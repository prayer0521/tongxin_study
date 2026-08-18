#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""L08 加机器:负载均衡"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blocks import *  # noqa


def build():
    blocks = [
        hook(
            "L07 你量出了单机极限,也算出了需要几台。现在真的加上第二台、第三台 —— "
            "然后立刻撞上三个新问题:\n\n"
            "1. 用户只知道一个域名,**流量怎么分到三台机器上?**\n"
            "2. 其中一台挂了,**怎么让用户不受影响?**\n"
            "3. 要发新版本,**怎么先只让 5% 的流量试试?**\n\n"
            "这三个问题的答案都是同一个东西:在用户和你的服务之间,加一层**负载均衡**。"
        ),

        h("先玩一下:算法决定了流量怎么分"),
        p("下面这个沙盘里三台后端**能力不同**(B2 是台慢机器)。"
          "切换算法、把 B2 打挂,看请求怎么重新分布。"
          "先自己玩两分钟再往下读 —— 你会自己发现轮询的问题。"),

        fig("loadbalance", "换算法 / 打挂 B2,观察请求分布和每台的负载条"),

        p("你应该已经看到了:**纯轮询(RR)对能力不均的机器很不友好** —— "
          "它给慢机器 B2 分了和快机器一样多的请求,B2 的负载条很快就红了。"
          "这就是为什么真实环境里几乎不用纯轮询。"),

        table(
            ["算法", "怎么选", "适合", "坑"],
            [
                ["**轮询 RR**", "挨个来,1→2→3→1", "机器配置完全一致、请求耗时均匀",
                 "机器能力不均时,慢的那台先崩"],
                ["**加权轮询 WRR**", "按权重分,权重 3 的拿 3 倍流量", "机器配置不同(常见于混合机型)",
                 "权重要手工维护;请求耗时差异大时仍会不均"],
                ["**最少连接 LC**", "谁当前连接最少给谁", "**请求耗时差异大**(最常用的默认选择)",
                 "长连接场景下,连接数不等于真实负载"],
                ["**一致性哈希**", "按 key(如用户 ID)哈希到固定后端", "需要**同一用户总落同一台**(本地缓存、粘性会话)",
                 "加减机器会造成部分 key 重新分布"],
                ["**IP 哈希**", "按客户端 IP 哈希", "简易粘性会话",
                 "**NAT 后面一大片用户共用一个出口 IP → 严重倾斜**"],
            ],
        ),

        key(
            "**没有「最好的算法」,只有「匹配你的请求特征的算法」。** 判断依据是"
            "**请求耗时的方差**:\n\n"
            "- 耗时都差不多(如纯查缓存的接口)→ **轮询/加权轮询**就够了,开销最小。\n"
            "- 耗时差异大(有的 5ms 有的 2s)→ 必须用**最少连接**。用轮询的话,"
            "某台机器可能连续接到几个慢请求而被压死,而隔壁机器闲着。\n\n"
            "这也是 nginx 默认 `round-robin`、但生产配置里大量出现 `least_conn` 的原因。",
            "怎么选算法"
        ),

        h("四层还是七层:你架构生涯的第一个真决策"),
        p("这个区分绕不过去,而且面试必问。理解它只需要回到 L01 学的**分层**:"
          "**负载均衡器要拆到第几层才能做决定?**"),

        table(
            ["", "四层 (L4)", "七层 (L7)"],
            [
                ["工作在", "传输层 —— 只看 **IP + 端口**", "应用层 —— 看得懂 **HTTP** 内容"],
                ["能不能看到 URL", "**不能**", "**能**"],
                ["转发方式", "改包头转发 TCP 连接,不解析内容", "自己**终结** TCP 连接,再向后端**新建**连接"],
                ["性能", "极高(几乎线速,单机百万级)", "较低(要解析 HTTP、可能要解密 TLS)"],
                ["典型实现", "**LVS**、F5、云厂商 NLB", "**Nginx**、HAProxy、云厂商 ALB"],
                ["能按 URL 路由吗", "不能", "**能** —— `/api/*` 给 A 组,`/static/*` 给 B 组"],
                ["能按 header 灰度吗", "不能", "**能** —— 这是灰度发布的基础"],
                ["能改请求吗", "不能", "**能** —— 加 `X-Request-Id`、重写路径"],
            ],
        ),

        key(
            "**灰度发布必须在七层做**,原因就在上面这张表:灰度的本质是"
            "「按某个业务特征挑出一小部分流量」—— 比如"
            "`Cookie 里有 beta=1` 或 `header 里 uid 尾号是 7`。\n\n"
            "四层只看得到 IP 和端口,**它根本不知道什么是 Cookie**,所以做不到。\n\n"
            "同理,`X-Request-Id` / `trace_id` 注入(L14 会用到)也只能在七层做。",
            "为什么灰度必须在七层"
        ),

        biz(
            "**大厂的实际做法是两层叠起来用**,各取所长:\n\n"
            "```\n"
            "用户 → LVS(四层,抗住海量连接和 DDoS)\n"
            "         → Nginx 集群(七层,按 URL 路由、灰度、注入 trace_id)\n"
            "             → 你的应用\n"
            "```\n\n"
            "四层在最前面扛量(它便宜、快、不容易成为瓶颈),七层在后面做业务决策。\n\n"
            "小规模场景直接上 Nginx 就够了 —— 一台 Nginx 扛几万 QPS 没问题,"
            "**不要过早引入 LVS**,那是几十万 QPS 才需要考虑的事。",
            "生产里怎么组合"
        ),

        h("真跑一遍:nginx 在三个后端之间分流"),
        p("下面这个实验是**真的** —— 真 nginx 容器、三个真后端进程。"
          "每个后端会在响应里报出自己是谁,所以你能直接看到流量分布。"),

        lab(
            "nginx-lb", "nginx 真的做负载均衡 + 故障转移",
            "起 3 个后端(各自返回自己的编号)+ 1 个 nginx。先用轮询打 12 个请求看分布,"
            "然后**杀掉一个后端**,再打 12 个 —— 观察 nginx 怎么自动把它摘掉。"
            "最后换成 `least_conn` 再看一次。",
            script="l08_nginx_lb",
            needs=["docker"],
            ask="杀掉 backend-2 之后,那些本该轮到它的请求会怎样?报错还是自动转给别人?",
            expect=(
                "=== 阶段 1:轮询(round-robin),3 个后端都健康 ===\n"
                "  打 12 个请求,分布:\n"
                "    backend-1   :  4 次  ####\n"
                "    backend-2   :  4 次  ####\n"
                "    backend-3   :  4 次  ####\n"
                "    失败 0 个\n\n"
                "=== 阶段 2:杀掉 backend-2,立刻再打 12 个 ===\n"
                "  已杀掉 backend-2 (pid 320376)\n"
                "  分布:\n"
                "    backend-1   :  5 次  #####\n"
                "    backend-3   :  7 次  #######\n"
                "    失败 0 个        <- 一个都没失败\n\n"
                "=== 阶段 3:backend-3 变成慢机器(每请求 +0.4s),并发 6 打 24 个 ===\n"
                "  A) 轮询:\n"
                "    backend-1   :  8 次   backend-2 : 8 次   backend-3 : 8 次\n"
                "    总耗时 3.39 秒\n"
                "  B) least_conn:\n"
                "    backend-1   :  9 次   backend-2 : 9 次   backend-3 : 6 次\n"
                "    总耗时 2.58 秒     <- 快了约 24%\n"
            ),
            explain=(
                "**阶段 2 是重点:杀了一台后端,12 个请求一个都没失败。**\n\n"
                "nginx 做了两件事:\n"
                "1. **被动健康检查**:请求 backend-2 时连接被拒,nginx 把它标记为不可用"
                "(默认 `max_fails=1`、`fail_timeout=10s`)。\n"
                "2. **自动重试**:失败的那个请求被**转发给下一个健康后端**,用户完全无感。\n\n"
                "这就是负载均衡最大的价值 —— **不是分摊流量,是屏蔽故障**。"
                "你的机器可以随时挂、随时重启发版,用户不知道。\n\n"
                "**但要注意重试的危险:** nginx 默认对失败请求重试,如果这个请求是"
                "**非幂等**的 POST(L06 讲过),而且后端其实已经处理成功了、只是响应丢了 —— "
                "重试就会造成**重复下单**。生产配置里对写接口通常要设"
                "`proxy_next_upstream off` 或只在明确安全的错误上重试。"
            ),
            xp=30,
        ),

        h("配置长什么样"),
        p("这是上面实验实际用的 nginx 配置。三行就是一个负载均衡器 —— "
          "值得看清每一行在管什么。"),

        code(
            "upstream backend {\n"
            "    # 算法:默认是轮���。取消注释下面一行就变成最少连接\n"
            "    # least_conn;\n"
            "\n"
            "    # 三个后端。weight 控制加权轮询,不写默认是 1\n"
            "    server 172.17.0.1:18841 weight=1 max_fails=1 fail_timeout=10s;\n"
            "    server 172.17.0.1:18842 weight=1 max_fails=1 fail_timeout=10s;\n"
            "    server 172.17.0.1:18843 weight=1 max_fails=1 fail_timeout=10s;\n"
            "\n"
            "    # keep-alive:和后端复用连接,省掉每次请求的握手(L02/L05)\n"
            "    keepalive 32;\n"
            "}\n"
            "\n"
            "server {\n"
            "    listen 80;\n"
            "    location / {\n"
            "        proxy_pass http://backend;\n"
            "\n"
            "        # 七层才能干的事:把真实客户端信息传给后端\n"
            "        # 不加这些,后端看到的来源 IP 全是 nginx 的\n"
            "        proxy_set_header Host              $host;\n"
            "        proxy_set_header X-Real-IP         $remote_addr;\n"
            "        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;\n"
            "\n"
            "        # 复用后端连接需要 HTTP/1.1 且清空 Connection 头\n"
            "        proxy_http_version 1.1;\n"
            "        proxy_set_header Connection \"\";\n"
            "\n"
            "        # 超时:这三个值不设好,一个慢后端能拖垮整个 nginx\n"
            "        proxy_connect_timeout 2s;\n"
            "        proxy_read_timeout    5s;\n"
            "        proxy_send_timeout    5s;\n"
            "    }\n"
            "}\n",
            lang="nginx", file="nginx.conf", label="真实可用的配置"
        ),

        trap(
            "**`X-Forwarded-For` 是可以伪造的。** 客户端完全可以自己在请求里带一个"
            "`X-Forwarded-For: 1.2.3.4`。\n\n"
            "如果你用它做**限流**(L14)或**风控**,攻击者只要每次换一个伪造 IP 就绕过了。\n\n"
            "正确做法:只信任**你自己的**代理层追加的那一段。`$proxy_add_x_forwarded_for` "
            "是「原有值 + 真实 remote_addr」,所以**最后一个**才是你的 nginx 亲眼看到的地址。"
            "在最外层入口通常要**直接覆盖**而不是追加:`proxy_set_header X-Forwarded-For $remote_addr;`",
            "别无条件信任 X-Forwarded-For"
        ),

        h("客户端也能做负载均衡"),
        p("上面是**服务端负载均衡**(用户 → LB → 后端)。还有一种在微服务里更常见的做法:"),

        poly(
            title="客户端负载均衡:调用方自己选后端",
            go=(
                "// 服务发现 + 客户端负载均衡的骨架\n"
                "// 微服务里 A 调 B,不走中心化 LB,而是 A 自己从注册中心拿 B 的列表\n"
                "type Balancer struct {\n"
                "    mu       sync.Mutex\n"
                "    backends []string   // 从 Consul/Nacos/etcd 拉来,会动态变化\n"
                "    idx      uint64\n"
                "}\n\n"
                "func (b *Balancer) Pick() string {\n"
                "    b.mu.Lock()\n"
                "    defer b.mu.Unlock()\n"
                "    if len(b.backends) == 0 { return \"\" }\n"
                "    // 原子自增取模 = 轮询\n"
                "    i := atomic.AddUint64(&b.idx, 1)\n"
                "    return b.backends[i%uint64(len(b.backends))]\n"
                "}\n\n"
                "// 好处:少一跳网络(不用绕到中心 LB),没有单点\n"
                "// 代价:每个客户端都要实现这套逻辑,配置变更要推给所有客户端\n"
                "// 这正是 Service Mesh(Istio/Envoy sidecar)要解决的问题 ——\n"
                "// 把这套逻辑从业务代码里抽到 sidecar 进程里",
                "balancer.go",
                "Go 是微服务的主流语言之一,这套代码在 gRPC 生态里很常见。"
                "`grpc-go` 内置了 `round_robin`、`pick_first` 等 balancer。"
            ),
            py=(
                "import itertools, threading, requests\n\n"
                "class ClientLB:\n"
                "    def __init__(self, backends):\n"
                "        self._backends = list(backends)\n"
                "        self._cycle = itertools.cycle(range(len(backends)))\n"
                "        self._lock = threading.Lock()\n"
                "        self._dead = {}          # {下标: 恢复时间}\n\n"
                "    def pick(self):\n"
                "        import time\n"
                "        with self._lock:\n"
                "            for _ in range(len(self._backends)):\n"
                "                i = next(self._cycle)\n"
                "                # 简易熔断:失败过的后端冷却 10 秒(L14 会讲完整版)\n"
                "                if self._dead.get(i, 0) < time.time():\n"
                "                    return i, self._backends[i]\n"
                "        raise RuntimeError('所有后端都不可用')\n\n"
                "    def mark_dead(self, i, cooldown=10):\n"
                "        import time\n"
                "        with self._lock:\n"
                "            self._dead[i] = time.time() + cooldown\n\n"
                "    def get(self, path):\n"
                "        i, base = self.pick()\n"
                "        try:\n"
                "            return requests.get(base + path, timeout=2)\n"
                "        except requests.RequestException:\n"
                "            self.mark_dead(i)     # 摘掉它,下次不选\n"
                "            raise",
                "client_lb.py",
                "注意 `mark_dead` —— **客户端负载均衡必须自己实现健康检查**,"
                "否则会不停往挂掉的机器上撞。这就是 nginx 帮你做的那件事。"
            ),
            cpp=(
                "// C++ 里通常直接用现成的库(如 gRPC C++),很少手写。\n"
                "// 但如果要手写,核心就是「一个可原子递增的下标 + 一个健康状态表」:\n"
                "class RoundRobin {\n"
                "    std::vector<std::string> backends_;\n"
                "    std::vector<std::atomic<int64_t>> dead_until_;  // 冷却到什么时候\n"
                "    std::atomic<uint64_t> idx_{0};\n"
                "public:\n"
                "    // 返回空字符串表示所有后端都不可用\n"
                "    std::string pick() {\n"
                "        auto now = std::chrono::steady_clock::now()\n"
                "                       .time_since_epoch().count();\n"
                "        for (size_t k = 0; k < backends_.size(); ++k) {\n"
                "            size_t i = idx_.fetch_add(1) % backends_.size();\n"
                "            if (dead_until_[i].load() < now) return backends_[i];\n"
                "        }\n"
                "        return {};\n"
                "    }\n"
                "};",
                "balancer.cpp",
                "`fetch_add` 是无锁轮询的标准写法 —— 高并发下比加互斥锁快得多。"
                "这是 C++ 在这一层的典型优势场景。"
            ),
        ),

        table(
            ["", "服务端 LB(nginx)", "客户端 LB(SDK/Mesh)"],
            [
                ["网络跳数", "多一跳(经过 LB)", "直连,少一跳"],
                ["单点风险", "LB 本身要做高可用", "无中心单点"],
                ["配置变更", "改 LB 一处即可", "要推送到所有客户端"],
                ["适合", "**南北向**流量(外部用户进来)", "**东西向**流量(微服务互相调)"],
                ["典型", "Nginx / ALB", "gRPC balancer / Istio+Envoy"],
            ],
        ),
    ]

    boss = [
        q("你的接口耗时差异极大(查缓存 5ms,复杂报表 3s)。最该用哪种均衡算法?",
          ["轮询 RR,最简单公平",
           "最少连接 LC —— 避免某台机器连续接到几个慢请求被压死,而其他机器闲着",
           "IP 哈希,保证同一用户落同一台",
           "随机,统计上最均匀"],
          1,
          "判断依据是**请求耗时的方差**。耗时差异大时轮询会让某台机器堆积慢请求而过载,"
          "最少连接能自动避开正在忙的机器。耗时均匀时轮询才够用。"),

        q("要做灰度发布:让 Cookie 里带 `beta=1` 的用户访问新版本。这必须在哪一层做?",
          ["四层 LVS,性能更好",
           "七层(Nginx/HAProxy)—— 只有七层能解析 HTTP,看得到 Cookie",
           "两层都可以",
           "在数据库层做"],
          1,
          "四层只看 IP + 端口,它不知道什么是 Cookie。灰度的本质是按业务特征筛流量,"
          "必须由能读懂 HTTP 的七层来做。同理 X-Request-Id 注入也只能在七层。"),

        q("nginx 后面一台后端挂了,但用户完全没感觉到报错。nginx 做了什么?",
          ["提前预知了故障",
           "被动健康检查把它标记为不可用,并把失败的请求自动重试到其他健康后端",
           "把请求缓存起来等后端恢复",
           "返回了上次的缓存响应"],
          1,
          "这是负载均衡最大的价值:**屏蔽故障**,而不只是分摊流量。但要注意重试对**非幂等**"
          "POST 的危险 —— 后端可能已处理成功只是响应丢了,重试会造成重复下单。"),

        q("用 `X-Forwarded-For` 做接口限流,为什么不安全?",
          ["这个头太长影响性能",
           "客户端可以自己伪造这个头,攻击者每次换一个假 IP 就绕过限流",
           "它只在 HTTPS 下有效",
           "nginx 不支持这个头"],
          1,
          "XFF 是普通请求头,客户端能随意伪造。只能信任**你自己的代理层追加的最后一段**;"
          "最外层入口应该直接用 $remote_addr 覆盖,而不是追加。"),
    ]

    write("L08", "加机器:负载均衡",
          "算法看请求方差,分层看要拆到第几层。负载均衡最大的价值不是分摊流量,是屏蔽故障。",
          blocks, boss,
          boss_title="通关测试:负载均衡",
          unlocks="- **负载均衡 Nginx/LVS** 节点点亮,后面挂上 **应用 #2 / #3**。\n"
                  "- **CDN** 节点点亮 —— 静态资源不该惊动你的源站。\n"
                  "- 你的架构第一次变成了「一组机器」而不是「一台机器」。")


if __name__ == "__main__":
    build()
