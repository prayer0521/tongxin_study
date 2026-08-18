#!/usr/bin/env python3
"""
UDP 服务器 —— 和 c/udp_server.c 逐段对照

和 tcp_server.py 的差异只有三处,但每一处都点出了 UDP 的本质:

    1. SOCK_STREAM -> SOCK_DGRAM        (就改一个常量)
    2. 没有 listen(),没有 accept()      (没有连接可监听/接受)
    3. recv/send  -> recvfrom/sendto     (每个包都得自己带地址)

第 3 点是最需要理解的:
    TCP:accept 给你一个 conn,它天生记着对端是谁,sendall 直接回。
    UDP:只有一个 socket,所有人的包都从这里进来。
        你必须从 recvfrom 的返回值里拿到"谁发的",再 sendto 回去。

运行:  python3 udp_server.py 9999
"""
import socket
import sys

PORT  = int(sys.argv[1]) if len(sys.argv) > 1 else 9999
BUFSZ = 1024

# ============ 1. socket():唯一的改动就是 SOCK_DGRAM ============
# C: socket(AF_INET, SOCK_DGRAM, 0)
#
# 一个常量之差,内核给你的东西完全不同:
#   SOCK_STREAM: 有序、可靠、【无】消息边界    -> 会粘包,不会丢
#   SOCK_DGRAM : 无序、不可靠、【有】消息边界  -> 不粘包,但会丢
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
print(f"[1] socket(SOCK_DGRAM) -> fd = {s.fileno()}")

# ============ 2. bind():和 TCP 一模一样 ============
# 服务器必须 bind,否则客户端不知道往哪个端口发。
s.bind(('0.0.0.0', PORT))
print(f"[2] bind() -> 0.0.0.0:{PORT}")

# ============ 没有 listen(),没有 accept() ============
# 到这里就已经能收数据了。
# 想验证 UDP 真的不支持 listen?取消下面的注释:
#
# try:
#     s.listen(5)
# except OSError as e:
#     print(f"[验证] 对 UDP 调 listen -> {e}")   # errno 95 EOPNOTSUPP
print("[3] 没有 listen / accept —— UDP 没有连接这个概念")
print(f"    等待数据报... 另开终端: python3 udp_client.py 127.0.0.1 {PORT}\n")

try:
    while True:
        # ============ 3. recvfrom():收一个包,顺便问出是谁发的 ============
        # C: recvfrom(fd, buf, len, 0, (struct sockaddr*)&cli, &clilen)
        #    - 数据填进 buf,返回字节数
        #    - 发件人填进 &cli(输出参数)
        #    - clilen 值-结果参数
        # Python: 一个元组把两样都返回了。
        data, addr = s.recvfrom(BUFSZ)

        # ⚠️ 和 TCP 最容易搞混的一点:
        #    TCP: data == b''  表示对端关闭了连接
        #    UDP: data == b''  表示【真的收到一个空包】,完全合法!
        #         UDP 没有连接,也就没有"关闭"。
        #    所以 UDP 循环里【绝对不要】写 `if not data: break`
        print(f"[4] recvfrom() 收到 {len(data)} 字节,来自 {addr}: {data!r}")

        # ============ 4. sendto():回给刚才记下的那个地址 ============
        # C: sendto(fd, buf, n, 0, (struct sockaddr*)&cli, clilen)
        #
        # addr 就是上面 recvfrom 返回的那个。这是 UDP 服务器的标准套路:
        #     【收的时候记下地址,回的时候用它】
        #
        # 和 TCP 的 send 的区别:
        #   sendto 不会部分发送,要么整个包进缓冲区,要么抛异常。
        #   所以 UDP 不需要 sendall,压根没这个函数用在 sendto 上。
        #   但"发出去了"≠"对方收到了" —— UDP 不保证送达。
        n = s.sendto(data, addr)
        print(f"    sendto() 回送 {n} 字节给 {addr}\n")

        # 注意:【不需要 close】。
        # TCP 服务器每来一个客户端就要 close 一个 conn;
        # UDP 从头到尾就这一个 socket,服务所有客户端。

except KeyboardInterrupt:
    print("\n收到 Ctrl-C,退出")
finally:
    s.close()
