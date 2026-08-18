#!/usr/bin/env python3
"""
通信网学习站 —— 本地服务器

只用 Python 标准库,没有任何第三方依赖。

  python3 serve.py            # 然后打开 http://127.0.0.1:8080
  python3 serve.py --port 9000

它干三件事:
  1. 静态文件服务      site/  下的 html/css/js
  2. 内容 API          content/ 下的关卡 JSON
  3. 实验执行器        POST /api/lab/run  ->  跑 labs/<name>.sh 并把输出回传

安全边界(重要):
  * 只绑定 127.0.0.1,外部机器连不上。
  * 没有任何认证 —— 因为它只监听本机回环口,不要改成 0.0.0.0 暴露出去。
  * 实验执行器【不接受浏览器传来的任意命令】。它只接受一个名字,
    然后去 labs/ 目录里找同名 .sh 文件。名字里含 / 或 .. 直接拒绝。
    这是白名单模型:能跑什么完全由 labs/ 目录里有什么决定,
    而 labs/ 里的脚本是你自己能读到的、写死的。
"""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")
CONTENT = os.path.join(ROOT, "content")
LABS = os.path.join(ROOT, "labs")
PROGRESS_FILE = os.path.join(ROOT, ".progress.json")

LAB_TIMEOUT = 90          # 秒。实验里有 sleep,给宽松一点
LAB_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".png": "image/png",
}

_progress_lock = threading.Lock()


# ---------------------------------------------------------------- 进度存档

def load_progress():
    try:
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"xp": 0, "done": {}, "labs": {}, "boss": {}, "notes": {}}


def save_progress(data):
    with _progress_lock:
        tmp = PROGRESS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, PROGRESS_FILE)


# ---------------------------------------------------------------- 实验执行

def list_labs():
    if not os.path.isdir(LABS):
        return []
    return sorted(
        f[:-3] for f in os.listdir(LABS)
        if f.endswith(".sh") and not f.startswith("_")
    )


def run_lab(name):
    """跑一个实验脚本。返回 (ok, payload)。

    name 必须是纯粹的脚本名,不含路径分隔符。这是唯一的信任边界。
    """
    if not LAB_NAME_RE.match(name):
        return False, {"error": "实验名不合法", "name": name}

    path = os.path.join(LABS, name + ".sh")
    # realpath 再校验一次,确保没被符号链接绕出 labs/
    if os.path.realpath(os.path.dirname(path)) != os.path.realpath(LABS):
        return False, {"error": "路径越界"}
    if not os.path.isfile(path):
        return False, {"error": "找不到这个实验脚本: labs/%s.sh" % name}

    started = time.time()
    env = dict(os.environ)
    env["LC_ALL"] = "C.UTF-8"
    env["STUDY_ROOT"] = ROOT

    try:
        # start_new_session:脚本里会起后台服务器进程。放到独立进程组里,
        # 超时时可以一次性把整组杀掉,不留孤儿进程占着端口。
        proc = subprocess.Popen(
            ["bash", path],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    except OSError as e:
        return False, {"error": "启动失败: %s" % e}

    timed_out = False
    try:
        out, _ = proc.communicate(timeout=LAB_TIMEOUT)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            pass
        out, _ = proc.communicate()
    else:
        # 脚本自己退出了,但它 fork 的后台进程可能还活着。清掉进程组。
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            pass

    text = (out or b"").decode("utf-8", errors="replace")
    return True, {
        "name": name,
        "output": text,
        "exit": proc.returncode,
        "seconds": round(time.time() - started, 2),
        "timedOut": timed_out,
    }


def check_tools():
    """报告本机有哪些工具,前端用来提示某些实验能不能跑。"""
    tools = {}
    for t in ("gcc", "g++", "go", "python3", "ss", "curl", "redis-server",
              "nginx", "tcpdump", "docker"):
        p = shutil.which(t)
        tools[t] = bool(p)
    return tools


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "StudyNet/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # 默认日志太吵(每个 css/js 一行)。只记 API 和错误。
        msg = fmt % args
        if "/api/" in msg or " 4" in msg or " 5" in msg:
            sys.stderr.write("  %s\n" % msg)

    # ---- 工具

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if n <= 0 or n > 1 << 20:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def _serve_file(self, base, relpath):
        # 防目录穿越:拼完路径后必须仍在 base 之内
        full = os.path.realpath(os.path.join(base, relpath.lstrip("/")))
        if not full.startswith(os.path.realpath(base)):
            return self._send(403, {"error": "forbidden"})
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self._send(404, {"error": "not found: %s" % relpath})

        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ---- 路由

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/tools":
            return self._send(200, {"tools": check_tools(), "labs": list_labs()})

        if path == "/api/progress":
            return self._send(200, load_progress())

        if path.startswith("/content/"):
            return self._serve_file(CONTENT, path[len("/content"):])

        if path == "/" or not os.path.splitext(path)[1]:
            # 前端是单页应用,所有无扩展名的路径都回 index.html
            return self._serve_file(SITE, "/index.html")

        return self._serve_file(SITE, path)

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_json()

        if path == "/api/lab/run":
            name = str(body.get("name") or "")
            ok, payload = run_lab(name)
            return self._send(200 if ok else 400, payload)

        if path == "/api/progress":
            if not isinstance(body, dict):
                return self._send(400, {"error": "bad body"})
            save_progress(body)
            return self._send(200, {"ok": True})

        if path == "/api/progress/reset":
            save_progress({"xp": 0, "done": {}, "labs": {}, "boss": {}, "notes": {}})
            return self._send(200, {"ok": True})

        return self._send(404, {"error": "no such endpoint"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()

    # 只绑回环地址。这台服务器会执行 shell 脚本,不能让外部访问。
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.daemon_threads = True

    n_labs = len(list_labs())
    print("")
    print("  通信网学习站已启动")
    print("  ────────────────────────────────────")
    print("  http://127.0.0.1:%d" % args.port)
    print("")
    print("  实验脚本: %d 个 (labs/)" % n_labs)
    print("  进度存档: .progress.json")
    print("  仅监听回环地址,外部无法访问")
    print("")
    print("  Ctrl-C 停止")
    print("")
    # 重定向到文件/管道时 stdout 默认是全缓冲,启动横幅会攒在缓冲区里不落盘。
    # 后台跑(nohup ... > study.log)的人会看到一个空日志,误以为没起来。
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  停止。进度已存在 .progress.json\n")
        srv.shutdown()


if __name__ == "__main__":
    main()
