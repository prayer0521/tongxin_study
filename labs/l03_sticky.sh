#!/usr/bin/env bash
# L03 实验:TCP 粘包 —— 5 次 send,1 次 recv
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PORT=18803
use_port $PORT
ensure_bin tcp_server || exit 1
ensure_bin tcp_client || exit 1

step "服务器起在 $PORT"
./bin/tcp_server $PORT > /tmp/l03_srv.log 2>&1 &
track $!
sleep 0.5

step "客户端连发 5 个 6 字节的包,中间不加任何分隔符"
./bin/tcp_client 127.0.0.1 $PORT --burst 5 2>&1 | sed 's/^/  /'
sleep 0.6

hr
echo "服务器端实际 recv 了几次:"
hr
grep -E 'recv\(\)' /tmp/l03_srv.log | sed 's/^/  /'
COUNT=$(grep -c 'recv() = ' /tmp/l03_srv.log)
hr
echo
echo "客户端 send 了 5 次,服务器 recv 了 $COUNT 次。"
echo

hr
echo "对比:UDP 做同样的事,边界不会消失"
hr
UPORT=18903
use_port $UPORT
ensure_bin udp_server && ensure_bin udp_client && {
    ./bin/udp_server $UPORT > /tmp/l03_udp.log 2>&1 &
    track $!
    sleep 0.4
    for i in 0 1 2 3 4; do
        ./bin/udp_client 127.0.0.1 $UPORT "PKT-0$i" >/dev/null 2>&1
    done
    sleep 0.5
    UC=$(grep -c 'recvfrom' /tmp/l03_udp.log)
    grep 'recvfrom' /tmp/l03_udp.log | head -6 | sed 's/^/  /'
    echo
    echo "  UDP: sendto 5 次 -> recvfrom $UC 次。一发一收,边界完整保留。"
}

echo
echo "结论:TCP 是【字节流】,应用层必须自己划边界(长度前缀 或 分隔符)。"
echo "      UDP 是【数据报】,边界由协议保证,但会丢、会乱序。"
