#!/usr/bin/env bash
# containers.sh —— 学习站依赖的中间件容器(redis / postgres)
#
# 第三、四幕的实验用到【真的】 Redis 和 PostgreSQL。它们跑在独立容器里,
# 用非标准端口,不会碰你机器上其他项目的实例。
#
#   ./containers.sh up      启动(镜像本地没有会自动拉)
#   ./containers.sh down    停止并删除
#   ./containers.sh status   看状态
#
# 端口:  study-redis -> 127.0.0.1:16380
#         study-pg    -> 127.0.0.1:15433  (user/pass/db 都是 study)
set -u

REDIS_IMG=docker.m.daocloud.io/redis/redis-stack-server:7.4.0-v8
PG_IMG=docker.m.daocloud.io/library/postgres:16
NGINX_IMG=docker.m.daocloud.io/library/nginx:alpine

need_docker() {
    command -v docker >/dev/null 2>&1 || {
        echo "!! 没有 docker。第三、四幕的实验需要它。"
        echo "   没有 docker 也能学 —— 每个实验都在网页里附了预期输出。"
        exit 1
    }
}

up() {
    need_docker
    echo ">>> 启动 study-redis (127.0.0.1:16380)"
    if docker ps -a --format '{{.Names}}' | grep -q '^study-redis$'; then
        docker start study-redis >/dev/null
    else
        docker run -d --name study-redis \
            -p 127.0.0.1:16380:6379 \
            "$REDIS_IMG" \
            redis-server --save '' --appendonly no --protected-mode no >/dev/null
    fi

    echo ">>> 启动 study-pg (127.0.0.1:15433)"
    if docker ps -a --format '{{.Names}}' | grep -q '^study-pg$'; then
        docker start study-pg >/dev/null
    else
        docker run -d --name study-pg \
            -p 127.0.0.1:15433:5432 \
            -e POSTGRES_PASSWORD=study -e POSTGRES_USER=study -e POSTGRES_DB=study \
            "$PG_IMG" >/dev/null
    fi

    echo ">>> 预拉 nginx 镜像(L08/L09 用)"
    docker image inspect "$NGINX_IMG" >/dev/null 2>&1 || docker pull "$NGINX_IMG" >/dev/null

    echo ">>> 等待就绪…"
    for i in $(seq 1 20); do
        r=$(docker exec study-redis redis-cli ping 2>/dev/null)
        p=$(docker exec study-pg pg_isready -U study 2>/dev/null | grep -c accepting)
        [ "$r" = "PONG" ] && [ "$p" = "1" ] && { echo "  就绪 (${i}s)"; break; }
        sleep 1
    done
    status
}

down() {
    need_docker
    docker rm -f study-redis study-pg study-lb-nginx study-l09-nginx 2>/dev/null
    echo "已停止并删除学习站容器(不影响你其他项目的容器)"
}

status() {
    need_docker
    echo ""
    echo "  容器状态:"
    docker ps --filter name=study- --format '    {{.Names}}  {{.Status}}  {{.Ports}}' 2>/dev/null
    echo "    redis ping: $(docker exec study-redis redis-cli ping 2>/dev/null || echo '未运行')"
    echo "    pg    ping: $(docker exec study-pg pg_isready -U study 2>/dev/null || echo '未运行')"
    echo ""
}

case "${1:-up}" in
    up)     up ;;
    down)   down ;;
    status) status ;;
    *)      echo "用法: $0 {up|down|status}" ;;
esac
