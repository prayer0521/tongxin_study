#!/usr/bin/env python3
"""
TCP 客户端 —— 和 c/tcp_client.c 逐段对照

核心还是那句话:客户端没有 bind / listen / accept。
    没 bind   -> connect 时内核自动分配临时端口(隐式绑定)
    没 listen -> 你是主动方
    没 accept -> 你不接客

运行:
    python3 tcp_client.py 127.0.0.1 8888              # 交互模式
    python3 tcp_client.py 127.0.0.1 8888 hello        # 发一条
    python3 tcp_client.py 127.0.0.1 8888 --burst 5    # 连发,演示粘包
    python3 tcp_client.py 127.0.0.1 8888 --noread     # 挂着不动,演示 backlog
"""
import socket
import sys
import time

if len(sys.argv) < 3:
    print(f"用法: {sys.argv[0]} <IP> <端口> [消息 | --burst N | --noread]")
    sys.exit(1)

IP    = sys.argv[1]
PORT  = int(sys.argv[2])
BUFSZ = 4096

arg3    = sys.argv[3] if len(sys.argv) > 3 else None
burst   = int(sys.argv[4]) if arg3 == '--burst' and len(sys.argv) > 4 else 0
noread  = (arg3 == '--noread')
oneshot = arg3 if arg3 and not arg3.startswith('--') else None

# ============ 1. socket() ============
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
print(f"[1] socket() -> fd = {s.fileno()}")

# 证明此刻还没有地址:C 里 getsockname 返回 0.0.0.0:0,Python 一样
print(f"    此刻我的地址: {s.getsockname()}   <- 全 0,内核还没分配")

try:
    # ============ 2+3. connect():三次握手 ============
    # C 要先填 sockaddr_in 再 connect,这里地址元组直接当参数。
    #
    # 这一行背后发生的事和 C 完全相同:
    #     --SYN-->  <--SYN+ACK--  --ACK-->
    # 阻塞到握手完成才返回。
    #
    # C 的 errno 对应到 Python 的异常类型:
    #     ECONNREFUSED -> ConnectionRefusedError
    #     ETIMEDOUT    -> TimeoutError
    #     EHOSTUNREACH -> OSError
    # 这是 Python 封装得最舒服的一处:不用查 errno 表了。
    print(f"[2] connect() -> 正在和 {IP}:{PORT} 三次握手...")
    s.connect((IP, PORT))
    print("[3] connect() 成功 —— 握手完成")

    # 现在内核已经分配了临时端口
    print(f"    我的地址: {s.getsockname()}  <- 内核自动分的(隐式 bind)")
    print(f"    对端地址: {s.getpeername()}")

except ConnectionRefusedError:
    print(f"    连接被拒绝 —— {IP}:{PORT} 没人监听。服务器起了吗?")
    sys.exit(1)
except OSError as e:
    print(f"    connect 失败: {e}")
    sys.exit(1)

with s:
    # ---- 模式 A: --noread 挂着不动,用来撑满服务器的 backlog 队列 ----
    if noread:
        print("    [--noread] 保持连接,不发不收。Ctrl-C 退出")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        sys.exit(0)

    # ---- 模式 B: --burst 连发,演示 TCP 没有消息边界 ----
    if burst > 0:
        print(f"\n[4] 连续 sendall() {burst} 次,不停顿、无分隔符:")
        for i in range(burst):
            msg = f"PKT-{i:02d}".encode()
            s.sendall(msg)
            print(f"    sendall() {msg!r} ({len(msg)} 字节)")

        time.sleep(0.3)                 # 等回送到齐
        data = s.recv(BUFSZ)            # 只读【一次】
        print(f"\n[5] 只 recv() 了一次,收到 {len(data)} 字节: {data!r}")
        print(f"    ↑ {burst} 条消息粘成一坨了。这就是粘包。")
        print("      C 版本表现完全一样 —— 这不是语言问题,是 TCP 的本质:")
        print("      TCP 是字节流,不保证「你发几次我就收几次」。")
        sys.exit(0)

    # ---- 模式 C: 发一条就走 ----
    if oneshot:
        data = oneshot.encode()         # str -> bytes,C 里本来就是字节
        print(f"\n[4] sendall() {data!r} ({len(data)} 字节)")
        s.sendall(data)

        resp = s.recv(BUFSZ)
        if resp:
            print(f"[5] recv() {len(resp)} 字节: {resp.decode('utf-8','replace')!r}")
        else:
            print("[5] recv() 返回 b'' —— 服务器关闭了连接")
        sys.exit(0)

    # ---- 模式 D(默认): 交互式 ----
    print("\n输入内容回车发送,Ctrl-D 或 quit 退出:")
    try:
        for line in sys.stdin:
            line = line.rstrip('\n')
            if not line:
                continue
            if line == 'quit':
                break

            s.sendall(line.encode())

            resp = s.recv(BUFSZ)
            if not resp:
                print("服务器关闭了连接")
                break
            print(f"  <- 服务器回送 {len(resp)} 字节: "
                  f"{resp.decode('utf-8','replace')}")
    except (BrokenPipeError, ConnectionResetError) as e:
        # C 里这对应 send 返回 -1 且 errno == EPIPE / ECONNRESET
        print(f"连接断了: {type(e).__name__}")
    except KeyboardInterrupt:
        pass

# 退出 with 块 = close() = 发 FIN,四次挥手。
# 主动关闭方进入 TIME_WAIT ~60 秒,用 `ss -tan | grep TIME-WAIT` 能看到。
print("close() -> 连接结束")
