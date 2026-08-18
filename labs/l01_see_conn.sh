#!/usr/bin/env bash
# L01 实验:看内核眼里的一条 TCP 连接(四元组)
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

PORT=18801
use_port $PORT
ensure_bin tcp_server || exit 1
ensure_bin tcp_client || exit 1

step "启动服务器 (端口 $PORT)"
./bin/tcp_server $PORT > /tmp/l01_srv.log 2>&1 &
track $!
sleep 0.5

step "客户端连上,并 hold 住不断开"
# --noread 让客户端连上后不读、不退出,这样连接一直是 ESTAB
timeout 6 ./bin/tcp_client 127.0.0.1 $PORT --noread > /tmp/l01_cli.log 2>&1 &
track $!
sleep 0.8

hr
echo "内核眼里的这条连接 (ss -tan):"
hr
ss -tan 2>/dev/null | head -1
ss -tan 2>/dev/null | grep ":$PORT" | sed 's/^/  /'
hr

echo
echo "服务器进程看到的:"
grep -E '\[1\]|\[2\]|\[3\]|\[4\]|四元组' /tmp/l01_srv.log 2>/dev/null | sed 's/^/  /'

echo
echo "读法:"
echo "  LISTEN 行  = 你 listen() 出来的监听套接字,0.0.0.0 表示所有网卡"
echo "  两条 ESTAB = 同一条连接的两端(本机通信所以两端都在本机),地址正好镜像"
echo "  客户端那个大端口号是内核自动分配的【临时端口】—— 你没 bind,它替你选了一个"
