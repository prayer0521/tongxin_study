/* ================================================================
 *  TCP 服务器
 *  socket() -> bind() -> listen() -> accept() -> recv()/send() -> close()
 * ================================================================
 *
 *  五个调用各自回答一个问题:
 *
 *    socket()  "给我一个通信端点"     -> 得到一个 fd,此时它还没有地址
 *    bind()    "我在哪个 IP:端口"      -> 给 fd 贴上地址标签
 *    listen()  "我不主动连人,我等人连我" -> fd 从"主动"变成"被动(监听)"
 *    accept()  "取出一个已经握完手的连接" -> 得到【另一个新的】fd
 *    recv/send "在新 fd 上收发字节流"
 *
 *  最容易错的一点:
 *    accept() 返回的是【新 fd】。监听 fd 永远不用来收发数据,
 *    它只负责"生小孩"。一个监听 fd 可以生出成千上万个连接 fd。
 *
 *  编译:  gcc -Wall -o tcp_server tcp_server.c
 *  运行:  ./tcp_server 8888
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

#define DEF_PORT 8888
#define BACKLOG  128     /* 已完成握手队列的长度,见 实验手册.md 实验三 */
#define BUFSZ    1024

/* ----------------------------------------------------------------
 * send() 不保证一次发完!
 * 内核发送缓冲区可能只剩 100 字节,你要发 1000,它就只发 100 并返回 100。
 * 所以凡是 send 都必须写成循环。这是新手最常见的 bug。
 * (Python 里 sendall() 帮你做了这个循环)
 * ---------------------------------------------------------------- */
static ssize_t send_all(int fd, const char *buf, size_t len)
{
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = send(fd, buf + sent, len - sent, 0);
        if (n < 0) {
            if (errno == EINTR) continue;   /* 被信号打断,不算错误,重试 */
            return -1;                      /* 真错了,比如对端已关闭 EPIPE */
        }
        sent += (size_t)n;
    }
    return (ssize_t)sent;
}

/* 把 sockaddr_in 打印成 "127.0.0.1:54321" 的形式 */
static void addr_str(const struct sockaddr_in *a, char *out, size_t n)
{
    char ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &a->sin_addr, ip, sizeof(ip));
    snprintf(out, n, "%s:%d", ip, ntohs(a->sin_port));
}

int main(int argc, char *argv[])
{
    int port = (argc > 1) ? atoi(argv[1]) : DEF_PORT;

    /* stdout 重定向到文件/管道时默认是【全缓冲】,输出会攒着不出来,
       进程被 kill 时就全丢了。改成行缓冲,每行立刻可见。
       调试网络程序时这一行能省掉很多"我的 printf 怎么没打印"的困惑。 */
    setvbuf(stdout, NULL, _IOLBF, 0);

    /* 对端已经关闭连接,你还往里 send,内核会给进程发 SIGPIPE,
       默认行为是【直接杀死进程】。忽略它,让 send() 老老实实返回 -1
       并把 errno 设成 EPIPE,由我们自己判断。 */
    signal(SIGPIPE, SIG_IGN);

    /* ============ 1. socket():申请一个通信端点 ============
     *   AF_INET     -> IPv4     (AF_INET6 是 IPv6,AF_UNIX 是本机文件套接字)
     *   SOCK_STREAM -> 字节流   (TCP)。UDP 是 SOCK_DGRAM
     *   0           -> 协议自动选:STREAM+INET 就是 TCP
     *
     * 返回一个 fd。它和 open() 返回的文件 fd 是同一套东西,
     * 所以 read/write/close 也能用在 socket 上。
     * 此刻这个 fd 没有地址,谁也找不到它。
     */
    int lfd = socket(AF_INET, SOCK_STREAM, 0);
    if (lfd < 0) { perror("socket"); return 1; }
    printf("[1] socket()  -> 监听fd = %d  (还没有地址)\n", lfd);

    /* ============ 1.5 SO_REUSEADDR:上一个连接的 TIME_WAIT 别挡我 ============
     * 服务器关闭后,内核会让那个端口在 TIME_WAIT 状态停留 ~60 秒。
     * 期间再 bind 同一个端口会报 "Address already in use"。
     * 这个选项让你能立刻重启服务器。
     * 试试注释掉这三行,然后看 实验手册.md 实验四。
     */
    int on = 1;
    if (setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on)) < 0)
        perror("setsockopt");

    /* ============ 2. bind():把地址贴到 fd 上 ============
     * sockaddr_in 是 IPv4 专用的地址结构:
     *
     *   struct sockaddr_in {
     *       sa_family_t    sin_family;  // AF_INET
     *       in_port_t      sin_port;    // 端口,【网络字节序】
     *       struct in_addr sin_addr;    // IP,  【网络字节序】
     *       char           sin_zero[8]; // 填充,清零就行
     *   };
     *
     * 为什么要 htons/htonl?
     *   网络字节序 = 大端。x86 是小端。端口 8888 = 0x22B8,
     *   小端机器内存里是 B8 22,直接发出去对方读成 0xB822 = 47138。
     *   htons = Host TO Network Short(16位), htonl 是 Long(32位)。
     *
     * INADDR_ANY (0.0.0.0) = 监听本机所有网卡。
     *   如果写 inet_addr("127.0.0.1"),就只有本机能连,外部机器连不上。
     */
    struct sockaddr_in srv;
    memset(&srv, 0, sizeof(srv));           /* 必须清零,尤其 sin_zero */
    srv.sin_family      = AF_INET;
    srv.sin_port        = htons(port);      /* 主机序 -> 网络序 */
    srv.sin_addr.s_addr = htonl(INADDR_ANY);

    /* 强制转成 struct sockaddr*:这是 90 年代没有 void* 泛型时留下的写法,
       内核靠第一个字段 sa_family 判断你实际传的是 IPv4 还是 IPv6 结构。 */
    if (bind(lfd, (struct sockaddr *)&srv, sizeof(srv)) < 0) {
        perror("bind");   /* 最常见:端口被占 / 端口 <1024 但不是 root */
        close(lfd);
        return 1;
    }
    printf("[2] bind()    -> 0.0.0.0:%d  (现在别人能找到我了)\n", port);

    /* ============ 3. listen():从"主动"变"被动" ============
     * 这一步内核做了两件事:
     *   a) 把 fd 标记为被动套接字 —— 它以后【不能再 connect】,只能 accept
     *   b) 创建两个队列:
     *        半连接队列(SYN queue)   : 收到 SYN,回了 SYN+ACK,还在等对方 ACK
     *        全连接队列(accept queue): 三次握手完成,等着你 accept() 来取
     *      backlog 影响的是【全连接队列】的长度上限。
     *
     * 关键认知:三次握手是【内核自动完成】的,不需要你写任何代码。
     *   listen() 一调用完,内核就开始替你握手了。
     *   accept() 只是从"已经握完手的一堆连接"里拿一个出来,
     *   它并不参与握手本身。
     *   所以就算你的程序卡住不 accept,客户端的 connect() 也能成功返回!
     *   (见 实验手册.md 实验三)
     */
    if (listen(lfd, BACKLOG) < 0) { perror("listen"); close(lfd); return 1; }
    printf("[3] listen()  -> backlog=%d  (内核开始替我三次握手)\n", BACKLOG);
    printf("    等待连接... 另开终端跑: ./tcp_client 127.0.0.1 %d\n\n", port);

    /* ============ 主循环:一次服务一个客户端 ============
     * 注意这是【单线程串行】的:必须等当前客户端断开,才能服务下一个。
     * 这是故意的 —— 这样你才能亲眼看到 backlog 队列堆积。
     * 真实服务器要用 fork / 线程 / epoll,见 README.md 末尾。
     */
    for (;;) {
        struct sockaddr_in cli;
        socklen_t clilen = sizeof(cli);   /* 【值-结果参数】:传入缓冲区大小,
                                             返回时内核改写成实际写入的长度。
                                             忘了初始化 = 未定义行为,常见 bug */

        /* ============ 4. accept():取出一个已完成的连接 ============
         * 阻塞在这里,直到全连接队列里有东西。
         * 返回一个【全新的 fd】,代表这一条具体的连接。
         * 第二个参数是输出参数:内核填入对端地址(不关心可以传 NULL)。
         */
        int cfd = accept(lfd, (struct sockaddr *)&cli, &clilen);
        if (cfd < 0) {
            if (errno == EINTR) continue;
            perror("accept");
            break;
        }

        char cs[64], ls[64];
        addr_str(&cli, cs, sizeof(cs));

        /* getsockname:查这条连接在【我这一侧】的地址。
           能看到它就是 0.0.0.0:8888 具体化后的本机 IP:8888 */
        struct sockaddr_in loc;
        socklen_t loclen = sizeof(loc);
        getsockname(cfd, (struct sockaddr *)&loc, &loclen);
        addr_str(&loc, ls, sizeof(ls));

        printf("[4] accept()  -> 新fd = %d   (监听fd %d 依然在监听)\n", cfd, lfd);
        printf("    这条连接的四元组: %s <--> %s\n", ls, cs);
        printf("    ↑ TCP 靠这个四元组区分不同连接,所以同一个 8888 端口\n"
               "      可以同时挂着几万条连接,不会冲突\n");

        /* ============ 5. recv() / send():收发数据 ============ */
        char buf[BUFSZ];
        for (;;) {
            /* recv 的返回值有三种含义,必须分清:
             *    > 0  实际收到的【字节数】
             *   == 0  对端调用了 close(),发来 FIN。这不是错误,是"正常结束"
             *    < 0  出错,看 errno
             *
             * 巨坑:recv 收到的是【字节流】,不是"一条消息"。
             *   客户端 send 三次,你可能一次 recv 就全收到了(粘包);
             *   客户端 send 一次 10KB,你可能要 recv 好几次才收全(拆包)。
             *   TCP 不保证消息边界 —— 边界要靠你自己在应用层定
             *   (加长度头,或用 \n 分隔)。见 实验手册.md 实验五。
             */
            ssize_t n = recv(cfd, buf, sizeof(buf) - 1, 0);

            if (n == 0) {
                printf("    recv() == 0  -> 对端关闭了连接(收到 FIN)\n");
                break;
            }
            if (n < 0) {
                if (errno == EINTR) continue;
                perror("recv");
                break;
            }

            buf[n] = '\0';
            printf("    recv() = %zd 字节: \"%s\"\n", n, buf);

            /* 原样回送(echo)。用循环版的 send_all,理由见函数注释 */
            if (send_all(cfd, buf, (size_t)n) < 0) {
                if (errno == EPIPE)
                    printf("    send() EPIPE -> 对端已经关了,写不进去\n");
                else
                    perror("send");
                break;
            }
            printf("    send() 回送 %zd 字节\n", n);
        }

        /* ============ 6. close():关闭这一条连接 ============
         * 发 FIN 给对端,开始四次挥手。
         * 只关 cfd,lfd 继续留着接待下一个客户端。
         */
        close(cfd);
        printf("[6] close(%d) -> 该连接结束,回到 accept() 等下一个\n\n", cfd);
    }

    close(lfd);
    return 0;
}
