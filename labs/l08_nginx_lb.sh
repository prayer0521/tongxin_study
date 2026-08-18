#!/usr/bin/env bash
# L08 实验:真 nginx + 3 个真后端,看分流和故障转移
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

B1=18841; B2=18842; B3=18843
LBPORT=18840
use_port $B1; use_port $B2; use_port $B3

CNAME=study-lb-nginx

# 退出时收拾 nginx 容器(_common.sh 的 cleanup 只管进程和端口)
cleanup_nginx() { docker rm -f $CNAME >/dev/null 2>&1; }
trap 'cleanup_nginx; cleanup' EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
    echo "!! 本机没有 docker,这个实验跑不了。直接看关卡里的预期输出即可。"
    exit 0
fi

# ---------------------------------------------------------------- 后端
cat > /tmp/l08_backend.py <<'EOF'
import socket, sys, time
NAME = sys.argv[1]
PORT = int(sys.argv[2])
SLOW = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

body = NAME.encode()
resp = (b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n'
        b'Content-Length: ' + str(len(body)).encode() +
        b'\r\nConnection: close\r\n\r\n' + body)

srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
# 绑 0.0.0.0:nginx 在容器里,要通过 docker 网桥访问宿主机
srv.bind(('0.0.0.0', PORT))
srv.listen(128)
while True:
    try:
        c, _ = srv.accept()
        c.settimeout(5)
        buf = b''
        while b'\r\n\r\n' not in buf:
            d = c.recv(4096)
            if not d: break
            buf += d
        if SLOW: time.sleep(SLOW)
        c.sendall(resp)
        c.close()
    except Exception:
        pass
EOF

step "启动 3 个后端(各自返回自己的名字)"
python3 /tmp/l08_backend.py backend-1 $B1 > /dev/null 2>&1 & track $!
python3 /tmp/l08_backend.py backend-2 $B2 > /dev/null 2>&1 & track $!
python3 /tmp/l08_backend.py backend-3 $B3 > /dev/null 2>&1 & track $!
sleep 1.0
for p in $B1 $B2 $B3; do
    printf "  :%s -> %s\n" "$p" "$(curl -s -m 2 http://127.0.0.1:$p/ || echo '起不来')"
done

# ---------------------------------------------------------------- nginx
# 容器访问宿主机:优先用 host-gateway,拿不到就退回 docker0 的地址
HOSTIP=$(ip -4 addr show docker0 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)
HOSTIP=${HOSTIP:-172.17.0.1}
echo "  (nginx 容器将通过 $HOSTIP 访问宿主机上的后端)"

write_conf() {
    local algo="$1"
    cat > /tmp/l08_nginx.conf <<EOF
events { worker_connections 1024; }
http {
    access_log off;
    upstream backend {
        $algo
        server $HOSTIP:$B1 max_fails=1 fail_timeout=5s;
        server $HOSTIP:$B2 max_fails=1 fail_timeout=5s;
        server $HOSTIP:$B3 max_fails=1 fail_timeout=5s;
    }
    server {
        listen 80;
        location / {
            proxy_pass http://backend;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_connect_timeout 1s;
            proxy_read_timeout    3s;
        }
    }
}
EOF
}

start_nginx() {
    docker rm -f $CNAME >/dev/null 2>&1
    docker run -d --name $CNAME \
        --add-host=host.docker.internal:host-gateway \
        -p 127.0.0.1:$LBPORT:80 \
        -v /tmp/l08_nginx.conf:/etc/nginx/nginx.conf:ro \
        docker.m.daocloud.io/library/nginx:alpine >/dev/null 2>&1
    for i in $(seq 1 25); do
        curl -s -o /dev/null -m 1 "http://127.0.0.1:$LBPORT/" 2>/dev/null && return 0
        sleep 0.4
    done
    echo "  !! nginx 起不来,看日志:"
    docker logs $CNAME 2>&1 | tail -5 | sed 's/^/     /'
    return 1
}

# 打 N 个请求,统计每个后端接到几个。
# 关键:必须【并发】发。串行发的话任一时刻只有 1 个在途连接,
# least_conn 看到所有后端连接数都是 0,就退化成轮询了 —— 演示不出区别。
hit() {
    local n=$1 conc=${2:-1}
    local dir=/tmp/l08_hits
    rm -rf $dir; mkdir -p $dir

    if [ "$conc" -le 1 ]; then
        for i in $(seq 1 "$n"); do
            curl -s -m 5 "http://127.0.0.1:$LBPORT/" > "$dir/$i" 2>/dev/null
        done
    else
        # 分批并发:每批 conc 个同时打出去
        local sent=0
        while [ "$sent" -lt "$n" ]; do
            local pids=()
            local batch=0
            while [ "$batch" -lt "$conc" ] && [ "$sent" -lt "$n" ]; do
                sent=$((sent+1)); batch=$((batch+1))
                curl -s -m 5 "http://127.0.0.1:$LBPORT/" > "$dir/$sent" 2>/dev/null &
                pids+=("$!")
            done
            # 只 wait 这批 curl 的 pid。裸 wait 会连那三个常驻后端进程
            # 一起等 —— 它们永远不退出,于是整个脚本卡死。
            for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
        done
    fi

    declare -A cnt
    local fail=0
    for f in "$dir"/*; do
        r=$(cat "$f" 2>/dev/null)
        if [ -z "$r" ]; then fail=$((fail+1)); else cnt[$r]=$(( ${cnt[$r]:-0} + 1 )); fi
    done
    for k in $(echo "${!cnt[@]}" | tr ' ' '\n' | sort); do
        local c=${cnt[$k]}
        printf "    %-12s: %2d 次  %s\n" "$k" "$c" "$(printf '#%.0s' $(seq 1 $c))"
    done
    [ "$fail" -gt 0 ] && printf "    %-12s: %2d 个\n" "失败" "$fail" || echo "    失败 0 个"
    rm -rf $dir
}

hr
echo "=== 阶段 1:轮询(round-robin),3 个后端都健康 ==="
hr
write_conf ""          # 不写算法 = nginx 默认轮询
start_nginx || exit 1
echo "  打 12 个请求,分布:"
hit 12

echo
hr
echo "=== 阶段 2:杀掉 backend-2,立刻再打 12 个 ==="
hr
# 找出 backend-2 的 pid 并杀掉
set +m
B2PID=$(ps -o pid=,args= -u "$(id -u)" | grep 'l08_backend.py backend-2' | grep -v grep | awk '{print $1}' | head -1)
if [ -n "$B2PID" ]; then
    kill -9 "$B2PID" 2>/dev/null; wait "$B2PID" 2>/dev/null
    echo "  已杀掉 backend-2 (pid $B2PID)"
else
    echo "  (没找到 backend-2 进程)"
fi
sleep 0.6
echo "  分布:"
hit 12
echo
echo "  ↑ 注意失败数。nginx 发现 backend-2 连不上,把它摘掉并【自动重试到其他后端】"

echo
hr
echo "=== 阶段 3:换 least_conn,并把 backend-3 变成慢机器 ==="
hr
# 重启 backend-2,并把 backend-3 换成延迟 0.4s 的慢机器
python3 /tmp/l08_backend.py backend-2 $B2 > /dev/null 2>&1 & track $!
B3PID=$(ps -o pid=,args= -u "$(id -u)" | grep 'l08_backend.py backend-3' | grep -v grep | awk '{print $1}' | head -1)
[ -n "$B3PID" ] && { kill -9 "$B3PID" 2>/dev/null; wait "$B3PID" 2>/dev/null; }
sleep 0.3
python3 /tmp/l08_backend.py backend-3 $B3 0.4 > /dev/null 2>&1 & track $!
sleep 1.0
echo "  现在 backend-3 每个请求慢 0.4 秒(模拟一台老机器)"
echo
echo "  A) 轮询:并发 6 打 24 个请求 —— 慢机器照样硬分到 1/3"
write_conf ""
start_nginx >/dev/null 2>&1
T0=$(date +%s.%N)
hit 24 6
T1=$(date +%s.%N)
echo "    这 24 个请求总耗时: $(echo "$T1 - $T0" | bc 2>/dev/null || echo '?') 秒"

echo
echo "  B) least_conn:同样并发 6 打 24 个 —— 慢机器的连接占着不放,自动少分"
write_conf "least_conn;"
start_nginx >/dev/null 2>&1
T0=$(date +%s.%N)
hit 24 6
T1=$(date +%s.%N)
echo "    这 24 个请求总耗时: $(echo "$T1 - $T0" | bc 2>/dev/null || echo '?') 秒"

echo
hr
cat <<'SUMMARY'
三个结论:

1. 【屏蔽故障】才是负载均衡最大的价值。阶段 2 杀了一台后端,
   用户侧一个错都没有 —— 你的机器可以随时挂、随时发版。

2. 【被动健康检查 + 自动重试】是怎么做到的:
   nginx 请求失败 -> 标记该后端不可用(max_fails/fail_timeout)
                  -> 把这个请求转给下一个健康后端
   危险:如果是非幂等的 POST,后端可能已经处理成功只是响应丢了,
        重试就会重复下单。写接口要限制重试条件。

3. 【least_conn 对能力不均的机器更友好】:慢机器的连接占着不放,
   nginx 就自动少分给它。轮询做不到这一点 —— 它只会公平地把
   请求塞给一台已经忙不过来的机器。
SUMMARY

rm -f /tmp/l08_backend.py /tmp/l08_nginx.conf
