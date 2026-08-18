#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 content/manifest.json —— 关卡清单与技能树。

内容源都放在 build/ 下的这些生成脚本里,而不是手写 JSON。
理由:JSON 里没法写注释,而这些内容需要注释来解释"为什么这一关放在这个位置"。
改内容 -> 跑 make content -> 重新生成。
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "content", "manifest.json")

# ---------------------------------------------------------------- 四幕
# 分幕的逻辑:每一幕回答一个不同层次的问题。
#   I   内核给了你什么(以及没给你什么)
#   II  怎么把字节变成业务
#   III 一台机器不够了
#   IV  多台机器带来的新问题
ACTS = [
    {"id": "I",   "title": "字节怎么过去的", "goal": "内核层面的真相"},
    {"id": "II",  "title": "变成业务系统",   "goal": "从字节到接口"},
    {"id": "III", "title": "撑住量",         "goal": "单机 → 集群"},
    {"id": "IV",  "title": "分布式的代价",   "goal": "生产环境的真实难题"},
]

LEVELS = [
    # ---------------- 第一幕:字节怎么过去的 ----------------
    dict(
        id="L01", act="I", xp=40, labs=2,
        title="一根线上的两个进程",
        blurb="你 send 出去的那个字节,到对面 recv 之前,到底经过了什么。"
              "IP 找机器,端口找进程,字节序决定谁在说人话。",
        skills=[
            dict(name="分层与封装",
                 desc="能说清一个包在四层里各被加了什么头,以及为什么 ping 通了端口还可能连不上"),
            dict(name="地址与端口语义",
                 desc="0.0.0.0 / 127.0.0.1 / 具体 IP 的区别,以及临时端口耗尽长什么样"),
        ],
    ),
    dict(
        id="L02", act="I", xp=45, labs=2,
        title="TCP 凭什么叫「可靠」",
        blurb="序号、确认、超时重传、滑动窗口、拥塞控制。可靠不是魔法,"
              "是五个机制堆出来的,每一个都有你能观测到的代价。",
        skills=[
            dict(name="TCP 状态机",
                 desc="能解释 TIME_WAIT / CLOSE_WAIT 堆积各自意味着代码里哪儿写错了"),
            dict(name="RTT 与重传",
                 desc="能从时间戳判断丢包,理解为什么首字节延迟是网络问题而非代码问题"),
        ],
    ),
    dict(
        id="L03", act="I", xp=45, labs=2,
        title="消息的边界要你自己划",
        blurb="TCP 只给你一条不分段的字节流。所有协议 —— HTTP、Redis、gRPC —— "
              "第一件事都是发明一个划边界的办法。你也来发明一个。",
        skills=[
            dict(name="协议设计",
                 desc="能设计长度前缀 / 分隔符协议,并说清各自适用场景与失败模式"),
            dict(name="健壮的读循环",
                 desc="写出永远正确的 read_exactly,不再假设一次 recv 拿到完整消息"),
        ],
    ),
    dict(
        id="L04", act="I", xp=50, labs=2,
        title="一个进程,一万个连接",
        blurb="串行服务器一次只能伺候一个人。fork、线程、select、epoll 是四代人"
              "对同一个问题的回答。C10K 到底难在哪。",
        skills=[
            dict(name="并发模型选型",
                 desc="能根据 CPU 密集 / IO 密集选进程、线程还是事件循环,并解释理由"),
            dict(name="epoll 事件循环",
                 desc="理解 nginx / Redis / Node.js 底层是同一个东西,以及阻塞调用为什么会毁掉事件循环"),
        ],
    ),

    # ---------------- 第二幕:变成业务系统 ----------------
    dict(
        id="L05", act="II", xp=45, labs=2,
        title="HTTP 就是一段有格式的字节",
        blurb="在 L03 你自己发明了协议。HTTP 是全世界都同意的那一个。"
              "用 nc 手打一个请求,你会发现它朴素得可疑。",
        skills=[
            dict(name="HTTP 报文结构",
                 desc="能手写请求报文,解释 Content-Length / chunked / keep-alive 各自解决什么"),
            dict(name="从零实现 HTTP 服务器",
                 desc="知道框架帮你做了什么,以及出问题时该往哪一层找"),
        ],
    ),
    dict(
        id="L06", act="II", xp=45, labs=2,
        title="一个请求的完整旅程",
        blurb="从浏览器地址栏到数据库再回来。DNS、TLS、CORS、状态码 —— "
              "你工作里天天遇到的怪事,都在这条链路的某一环上。",
        skills=[
            dict(name="全链路定位能力",
                 desc="接口慢 / 报错时,能按 DNS → TCP → TLS → 服务端 → 渲染 逐段排除"),
            dict(name="接口设计",
                 desc="REST 语义、状态码选择、幂等性,以及为什么 CORS 预检会突然多一个 OPTIONS 请求"),
        ],
    ),
    dict(
        id="L07", act="II", xp=50, labs=2,
        title="单机的天花板在哪",
        blurb="在加任何机器之前,先量出你现在能扛多少。QPS、P99、瓶颈在 CPU 还是 IO —— "
              "不会压测就没资格谈架构。",
        skills=[
            dict(name="性能压测与读数",
                 desc="能设计压测、读懂 P50/P99,并解释为什么平均延迟是最没用的指标"),
            dict(name="瓶颈定位",
                 desc="用 USE 方法快速判断瓶颈在 CPU、内存、磁盘还是网络"),
        ],
    ),

    # ---------------- 第三幕:撑住量 ----------------
    dict(
        id="L08", act="III", xp=50, labs=2,
        title="加机器:负载均衡",
        blurb="一台不够就上三台。但流量怎么分?挂了一台怎么办?四层和七层的分水岭在哪 —— "
              "这是你架构生涯的第一个真正决策。",
        skills=[
            dict(name="四层 / 七层选型",
                 desc="能说清 LVS 与 Nginx 的分工,以及为什么灰度发布必须在七层做"),
            dict(name="均衡算法与健康检查",
                 desc="RR / WRR / 最少连接 / 一致性哈希 的适用场景,以及摘除故障节点的机制"),
        ],
    ),
    dict(
        id="L09", act="III", xp=45, labs=1,
        title="无状态化:能横向扩展的前提",
        blurb="加了第二台机器,用户突然开始随机掉登录。因为 session 存在第一台的内存里。"
              "这一关是所有横向扩展的先决条件。",
        skills=[
            dict(name="无状态服务设计",
                 desc="能识别代码里所有隐藏的本地状态:内存 session、本地文件、进程内缓存、定时任务"),
            dict(name="会话方案权衡",
                 desc="粘性会话 / 集中式 session / JWT 的三方对比,包括 JWT 无法主动失效这个硬伤"),
        ],
    ),
    dict(
        id="L10", act="III", xp=50, labs=2,
        title="缓存:用空间换时间",
        blurb="应用扛住了,数据库跪了。缓存是后端最有效的一招,也是引入 bug 最多的一招 —— "
              "穿透、击穿、雪崩、双写不一致。",
        skills=[
            dict(name="缓存模式与失效策略",
                 desc="Cache-Aside / Write-Through 的取舍,TTL 与主动失效的组合"),
            dict(name="三大缓存故障",
                 desc="能现场说出穿透、击穿、雪崩的区别和各自的标准解法"),
        ],
    ),
    dict(
        id="L11", act="III", xp=50, labs=2,
        title="数据库:最后的瓶颈",
        blurb="缓存挡不住写。索引、主从复制、读写分离、分库分表 —— "
              "每一步都在拿一部分能力去换另一部分,没有免费的。",
        skills=[
            dict(name="索引与执行计划",
                 desc="能看懂 EXPLAIN,理解回表、覆盖索引、最左前缀"),
            dict(name="读写分离与分片",
                 desc="能设计分片键,并说清分片之后跨库 JOIN、分页、事务各自变成了什么麻烦"),
        ],
    ),

    # ---------------- 第四幕:分布式的代价 ----------------
    dict(
        id="L12", act="IV", xp=50, labs=2,
        title="异步:把慢活儿挪走",
        blurb="下单要发短信、扣库存、写日志、通知仓库。同步做完要 3 秒。"
              "消息队列把它们从请求链路里摘出去 —— 顺便学会削峰。",
        skills=[
            dict(name="异步解耦与削峰",
                 desc="能判断哪些逻辑该进队列,以及队列积压时该看什么指标"),
            dict(name="消息可靠性",
                 desc="at-least-once 下必须做幂等,能设计幂等键与去重表"),
        ],
    ),
    dict(
        id="L13", act="IV", xp=55, labs=2,
        title="分布式的代价",
        blurb="机器一多,你就失去了「同时」和「确定」。CAP、分布式锁、超时的三态、幂等 —— "
              "单机时代的所有直觉在这里都要重建。",
        skills=[
            dict(name="CAP 的工程含义",
                 desc="能针对具体业务(支付 vs 点赞)做出并论证 CP / AP 的选择"),
            dict(name="分布式锁与幂等",
                 desc="能指出 setnx 锁的三个经典 bug,并写出可用的实现"),
        ],
    ),
    dict(
        id="L14", act="IV", xp=60, labs=0,
        title="生产就绪",
        blurb="限流、熔断、降级保命;日志、指标、链路让你看得见。"
              "最后用一个秒杀系统,把十四关的东西全串起来。",
        skills=[
            dict(name="稳定性三板斧",
                 desc="限流 / 熔断 / 降级 各自解决什么,以及漏桶与令牌桶的区别"),
            dict(name="可观测性",
                 desc="日志、指标、链路追踪的分工,以及 trace_id 怎么串起整条调用链"),
            dict(name="系统设计表达",
                 desc="能在白板上把一个高并发系统从需求推导到架构,并说清每个组件的必要性"),
        ],
    ),
]

INTRO = (
    "你已经会写两个互相通信的进程了。这条路的另一头是一套能扛住高并发的分布式系统。"
    "它们之间不是两门学问,而是同一个问题被反复追问了十四次:"
    "**这一层解决不了的事,下一层用什么办法解决,又付出了什么代价。** "
    "每一关都从一个具体的业务场景开始 —— 因为所有的架构组件,都是某个具体痛点逼出来的。"
)


def main():
    data = {"intro": INTRO, "acts": ACTS, "levels": LEVELS}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("manifest.json  %d 关 / %d 幕" % (len(LEVELS), len(ACTS)))


if __name__ == "__main__":
    main()
