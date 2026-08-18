#!/usr/bin/env bash
# L06 实验:用 curl -w 量出请求各阶段耗时
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PORT=18806
use_port $PORT

# curl 只输出原始数值,由 Python 算差值并排版。
# 注意 -w 从文件读时不会自动加换行,要显式写 \n
CURL_FMT='%{time_namelookup} %{time_connect} %{time_appconnect} %{time_pretransfer} %{time_starttransfer} %{time_total} %{http_code} %{size_download}\n'

# 把 curl 的原始数值转成"每一段花了多久"
explain_timing() {
    python3 -c '
import sys
f = sys.stdin.read().split()
if len(f) < 8:
    print("  (curl 没有返回有效数据)"); sys.exit()
dns, conn, tls, pre, start, total, code, size = (
    float(f[0]), float(f[1]), float(f[2]), float(f[3]),
    float(f[4]), float(f[5]), f[6], f[7])

def ms(x): return x * 1000.0

# TLS 为 0 表示明文 http
has_tls = tls > 0
seg_dns   = ms(dns)
seg_tcp   = ms(conn - dns)
seg_tls   = ms(tls - conn) if has_tls else 0.0
seg_srv   = ms(start - (tls if has_tls else conn))
seg_body  = ms(total - start)

rows = [
    ("DNS 解析",   seg_dns,  "域名 -> IP,走 UDP:53"),
    ("TCP 握手",   seg_tcp,  "三次握手,1 个 RTT"),
    ("TLS 握手",   seg_tls,  "证书校验+密钥协商" if has_tls else "明文 http,没有这一步"),
    ("服务端处理", seg_srv,  "<- 后端真正干活的时间"),
    ("响应体传输", seg_body, "剩下的字节传完"),
]

import unicodedata
def cells(s):
    """字符串占几个终端列。中日韩字符占 2 列。"""
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)

def pad(s, n):
    return s + " " * max(0, n - cells(s))

width = 34
mx = max(r[1] for r in rows) or 1.0
for name, val, note in rows:
    bar = "#" * int(val / mx * width) if val > 0 else ""
    print("  %s %8.2f ms  %-34s %s" % (pad(name, 12), val, bar, note))
print("  %s %8.2f ms" % (pad("总计", 12), ms(total)))
print("  HTTP %s,响应体 %s 字节" % (code, size))
'
}

step "起一个本机 HTTP 服务器"
python3 - $PORT > /tmp/l06_srv.log 2>&1 <<'EOF' &
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'ok'
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
EOF
track $!
sleep 0.8

hr
echo "=== A. 请求本机服务 (http://127.0.0.1:$PORT) ==="
hr
curl -s -o /dev/null -w "$CURL_FMT" "http://127.0.0.1:$PORT/api/test" | explain_timing

echo
hr
echo "=== B. 对比:请求外网 HTTPS 站点 ==="
hr
if curl -s -o /dev/null -m 8 --connect-timeout 4 https://example.com 2>/dev/null; then
    curl -s -o /dev/null -m 10 -w "$CURL_FMT" "https://example.com/" | explain_timing
    echo
    echo "  对比 A 和 B:"
    echo "    * 本机 DNS ≈ 0(127.0.0.1 不用解析);外网要真的查"
    echo "    * 本机 TCP 握手是微秒级(走回环);外网是毫秒级(真实 RTT)"
    echo "    * 外网多了 TLS 握手 —— 通常是最大的一块【固定】开销"
    echo "    * 两边的【服务端处理】才是可比的部分"
else
    echo "  (本机访问不了外网,跳过这组对比)"
fi

echo
hr
echo "这条命令值得存下来 —— 下次『接口慢』先跑它,再决定查哪儿"
hr
cat <<'SNIP'
  curl -o /dev/null -s -w '
    DNS:      %{time_namelookup}s
    TCP:      %{time_connect}s
    TLS:      %{time_appconnect}s
    首字节:   %{time_starttransfer}s
    总计:     %{time_total}s
  ' 'https://你的接口'

  判读规则:
    首字节 - TLS   很小  -> 后端很快,问题在 DNS/TCP/TLS,别去读业务代码
    首字节 - TLS   很大  -> 后端慢,去查代码/慢查询(L10 缓存、L11 索引)
    总计 - 首字节  很大  -> 响应体太大 或 带宽不足
    TLS - TCP      很大  -> TLS 握手慢,考虑会话复用 / HTTP2 / 就近接入
SNIP
