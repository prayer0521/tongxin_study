#!/usr/bin/env bash
# L13 实验:分布式锁防超卖(真 Redis)
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

REDIS_PORT=16380
command -v docker >/dev/null 2>&1 || { echo "!! 没有 docker,看预期输出即可"; exit 0; }
if ! docker ps --format '{{.Names}}' | grep -q '^study-redis$'; then
    docker start study-redis >/dev/null 2>&1 || { echo "!! study-redis 起不来"; exit 0; }
    sleep 2
fi
echo "  study-redis: $(docker exec study-redis redis-cli ping 2>&1)"
docker exec study-redis redis-cli FLUSHDB >/dev/null 2>&1

python3 - "$REDIS_PORT" <<'PYEOF'
import socket, sys, threading, time, uuid

RPORT = int(sys.argv[1])

class Redis:
    def __init__(self, port):
        self.port = port; self.local = threading.local()
    def _sock(self):
        s = getattr(self.local, 's', None)
        if s is None:
            s = socket.create_connection(('127.0.0.1', self.port), timeout=5)
            self.local.s = s
        return s
    def cmd(self, *args):
        out = b'*%d\r\n' % len(args)
        for a in args:
            b = str(a).encode(); out += b'$%d\r\n%s\r\n' % (len(b), b)
        s = self._sock(); s.sendall(out); return self._read(s)
    def _read(self, s):
        buf = b''
        while b'\r\n' not in buf: buf += s.recv(65536)
        line, _, rest = buf.partition(b'\r\n')
        t, val = line[:1], line[1:]
        if t in (b'+', b':'): return val.decode()
        if t == b'-': raise RuntimeError(val.decode())
        if t == b'$':
            n = int(val)
            if n == -1: return None
            while len(rest) < n + 2: rest += s.recv(65536)
            return rest[:n].decode()
        return None

STOCK_KEY = 'stock:item'
N_CONCURRENT = 50
INIT_STOCK = 10

def reset():
    r = Redis(RPORT)
    r.cmd('SET', STOCK_KEY, INIT_STOCK)

# ---------------- 阶段 1:不加锁,check-then-act 竞态 ----------------
print("─" * 40)
print("=== 阶段 1:不加锁(查询→判断→扣减,三步有竞态)===")
print("─" * 40)
reset()
sold = [0]; sold_lock = threading.Lock()

def buy_no_lock():
    r = Redis(RPORT)
    stock = int(r.cmd('GET', STOCK_KEY))     # 查
    if stock > 0:                            # 判断
        time.sleep(0.001)                    # 放大竞态窗口(真实网络里天然存在)
        r.cmd('DECR', STOCK_KEY)             # 扣
        with sold_lock: sold[0] += 1

ts = [threading.Thread(target=buy_no_lock) for _ in range(N_CONCURRENT)]
for t in ts: t.start()
for t in ts: t.join()
final = int(Redis(RPORT).cmd('GET', STOCK_KEY))
print(f"  初始库存 {INIT_STOCK},{N_CONCURRENT} 个并发抢购:")
print(f"    成功卖出 {sold[0]} 件   <- {'超卖了 %d 件!' % (sold[0]-INIT_STOCK) if sold[0]>INIT_STOCK else '正常'}")
print(f"    最终库存 = {final}")
print("  原因:多个请求同时读到「还有库存」,然后一起扣")

# ---------------- 阶段 2:加分布式锁 ----------------
print()
print("─" * 40)
print("=== 阶段 2:加 Redis 分布式锁 ===")
print("─" * 40)
reset()
sold2 = [0]; blocked = [0]
s2_lock = threading.Lock()
LOCK_KEY = 'lock:item'

UNLOCK_LUA = ("if redis.call('get',KEYS[1])==ARGV[1] then "
              "return redis.call('del',KEYS[1]) else return 0 end")

def buy_with_lock():
    r = Redis(RPORT)
    token = str(uuid.uuid4())
    # 抢锁:SET NX EX,最多重试几次
    got = False
    for _ in range(20):
        if r.cmd('SET', LOCK_KEY, token, 'NX', 'EX', '5'):
            got = True; break
        time.sleep(0.005)
    if not got:
        with s2_lock: blocked[0] += 1
        return
    try:
        stock = int(r.cmd('GET', STOCK_KEY))
        if stock > 0:
            time.sleep(0.001)
            r.cmd('DECR', STOCK_KEY)
            with s2_lock: sold2[0] += 1
    finally:
        r.cmd('EVAL', UNLOCK_LUA, 1, LOCK_KEY, token)   # 原子释放,只删自己的

ts = [threading.Thread(target=buy_with_lock) for _ in range(N_CONCURRENT)]
for t in ts: t.start()
for t in ts: t.join()
final = int(Redis(RPORT).cmd('GET', STOCK_KEY))
print(f"  初始库存 {INIT_STOCK},{N_CONCURRENT} 个并发抢购:")
print(f"    成功卖出 {sold2[0]} 件   <- {'精确,不超卖' if sold2[0]==INIT_STOCK else '异常'}")
print(f"    最终库存 = {final}")
print("  锁把「查-扣」串行化了,一次只有一个请求能进临界区")

# ---------------- 阶段 3:原子操作,根本不用锁 ----------------
print()
print("─" * 40)
print("=== 阶段 3:更优解 —— Redis 原子操作,根本不用锁 ===")
print("─" * 40)
reset()
sold3 = [0]; s3_lock = threading.Lock()

def buy_atomic():
    r = Redis(RPORT)
    # DECR 是原子的:扣减并返回结果。扣成负数就说明没抢到,补回去
    left = int(r.cmd('DECR', STOCK_KEY))
    if left >= 0:
        with s3_lock: sold3[0] += 1
    else:
        r.cmd('INCR', STOCK_KEY)     # 没抢到,把多扣的加回来

ts = [threading.Thread(target=buy_atomic) for _ in range(N_CONCURRENT)]
for t in ts: t.start()
for t in ts: t.join()
final = int(Redis(RPORT).cmd('GET', STOCK_KEY))
print(f"  初始库存 {INIT_STOCK},{N_CONCURRENT} 个并发抢购:")
print(f"    成功卖出 {sold3[0]} 件,最终库存 {final}")
print("    DECR 是原子的,天然不会超卖,而且比加锁快得多、简单得多")

print()
print("─" * 40)
print("""结论:

  阶段 1 超卖 = 经典的 check-then-act 竞态。
     「查库存→判断够→扣减」三步之间,别人也在查、也判断够了 -> 一起扣成负数。
     单机加锁没用,因为请求分散在多台机器上。

  阶段 2 分布式锁能防超卖,但代价是【串行 + 加锁开销】,吞吐受限。
     且锁本身有坑:setnx+expire 要原子、value 要唯一 token、释放要用 Lua。

  阶段 3 才是秒杀真正的解法:【能用原子操作就别用锁】。
     DECR / INCR / UPDATE...WHERE stock>0,又快又简单又不会错。

  工程直觉:分布式锁是重武器。掂量一下,很多场景一个原子操作就够了。""")
PYEOF

docker exec study-redis redis-cli FLUSHDB >/dev/null 2>&1
