#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""共用压测器 —— 纯标准库,不需要装 ab / wrk。

用法:
    python3 _bench.py <url> <并发数> <总请求数>

输出 QPS / P50 / P95 / P99。刻意用线程而不是 asyncio:
压测端本身要能产生真实的并发连接,线程模型最直观。
"""
import sys
import threading
import time
import urllib.request
import urllib.error


def percentile(sorted_ms, p):
    """取百分位。sorted_ms 必须已排序。"""
    if not sorted_ms:
        return 0.0
    k = (len(sorted_ms) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(sorted_ms) - 1)
    if lo == hi:
        return sorted_ms[lo]
    return sorted_ms[lo] + (sorted_ms[hi] - sorted_ms[lo]) * (k - lo)


def run(url, concurrency, total):
    lat = []
    errors = [0]
    lock = threading.Lock()
    counter = [0]

    def worker():
        while True:
            with lock:
                if counter[0] >= total:
                    return
                counter[0] += 1
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(url, timeout=15) as r:
                    r.read()
                dt = (time.perf_counter() - t0) * 1000.0
                with lock:
                    lat.append(dt)
            except Exception:
                with lock:
                    errors[0] += 1

    threads = [threading.Thread(target=worker, daemon=True)
               for _ in range(concurrency)]
    wall0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    wall = time.perf_counter() - wall0

    lat.sort()
    ok = len(lat)
    return {
        "qps": ok / wall if wall > 0 else 0,
        "wall": wall,
        "ok": ok,
        "err": errors[0],
        "p50": percentile(lat, 50),
        "p95": percentile(lat, 95),
        "p99": percentile(lat, 99),
        "min": lat[0] if lat else 0,
        "max": lat[-1] if lat else 0,
    }


def report(tag, r, indent="  "):
    print("%s%s" % (indent, tag))
    print("%s  QPS         : %.1f" % (indent, r["qps"]))
    print("%s  P50 延迟    : %.1f ms" % (indent, r["p50"]))
    print("%s  P95 延迟    : %.1f ms" % (indent, r["p95"]))
    print("%s  P99 延迟    : %.1f ms" % (indent, r["p99"]))
    print("%s  最慢        : %.1f ms" % (indent, r["max"]))
    if r["err"]:
        print("%s  失败        : %d 个" % (indent, r["err"]))
    sys.stdout.flush()


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("用法: _bench.py <url> <并发> <总请求>")
        sys.exit(1)
    url = sys.argv[1]
    conc = int(sys.argv[2])
    tot = int(sys.argv[3])
    r = run(url, conc, tot)
    report("并发 %d,总请求 %d" % (conc, tot), r)
