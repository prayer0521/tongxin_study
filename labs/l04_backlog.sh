#!/usr/bin/env bash
# L04 实验:连接堆在 backlog 队列里(握完手却没人 accept)
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PORT=18804
use_port $PORT
ensure_bin tcp_client || exit 1

step "编译一个 backlog=2、且【永不 accept】的服务器"
cat > /tmp/l04_srv.c <<'EOF'
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    int port = argc > 1 ? atoi(argv[1]) : 18804;
    int l = socket(AF_INET, SOCK_STREAM, 0);
    int on = 1; setsockopt(l, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
    struct sockaddr_in a; memset(&a, 0, sizeof a);
    a.sin_family = AF_INET; a.sin_port = htons(port);
    a.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(l, (struct sockaddr*)&a, sizeof a) < 0) { perror("bind"); return 1; }
    listen(l, 2);                 /* backlog=2,而且下面【永不 accept】 */
    printf("listen(backlog=2) 完成,故意不 accept,睡 10 秒\n");
    fflush(stdout);
    sleep(10);
    return 0;
}
EOF
gcc -o /tmp/l04_srv /tmp/l04_srv.c 2>&1 || { echo "编译失败"; exit 1; }

/tmp/l04_srv $PORT &
track $!
sleep 0.5

step "连 5 个客户端进去,看哪个开始卡住"
hr
for i in 1 2 3 4 5; do
    timeout 2 ./bin/tcp_client 127.0.0.1 $PORT --noread > /tmp/l04_c$i.log 2>&1 &
    track $!
    sleep 0.4
    ok=$(grep -c 'connect() 成功\|connect 成功\|已连接\|\[3\]' /tmp/l04_c$i.log 2>/dev/null)
    if [ "$ok" -ge 1 ]; then
        echo "  第 $i 个客户端: connect 成功"
    else
        echo "  第 $i 个客户端: 卡住,连不上  <-- 队列满了"
    fi
done
hr

echo
echo "内核队列状态 (ss -tanl):"
ss -tanl 2>/dev/null | head -1
ss -tanl 2>/dev/null | grep ":$PORT" | sed 's/^/  /'
echo
echo "读法:"
echo "  Recv-Q = 全连接队列当前堆积的连接数(握完手、等着被 accept 的)"
echo "  Send-Q = 队列上限(就是你传给 listen 的 backlog)"
echo
echo "  服务器一次 accept 都没调,前几个客户端却 connect 成功了"
echo "  => 三次握手是【内核】干的,accept 只是从队列取货。"
echo "  Recv-Q 持续接近 Send-Q,就是线上『accept 不过来 / 过载』的告警信号。"

rm -f /tmp/l04_srv /tmp/l04_srv.c
