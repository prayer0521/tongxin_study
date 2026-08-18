#!/usr/bin/env bash
# L02 实验:谁先 close,谁进 TIME_WAIT
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PORT=18802
use_port $PORT
ensure_bin tcp_server || exit 1
ensure_bin tcp_client || exit 1

step "服务器起在 $PORT"
./bin/tcp_server $PORT > /tmp/l02_srv.log 2>&1 &
track $!
sleep 0.5

step "客户端连上,发一句话,然后【客户端先 close】"
./bin/tcp_client 127.0.0.1 $PORT "bye" > /tmp/l02_cli.log 2>&1
sleep 0.4

hr
echo "现在看谁进了 TIME-WAIT (ss -tan):"
hr
ss -tan 2>/dev/null | head -1
ss -tan 2>/dev/null | grep ":$PORT" | sed 's/^/  /'
hr
echo
echo "关键观察:"
echo "  TIME-WAIT 那一行的 Local Address 是客户端的临时端口,不是服务器的 $PORT。"
echo "  => 客户端先 close(发出第一个 FIN),所以【客户端】进 TIME_WAIT。"
echo
echo "  规则:谁主动 close,谁进 TIME_WAIT,持续约 2×MSL(Linux 上约 60 秒)。"
echo
echo "  工作意义:如果让【服务器】做主动关闭方,高并发下服务器会堆积海量 TIME_WAIT,"
echo "  耗尽本地端口。这就是 HTTP keep-alive、以及『尽量让客户端关连接』的由来。"
