#!/usr/bin/env bash
# L12 实验:用 Redis 做一个真队列,复现重复消费,再用幂等修好
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
import socket, sys, threading, time, random

RPORT = int(sys.argv[1])

class Redis:
    def __init__(self, port):
        self.port = port; self.local = threading.local()
    def _sock(self):
        s = getattr(self.local, 's', None)
        if s is None:
            s = socket.create_connection(('127.0.0.1', self.port), timeout=3)
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

r = Redis(RPORT)

# 业务副作用:给用户加积分。用一个 Redis 计数器统计【实际执行了几次】
def add_points(uid, pts):
    r.cmd('INCRBY', f'points:{uid}', pts)

print("─" * 40)
print("=== 阶段 1:at-least-once 造成重复消费 ===")
print("─" * 40)
print("  场景:一条「给 alice 加 100 积分」的消息,因为消费者 ACK 前崩溃,被重投了 3 次")
r.cmd('DEL', 'points:alice')

msg = {'id': 'msg-0001', 'uid': 'alice', 'pts': 100}

def consume_no_idempotent(msg):
    add_points(msg['uid'], msg['pts'])       # 直接处理,不去重

# 模拟同一条消息被投递 3 次(重复消费)
for attempt in range(3):
    consume_no_idempotent(msg)
    print(f"    第 {attempt+1} 次投递 -> 处理了")

final = r.cmd('GET', 'points:alice')
print(f"  alice 最终积分 = {final}   <- 应该是 100,却变成了 {final}!")
print("  ↑ 这就是重复消费的后果:用户积分翻了 3 倍")

print()
print("─" * 40)
print("=== 阶段 2:加幂等(SET NX 去重),同样投递 3 次 ===")
print("─" * 40)
r.cmd('DEL', 'points:alice')

def consume_idempotent(msg):
    key = f"processed:{msg['id']}"
    # SET NX:只有第一次能成功。谁 set 成功谁才处理
    ok = r.cmd('SET', key, '1', 'NX', 'EX', '86400')
    if ok is None:
        return 'skipped'                     # 已处理过,幂等跳过
    add_points(msg['uid'], msg['pts'])
    return 'processed'

for attempt in range(3):
    result = consume_idempotent(msg)
    print(f"    第 {attempt+1} 次投递 -> {result}")

final = r.cmd('GET', 'points:alice')
print(f"  alice 最终积分 = {final}   <- 正确!无论投递几次,只加一次")

print()
print("─" * 40)
print("=== 阶段 3:削峰 —— 生产快、消费慢,看队列缓冲 ===")
print("─" * 40)
r.cmd('DEL', 'task_queue')

# 生产者:瞬间push 100 个任务(模拟秒杀洪峰)
for i in range(100):
    r.cmd('RPUSH', 'task_queue', f'task-{i}')
depth = r.cmd('LLEN', 'task_queue')
print(f"  生产者瞬间投递 100 个任务,当前队列深度 = {depth}")

# 消费者:固定速率消费(每次 LPOP 一个),这里快速跑完只为演示"匀速取出"
processed = 0
t0 = time.time()
while True:
    task = r.cmd('LPOP', 'task_queue')
    if task is None:
        break
    processed += 1
    if processed in (25, 50, 75, 100):
        print(f"    已消费 {processed}/100,队列剩余 {r.cmd('LLEN','task_queue')}")
print(f"  消费者按自己的节奏处理完 {processed} 个")
print("  ↑ 洪峰被队列缓冲,下游看到的是【匀速】流量,而不是瞬间 100 个并发")

print()
print("─" * 40)
print("""结论:

  1. at-least-once(主流选择)必然带来重复投递:
       消费者 ACK 前崩溃 -> 队列以为没处理 -> 重投 -> 同一消息处理多次

  2. 你挡不住重复投递,只能让【重复处理无副作用】= 幂等
       SET NX 去重 / 数据库唯一约束 / 状态机,三选一

  3. 削峰:队列把瞬时洪峰摊平成下游能承受的匀速流量
       代价是洪峰期间请求延迟处理、队列满会丢弃

  这里的幂等和 L06 的幂等是同一件事 —— 用了队列就【必须】做,不是可选。""")
PYEOF

docker exec study-redis redis-cli FLUSHDB >/dev/null 2>&1
