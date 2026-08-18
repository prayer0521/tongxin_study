/* ================================================================
 *  UDP 客户端
 *  socket() -> sendto()/recvfrom() -> close()
 * ================================================================
 *
 *  四个程序里最简单的一个:没有 bind,没有 listen,没有 accept,
 *  连 connect 都不需要。socket() 完了直接就能发。
 *
 *  为什么不用 bind?
 *    和 TCP 客户端一样是【隐式绑定】:第一次 sendto 时内核自动
 *    分配一个临时端口。下面代码会打印出来给你看。
 *
 *  为什么不用 connect?
 *    因为 sendto 的参数里已经写了收件人地址。
 *    但 UDP 【也可以】connect,而且很有用 —— 见下面 --connect 模式。
 *    UDP 的 connect 不发任何网络包,只是在内核里记一个"默认对端"。
 *
 *  编译:  gcc -Wall -o udp_client udp_client.c
 *  运行:  ./udp_client 127.0.0.1 9999               # 交互模式
 *         ./udp_client 127.0.0.1 9999 hello         # 发一条
 *         ./udp_client 127.0.0.1 9999 --connect     # 演示 UDP 的 connect
 *         ./udp_client 127.0.0.1 9999 --big 2000    # 发超大包,演示截断
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define BUFSZ 65536

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
            "用法: %s <服务器IP> <端口> [消息 | --connect | --big N]\n"
            "例:   %s 127.0.0.1 9999\n", argv[0], argv[0]);
        return 1;
    }
    const char *ip   = argv[1];
    int         port = atoi(argv[2]);

    int use_connect = 0, big = 0;
    const char *oneshot = NULL;
    if (argc > 3) {
        if (strcmp(argv[3], "--connect") == 0)          use_connect = 1;
        else if (strcmp(argv[3], "--big") == 0 && argc > 4) big = atoi(argv[4]);
        else                                            oneshot = argv[3];
    }

    /* ============ 1. socket() ============ */
    setvbuf(stdout, NULL, _IOLBF, 0);   /* 行缓冲,见 tcp_server.c 同处注释 */
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    printf("[1] socket(SOCK_DGRAM) -> fd = %d\n", fd);

    /* ============ 关键:给接收加超时 ============
     * TCP 的对端挂了,你的 recv 会返回 0 或报错,你能知道。
     * UDP 的对端挂了,你的 recvfrom 会【永远卡在那里】——
     *   因为没有连接,内核根本不知道对方死没死,只能傻等。
     * 所以 UDP 客户端【必须】自己设超时,否则程序就是个死锁。
     * 这是 UDP"不可靠"最直接的体现。
     */
    struct timeval tv = { .tv_sec = 2, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    printf("    已设 2 秒接收超时 (UDP 必须自己管超时,不然会永远卡住)\n");

    /* ============ 2. 填服务器地址 ============ */
    struct sockaddr_in srv;
    memset(&srv, 0, sizeof(srv));
    srv.sin_family = AF_INET;
    srv.sin_port   = htons(port);
    if (inet_pton(AF_INET, ip, &srv.sin_addr) != 1) {
        fprintf(stderr, "IP 格式不对: %s\n", ip);
        close(fd);
        return 1;
    }

    /* ---- 模式:--connect 演示 UDP 上的 connect ---- */
    if (use_connect) {
        printf("\n[2] 对 UDP socket 调 connect()...\n");
        if (connect(fd, (struct sockaddr *)&srv, sizeof(srv)) < 0) {
            perror("connect"); close(fd); return 1;
        }
        printf("    立刻返回了,而且【一个网络包都没发】。\n");
        printf("    UDP 的 connect 只做两件事:\n");
        printf("      a) 在内核里记下默认对端,之后可以直接用 send/recv\n");
        printf("      b) 只接收这个对端发来的包,别人发的直接丢弃(过滤)\n");
        printf("    好处:能收到 ICMP 端口不可达错误了 —— 不 connect 的话\n");
        printf("          对方端口没开你也不知道,包就默默消失了。\n\n");

        const char *msg = "hello from connected udp";
        /* 已经 connect,可以用 send 而不是 sendto 了 */
        ssize_t n = send(fd, msg, strlen(msg), 0);
        printf("[3] send() %zd 字节 (不用 sendto 了,对端已记住)\n", n);

        char buf[BUFSZ];
        ssize_t r = recv(fd, buf, sizeof(buf) - 1, 0);
        if (r >= 0) { buf[r] = '\0'; printf("[4] recv() %zd 字节: \"%s\"\n", r, buf); }
        else if (errno == EAGAIN || errno == EWOULDBLOCK)
            printf("[4] recv 超时 —— 服务器没起?UDP 不会告诉你,只能超时\n");
        else if (errno == ECONNREFUSED)
            printf("[4] ECONNREFUSED —— 收到了 ICMP 端口不可达。\n"
                   "    这个错误【只有 connect 过的 UDP 才拿得到】\n");
        else perror("recv");

        close(fd);
        return 0;
    }

    /* ---- 模式:--big 发一个超大数据报,演示接收方截断 ---- */
    if (big > 0) {
        char *msg = malloc((size_t)big + 1);
        if (!msg) { perror("malloc"); close(fd); return 1; }
        memset(msg, 'A', (size_t)big);
        msg[big] = '\0';

        printf("\n[2] sendto() 一个 %d 字节的数据报\n", big);
        ssize_t n = sendto(fd, msg, (size_t)big, 0,
                           (struct sockaddr *)&srv, sizeof(srv));
        if (n < 0) {
            perror("sendto");
            if (errno == EMSGSIZE)
                printf("    EMSGSIZE: 超过了数据报的最大长度\n");
        } else {
            printf("    sendto 返回 %zd —— 注意它要么全发要么失败,\n"
                   "    不像 TCP 的 send 会部分发送\n", n);
            printf("    服务器的 buf 只有 1024 字节,去看它收到了多少 ->\n"
                   "    超出部分被内核【直接丢弃】,而且不报错\n");
        }
        free(msg);
        close(fd);
        return 0;
    }

    /* ============ 3. sendto():直接发,不需要建立连接 ============
     *
     * 这里是 UDP 和 TCP 最大的体感差异:
     *   TCP 必须先 connect 成功(三次握手)才能 send。
     *   UDP 直接 sendto,内核封个包就往网卡送,不管对面有没有人。
     *   哪怕服务器根本没启动,sendto 一样返回成功。
     */
    char buf[BUFSZ];

    if (oneshot) {
        printf("\n[2] sendto() \"%s\" -> %s:%d\n", oneshot, ip, port);
        ssize_t n = sendto(fd, oneshot, strlen(oneshot), 0,
                           (struct sockaddr *)&srv, sizeof(srv));
        if (n < 0) { perror("sendto"); close(fd); return 1; }
        printf("    发出 %zd 字节 (注意:返回成功≠对方收到)\n", n);

        /* 第一次 sendto 之后,内核才给我们分配了临时端口 */
        struct sockaddr_in me; socklen_t l = sizeof(me); char s[64];
        getsockname(fd, (struct sockaddr *)&me, &l);
        addr_str(&me, s, sizeof(s));
        printf("    我的地址现在是: %s  <- 第一次 sendto 时内核自动分的\n", s);

        struct sockaddr_in from; socklen_t fl = sizeof(from);
        ssize_t r = recvfrom(fd, buf, sizeof(buf) - 1, 0,
                             (struct sockaddr *)&from, &fl);
        if (r >= 0) {
            buf[r] = '\0';
            char fs[64]; addr_str(&from, fs, sizeof(fs));
            printf("[3] recvfrom() %zd 字节,来自 %s: \"%s\"\n", r, fs, buf);
        } else if (errno == EAGAIN || errno == EWOULDBLOCK) {
            printf("[3] 2 秒超时,没收到回复。\n"
                   "    可能:服务器没起 / 包丢了 / 回包丢了。\n"
                   "    UDP 不会告诉你是哪种 —— 这就是「不可靠」。\n");
        } else perror("recvfrom");

        close(fd);
        return 0;
    }

    /* ---- 默认:交互模式 ---- */
    printf("\n输入内容回车发送,Ctrl-D 或 quit 退出:\n");
    while (fgets(buf, sizeof(buf), stdin)) {
        size_t len = strlen(buf);
        if (len && buf[len - 1] == '\n') buf[--len] = '\0';
        if (len == 0) continue;
        if (strcmp(buf, "quit") == 0) break;

        if (sendto(fd, buf, len, 0, (struct sockaddr *)&srv, sizeof(srv)) < 0) {
            perror("sendto");
            break;
        }

        char rbuf[BUFSZ];
        struct sockaddr_in from; socklen_t fl = sizeof(from);
        ssize_t r = recvfrom(fd, rbuf, sizeof(rbuf) - 1, 0,
                             (struct sockaddr *)&from, &fl);
        if (r >= 0) {
            rbuf[r] = '\0';
            char fs[64]; addr_str(&from, fs, sizeof(fs));
            printf("  <- 来自 %s 的 %zd 字节: %s\n", fs, r, rbuf);
        } else if (errno == EAGAIN || errno == EWOULDBLOCK) {
            printf("  <- 超时,没有回复(丢包?服务器没起?)\n");
        } else {
            perror("recvfrom");
            break;
        }
    }

    /* close():对 UDP 来说就是释放 fd,【不发任何网络包】。
       没有四次挥手,没有 TIME_WAIT。对端完全不知道你走了。 */
    close(fd);
    printf("close() -> 仅释放 fd,没发任何包,对端不知情\n");
    return 0;
}
