# 通信网 → 现代后端：一条路走到底

一个**本地闯关式学习站**，把你从「两台主机互相通信」一路带到「一套能扛高并发的现代后端」。

不是看文档 —— 是**一步步打怪升级**：每一关先给你一个真实业务场景（为什么需要这东西），
讲底层原理，给 C++/Python/Go 三语言对照，然后**在你自己机器上真跑一个实验**看现象，
最后过一个关底测试才解锁下一关。左边有一张**系统架构图，你每通一关它就长出一块** ——
那就是「整个系统认知」的具体形状。

## 跑起来

```bash
# 1. 编译底层实验用的 C 程序(第一幕用)
make

# 2. 启动依赖的中间件容器(第三、四幕的实验用到真 Redis / PostgreSQL)
#    没有 docker 也能学 —— 每个实验都附了预期输出
./containers.sh up

# 3. 启动学习站
python3 serve.py

# 4. 浏览器打开
#    http://127.0.0.1:8080
```

只用 Python 标准库，没有任何第三方依赖。服务器只绑 `127.0.0.1`，外部访问不到。

### 启动网站服务:细节

**启动**

```bash
python3 serve.py                 # 默认端口 8080 -> http://127.0.0.1:8080
python3 serve.py --port 9000     # 换端口(8080 被占用时)-> http://127.0.0.1:9000
```

启动后终端会打印实际地址和已加载的实验数。它在**前台**运行,占着这个终端窗口。

`make serve` 是个快捷方式:先 `make` 编译 C 程序,再 `python3 serve.py`,一步到位
(但不会帮你起中间件容器,那个仍要单独 `./containers.sh up`)。

**想让它在后台一直跑**:

```bash
nohup python3 serve.py > /tmp/study.log 2>&1 &   # 后台启动,日志写到 /tmp/study.log
cat /tmp/study.log                                # 确认起来了:能看到启动横幅和地址
```

**停止**

- 前台运行:在那个终端按 `Ctrl-C`。
- 后台运行:`pkill -f serve.py`。

**只有第一幕能学、后面点了没反应?**
第一、二幕纯 Python 标准库,`make` + `python3 serve.py` 就够。
第三、四幕的实验要连真的 Redis / PostgreSQL,得先 `./containers.sh up`
(`./containers.sh status` 看容器状态,`./containers.sh down` 关掉)。
没有 docker 也不影响学 —— 那些实验点「看预期输出」就能读到真实机器上跑出来的结果。

**打开后一直卡在「正在加载关卡」?**
多半是 `serve.py` 没起来,或浏览器缓存了旧文件。确认终端里 `serve.py` 在跑,
然后 `Ctrl-Shift-R` 强制刷新。

**进度存在哪?**
项目根目录的 `.progress.json`。想从头再来:页面左下角「重置进度」,
或直接删掉这个文件。

## 十四关地图

| 幕 | 关卡 | 你会亲手验证的东西 |
|---|---|---|
| **I 字节怎么过去的** | L01 一根线上的两个进程 | 四元组、分层封装、字节序 |
| | L02 TCP 凭什么叫「可靠」 | 握手时序、TIME_WAIT vs CLOSE_WAIT |
| | L03 消息的边界要你自己划 | 粘包、长度前缀/分隔符分帧 |
| | L04 一个进程一万个连接 | backlog 堆积、epoll、C10K |
| **II 变成业务系统** | L05 HTTP 就是一段有格式的字节 | 手打 HTTP、Content-Length |
| | L06 一个请求的完整旅程 | 全链路耗时、CORS 预检、幂等 |
| | L07 单机的天花板在哪 | 压测 P99、CPU vs IO 密集 |
| **III 撑住量** | L08 加机器：负载均衡 | 真 nginx 分流 + 故障转移 |
| | L09 无状态化 | 复现随机掉登录，用 Redis 修 |
| | L10 缓存 | 真 Redis：穿透/击穿/雪崩 |
| | L11 数据库 | 真 PostgreSQL：EXPLAIN 索引 |
| **IV 分布式的代价** | L12 异步：消息队列 | 复现重复消费，用幂等修 |
| | L13 分布式的代价 | 真 Redis 分布式锁防超卖 |
| | L14 生产就绪 | 限流熔断降级 + 秒杀系统全景 |

## 目录结构

```
serve.py            本地服务器(静态文件 + 内容 API + 实验执行器)
containers.sh       中间件容器管理(redis/pg,独立端口不碰别的项目)
site/               前端(原生 JS,无构建)
  index.html
  css/app.css
  js/{md,store,diagrams,app}.js
content/            关卡内容(由 build/ 生成,别手改)
  manifest.json
  levels/L01.json ... L14.json
build/              内容生成器(改内容改这里,然后 make content)
  gen_manifest.py, blocks.py, act1.py, act2.py, l08.py ... l14.py
labs/               实验脚本(点「真跑一遍」时服务器执行这些)
  _common.sh, _bench.py, l01_*.sh ... l13_*.sh
c/  py/  bin/       第一幕用的底层 socket 程序(C 和 Python 对照)
README-sockets.md   最初的 socket 教程(第一幕的底子)
实验手册.md          最初的 7 个 socket 实验
```

## 改内容

内容不是手写 JSON，而是由 `build/` 下的 Python 生成 —— 因为需要注释解释
「为什么这一关放在这个位置」。改完重新生成：

```bash
make content        # 等价于 python3 build/gen_manifest.py && 各 act/lN.py
```

## 实验是真跑的

点关卡里的「▶ 在本机真跑一遍」，服务器会执行 `labs/` 下对应的脚本，
把**你这台机器的真实输出**回传到页面，和预期对比。安全边界：浏览器只能传一个
**脚本名**，服务器去 `labs/` 里找同名 `.sh` —— 能跑什么完全由那个目录决定，
传路径或 `..` 直接拒绝。

没装 docker 的实验会标出来，点「看预期输出」读参考结果即可（那些数字是在真实机器上跑出来的）。

## 设计说明

- **进度存档**：`.progress.json`（服务端）+ localStorage（浏览器），双写。
- **解锁**：关底测试全对才通关、才解锁下一关。
- **XP / 段位**：纯粹为了「打怪升级」的手感，不影响内容。
- **架构图**：`site/js/diagrams.js` 里 `architecture()`，节点标了「第几关解锁」，
  随进度点亮。这是全站的主线视觉。
