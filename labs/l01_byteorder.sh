#!/usr/bin/env bash
# L01 实验:字节序 —— htons 到底动了什么
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "编译一个只做字节序演示的小程序…"
echo

cat > /tmp/l01_bo.c <<'EOF'
#include <stdio.h>
#include <arpa/inet.h>
#include <string.h>

static void dump(const char *tag, const void *p, size_t n) {
    const unsigned char *b = p;
    printf("%-26s", tag);
    for (size_t i = 0; i < n; i++) printf("%02x ", b[i]);
    printf("\n");
}

int main(void) {
    uint16_t port = 8888;
    uint16_t net  = htons(port);

    printf("主机端口:                 %u   = 0x%04x\n", port, port);
    dump("内存里的字节(本机序):", &port, 2);
    printf("htons 之后:               0x%04x\n", net);
    dump("内存里的字节(网络序):", &net, 2);
    printf("\n");

    /* 如果忘了 htons:发送方把主机序的字节直接发出去,
       接收方按网络序(大端)解析 —— 结果就是两个字节反过来读 */
    uint16_t misread = (uint16_t)((port >> 8) | (port << 8));
    printf("忘了 htons 的后果:  对方把它读成 %u  <-- 连错端口\n", misread);
    printf("\n");

    /* 判断本机字节序 */
    uint32_t x = 1;
    printf("本机字节序: %s\n",
           (*(char *)&x == 1) ? "小端 (little-endian, x86/ARM 常见)" : "大端 (big-endian)");

    /* 32 位的例子:IP 地址 */
    struct in_addr a;
    inet_pton(AF_INET, "192.168.1.10", &a);
    dump("192.168.1.10 网络序字节:", &a, 4);
    printf("  ^ 正好是 c0 a8 01 0a = 192 168 1 10,按人读的顺序排 —— 大端就是「自然顺序」\n");
    return 0;
}
EOF

gcc -Wall -o /tmp/l01_bo /tmp/l01_bo.c 2>&1 && /tmp/l01_bo
rm -f /tmp/l01_bo /tmp/l01_bo.c

echo
hr
echo "Python 里同一件事(字节序没消失,只是被隐藏了):"
hr
python3 - <<'EOF'
import socket, struct
print("socket.htons(8888)      =", socket.htons(8888), " <- Python 也有 htons")
print("struct.pack('>H', 8888) =", struct.pack('>H', 8888).hex(), " <- '>' 就是大端")
print("struct.pack('<H', 8888) =", struct.pack('<H', 8888).hex(), " <- '<' 小端,反了")
print()
print("你写 s.connect(('127.0.0.1', 8888)) 时,Python 内部就做了 htons。")
print("字节序转换照样发生 —— 只是你看不见。这就是「封装历史包袱」的含义。")
EOF
