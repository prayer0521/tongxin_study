#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容块构造助手。

关卡 JSON 的结构由前端 app.js 的 renderBlocks 决定。这里只是把
{"t": "note", "kind": "trap", ...} 这种字典写得像人话一点。
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELDIR = os.path.join(ROOT, "content", "levels")


# ---------------------------------------------------------------- 块

def h(text):
    """章节标题"""
    return {"t": "h", "text": text}


def p(text):
    """段落。支持 **粗体** `代码` [链接](url)"""
    return {"t": "p", "text": text}


def hook(text, tag="场景"):
    """场景钩子。每关开头用,回答"为什么需要这个东西"。"""
    return {"t": "hook", "tag": tag, "text": text}


def note(body, kind="info", title=None):
    """kind: key(关键认知) trap(坑) warn(注意) biz(工作里长什么样) info"""
    d = {"t": "note", "kind": kind, "body": body}
    if title:
        d["title"] = title
    return d


def key(body, title=None):
    return note(body, "key", title)


def trap(body, title=None):
    return note(body, "trap", title)


def warn(body, title=None):
    return note(body, "warn", title)


def biz(body, title=None):
    return note(body, "biz", title)


def code(src, lang="text", file=None, label=None):
    d = {"t": "code", "code": src.strip("\n"), "lang": lang}
    if file:
        d["file"] = file
    if label:
        d["label"] = label
    return d


def term(src, label=None, file=None):
    """终端输出块 —— 不做语法高亮"""
    d = {"t": "code", "code": src.strip("\n"), "kind": "term"}
    if label:
        d["label"] = label
    if file:
        d["file"] = file
    return d


def poly(title=None, note_=None, **variants):
    """多语言对照。用法:
         poly(title="...", cpp=(src, "file.cpp", "注释"), py=(...), go=(...))
       每个语言的值是 (代码, 文件名, 说明) 或 (代码, 文件名) 或 代码
    """
    out = {}
    for k, v in variants.items():
        if isinstance(v, tuple):
            src = v[0]
            fname = v[1] if len(v) > 1 else ""
            nt = v[2] if len(v) > 2 else ""
        else:
            src, fname, nt = v, "", ""
        out[k] = {"code": src.strip("\n"), "file": fname, "note": nt}
    d = {"t": "poly", "variants": out}
    if title:
        d["title"] = title
    return d


def fig(kind, cap=None):
    """可交互图示。kind 必须是 diagrams.js 里导出的函数名。"""
    d = {"t": "fig", "fig": kind}
    if cap:
        d["cap"] = cap
    return d


def lab(id, title, intro, script=None, cmd=None, ask=None,
        expect=None, explain=None, xp=20, needs=None):
    """实验卡。
       script: labs/<script>.sh,点按钮真跑
       ask:    先让人猜结果 —— 猜错了的印象最深
       expect: 参考输出,没装工具的人也能读
    """
    d = {"t": "lab", "id": id, "title": title, "intro": intro, "xp": xp}
    if script:
        d["script"] = script
    if cmd:
        d["cmd"] = cmd.strip("\n")
    if ask:
        d["ask"] = ask
    if expect:
        d["expect"] = expect.strip("\n")
    if explain:
        d["explain"] = explain
    if needs:
        d["needs"] = needs
    return d


def table(head, rows, title=None):
    d = {"t": "table", "head": head, "rows": rows}
    if title:
        d["title"] = title
    return d


def hr():
    return {"t": "hr"}


def q(question, opts, a, why):
    """关底测试题。a 是正确选项的下标(从 0 开始)。
       why 是解释 —— 这部分比题目本身重要。
    """
    return {"q": question, "opts": opts, "a": a, "why": why}


# ---------------------------------------------------------------- 输出

def write(level_id, title, subtitle, blocks, boss,
          boss_title=None, unlocks=None):
    data = {
        "id": level_id,
        "title": title,
        "subtitle": subtitle,
        "blocks": blocks,
        "boss": boss,
    }
    if boss_title:
        data["bossTitle"] = boss_title
    if unlocks:
        data["unlocks"] = unlocks

    os.makedirs(LEVELDIR, exist_ok=True)
    path = os.path.join(LEVELDIR, level_id + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    n_lab = sum(1 for b in blocks if b.get("t") == "lab")
    n_poly = sum(1 for b in blocks if b.get("t") == "poly")
    n_fig = sum(1 for b in blocks if b.get("t") == "fig")
    print("  %s  %-28s %2d 块 / %d 实验 / %d 对照 / %d 图 / %d 题"
          % (level_id, title, len(blocks), n_lab, n_poly, n_fig, len(boss)))
