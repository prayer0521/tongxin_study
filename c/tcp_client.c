/* ================================================================
 *  TCP 客户端
 *  socket() -> connect() -> send()/recv() -> close()
 * ================================================================
 *
 *  和服务器比,客户端少了 bind() 和 listen()/accept():
 *
 *    没有 bind  ->  不是不绑,是【内核帮你绑】。connect() 的瞬间内核
 *                   自动选一个空闲的临时端口(32768-60999),这叫
 *                   "隐式绑定"。你也可以手动 bind,见下面 --bind 选项。
 *    没有 listen ->  你是主动方,不需要等别人连你。
 *    没有 accept ->  accept 是"取出别人发起的连接",客户端不接客。
 *
 *  connect() 才是真正触发【三次握手】的那一下:
 *      客户端 --SYN-->     服务器
 *      客户端 <--SYN+ACK-- 服务器
 *      客户端 --ACK-->     服务器      <- connect() 在这里返回成功
 *
 *  编译:  gcc -Wall -o tcp_client tcp_client.c
 *  运行:  ./tcp_client 127.0.0.1 8888              # 交互模式,输入什么发什么
 *         ./tcp_client 127.0.0.1 8888 hello        # 发一条就退出
 *         ./tcp_client 127.0.0.1 8888 --burst 5    # 连发5条,演示粘包
 *         ./tcp_client 127.0.0.1 8888 --noread     # 连上不收不发,演示 backlog
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define BUFSZ 4096

static ssize_t send_all(int fd, const char *buf, size_t len)
{
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = send(fd, buf + sent, len - sent, 0);
        if (n < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        sent += (size_t)n;
    }
    return (ssize_t)sent;
}

static void addr_str(const struct sockaddr_in *a, char *out, size_t n)
{
    char ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &a->sin_addr, ip, sizeof(ip));
    snprintf(out, n, "%s:%d", ip, ntohs(a->sin_port));
}

int main(int argc, char *argv[])
{
    if (argc < 3) {
        fprintf(stderr,
            "用法: %s <服务器IP> <端口> [消息 | --burst N | --noread]\n"
            "例:   %s 127.0.0.1 8888\n", argv[0], argv[0]);
        return 1;
    }
    const char *ip   = argv[1];
    int         port = atoi(argv[2]);

    int   burst  = 0;
    int   noread = 0;
    const char *oneshot = NULL;
    if (argc > 3) {
        if (strcmp(argv[3], "--burst") == 0 && argc > 4) burst = atoi(argv[4]);
        else if (strcmp(argv[3], "--noread") == 0)       noread = 1;
        else                                             oneshot = argv[3];
    }

    signal(SIGPIPE, SIG_IGN);
    setvbuf(stdout, NULL, _IOLBF, 0);   /* 行缓冲,见 tcp_server.c 同处注释 */

    /* ============ 1. socket() ============
     * 和服务器一模一样。此时它还没有地址,也不知道要连谁。 */
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    printf("[1] socket()  -> fd = %d\n", fd);

    /* 证明"此时还没有地址":getsockname 会返回 0.0.0.0:0 */
    {
        struct sockaddr_in me; socklen_t l = sizeof(me);
        char s[64];
        getsockname(fd, (struct sockaddr *)&me, &l);
        addr_str(&me, s, sizeof(s));
        printf("    此刻我的地址: %s   <- 全是 0,内核还没分配\n", s);
    }

    /* ============ 2. 填服务器地址 ============
     * 注意:这个结构体描述的是【对方】,不是自己。
     * 服务器 bind 时填的是自己,客户端 connect 时填的是对方。
     * 同一个结构体,两种用途 —— 这点最容易绕晕。
     *
     * inet_pton = presentation(字符串) TO network(二进制,网络字节序)
     *   "127.0.0.1" -> 0x0100007F(小端内存布局)
     *   返回值: 1 成功 / 0 字符串格式不对 / -1 出错
     *   老代码用 inet_addr(),它无法区分"出错"和"255.255.255.255",别用了。
     */
    struct sockaddr_in srv;
    memset(&srv, 0, sizeof(srv));
    srv.sin_family = AF_INET;
    srv.sin_port   = htons(port);
    if (inet_pton(AF_INET, ip, &srv.sin_addr) != 1) {
        fprintf(stderr, "IP 格式不对: %s\n", ip);
        close(fd);
        return 1;
    }

    /* ============ 3. connect():三次握手 ============
     * 阻塞,直到:
     *   握手成功              -> 返回 0
     *   服务器端口没人监听    -> 内核收到 RST,返回 ECONNREFUSED(很快)
     *   IP 不可达/被防火墙丢弃 -> 一直重发 SYN,最后 ETIMEDOUT(要等 ~2分钟)
     *
     * 重要:connect() 成功【不代表服务器调用了 accept()】。
     *   只要内核完成了三次握手,连接就进全连接队列,connect 就返回成功。
     *   服务器可能还在忙别的,压根没 accept。见 实验手册.md 实验三。
     */
    printf("[2] connect() -> 正在和 %s:%d 三次握手...\n", ip, port);
    if (connect(fd, (struct sockaddr *)&srv, sizeof(srv)) < 0) {
        perror("connect");
        if (errno == ECONNREFUSED)
            fprintf(stderr, "    -> 端口没人监听。服务器起了吗?\n");
        close(fd);
        return 1;
    }
    printf("[3] connect() 成功 —— 握手完成\n");

    /* 现在再看自己的地址:内核已经自动分配了一个临时端口 */
    {
        struct sockaddr_in me, pe;
        socklen_t l1 = sizeof(me), l2 = sizeof(pe);
        char s1[64], s2[64];
        getsockname(fd, (struct sockaddr *)&me, &l1);  /* 我这一侧 */
        getpeername(fd, (struct sockaddr *)&pe, &l2);  /* 对端 */
        addr_str(&me, s1, sizeof(s1));
        addr_str(&pe, s2, sizeof(s2));
        printf("    我的地址: %s  <- 内核自动分的临时端口(隐式 bind)\n", s1);
        printf("    对端地址: %s\n", s2);
    }

    /* ---- 模式 A: --noread 连上就赖着不动,用来把服务器的队列撑满 ---- */
    if (noread) {
        printf("    [--noread] 保持连接不发不收,Ctrl-C 退出\n");
        pause();
        close(fd);
        return 0;
    }

    char buf[BUFSZ];

    /* ---- 模式 B: --burst 连续快速发 N 条,演示 TCP 没有消息边界 ---- */
    if (burst > 0) {
        printf("\n[4] 连续 send() %d 次,中间不停顿、不加任何分隔符:\n", burst);
        for (int i = 0; i < burst; i++) {
            char msg[64];
            int  len = snprintf(msg, sizeof(msg), "PKT-%02d", i);
            if (send_all(fd, msg, (size_t)len) < 0) { perror("send"); break; }
            printf("    send() \"%s\" (%d 字节)\n", msg, len);
        }
        /* 睡一下,让服务器的回送都到齐,再一次性读 */
        usleep(300 * 1000);
        ssize_t n = recv(fd, buf, sizeof(buf) - 1, 0);
        if (n > 0) {
            buf[n] = '\0';
            printf("\n[5] 只 recv() 了【一次】,收到 %zd 字节: \"%s\"\n", n, buf);
            printf("    ↑ %d 条消息粘成了一坨。这就是「粘包」。\n", burst);
            printf("      TCP 是字节流,它从不保证「你发几次我就收几次」。\n");
        }
        close(fd);
        return 0;
    }

    /* ---- 模式 C: 命令行直接给了一条消息,发完就走 ---- */
    if (oneshot) {
        size_t len = strlen(oneshot);
        printf("\n[4] send() \"%s\" (%zu 字节)\n", oneshot, len);
        if (send_all(fd, oneshot, len) < 0) { perror("send"); close(fd); return 1; }

        ssize_t n = recv(fd, buf, sizeof(buf) - 1, 0);
        if (n > 0)  { buf[n] = '\0'; printf("[5] recv() %zd 字节: \"%s\"\n", n, buf); }
        else if (n == 0) printf("[5] recv() == 0,服务器关闭了连接\n");
        else perror("recv");

        close(fd);
        printf("[6] close() -> 发 FIN,四次挥手\n");
        return 0;
    }

    /* ---- 模式 D(默认): 交互式,从键盘读一行发一行 ---- */
    printf("\n输入内容回车发送,Ctrl-D 或输入 quit 退出:\n");
    while (fgets(buf, sizeof(buf), stdin)) {
        size_t len = strlen(buf);
        if (len && buf[len - 1] == '\n') buf[--len] = '\0';   /* 去掉换行 */
        if (len == 0) continue;
        if (strcmp(buf, "quit") == 0) break;

        if (send_all(fd, buf, len) < 0) { perror("send"); break; }

        char rbuf[BUFSZ];
        ssize_t n = recv(fd, rbuf, sizeof(rbuf) - 1, 0);
        if (n == 0) { printf("服务器关闭了连接\n"); break; }
        if (n < 0)  { perror("recv"); break; }
        rbuf[n] = '\0';
        printf("  <- 服务器回送 %zd 字节: %s\n", n, rbuf);
    }

    /* ============ close():发 FIN,四次挥手 ============
     * 主动关闭的一方会进入 TIME_WAIT,持续 2*MSL(Linux 上约 60 秒)。
     * 用 `ss -tan | grep TIME-WAIT` 能看到。见 实验手册.md 实验四。
     */
    close(fd);
    printf("close() -> 连接结束\n");
    return 0;
}
