#!/usr/bin/env python3
"""
UDP 客户端 —— 和 c/udp_client.c 逐段对照

四个程序里最简单的:没有 bind、没有 listen、没有 accept,
连 connect 都可以不要。socket() 完了直接 sendto。

运行:
    python3 udp_client.py 127.0.0.1 9999             # 交互模式
    python3 udp_client.py 127.0.0.1 9999 hello       # 发一条
    python3 udp_client.py 127.0.0.1 9999 --connect   # 演示 UDP 的 connect
    python3 udp_client.py 127.0.0.1 9999 --big 2000  # 超大包,演示截断
"""
import socket
import sys

if len(sys.argv) < 3:
    print(f"用法: {sys.argv[0]} <IP> <端口> [消息 | --connect | --big N]")
    sys.exit(1)

IP    = sys.argv[1]
PORT  = int(sys.argv[2])
BUFSZ = 65536

arg3        = sys.argv[3] if len(sys.argv) > 3 else None
use_connect = (arg3 == '--connect')
big         = int(sys.argv[4]) if arg3 == '--big' and len(sys.argv) > 4 else 0
oneshot     = arg3 if arg3 and not arg3.startswith('--') else None

# ============ 1. socket() ============
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
print(f"[1] socket(SOCK_DGRAM) -> fd = {s.fileno()}")

# ============ 必须设超时 ============
# C: setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv))
# Python: 一行 settimeout(),超时抛 socket.timeout(= TimeoutError)
#
# 为什么 UDP 必须设超时,TCP 不用?
#   TCP 对端挂了,内核能感知(RST/FIN),recv 会返回或报错。
#   UDP 没有连接,内核根本不知道对面死没死,recvfrom 会【永远卡住】。
#   不设超时的 UDP 客户端 = 一个潜在的死锁。
s.settimeout(2.0)
print("    settimeout(2.0) —— UDP 必须自己管超时,不然会永远卡住")

server = (IP, PORT)

# ---- 模式:--connect 演示 UDP 上的 connect ----
if use_connect:
    print("\n[2] 对 UDP socket 调 connect()...")
    s.connect(server)
    print("    立刻返回,而且【一个网络包都没发出去】。")
    print("    UDP 的 connect 不握手,只做两件事:")
    print("      a) 在内核里记下默认对端 -> 之后可以直接用 send/recv")
    print("      b) 只收这个对端的包,别人发来的直接丢弃(过滤)")
    print("    附带好处:能收到 ICMP 端口不可达了。")
    print("      不 connect 的话,对方端口没开你也不知道,包默默消失。\n")

    msg = b"hello from connected udp"
    n = s.send(msg)                     # 已 connect,可以用 send 而非 sendto
    print(f"[3] send() {n} 字节 (不用 sendto 了,对端已记住)")

    try:
        data = s.recv(BUFSZ)
        print(f"[4] recv() {len(data)} 字节: {data!r}")
    except socket.timeout:
        print("[4] 超时 —— 服务器没起?UDP 不会告诉你,只能靠超时判断")
    except ConnectionRefusedError:
        # C 里这是 errno == ECONNREFUSED
        print("[4] ConnectionRefusedError —— 收到了 ICMP 端口不可达。")
        print("    这个错误【只有 connect 过的 UDP 才拿得到】。")
    s.close()
    sys.exit(0)

# ---- 模式:--big 发超大包,演示接收方截断 ----
if big > 0:
    msg = b'A' * big
    print(f"\n[2] sendto() 一个 {big} 字节的数据报")
    try:
        n = s.sendto(msg, server)
        print(f"    sendto 返回 {n} —— 要么全发要么抛异常,")
        print("    不像 TCP 的 send 会部分发送")
        print("    服务器 buf 只有 1024 字节,去看它收到了多少 ->")
        print("    超出部分被内核【直接丢弃】,而且不报错")
    except OSError as e:
        print(f"    sendto 失败: {e}")
        print("    (EMSGSIZE = 超过数据报最大长度)")
    s.close()
    sys.exit(0)

# ---- 模式:发一条就走 ----
if oneshot:
    data = oneshot.encode()
    # ============ sendto():直接发,不需要建立连接 ============
    # TCP 必须先 connect 成功才能 send。
    # UDP 直接 sendto,哪怕服务器根本没启动,也返回成功。
    print(f"\n[2] sendto() {data!r} -> {server}")
    n = s.sendto(data, server)
    print(f"    发出 {n} 字节 (注意:返回成功 ≠ 对方收到)")

    # 第一次 sendto 之后,内核才分配临时端口(隐式绑定)
    print(f"    我的地址现在是: {s.getsockname()}  <- 刚才 sendto 时自动分的")

    try:
        resp, frm = s.recvfrom(BUFSZ)
        print(f"[3] recvfrom() {len(resp)} 字节,来自 {frm}: {resp!r}")
    except socket.timeout:
        print("[3] 2 秒超时,没收到回复。")
        print("    可能:服务器没起 / 请求包丢了 / 回复包丢了。")
        print("    UDP 不会告诉你是哪一种 —— 这就是「不可靠」。")
    s.close()
    sys.exit(0)

# ---- 默认:交互模式 ----
print("\n输入内容回车发送,Ctrl-D 或 quit 退出:")
try:
    for line in sys.stdin:
        line = line.rstrip('\n')
        if not line:
            continue
        if line == 'quit':
            break

        s.sendto(line.encode(), server)

        try:
            resp, frm = s.recvfrom(BUFSZ)
            print(f"  <- 来自 {frm} 的 {len(resp)} 字节: "
                  f"{resp.decode('utf-8','replace')}")
        except socket.timeout:
            print("  <- 超时,没有回复(丢包?服务器没起?)")
except KeyboardInterrupt:
    pass

# close() 对 UDP 来说就是释放 fd,【不发任何网络包】。
# 没有四次挥手,没有 TIME_WAIT。对端完全不知道你走了。
s.close()
print("close() -> 仅释放 fd,没发任何包,对端不知情")
