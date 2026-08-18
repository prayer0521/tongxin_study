#!/usr/bin/env bash
# L07 实验:CPU 密集 vs IO 密集,加并发的效果天差地别
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PORT=18873
use_port $PORT

cat > /tmp/l07b_srv.py <<'EOF'
import socket, sys, time, math
from concurrent.futures import ThreadPoolExecutor

PORT = int(sys.argv[1])

def cpu_work():
    # 纯计算。Python 有 GIL,多线程无法并行跑 CPU ——
    # 这恰好把「CPU 是天花板」演示得最清楚
    x = 0.0
    for i in range(1, 700000):
        x += math.sqrt(i) * math.sin(i)
    return x

def handle(conn):
    try:
        conn.settimeout(20)
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = conn.recv(4096)
            if not c: return
            buf += c
        path = buf.split(b' ', 2)[1] if b' ' in buf else b'/'

        if path.startswith(b'/cpu'):
            cpu_work()                 # CPU 密集
        else:
            time.sleep(0.1)            # IO 密集:睡 100ms 模拟等数据库

        conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n'
                     b'Connection: close\r\n\r\nok')
    except Exception:
        pass
    finally:
        try: conn.close()
        except Exception: pass

srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.1', PORT))
srv.listen(256)
pool = ThreadPoolExecutor(max_workers=128)
while True:
    conn, _ = srv.accept()
    pool.submit(handle, conn)
EOF

# 压测 + 同时采样 CPU。两件事必须并行做,否则采到的是空闲期的 CPU。
# CPU 采样用 Python 读 /proc/stat —— shell 的 read 处理 "cpu  1 2 3" 的双空格容易出错
run_case() {
    local path=$1 conc=$2 total=$3
    python3 - "$PORT" "$path" "$conc" "$total" <<'PYEOF'
import sys, os, threading, time
sys.path.insert(0, os.path.join(os.environ.get('STUDY_ROOT', '.'), 'labs'))
import importlib.util
spec = importlib.util.spec_from_file_location(
    "_bench", os.path.join(os.environ.get('STUDY_ROOT', '.'), 'labs', '_bench.py'))
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)

port, path, conc, total = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
url = "http://127.0.0.1:%s%s" % (port, path)

def cpu_snapshot():
    with open('/proc/stat') as f:
        parts = f.readline().split()      # ['cpu', v1, v2, ...] 双空格已被 split 吃掉
    vals = [int(x) for x in parts[1:]]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)   # idle + iowait
    return sum(vals), idle

result = {}
def sampler():
    t0, i0 = cpu_snapshot()
    while not stop.is_set():
        time.sleep(0.2)
    t1, i1 = cpu_snapshot()
    dt, di = t1 - t0, i1 - i0
    result['cpu'] = (100.0 * (dt - di) / dt) if dt > 0 else 0.0

stop = threading.Event()
th = threading.Thread(target=sampler, daemon=True)
th.start()
r = bench.run(url, conc, total)
stop.set()
th.join(timeout=2)

ncpu = os.cpu_count() or 1
cpu_pct = result.get('cpu', 0.0)
# 关键:整机 CPU% 在多核上会误导人。换算成"几个核"才看得懂。
cores_busy = cpu_pct * ncpu / 100.0
print("  并发 %-3d  QPS %8.1f   P50 %7.1f ms   P99 %7.1f ms   "
      "整机CPU %5.1f%% (≈%.1f/%d 核)"
      % (conc, r['qps'], r['p50'], r['p99'], cpu_pct, cores_busy, ncpu))
PYEOF
}

step "启动服务器,提供 /io(睡 100ms)和 /cpu(纯算)两个接口"
python3 /tmp/l07b_srv.py $PORT > /dev/null 2>&1 &
track $!
sleep 1.0

# 先探一下 /cpu 单次要多久,好让两组的"单请求耗时"可比
SINGLE=$(curl -s -o /dev/null -w '%{time_total}' "http://127.0.0.1:$PORT/cpu" 2>/dev/null)
echo "  (/cpu 单次耗时约 ${SINGLE}s,/io 固定 0.1s)"

hr
echo "=== 接口 /io  —— IO 密集(睡 100ms,模拟等数据库) ==="
hr
run_case /io 8  48
run_case /io 32 192
run_case /io 64 384
echo
echo "  => 并发从 8 加到 64,QPS 几乎【线性增长】。"
echo "     因为每个请求 100ms 里几乎全在等,线程闲着,加并发就能把等待重叠起来。"
echo "     注意 CPU 一直很低 —— 这是 IO 密集最明显的指纹。"

echo
hr
echo "=== 接口 /cpu —— CPU 密集(纯计算) ==="
hr
run_case /cpu 8  24
run_case /cpu 32 48
run_case /cpu 64 64
echo
echo "  => 并发从 8 加到 64,QPS 【几乎不动】,而 P99 却成倍恶化。"
echo "     因为 CPU 已经是瓶颈,再多并发只是让大家排队 + 增加上下文切换。"
echo
echo "  这里有个【很容易看错监控】的地方,值得单独记住:"
echo "     整机 CPU% 看起来并不高(远不到 100%),但 QPS 已经封顶了。"
echo "     原因:Python 的 GIL 让这个进程基本只能用满【一个核】。"
echo "     在 $(nproc) 核的机器上,一个核跑满 = 整机只有 $(python3 -c 'import os;print(round(100/os.cpu_count(),1))')% 。"
echo
echo "     教训:【别只看整机 CPU%】。要看"
echo "       * 单进程/单线程是否已经吃满一个核 (top 里按 1 看每核,或 pidstat)"
echo "       * QPS 是否随并发停止增长  <- 这个信号比 CPU% 可靠得多"
echo "     C/Go 没有 GIL,能吃多核,但【核心数】依然是硬天花板 —— 到顶了就只能加机器。"

echo
hr
cat <<'SUMMARY'
结论 —— 全站最实用的一条判断:

  压测时同时看 QPS 和 CPU:

    CPU 跑满 + 加并发 QPS 不涨   -> CPU 密集
        出路:优化算法 / 加缓存少算(L10) / 加机器横向扩展(L08)

    CPU 很闲 + 延迟却很高        -> IO 密集(在等 DB、等下游)
        出路:加并发(L04) / 加缓存(L10) / 异步化(L12) / 优化查询(L11)

  这也回答了 L04 的选型问题:Web 后端大多是 IO 密集(大量时间在等数据库),
  所以事件循环 / 协程这类高并发模型才那么有效。
SUMMARY

rm -f /tmp/l07b_srv.py
