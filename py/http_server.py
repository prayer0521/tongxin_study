#!/usr/bin/env python3
"""
极简 HTTP 服务器 —— 和 c/http_server.c 逐段对照

本质:
    HTTP = TCP + 文本格式约定
    这个文件 = tcp_server.py + 解析请求文本 + 拼响应文本

运行:  python3 http_server.py 8080
验证:  浏览器打开 http://127.0.0.1:8080/hello
       或者: curl -v http://127.0.0.1:8080/hello

和 C 版本的区别:
    socket/bind/listen/accept 一个不少,结构完全相同。
    Python 的好处只是:字符串拼接更方便(f-string)、
    不用管 htons、不用手写 send_all 循环。
"""
import socket
import sys
import os

PORT    = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
BACKLOG = 128
BUFSZ   = 4096

# ============ socket / bind / listen:和 tcp_server.py 完全一样 ============
lfd = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
lfd.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
lfd.bind(('0.0.0.0', PORT))
lfd.listen(BACKLOG)

print(f"HTTP 服务器启动: http://127.0.0.1:{PORT}/hello")
print(f"打开浏览器访问上面的地址,或者: curl -v http://127.0.0.1:{PORT}/hello\n")


def send_response(conn, status: int, status_text: str,
                  content_type: str, body: str):
    """构造并发送 HTTP 响应。

    HTTP 响应 = 状态行 + 头部 + 空行 + body,全是文本。
    """
    body_bytes = body.encode('utf-8')
    # 注意分隔符是 \r\n,不是 \n。这是 HTTP 协议规定的。
    # (CRLF = Carriage Return + Line Feed,源自电传打字机时代)
    header = (
        f"HTTP/1.1 {status} {status_text}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body_bytes)}\r\n"
        f"Connection: close\r\n"
        f"\r\n"                 # 空行:头部结束
    )
    # 先发 header(ASCII),再发 body(可能含中文 UTF-8)
    conn.sendall(header.encode('ascii') + body_bytes)


def handle_request(conn, method: str, path: str):
    """路由:根据路径决定返回什么内容"""
    print(f"    请求: {method} {path}")

    if path == '/hello':
        html = """\
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Hello</title></head>
<body>
  <h1>Hello from raw socket!</h1>
  <p>这个页面是用 Python 的 socket + sendall() 手写回去的,</p>
  <p>没有用 Flask、Django、http.server,什么框架都没用。</p>
  <p>你在浏览器看到这行字,说明整条链路:</p>
  <pre>
  浏览器 connect() -> 三次握手 -> send(HTTP请求)
       -> Python socket recv() -> 解析请求行 -> 拼 HTTP 响应
       -> sendall(响应) -> 浏览器 recv() -> 渲染 HTML
  </pre>
  <p>全部跑通了。</p>
  <hr>
  <p><a href="/time">看看 /time</a> | <a href="/not-exist">看看 404</a></p>
</body></html>
"""
        send_response(conn, 200, 'OK', 'text/html; charset=utf-8', html)

    elif path == '/time':
        body = f"Current PID: {os.getpid()}\nThis is plain text, not HTML.\n"
        send_response(conn, 200, 'OK', 'text/plain; charset=utf-8', body)

    elif path == '/':
        # 302 重定向到 /hello
        resp = (
            "HTTP/1.1 302 Found\r\n"
            "Location: /hello\r\n"
            "Content-Length: 0\r\n"
            "Connection: close\r\n"
            "\r\n"
        )
        conn.sendall(resp.encode('ascii'))

    else:
        body = f"<h1>404 Not Found</h1><p>没有 {path} 这个路径</p>"
        send_response(conn, 404, 'Not Found', 'text/html; charset=utf-8', body)


# ============ 主循环:accept -> recv -> 解析 -> 响应 -> close ============
try:
    while True:
        conn, addr = lfd.accept()
        print(f"[accept] 新连接来自 {addr} (fd={conn.fileno()})")

        with conn:
            data = conn.recv(BUFSZ)
            if not data:
                print("    recv() 返回 b'',连接立刻关了")
                continue

            # 打印浏览器发来的原始 HTTP 请求 —— 这是最有价值的输出
            text = data.decode('utf-8', errors='replace')
            print(f"    ┌─ 浏览器发来的 HTTP 请求原文({len(data)} 字节)─────")
            for line in text.split('\n'):
                print(f"    │ {line.rstrip()}")
            print(f"    └─────────────────────────────────────────────")

            # 解析请求行: "GET /hello HTTP/1.1"
            #              ^^^  ^^^^^^ ^^^^^^^^
            lines = text.split('\r\n')
            if not lines:
                send_response(conn, 400, 'Bad Request',
                              'text/plain', 'Malformed request')
                continue

            parts = lines[0].split(' ')
            if len(parts) < 2:
                send_response(conn, 400, 'Bad Request',
                              'text/plain', 'Malformed request')
                continue

            method, path = parts[0], parts[1]

            # 路由 + 响应
            handle_request(conn, method, path)

            print("    [close] 响应完毕,关闭连接\n")

except KeyboardInterrupt:
    print("\n收到 Ctrl-C,退出")
finally:
    lfd.close()
