#!/usr/bin/env bash
# L07 实验:压测串行服务器 vs 并发服务器
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PA=18871
PB=18872
use_port $PA
use_port $PB

# 两个服务器业务逻辑完全一样:睡 5ms 模拟一点点工作,然后返回。
# 唯一区别:A 是串行 accept 循环,B 是线程池。
cat > /tmp/l07_srv.py <<'EOF'
import socket, sys, time, threading
from concurrent.futures import ThreadPoolExecutor

MODE = sys.argv[1]          # serial | threaded
PORT = int(sys.argv[2])
WORK = 0.005                # 每个请求的"业务耗时" 5ms

BODY = b'ok'
RESP = (b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n'
        b'Content-Length: ' + str(len(BODY)).encode() +
        b'\r\nConnection: close\r\n\r\n' + BODY)

def handle(conn):
    try:
        conn.settimeout(5)
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = conn.recv(4096)
            if not c:
                return
            buf += c
        time.sleep(WORK)            # 模拟业务处理
        conn.sendall(RESP)
    except Exception:
        pass
    finally:
        try: conn.close()
        except Exception: pass

srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.1', PORT))
srv.listen(256)

if MODE == 'serial':
    # 串行:处理完一个才 accept 下一个 —— 就是你的教学版 tcp_server
    while True:
        conn, _ = srv.accept()
        handle(conn)
else:
    # 并发:交给线程池
    pool = ThreadPoolExecutor(max_workers=32)
    while True:
        conn, _ = srv.accept()
        pool.submit(handle, conn)
EOF

CONC=20
TOTAL=200

step "启动【串行】服务器 (端口 $PA) 和【并发】服务器 (端口 $PB)"
echo "  两者业务逻辑完全相同:每个请求处理 5ms"
python3 /tmp/l07_srv.py serial   $PA > /dev/null 2>&1 &
track $!
python3 /tmp/l07_srv.py threaded $PB > /dev/null 2>&1 &
track $!
sleep 1.0

hr
echo "=== 压测 A:串行服务器(一次只服务一个连接) ==="
hr
python3 labs/_bench.py "http://127.0.0.1:$PA/" $CONC $TOTAL
echo "  说明:并发上去了,QPS 却上不去 —— 请求全在 backlog 队列里排队(L04)"

echo
hr
echo "=== 压测 B:并发服务器(线程池 32) ==="
hr
python3 labs/_bench.py "http://127.0.0.1:$PB/" $CONC $TOTAL
echo "  说明:同样的业务逻辑,吞吐大幅提升"

echo
hr
echo "怎么读这两组数字"
hr
cat <<'EOF'
  串行版:P50 和 P99 都高、而且彼此接近
      -> 【所有人都慢】= 系统性排队,容量不足

  并发版:P50 很低,P99 明显高于 P50
      -> 【大部分人快,少数人踩到抖动】= 长尾问题
         (来源:GC、锁竞争、调度延迟、慢查询)

  这两种形态的排查方向完全不同:
      P50 就高      -> 加容量 / 换并发模型 / 优化每个请求
      P50 低 P99 高 -> 抓长尾:看 GC 日志、锁、慢查询、重传
EOF

rm -f /tmp/l07_srv.py
