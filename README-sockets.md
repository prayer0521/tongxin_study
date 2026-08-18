# 手写 Socket:TCP / UDP 的服务器与客户端

用 C 和 Python 各写一遍 TCP 服务器、TCP 客户端、UDP 服务器、UDP 客户端,
目的是彻底搞清楚 `bind` / `listen` / `accept` / `connect` / `send` / `recv`
这六个调用【各自到底干了什么】。

```
.
├── c/                  C 版本,看清每一个系统调用
│   ├── tcp_server.c
│   ├── tcp_client.c
│   ├── udp_server.c
│   └── udp_client.c
├── py/                 Python 版本,看清 C 里哪些是本质、哪些是历史包袱
│   ├── tcp_server.py
│   ├── tcp_client.py
│   ├── udp_server.py
│   └── udp_client.py
├── Makefile
├── README.md           <- 你在这
└── 实验手册.md          7 个动手实验,把概念踩实
```

## 跑起来

```bash
make            # 编译 C 版本到 bin/
make pycheck    # 检查 Python 语法
```

**TCP**(开两个终端):

```bash
./bin/tcp_server 8888                  # 终端1
./bin/tcp_client 127.0.0.1 8888        # 终端2,输入什么回显什么
```

**UDP**:

```bash
./bin/udp_server 9999                  # 终端1
./bin/udp_client 127.0.0.1 9999        # 终端2
```

Python 版本用法完全一样,把 `./bin/tcp_server` 换成 `python3 py/tcp_server.py`。

**两种语言可以混着连** —— C 客户端连 Python 服务器完全正常。
因为跑在网线上的是 TCP/IP 协议,和你用什么语言写没有半点关系。
这件事本身就值得亲手验证一次。

---

## 一、六个调用,一句话各是什么

| 调用 | 谁用 | 一句话 | 不调用会怎样 |
|---|---|---|---|
| `socket()` | 都用 | 要一个通信端点,得到 fd。此时它没有地址 | 什么都干不了 |
| `bind()` | **服务器必须**<br>客户端可选 | 给 fd 贴上"我在哪"的地址标签 | 客户端:内核自动分配临时端口<br>服务器:端口随机,客户端找不到你 |
| `listen()` | 仅 TCP 服务器 | 把 fd 从"主动"改成"被动",并创建连接队列 | `accept` 报 EINVAL,连不上 |
| `accept()` | 仅 TCP 服务器 | 从**已完成握手**的队列里取一个连接,返回**新 fd** | 客户端照样能连上,但堆在队列里没人服务 |
| `connect()` | TCP 客户端必须<br>UDP 可选 | TCP:触发三次握手<br>UDP:只记个默认对端,**不发包** | TCP:不能 send<br>UDP:照样能 sendto |
| `send/recv` | TCP | 在**连接**上收发字节流 | — |
| `sendto/recvfrom` | UDP | 每个包**自带**对方地址 | — |

## 二、最容易搞错的五件事

**1. `accept()` 返回的是新 fd,监听 fd 不用来传数据。**

实测输出:

```
[1] socket()  -> 监听fd = 3
[4] accept()  -> 新fd = 4   (监听fd 3 依然在监听)
    这条连接的四元组: 127.0.0.1:18888 <--> 127.0.0.1:52890
```

fd 3 只负责"生小孩",数据都走 fd 4。一个监听 fd 能生出几万个连接 fd,
靠**四元组**(源IP、源端口、目的IP、目的端口)区分,所以同一个 8888
端口挂几万条连接不会冲突。

**2. 三次握手是内核干的,不是 `accept()` 干的。**

`listen()` 一返回,内核就开始替你握手了。`accept()` 只是从"已经握完手
的一堆连接"里拿一个出来。所以**你的程序卡住不 accept,客户端的
`connect()` 照样成功返回** —— 见实验三,这个反直觉的点必须亲手验一次。

**3. `recv()` 返回 0 在 TCP 和 UDP 里含义完全不同。**

- TCP:`recv() == 0` = 对端 `close()` 了(收到 FIN)。这是**唯一**的正常结束标志。
- UDP:`recvfrom() == 0` = 真的收到一个**长度为 0 的空包**,完全合法。
  UDP 没有连接,也就没有"关闭"。**UDP 循环里绝不能写 `if (n == 0) break;`**

**4. TCP 没有消息边界(粘包)。**

实测:客户端 `send()` 五次,服务器 `recv()` **一次**就全收到了:

```
客户端: send "PKT-00" / "PKT-01" / "PKT-02" / "PKT-03" / "PKT-04"   (5 次,各 6 字节)
服务器: recv() = 30 字节: "PKT-00PKT-01PKT-02PKT-03PKT-04"          (1 次)
```

TCP 是**字节流**,它只保证"字节顺序不乱、不丢",从不保证"你发几次我收
几次"。消息边界得你自己在应用层定(加长度头,或用 `\n` 分隔)。
反过来发 10KB 也可能要 `recv` 好几次才收全(拆包)。

**5. `send()` 不保证一次发完。**

内核发送缓冲区满了,`send(fd, buf, 1000)` 可能只发 100 并返回 100。
所以 C 里凡是 `send` 都必须写成循环(见 `send_all()`)。
Python 的 `sendall()` 就是帮你做了这个循环 —— 日常一律用 `sendall`,
别用 `send`。

## 三、TCP vs UDP:调用序列对照

```
        TCP 服务器              TCP 客户端            UDP 服务器           UDP 客户端
        ──────────              ──────────            ──────────           ──────────
        socket()                socket()              socket()             socket()
        bind()                     │                  bind()                  │
        listen()                   │                     │                    │
           │                       │                     │                    │
        accept() ◄──握手──── connect()                   │                    │
           │  ↑返回新fd            │                     │                    │
           │                       │                     │                    │
        recv()   ◄───────────── send()               recvfrom() ◄────────  sendto()
        send()   ─────────────► recv()               sendto()   ────────►  recvfrom()
           │                       │                     │                    │
        close(新fd)             close()               (不用close)          close()
        close(监听fd)                                 
```

差异归纳:

| | TCP | UDP |
|---|---|---|
| `socket()` 第二参数 | `SOCK_STREAM` | `SOCK_DGRAM` |
| `listen` / `accept` | 必须 | **没有**(对 UDP 调用返回 EOPNOTSUPP) |
| 服务器怎么知道回给谁 | `accept` 给的 conn 自带对端 | 必须从 `recvfrom` 的输出参数里拿 |
| 消息边界 | **没有**(会粘包) | **有**(一发一收,不粘) |
| 可靠性 | 保证不丢不乱序 | 会丢、会乱序、会重复 |
| 缓冲区太小 | 剩下的下次 `recv` 再拿 | 超出部分**静默丢弃** |
| 对端挂了 | `recv` 返回 0 或报错 | **永远卡住**(必须自己设超时) |
| `close()` | 发 FIN,四次挥手,进 TIME_WAIT | 只释放 fd,**不发任何包** |
| 每客户端一个 fd | 是 | 否,全程一个 fd |

## 四、C 和 Python 的对照表

Python 的 `socket` 模块是 C API 的**薄封装**,六个调用一个不少。
被封装掉的只是 C 的历史包袱:

| C | Python | 说明 |
|---|---|---|
| `struct sockaddr_in` + `memset` + 三次赋值 | `('0.0.0.0', 8888)` | 一个元组搞定 |
| `htons()` / `htonl()` | **隐式** | 字节序转换照样发生,只是你看不见 |
| `(struct sockaddr *)` 强制转换 | 没有 | 90 年代没泛型留下的写法 |
| `socklen_t *addrlen` 值-结果参数 | 没有 | 改成元组返回 |
| `char buf[1024]` 预分配 | `recv(1024)` 返回 `bytes` | |
| 返回值 `< 0` + 查 `errno` | `raise OSError` 子类 | `ECONNREFUSED` → `ConnectionRefusedError` |
| 手写 `send_all()` 循环 | `sendall()` | |
| `n == 0` 判断对端关闭 | `data == b''` | 语义完全相同 |
| `close()` | `with` 语句 | 异常时也保证关闭 |
| `setsockopt(..., &on, sizeof(on))` | `setsockopt(..., 1)` | |
| `SO_RCVTIMEO` + `struct timeval` | `settimeout(2.0)` | |

**没有**被封装掉的(说明这些是协议本质,换语言也躲不掉):

- 六个调用的顺序和职责
- `accept` 返回新 socket
- TCP 粘包
- UDP 会丢包、要自己设超时
- 网络上传的是字节(Python 3 逼你显式 `encode`/`decode`,其实是好事)

---

## 五、下一步

这四个程序都是**单线程串行**的:TCP 服务器必须等当前客户端断开才能服务
下一个。这是**故意**的 —— 只有这样你才能在实验三里亲眼看到连接堆在
backlog 队列里。

真实服务器的并发方案,按历史顺序:

1. **`fork()` 每连接一进程** —— 最简单,开销最大
2. **线程每连接** —— 轻一些,但上万连接就崩了(C10K 问题)
3. **`select` / `poll`** —— 单线程管多个 fd,但每次都要遍历全部 fd
4. **`epoll`**(Linux)—— 只返回就绪的 fd,现代高性能服务器的基础
   (nginx、redis、Node.js 底层都是它)

理解了本仓库的六个调用之后,`epoll` 就只是"帮你同时盯着很多个 fd,
告诉你哪个可以 `accept`/`recv` 了"而已 —— 收发的语义一点没变。

**现在去做 [实验手册.md](实验手册.md) 里的 7 个实验**,把上面这些
文字变成你亲眼见过的现象。
