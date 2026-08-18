CC      ?= gcc
CFLAGS  ?= -Wall -Wextra -O0 -g -std=c11 -D_GNU_SOURCE

SRCDIR   = c
BINDIR   = bin
PROGS    = tcp_server tcp_client udp_server udp_client http_server
TARGETS  = $(addprefix $(BINDIR)/,$(PROGS))

all: $(TARGETS)
	@echo ""
	@echo "编译完成,可执行文件在 $(BINDIR)/"
	@echo "  终端1: ./$(BINDIR)/tcp_server 8888"
	@echo "  终端2: ./$(BINDIR)/tcp_client 127.0.0.1 8888"
	@echo ""
	@echo "  终端1: ./$(BINDIR)/udp_server 9999"
	@echo "  终端2: ./$(BINDIR)/udp_client 127.0.0.1 9999"
	@echo ""
	@echo "动手实验见 实验手册.md"

$(BINDIR)/%: $(SRCDIR)/%.c | $(BINDIR)
	$(CC) $(CFLAGS) -o $@ $<

$(BINDIR):
	mkdir -p $(BINDIR)

# 检查 Python 版本语法是否正确(不运行)
pycheck:
	python3 -m py_compile py/*.py && echo "Python 四个文件语法 OK"

clean:
	rm -rf $(BINDIR) py/__pycache__

.PHONY: all clean pycheck

# ---- 学习站内容生成 ----
# 内容源在 build/ 下,改完跑 make content 重新生成 content/*.json
content:
	@python3 build/gen_manifest.py
	@python3 build/act1.py
	@python3 build/act2.py
	@for n in 08 09 10 11 12 13 14; do python3 build/l$$n.py; done
	@echo "内容已生成到 content/"

# 启动学习站
serve: all
	@python3 serve.py

.PHONY: content serve
