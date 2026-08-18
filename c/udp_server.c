/* ================================================================
 *  UDP 服务器
 *  socket() -> bind() -> recvfrom()/sendto() -> close()
 * ================================================================
 *
 *  和 TCP 服务器对比,少了两个调用,多了一个麻烦:
 *
 *    没有 listen()  -> UDP 没有"连接"这个概念,自然没有连接队列可排。
 *    没有 accept()  -> 没有连接可取。所有客户端的数据都从【同一个 fd】进来。
 *
 *    多的麻烦: TCP 的 cfd 天生记着"对面是谁",send() 直接就能回。
 *              UDP 只有一个 fd,你必须用 recvfrom() 的输出参数
 *              把"这个包是谁发的"记下来,再 sendto() 回去。
 *              这就是 recvfrom/sendto 相比 recv/send 多出来的两个参数的意义。
 *
 *  一句话记忆:
 *      TCP = 打电话(先拨号建立通路,之后只管说)
 *      UDP = 寄明信片(每张都要写收件人地址,寄不到也不通知你)
 *
 *  编译:  gcc -Wall -o udp_server udp_server.c
 *  运行:  ./udp_server 9999
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define DEF_PORT 9999
#define BUFSZ    1024

static void addr_str(const struct sockaddr_in *a, char *out, size_t n)
{
    char ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &a->sin_addr, ip, sizeof(ip));
    snprintf(out, n, "%s:%d", ip, ntohs(a->sin_port));
}

int main(int argc, char *argv[])
{
    int port = (argc > 1) ? atoi(argv[1]) : DEF_PORT;

    /* 行缓冲:重定向到文件时也能实时看到输出,详见 tcp_server.c 同处注释 */
    setvbuf(stdout, NULL, _IOLBF, 0);

    /* ============ 1. socket():注意第二个参数变了 ============
     *   SOCK_DGRAM  -> 数据报 (UDP)。TCP 是 SOCK_STREAM。
     *
     * 就改了这一个常量,内核给你的东西就完全不同了:
     *   SOCK_STREAM: 有序、可靠、无边界的字节流
     *   SOCK_DGRAM : 无序、不可靠、【有边界】的数据报
     *
     * "有边界"是 UDP 唯一比 TCP 省心的地方:
     *   对方 sendto 一次 = 你 recvfrom 一次,不多不少。
     *   永远不会粘包。但会丢包、会乱序、会重复。
     */
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    printf("[1] socket(SOCK_DGRAM) -> fd = %d\n", fd);

    int on = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));

    /* ============ 2. bind():和 TCP 完全一样 ============
     * 服务器必须 bind,道理和 TCP 一样:客户端得知道往哪个端口发。
     * 地址结构、htons、INADDR_ANY 全部同 TCP,一个字都不用改。
     */
    struct sockaddr_in srv;
    memset(&srv, 0, sizeof(srv));
    srv.sin_family      = AF_INET;
    srv.sin_port        = htons(port);
    srv.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(fd, (struct sockaddr *)&srv, sizeof(srv)) < 0) {
        perror("bind");
        close(fd);
        return 1;
    }
    printf("[2] bind() -> 0.0.0.0:%d\n", port);

    /* ============ 没有 listen(),没有 accept() ============
     * 到这里 UDP 服务器就已经能收数据了。
     * 试试对 UDP 的 fd 调 listen():会返回 -1,errno = EOPNOTSUPP
     *   (操作不支持) —— 内核明确告诉你"数据报套接字不支持监听"。
     * 取消下面两行的注释可以亲眼看到:
     */
    /* if (listen(fd, 5) < 0) perror("[验证] 对 UDP 调 listen"); */
    /* accept(fd, NULL, NULL) 同理,errno = EOPNOTSUPP */

    printf("[3] 没有 listen / accept —— UDP 没有连接可监听、可接受\n");
    printf("    等待数据报... 另开终端: ./udp_client 127.0.0.1 %d\n\n", port);

    for (;;) {
        char buf[BUFSZ];
        struct sockaddr_in cli;
        socklen_t clilen = sizeof(cli);   /* 值-结果参数,必须先赋值! */

        /* ============ 3. recvfrom():收一个数据报,顺便问出发件人 ============
         *
         *   ssize_t recvfrom(int fd, void *buf, size_t len, int flags,
         *                    struct sockaddr *src_addr,   <- 【输出】谁发的
         *                    socklen_t *addrlen);         <- 值-结果参数
         *
         * 返回值和 TCP 的 recv 有个关键区别:
         *   TCP: recv 返回 0  = 对端关闭连接(FIN)
         *   UDP: recvfrom 返回 0 = 真的收到了一个【长度为 0 的空包】,
         *        完全合法!UDP 没有连接,也就没有"关闭"这回事,
         *        所以 UDP 里永远不要用 "== 0" 判断结束。
         *
         * 另一个坑:如果对方发了 2000 字节而 buf 只有 1024,
         *   多出来的 976 字节会被【直接丢弃】,而且默认不告诉你。
         *   加 MSG_TRUNC 标志才能拿到"原始长度"来发现截断。
         *   见 实验手册.md 实验六。
         */
        ssize_t n = recvfrom(fd, buf, sizeof(buf) - 1, 0,
                             (struct sockaddr *)&cli, &clilen);
        if (n < 0) {
            if (errno == EINTR) continue;
            perror("recvfrom");
            break;
        }

        buf[n] = '\0';
        char cs[64];
        addr_str(&cli, cs, sizeof(cs));
        printf("[4] recvfrom() 收到 %zd 字节,来自 %s: \"%s\"\n", n, cs, buf);

        /* ============ 4. sendto():回给刚才那个地址 ============
         *
         *   ssize_t sendto(int fd, const void *buf, size_t len, int flags,
         *                  const struct sockaddr *dest_addr,  <- 【输入】发给谁
         *                  socklen_t addrlen);                <- 普通值,不是指针
         *
         * 注意 dest_addr 就是上面 recvfrom 填出来的 cli。
         * 这就是 UDP 服务器的核心套路:【收的时候记下地址,回的时候用它】。
         *
         * 和 TCP 的 send 另一个区别:
         *   sendto 【不会】部分发送。要么整个数据报进内核缓冲区(返回 len),
         *   要么失败(返回 -1)。所以 UDP 不需要写 send_all 那样的循环。
         *   但"进了内核缓冲区"不等于"对方收到了" —— UDP 不保证送达,
         *   sendto 返回成功只说明"我交给网卡了"。
         */
        ssize_t m = sendto(fd, buf, (size_t)n, 0,
                           (struct sockaddr *)&cli, clilen);
        if (m < 0) perror("sendto");
        else printf("    sendto() 回送 %zd 字节给 %s\n\n", m, cs);

        /* 循环回去继续收。注意:【不需要 close】。
           UDP 没有连接,这个 fd 从头到尾就一个,服务所有客户端。
           TCP 服务器每个客户端都要 close(cfd),UDP 完全不用。 */
    }

    close(fd);
    return 0;
}
