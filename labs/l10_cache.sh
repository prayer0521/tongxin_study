#!/usr/bin/env bash
# L10 实验:真 Redis 上测缓存收益,复现穿透与击穿
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

REDIS_PORT=16380
command -v docker >/dev/null 2>&1 || { echo "!! 没有 docker,看预期输出即可"; exit 0; }

if ! docker ps --format '{{.Names}}' | grep -q '^study-redis$'; then
    docker start study-redis >/dev/null 2>&1 || {
        echo "!! study-redis 起不来。手动:"
        echo "   docker run -d --name study-redis -p 127.0.0.1:16380:6379 \\"
        echo "     docker.m.daocloud.io/redis/redis-stack-server:7.4.0-v8 \\"
        echo "     redis-server --save '' --appendonly no --protected-mode no"
        exit 0
    }
    sleep 2
fi
echo "  study-redis: $(docker exec study-redis redis-cli ping 2>&1)"
docker exec study-redis redis-cli FLUSHDB >/dev/null 2>&1

python3 - "$REDIS_PORT" <<'PYEOF'
import socket, sys, time, threading, random

RPORT = int(sys.argv[1])

# ---- 极简 Redis 客户端(手写 RESP)----
class Redis:
    def __init__(self, port):
        self.port = port
        self.local = threading.local()
    def _sock(self):
        s = getattr(self.local, 's', None)
        if s is None:
            s = socket.create_connection(('127.0.0.1', self.port), timeout=3)
            self.local.s = s
        return s
    def _cmd(self, *args):
        out = b'*%d\r\n' % len(args)
        for a in args:
            b = str(a).encode()
            out += b'$%d\r\n%s\r\n' % (len(b), b)
        s = self._sock()
        s.sendall(out)
        return self._read(s)
    def _read(self, s):
        buf = b''
        while b'\r\n' not in buf:
            buf += s.recv(65536)
        line, _, rest = buf.partition(b'\r\n')
        t, val = line[:1], line[1:]
        if t in (b'+', b':'):
            return val.decode()
        if t == b'-':
            raise RuntimeError(val.decode())
        if t == b'$':
            n = int(val)
            if n == -1:
                return None
            need = n + 2 - len(rest)
            while need > 0:
                chunk = s.recv(65536); rest += chunk; need -= len(chunk)
            return rest[:n].decode()
        return None
    def get(self, k):      return self._cmd('GET', k)
    def setex(self, k, t, v): return self._cmd('SETEX', k, t, v)
    def delete(self, k):   return self._cmd('DEL', k)

r = Redis(RPORT)

# ---- 模拟数据库:查询耗时 20ms,统计被查了几次 ----
DB_LATENCY = 0.02
db_calls = [0]
db_lock = threading.Lock()

# 数据库里存在的用户:id 1..1000
def db_query(uid):
    with db_lock:
        db_calls[0] += 1
    time.sleep(DB_LATENCY)
    if isinstance(uid, int) and 1 <= uid <= 1000:
        return '{"id":%d,"name":"user%d"}' % (uid, uid)
    return None      # 不存在

def reset_db_counter():
    with db_lock:
        db_calls[0] = 0

# ================================================================ 阶段 1
print("─" * 40)
print("=== 阶段 1:Cache-Aside 的收益 ===")
print("─" * 40)
print("  模拟数据库查询耗时 %dms,Redis 约 0.3ms" % int(DB_LATENCY*1000))

def get_user_cached(uid):
    key = 'user:%s' % uid
    v = r.get(key)
    if v is not None:
        return v                       # 命中
    v = db_query(uid)                  # 未命中 -> 查库
    r.setex(key, 300, v if v is not None else '')
    return v

r.delete(*['x'])  # noop 保活
for i in range(1, 11):
    r.delete('user:%d' % i)
reset_db_counter()

# 读 100 次,热点集中在 10 个 key(zipf 式:先随机 10 个,反复读)
t0 = time.time()
hits = 0
for _ in range(100):
    uid = random.randint(1, 10)
    key = 'user:%d' % uid
    before = r.get(key)
    get_user_cached(uid)
    if before is not None:
        hits += 1
elapsed = (time.time() - t0) * 1000
print("  读 100 次(热点集中在 10 个 key):")
print("    命中 %d / 未命中 %d" % (hits, 100 - hits))
print("    命中率 %.1f%%" % (hits))
print("    无缓存(全查库)理论耗时: ~%d ms" % int(100 * DB_LATENCY * 1000))
print("    有缓存实际总耗时:        ~%d ms" % int(elapsed))
print("    数据库查询次数从 100 降到 %d  <- 压力砍掉 %d%%" % (db_calls[0], 100 - db_calls[0]))

# ================================================================ 阶段 2
print()
print("─" * 40)
print("=== 阶段 2:缓存穿透(查根本不存在的数据)===")
print("─" * 40)

# 不缓存空值:每次都穿透
docker_flush = None
reset_db_counter()
for i in range(50):
    uid = -random.randint(1, 5)        # 负数 id,数据库里不存在
    key = 'user:%s' % uid
    v = r.get(key)
    if v is None:
        v = db_query(uid)              # None,而且【不缓存】
print("  不缓存空值,查 50 次不存在的 key:")
print("    数据库被查了 %d 次 —— 缓存完全没挡住" % db_calls[0])

# 缓存空值:挡住重复查询
for i in range(1, 6):
    r.delete('user:-%d' % i)
reset_db_counter()
for i in range(50):
    uid = -random.randint(1, 5)
    key = 'user:%s' % uid
    v = r.get(key)
    if v is None:
        v = db_query(uid)
        r.setex(key, 60, '')           # 【空值也缓存】
print("  开启空值缓存后,再查 50 次:")
print("    数据库只被查了 %d 次(其余命中空值缓存)" % db_calls[0])
print("    注意:若攻击者每次换【不同】的不存在 key,空值缓存会被撑爆 -> 需要布隆过滤器")

# ================================================================ 阶段 3
print()
print("─" * 40)
print("=== 阶段 3:缓存击穿(热点 key 瞬间失效)===")
print("─" * 40)

HOT = 'user:hot'

def blast(use_lock):
    r.delete(HOT)                      # 模拟热点 key 刚过期
    reset_db_counter()
    lock = threading.Lock()

    def worker():
        v = r.get(HOT)
        if v is not None:
            return
        if use_lock:
            with lock:                 # 互斥:只放一个去查库
                v = r.get(HOT)         # 双重检查
                if v is not None:
                    return
                val = db_query(500)
                r.setex(HOT, 300, val)
        else:
            val = db_query(500)        # 所有人一起查库
            r.setex(HOT, 300, val)

    threads = [threading.Thread(target=worker) for _ in range(50)]
    for t in threads: t.start()
    for t in threads: t.join()
    return db_calls[0]

n1 = blast(use_lock=False)
print("  50 个并发同时请求一个刚过期的热点 key:")
print("    不加锁  : 数据库被同时打了 %d 次" % n1)
n2 = blast(use_lock=True)
print("    加互斥锁: 数据库只被打了 %d 次(其余等待并复用结果)" % n2)

print()
print("─" * 40)
print("""结论:

  缓存的收益是【非线性】的:命中率从 90% 提到 99%,平均耗时还能再降一半。
  平均耗时 ≈ 命中率×缓存耗时 + 未命中率×数据库耗时

  三个故障的解法,一句话各记住:
    穿透 -> 缓存空值 / 布隆过滤器(挡住不存在的 key)
    击穿 -> 互斥锁只放一个查库 / 热点不过期(挡住单点雪崩)
    雪崩 -> TTL 加随机抖动 / Redis 高可用 / 限流兜底(别让 key 集体失效)""")
PYEOF

docker exec study-redis redis-cli FLUSHDB >/dev/null 2>&1
