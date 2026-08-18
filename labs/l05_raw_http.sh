#!/usr/bin/env bash
# L05 实验:手打 HTTP 原始字节
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# 两个阶段用【不同端口】,各起一个一次性服务器。
# 用同一个端口会有竞态:阶段一的服务器还在 3 秒读超时里,
# 阶段二的客户端就连过去了,连到的其实是上一个服务器。
PA=18805
PB=18815
use_port $PA
use_port $PB

cat > /tmp/l05_srv.py <<'EOF'
import socket, sys
PORT = int(sys.argv[1])
srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.1', PORT))     # 只绑回环 —— 教学服务器不对外
srv.listen(16)
srv.settimeout(10)
try:
    conn, addr = srv.accept()
except socket.timeout:
    sys.exit(0)
with conn:
    # 循环读到 \r\n\r\n:这就是 HTTP 的分隔符分帧
    buf = b''
    conn.settimeout(3)
    got_full_head = False
    while b'\r\n\r\n' not in buf:
        try:
            chunk = conn.recv(4096)
        except socket.timeout:
            print("!! 3 秒都没等到空行,服务器放弃了", flush=True)
            print("   已收到的字节:", repr(buf), flush=True)
            break
        if not chunk:
            print("!! 对端关闭了连接,而头部还没读完", flush=True)
            print("   已收到的字节:", repr(buf), flush=True)
            break
        buf += chunk
    else:
        got_full_head = True

    if got_full_head:
        head = buf.split(b'\r\n\r\n')[0]
        print("--- 服务器收到的完整头部 ---", flush=True)
        for line in head.split(b'\r\n'):
            print("   ", line.decode('utf-8', 'replace'), flush=True)
        body = b'hello from raw http!'
        resp = (b'HTTP/1.1 200 OK\r\n'
                b'Content-Type: text/plain; charset=utf-8\r\n'
                b'Content-Length: ' + str(len(body)).encode() + b'\r\n'
                b'Connection: close\r\n'
                b'\r\n' + body)
        conn.sendall(resp)
        print("--- 已回响应 ---", flush=True)
EOF

hr
step "阶段一:只发请求行,【故意不发空行】—— 服务器会回吗?"
hr
python3 /tmp/l05_srv.py $PA > /tmp/l05_a.log 2>&1 &
track $!
sleep 0.7

python3 - $PA <<'EOF'
import socket, sys
s = socket.socket(); s.settimeout(2.5)
s.connect(('127.0.0.1', int(sys.argv[1])))
s.sendall(b'GET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\n')   # 没有结尾空行
print("  客户端已发送:")
print("    GET /hello HTTP/1.1\\r\\n")
print("    Host: 127.0.0.1\\r\\n")
print("    (就到这儿,没有那个空行)")
print()
try:
    data = s.recv(4096)
    print("  收到响应:", data[:80])
except socket.timeout:
    print("  等了 2.5 秒 —— 服务器【一声不响】")
    print("  因为它还在等 \\r\\n\\r\\n,不知道头发完了没有")
s.close()
EOF
sleep 3.2
echo
echo "  服务器侧日志:"
sed 's/^/    /' /tmp/l05_a.log 2>/dev/null

echo
hr
step "阶段二:发完整请求(带空行)"
hr
python3 /tmp/l05_srv.py $PB > /tmp/l05_b.log 2>&1 &
track $!
sleep 0.7

python3 - $PB <<'EOF'
import socket, sys
s = socket.socket(); s.settimeout(4)
s.connect(('127.0.0.1', int(sys.argv[1])))
req = (b'GET /hello HTTP/1.1\r\n'
       b'Host: 127.0.0.1\r\n'
       b'User-Agent: hand-typed\r\n'
       b'\r\n')                              # <- 这个空行是关键
print("  === 手动发送的原始字节 ===")
for line in req.split(b'\r\n')[:-1]:
    print("    " + (line.decode() if line else "(空行 <- 头部结束标记)") + "\\r\\n")

s.sendall(req)          # 真正把字节发出去

resp = b''
try:
    while True:
        c = s.recv(4096)
        if not c: break
        resp += c
except socket.timeout:
    pass
s.close()
print()
print("  === 服务器返回的原始字节 ===")
head, sep, body = resp.partition(b'\r\n\r\n')
for line in head.split(b'\r\n'):
    print("    " + line.decode())
print("    (空行)")
print("    " + body.decode())
print()
print("  响应体实际 %d 字节,和 Content-Length 声明的一致。" % len(body))
print("  客户端就是靠这个数字知道『读够了,可以停』。")
EOF
sleep 0.4
echo
echo "  服务器侧日志:"
sed 's/^/    /' /tmp/l05_b.log 2>/dev/null

echo
hr
cat <<'EOF'
结论 —— HTTP 把 L03 的两种分帧方式都用上了:

  头部 -> 【分隔符分帧】,分隔符是空行 \r\n\r\n
          所以不发空行,服务器就永远在等(阶段一亲眼所见)

  响应体 -> 【长度前缀分帧】,前缀是 Content-Length
          所以 Content-Length 算错了,浏览器会一直转圈等剩下的字节

  任何 HTTP 服务器的第一步都是:循环 recv,直到缓冲区出现 \r\n\r\n。
  这就是你在 L03 写的那个 read_until 循环。
EOF

rm -f /tmp/l05_srv.py
