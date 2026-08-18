/* ================================================================
 *  极简 HTTP 服务器 —— 用裸 socket 手写,不依赖任何库
 * ================================================================
 *
 *  本质:
 *    HTTP 就是 TCP 上面的【纯文本协议】。
 *    底下还是 socket/bind/listen/accept/recv/send 那一套,
 *    只是 recv 到的不再是随便什么字节,而是有格式的请求文本;
 *    send 回去的也不是随便什么字节,而是有格式的响应文本。
 *
 *    所以"实现 HTTP 服务器" = 在 tcp_server.c 的基础上加两件事:
 *      a) 解析请求文本(读懂浏览器要什么)
 *      b) 按格式拼响应文本(让浏览器认你的回复)
 *
 *  HTTP 请求长什么样(浏览器 send 给你的原始字节):
 *
 *      GET /hello HTTP/1.1\r\n          <- 请求行: 方法 路径 版本
 *      Host: 127.0.0.1:8080\r\n        <- 头部字段(若干行)
 *      User-Agent: Mozilla/5.0...\r\n
 *      Accept: text/html\r\n
 *      \r\n                             <- 空行 = 头部结束的标志
 *                                          (GET 没有 body,POST 有)
 *
 *  HTTP 响应长什么样(你 send 回去的原始字节):
 *
 *      HTTP/1.1 200 OK\r\n              <- 状态行: 版本 状态码 原因短语
 *      Content-Type: text/html\r\n      <- 告诉浏览器内容是 HTML
 *      Content-Length: 37\r\n           <- 告诉浏览器 body 有多少字节
 *      Connection: close\r\n            <- 响应完就关连接(最简单的做法)
 *      \r\n                             <- 空行 = 头部结束
 *      <h1>Hello from raw socket!</h1>  <- body(浏览器渲染的内容)
 *
 *  就这么简单。HTTP 不神秘,它就是一段有格式的 ASCII 文本。
 *
 *  编译:  gcc -Wall -o http_server http_server.c
 *  运行:  ./http_server 8080
 *  验证:  打开浏览器访问 http://127.0.0.1:8080/hello
 *         或者用 curl: curl -v http://127.0.0.1:8080/hello
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

#define DEF_PORT 8080
#define BACKLOG  128
#define BUFSZ    4096   /* HTTP 请求头一般不超过 8KB,4KB 够用于演示 */

/* ----------------------------------------------------------------
 * 把 HTTP 请求的第一行(请求行)解析出来
 *
 *   "GET /hello HTTP/1.1\r\n..."
 *    ^^^  ^^^^^^ ^^^^^^^^
 *   method  path  version
 *
 * 真实服务器还要解析后面的头部字段、处理 chunked encoding 等,
 * 这里只看第一行就够了 —— 路径决定返回什么内容。
 * ---------------------------------------------------------------- */
static int parse_request_line(const char *raw,
                              char *method, size_t msz,
                              char *path,   size_t psz)
{
    /* 找第一行的结尾 */
    const char *end = strstr(raw, "\r\n");
    if (!end) return -1;

    /* sscanf 按空格拆,简单粗暴但对合法请求足够 */
    if (sscanf(raw, "%63s %255s", method, path) != 2)
        return -1;
    (void)msz; (void)psz;   /* 抑制 unused 警告 */
    return 0;
}

/* ----------------------------------------------------------------
 * 构造 HTTP 响应并发回去
 *
 * 最核心的认知:HTTP 响应 = 状态行 + 头部 + 空行 + body
 * 全是文本,用 snprintf 拼就行。
 * ---------------------------------------------------------------- */
static void send_response(int cfd, int status, const char *status_text,
                          const char *content_type, const char *body)
{
    char resp[BUFSZ];
    size_t body_len = strlen(body);

    /* 拼响应。注意每一行以 \r\n 结尾,头部和 body 之间有一个空行 */
    int n = snprintf(resp, sizeof(resp),
        "HTTP/1.1 %d %s\r\n"               /* 状态行 */
        "Content-Type: %s\r\n"              /* body 的类型 */
        "Content-Length: %zu\r\n"           /* body 的字节数。不写的话浏览器
                                               不知道读到哪里算结束 —— 这也是
                                               "TCP 没有消息边界"的实际后果 */
        "Connection: close\r\n"             /* 告诉浏览器:响应完我就关连接。
                                               不写这个,HTTP/1.1 默认 keep-alive,
                                               浏览器会复用这条 TCP 连接发下一个请求。
                                               极简版我们不想处理这个,直接关。 */
        "\r\n"                              /* 空行:头部结束,下面是 body */
        "%s",                               /* body */
        status, status_text,
        content_type, body_len,
        body);

    /* send_all:还是老规矩,TCP 可能一次发不完 */
    size_t sent = 0;
    while (sent < (size_t)n) {
        ssize_t w = send(cfd, resp + sent, (size_t)n - sent, 0);
        if (w <= 0) break;
        sent += (size_t)w;
    }
}

/* ----------------------------------------------------------------
 * "路由":根据请求路径决定返回什么
 * 真实框架(Express/Flask/Spring)的路由本质上也就是一堆 if/strcmp
 * ---------------------------------------------------------------- */
static void handle_request(int cfd, const char *method, const char *path)
{
    printf("    请求: %s %s\n", method, path);

    if (strcmp(path, "/hello") == 0) {
        /* 正常响应:200 + HTML body */
        const char *html =
            "<!DOCTYPE html>\n"
            "<html><head><meta charset=\"utf-8\"><title>Hello</title></head>\n"
            "<body>\n"
            "  <h1>Hello from raw socket!</h1>\n"
            "  <p>这个页面是用 C 的 socket + send() 手写回去的,</p>\n"
            "  <p>没有用任何 HTTP 库、Web 框架。</p>\n"
            "  <p>你在浏览器看到这行字,说明整条链路:</p>\n"
            "  <pre>\n"
            "  浏览器 connect() -> 三次握手 -> send(HTTP请求)\n"
            "       -> 你的 C 程序 recv() -> 解析请求行 -> 拼 HTTP 响应\n"
            "       -> send(响应) -> 浏览器 recv() -> 渲染 HTML\n"
            "  </pre>\n"
            "  <p>全部跑通了。</p>\n"
            "  <hr>\n"
            "  <p><a href=\"/time\">看看 /time</a> | "
            "<a href=\"/not-exist\">看看 404</a></p>\n"
            "</body></html>\n";
        send_response(cfd, 200, "OK", "text/html; charset=utf-8", html);

    } else if (strcmp(path, "/time") == 0) {
        /* 第二个路由:返回简单文本 */
        char body[256];
        snprintf(body, sizeof(body),
            "Current PID: %d\nThis is plain text, not HTML.\n", getpid());
        send_response(cfd, 200, "OK", "text/plain; charset=utf-8", body);

    } else if (strcmp(path, "/") == 0) {
        /* 根路径:重定向到 /hello */
        char resp[256];
        snprintf(resp, sizeof(resp),
            "HTTP/1.1 302 Found\r\n"
            "Location: /hello\r\n"
            "Content-Length: 0\r\n"
            "Connection: close\r\n"
            "\r\n");
        send(cfd, resp, strlen(resp), 0);

    } else {
        /* 不认识的路径:404 */
        char body[256];
        snprintf(body, sizeof(body),
            "<h1>404 Not Found</h1><p>没有 %s 这个路径</p>", path);
        send_response(cfd, 404, "Not Found", "text/html; charset=utf-8", body);
    }
}

int main(int argc, char *argv[])
{
    int port = (argc > 1) ? atoi(argv[1]) : DEF_PORT;

    signal(SIGPIPE, SIG_IGN);
    setvbuf(stdout, NULL, _IOLBF, 0);

    /* ===== 下面这些和 tcp_server.c 一模一样,一行不改 ===== */
    int lfd = socket(AF_INET, SOCK_STREAM, 0);
    if (lfd < 0) { perror("socket"); return 1; }

    int on = 1;
    setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));

    struct sockaddr_in srv;
    memset(&srv, 0, sizeof(srv));
    srv.sin_family      = AF_INET;
    srv.sin_port        = htons(port);
    srv.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(lfd, (struct sockaddr *)&srv, sizeof(srv)) < 0) {
        perror("bind"); close(lfd); return 1;
    }
    if (listen(lfd, BACKLOG) < 0) {
        perror("listen"); close(lfd); return 1;
    }

    printf("HTTP 服务器启动: http://127.0.0.1:%d/hello\n", port);
    printf("打开浏览器访问上面的地址,或者: curl -v http://127.0.0.1:%d/hello\n\n", port);

    /* ===== 主循环:和 tcp_server.c 结构完全一样 ===== */
    for (;;) {
        struct sockaddr_in cli;
        socklen_t clilen = sizeof(cli);

        int cfd = accept(lfd, (struct sockaddr *)&cli, &clilen);
        if (cfd < 0) {
            if (errno == EINTR) continue;
            perror("accept");
            break;
        }

        char cs[64];
        char ip[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &cli.sin_addr, ip, sizeof(ip));
        snprintf(cs, sizeof(cs), "%s:%d", ip, ntohs(cli.sin_port));
        printf("[accept] 新连接来自 %s (fd=%d)\n", cs, cfd);

        /* ===== 这里开始不一样:读取并解析 HTTP 请求 ===== */
        char buf[BUFSZ];
        ssize_t n = recv(cfd, buf, sizeof(buf) - 1, 0);

        if (n <= 0) {
            /* 浏览器可能建了连接就关了(预连接/健康检查) */
            printf("    recv() = %zd,连接立刻关闭了\n", n);
            close(cfd);
            continue;
        }
        buf[n] = '\0';

        /* 先解析请求行(在修改 buf 之前!) */
        char method[64], path[256];
        int parse_ok = parse_request_line(buf, method, sizeof(method),
                                          path, sizeof(path));

        /* 打印浏览器发来的原始 HTTP 请求 —— 这是最有学习价值的输出 */
        printf("    ┌─ 浏览器发来的 HTTP 请求原文(%zd 字节)─────────────\n", n);
        /* 逐行打印(用副本,不破坏原文) */
        {
            char copy[BUFSZ];
            memcpy(copy, buf, (size_t)n + 1);
            char *line = copy;
            for (char *p = copy; *p; p++) {
                if (*p == '\n') {
                    *p = '\0';
                    if (p > line && *(p-1) == '\r') *(p-1) = '\0';
                    printf("    │ %s\n", line);
                    line = p + 1;
                }
            }
            if (*line) printf("    │ %s\n", line);
        }
        printf("    └────────────────────────────────────────────────\n");

        if (parse_ok < 0) {
            send_response(cfd, 400, "Bad Request",
                          "text/plain", "Malformed request\n");
            close(cfd);
            continue;
        }

        /* 根据路径生成响应并发回 */
        handle_request(cfd, method, path);

        /* Connection: close —— 响应完就关连接
         * 这是 HTTP/1.0 的做法。HTTP/1.1 默认 keep-alive,
         * 即一条 TCP 连接上连续收发多个请求/响应(减少握手开销)。
         * 极简版不实现 keep-alive,每个请求用一条新连接。
         * 因为我们在响应头里写了 Connection: close,浏览器会配合。
         */
        close(cfd);
        printf("    [close] 响应完毕,关闭连接\n\n");
    }

    close(lfd);
    return 0;
}
