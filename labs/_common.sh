#!/usr/bin/env bash
# labs/_common.sh —— 所有实验脚本共用的工具与安全约定
#
# 这些脚本由 serve.py 在【本机回环】上执行,输出回传到网页。
# 约定:
#   * 只用固定的高端口(188xx),避免撞常用端口
#   * 结束时清理自己起的所有后台进程,不留孤儿
#   * 所有输出走 stdout,serve.py 会捕获
#   * 需要编译时先确保 bin/ 存在

set -u
STUDY_ROOT="${STUDY_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$STUDY_ROOT" || exit 1

# 记录本脚本起的后台 pid,退出时统一清理
_PIDS=()
track() { _PIDS+=("$1"); }
cleanup() {
    for pid in "${_PIDS[@]:-}"; do
        kill "$pid" 2>/dev/null
    done
    # 兜底:杀掉可能残留的本实验端口占用者
    for port in "${_PORTS[@]:-}"; do
        local owner
        owner=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)
        [ -n "${owner:-}" ] && kill "$owner" 2>/dev/null
    done
}
trap cleanup EXIT INT TERM

_PORTS=()
use_port() { _PORTS+=("$1"); }

# 确保 C 版二进制已编译
ensure_bin() {
    if [ ! -x "bin/$1" ]; then
        echo "(bin/$1 不存在,尝试编译…)"
        make "bin/$1" >/dev/null 2>&1 || make >/dev/null 2>&1
    fi
    if [ ! -x "bin/$1" ]; then
        echo "!! 编译失败,请先在项目根目录手动跑一次 make"
        return 1
    fi
    return 0
}

hr()  { echo "────────────────────────────────────────"; }
step(){ echo ">>> $*"; }
