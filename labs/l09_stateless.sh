#!/usr/bin/env bash
# L09 实验:复现「随机掉登录」,再用 Redis 修好
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

A1=18851; A2=18852
LBPORT=18850
REDIS_PORT=16380
use_port $A1; use_port $A2

CNAME=study-l09-nginx
cleanup_nginx() { docker rm -f $CNAME >/dev/null 2>&1; }
trap 'cleanup_nginx; cleanup' EXIT INT TERM

command -v docker >/dev/null 2>&1 || { echo "!! 没有 docker,跑不了,看预期输出即可"; exit 0; }

# 确认 study-redis 在
if ! docker ps --format '{{.Names}}' | grep -q '^study-redis$'; then
    echo "study-redis 没在跑,尝试启动…"
    docker start study-redis >/dev/null 2>&1 || {
        echo "!! 起不来。可以手动跑:"
        echo "   docker run -d --name study-redis -p 127.0.0.1:16380:6379 \\"
        echo "     docker.m.daocloud.io/redis/redis-stack-server:7.4.0-v8 \\"
        echo "     redis-server --save '' --appendonly no --protected-mode no"
        exit 0
    }
    sleep 2
fi
echo "  study-redis: $(docker exec study-redis redis-cli ping 2>&1)"

# ---------------------------------------------------------------- 应用
cat > /tmp/l09_app.py <<'PYEOF'
"""一个最小应用,支持两种 session 模式:
   memory —— session 存进程内存(错的做法)
   redis  —— session 存 Redis(对的做法)
"""
import socket, sys, json, secrets, time, threading

NAME  = sys.argv[1]
PORT  = int(sys.argv[2])
MODE  = sys.argv[3]              # memory | redis
RPORT = int(sys.argv[4]) if len(sys.argv) > 4 else 16380

# ---- 内存 session:致命的本地状态 ----
MEM = {}
MEM_LOCK = threading.Lock()

# ---- Redis:手写 RESP,不依赖 redis-py(免安装) ----
def resp_cmd(*args):
    out = b'*%d\r\n' % len(args)
    for a in args:
        b = a.encode() if isinstance(a, str) else a
        out += b'$%d\r\n%s\r\n' % (len(b), b)
    return out

def redis_call(*args):
    s = socket.create_connection(('127.0.0.1', RPORT), timeout=3)
    try:
        s.sendall(resp_cmd(*args))
        buf = b''
        # 读一个完整回复就够(简化版解析)
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            if buf.endswith(b'\r\n'):
                break
        return buf
    finally:
        s.close()

def redis_setex(key, ttl, val):
    return redis_call('SETEX', key, str(ttl), val)

def redis_get(key):
    raw = redis_call('GET', key)
    if raw.startswith(b'$-1'):          # nil
        return None
    if raw.startswith(b'$'):
        parts = raw.split(b'\r\n', 1)
        return parts[1][:-2] if len(parts) > 1 else None
    return None

def redis_keys_del_by_user(user):
    """把某用户的所有会话删掉 —— 主动踢人。JWT 做不到的事。"""
    raw = redis_call('KEYS', 'sess:*')
    n = 0
    # 粗略解析 KEYS 的数组回复
    for line in raw.split(b'\r\n'):
        if line.startswith(b'sess:'):
            v = redis_get(line.decode())
            if v and json.loads(v).get('user') == user:
                redis_call('DEL', line.decode())
                n += 1
    return n

# ---- session 抽象 ----
def sess_create(user):
    sid = secrets.token_urlsafe(16)
    payload = json.dumps({'user': user, 'ts': time.time()})
    if MODE == 'memory':
        with MEM_LOCK:
            MEM[sid] = payload           # 只有【这个进程】知道
    else:
        redis_setex('sess:' + sid, 1800, payload)
    return sid

def sess_read(sid):
    if MODE == 'memory':
        with MEM_LOCK:
            raw = MEM.get(sid)
    else:
        raw = redis_get('sess:' + sid)
        if isinstance(raw, bytes):
            raw = raw.decode()
    if not raw:
        return None
    return json.loads(raw).get('user')

# ---- HTTP ----
def reply(conn, obj, code=200):
    body = json.dumps(obj, ensure_ascii=False).encode()
    conn.sendall(b'HTTP/1.1 %d OK\r\nContent-Type: application/json\r\n'
                 b'Content-Length: %d\r\nConnection: close\r\n\r\n%s'
                 % (code, len(body), body))

def handle(conn):
    try:
        conn.settimeout(5)
        buf = b''
        while b'\r\n\r\n' not in buf:
            d = conn.recv(4096)
            if not d: return
            buf += d
        line = buf.split(b'\r\n', 1)[0].decode('utf-8', 'replace')
        parts = line.split()
        path = parts[1] if len(parts) > 1 else '/'

        # 极简查询串解析
        qs = {}
        if '?' in path:
            path, _, q = path.partition('?')
            for kv in q.split('&'):
                k, _, v = kv.partition('=')
                qs[k] = v

        if path == '/login':
            sid = sess_create(qs.get('user', 'alice'))
            reply(conn, {'server': NAME, 'sid': sid})
        elif path == '/whoami':
            user = sess_read(qs.get('sid', ''))
            reply(conn, {'server': NAME, 'user': user})
        elif path == '/kick':
            n = redis_keys_del_by_user(qs.get('user', 'alice')) if MODE == 'redis' else -1
            reply(conn, {'server': NAME, 'killed': n})
        else:
            reply(conn, {'server': NAME, 'mode': MODE})
    except Exception as e:
        try: reply(conn, {'error': str(e)}, 500)
        except Exception: pass
    finally:
        try: conn.close()
        except Exception: pass

srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('0.0.0.0', PORT))
srv.listen(128)
while True:
    try:
        c, _ = srv.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()
    except Exception:
        pass
PYEOF

HOSTIP=$(ip -4 addr show docker0 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)
HOSTIP=${HOSTIP:-172.17.0.1}

cat > /tmp/l09_nginx.conf <<EOF
events { worker_connections 1024; }
http {
    access_log off;
    upstream app {
        server $HOSTIP:$A1;
        server $HOSTIP:$A2;
    }
    server {
        listen 80;
        location / {
            proxy_pass http://app;
            proxy_connect_timeout 2s;
            proxy_read_timeout 5s;
        }
    }
}
EOF

start_stack() {
    local mode=$1
    set +m      # 关掉「作业已杀死」的通知噪音
    # 关掉旧的应用
    for pid in $(ps -o pid=,args= -u "$(id -u)" | grep 'l09_app.py' | grep -v grep | awk '{print $1}'); do
        kill -9 "$pid" 2>/dev/null
        wait "$pid" 2>/dev/null
    done
    sleep 0.4
    python3 /tmp/l09_app.py app-1 $A1 "$mode" $REDIS_PORT >/dev/null 2>&1 & track $!
    python3 /tmp/l09_app.py app-2 $A2 "$mode" $REDIS_PORT >/dev/null 2>&1 & track $!
    sleep 1.0
    docker rm -f $CNAME >/dev/null 2>&1
    docker run -d --name $CNAME -p 127.0.0.1:$LBPORT:80 \
        -v /tmp/l09_nginx.conf:/etc/nginx/nginx.conf:ro \
        docker.m.daocloud.io/library/nginx:alpine >/dev/null 2>&1
    for i in $(seq 1 25); do
        curl -s -o /dev/null -m 1 "http://127.0.0.1:$LBPORT/" && return 0
        sleep 0.4
    done
    echo "  !! nginx 起不来"; docker logs $CNAME 2>&1 | tail -3 | sed 's/^/     /'
    return 1
}

# 用 python 解析 JSON,避免依赖 jq
jget() { python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }

probe() {
    local sid=$1 times=$2
    local ok=0 bad=0
    for i in $(seq 1 "$times"); do
        r=$(curl -s -m 3 "http://127.0.0.1:$LBPORT/whoami?sid=$sid")
        srv=$(echo "$r" | jget server)
        usr=$(echo "$r" | jget user)
        if [ -n "$usr" ] && [ "$usr" != "None" ]; then
            printf "    第 %d 次 -> %-6s ✓ %s\n" "$i" "$srv" "$usr"; ok=$((ok+1))
        else
            printf "    第 %d 次 -> %-6s ✗ 未登录\n" "$i" "$srv"; bad=$((bad+1))
        fi
    done
    echo "  成功 $ok / 失败 $bad"
}

hr
echo "=== 阶段 1:内存 session(2 台机器各存各的)==="
hr
start_stack memory || exit 1
LOGIN=$(curl -s -m 3 "http://127.0.0.1:$LBPORT/login?user=alice")
SID=$(echo "$LOGIN" | jget sid)
WHERE=$(echo "$LOGIN" | jget server)
echo "  在 $WHERE 上登录,拿到 sid=${SID:0:12}…"
echo "  用这个 sid 连打 6 次 /whoami:"
probe "$SID" 6
echo
echo "  ↑ 用户感受到的就是「随机掉登录」。失败率约 (N-1)/N,N=机器数"

echo
hr
echo "=== 阶段 2:Redis session(2 台机器共享)==="
hr
docker exec study-redis redis-cli FLUSHDB >/dev/null 2>&1
start_stack redis || exit 1
LOGIN=$(curl -s -m 3 "http://127.0.0.1:$LBPORT/login?user=alice")
SID=$(echo "$LOGIN" | jget sid)
WHERE=$(echo "$LOGIN" | jget server)
echo "  在 $WHERE 上登录,拿到 sid=${SID:0:12}…"
echo "  同一个 sid 连打 6 次:"
probe "$SID" 6
echo
echo "  ↑ 无论分到哪台机器都认得你 —— 因为状态在共享的 Redis 里"
echo "  Redis 里现在存着: $(docker exec study-redis redis-cli KEYS 'sess:*' 2>/dev/null | head -1)"

echo
hr
echo "=== 阶段 3:主动踢人 —— JWT 做不到的事 ==="
hr
echo "  调用 /kick?user=alice(等价于改密码 / 管理员封号)"
KICK=$(curl -s -m 3 "http://127.0.0.1:$LBPORT/kick?user=alice")
echo "  删掉了 $(echo "$KICK" | jget killed) 个会话"
echo "  再用原来那个 sid 请求:"
probe "$SID" 3
echo
echo "  ↑ 立刻全部失效,两台机器同时生效。"
echo "    如果用 JWT,token 已经在用户手里,你收不回来 —— 只能等它过期。"

echo
hr
cat <<'SUMMARY'
结论:

  「无状态」不是「没有数据」,而是【状态不能绑在某台特定机器上】。

  阶段 1 的 bug 特别难查,因为:
    * 不稳定失败,重试一次就好了
    * 日志里没有任何错误
    * 单机开发环境永远复现不了

  选型判据:
    需要「立刻踢人下线」(改密码/封号/异地登录) -> 集中式 session
    纯读、多端、微服务间传递身份              -> JWT + 短过期 + refresh token

  自检一句话:随机杀掉任意一台机器,用户能不能无感?
SUMMARY

rm -f /tmp/l09_app.py /tmp/l09_nginx.conf
