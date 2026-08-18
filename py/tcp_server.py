#!/usr/bin/env python3
"""
TCP 服务器 —— 和 c/tcp_server.c 逐段对照

Python 的 socket 模块是 C API 的【薄封装】,函数名一一对应。
读这个文件的正确方式:把 c/tcp_server.c 并排打开,看少了什么。

少掉的东西一览:
    struct sockaddr_in + memset + htons   -> 一个元组 ('0.0.0.0', 8888)
    (struct sockaddr *) 强制转换           -> 没有了
    char buf[1024] 预分配                  -> recv(1024) 直接返回 bytes
    返回值 < 0 判断 + errno                -> raise OSError,用 try/except
    send 循环                              -> sendall()
    close()                                -> with 语句自动关

【没有】少掉的东西(说明它们是本质,不是 C 的历史包袱):
    socket / bind / listen / accept / recv / send 六个调用一个不少
    accept 返回新 socket 这件事
    recv 返回 b'' 表示对端关闭
    TCP 没有消息边界(粘包照样发生)

运行:  python3 tcp_server.py 8888
"""
import socket
import sys

PORT    = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
BACKLOG = 128
BUFSZ   = 1024

# ============ 1. socket() ============
# 参数和 C 一模一样,只是常量挂在 socket 模块下。
# AF_INET = IPv4, SOCK_STREAM = TCP
# C: int lfd = socket(AF_INET, SOCK_STREAM, 0);
lfd = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
print(f"[1] socket()  -> fd = {lfd.fileno()}   (fileno() 就是 C 里那个 int)")

# ============ 1.5 SO_REUSEADDR ============
# C: setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
# Python 帮你处理了 &on 和 sizeof,直接传 1。
lfd.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

# ============ 2. bind() ============
# C 里要 10 行(memset / sin_family / htons / htonl / 强制转换),
# 这里就一行。元组 ('0.0.0.0', PORT) 在底层被翻译成 struct sockaddr_in:
#     '0.0.0.0' -> inet_pton -> sin_addr
#     PORT      -> htons     -> sin_port      <- 字节序转换是隐式做的!
#
# 这是 Python 隐藏得最彻底的一处。你永远不会在 Python 里写 htons,
# 但它确实发生了 —— 因为网络字节序是协议规定,不是语言能绕过的。
lfd.bind(('0.0.0.0', PORT))
print(f"[2] bind()    -> 0.0.0.0:{PORT}")
print("    注意:这里没写 htons,但底层照样做了主机序->网络序转换")

# ============ 3. listen() ============
# 和 C 完全一样。参数就是 backlog。
# 同样地:三次握手由内核自动完成,和你 accept 不 accept 无关。
lfd.listen(BACKLOG)
print(f"[3] listen({BACKLOG}) -> 变成被动套接字,内核开始替我握手")
print(f"    等待连接... 另开终端: python3 tcp_client.py 127.0.0.1 {PORT}\n")

try:
    while True:
        # ============ 4. accept() ============
        # C: int cfd = accept(lfd, (struct sockaddr*)&cli, &clilen);
        #    - 新 fd 用返回值拿
        #    - 对端地址用输出参数 &cli 拿
        #    - clilen 是值-结果参数,还得记得初始化
        #
        # Python 把两个"输出"合并成一个元组返回,值-结果参数彻底消失。
        # 但本质没变:conn 是【一个全新的 socket 对象】,lfd 还在监听。
        conn, addr = lfd.accept()

        print(f"[4] accept()  -> 新 fd = {conn.fileno()}  (监听 fd {lfd.fileno()} 还在)")
        print(f"    四元组: {conn.getsockname()} <--> {conn.getpeername()}")
        #                    ↑ C 的 getsockname()      ↑ C 的 getpeername()

        # with 语句 = C 里的 close(cfd),而且异常时也保证执行
        with conn:
            while True:
                # ============ 5. recv() ============
                # C: ssize_t n = recv(cfd, buf, sizeof(buf)-1, 0);
                #    你先分配 buf,内核填进去,返回填了多少字节。
                # Python: 你说要多少,它返回一个新的 bytes 对象。
                #
                # 三种情况的对应关系:
                #    C: n > 0   <->  Python: 非空 bytes
                #    C: n == 0  <->  Python: b''      <- 对端关闭(FIN)
                #    C: n < 0   <->  Python: raise OSError
                #
                # 注意返回的是 bytes 不是 str。网络上跑的永远是字节,
                # Python 3 逼你显式 decode,这其实是好事。
                data = conn.recv(BUFSZ)

                if not data:            # b'' —— 等价于 C 的 n == 0
                    print("    recv() 返回 b'' -> 对端关闭连接(收到 FIN)")
                    break

                print(f"    recv() = {len(data)} 字节: {data!r}")
                print(f"           decode 后: {data.decode('utf-8', 'replace')!r}")

                # ============ send vs sendall ============
                # conn.send(data)    <- 和 C 的 send 一样,可能只发一部分,
                #                       返回实际发送的字节数。用它你就得自己写循环。
                # conn.sendall(data) <- 内部替你循环到发完为止。
                #                       等价于 c/tcp_server.c 里的 send_all()
                # 日常一律用 sendall。
                conn.sendall(data)
                print(f"    sendall() 回送 {len(data)} 字节")

        print(f"[6] close() -> 连接结束,回到 accept()\n")

except KeyboardInterrupt:
    print("\n收到 Ctrl-C,退出")
finally:
    lfd.close()
