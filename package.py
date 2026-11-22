#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《横扫六国》小红书 Builder Hub 离线合规检查 + 一键打包
只用 Python 标准库（不依赖 PIL）。
输出：../qixiong-survivors-xhs.zip（ZIP 根目录直接是 index.html）
"""
import os
import re
import struct
import sys
import zipfile

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.dirname(PROJECT_DIR)
ZIP_PATH = os.path.join(OUTPUT_DIR, "qixiong-survivors-xhs.zip")
PACK = ["index.html", "style.css", "core.js", "app.js", "assets.js", "ui.js", "icon.png"]
TEXT = ["index.html", "style.css", "core.js", "app.js", "assets.js", "ui.js"]
MAX_ZIP = 2 * 1024 * 1024

# 2026-11-20 图片资源层：图片以 base64 写进 assets_data.js（推荐，file:// 下战报 toDataURL 不受画布污染影响）
# img/ 目录只是流水线中间产物，默认不打包；确需打包目录图片时加参数 --with-img（ZIP 里会出现 img/ 子目录）
DATA_JS = "assets_data.js"
IMG_DIR = "img"
WITH_IMG = "--with-img" in sys.argv
IMG_BUDGET = int(1.2 * 1024 * 1024)
# 2026-11-21 背景音乐：Flow Music 生成的循环曲以 base64 写进 audio_data.js（tools/build_audio_data.py 生成）
AUDIO_JS = "audio_data.js"
AUDIO_BUDGET = int(800 * 1024)
AUDIO_LINE = re.compile(r'^  "([A-Za-z0-9_]+)": \{ "loop": ([0-9.]+), "src": "data:audio/mpeg;base64,([A-Za-z0-9+/]*={0,2})" \},?$')
DATA_LINE = re.compile(r'^  "([A-Za-z0-9_]+)": "data:image/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})",?$')

# Chrome 61 不支持 / 小红书禁止的写法
JS_RULES = [
    (r"\?\.(?!\d)", "可选链 ?."),
    (r"\?\?", "空值合并 ??"),
    (r"\bfetch\s*\(", "fetch() 网络请求"),
    (r"XMLHttpRequest", "XMLHttpRequest 网络请求"),
    (r"\bWebSocket\b", "WebSocket"),
    (r"sendBeacon", "sendBeacon"),
    (r"\bimport\s*\(", "动态 import()"),
    (r"catch\s*\{", "可选 catch 绑定（Chrome 66+）"),
    (r"\.flat\s*\(|\.flatMap\s*\(", "Array.flat/flatMap（Chrome 69+）"),
    (r"\bglobalThis\b", "globalThis（Chrome 71+）"),
    (r"\.roundRect\s*\(", "CanvasRenderingContext2D.roundRect（新 API）"),
    (r"\.replaceAll\s*\(", "String.replaceAll（Chrome 85+）"),
]


def strip_comments(js):
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    return re.sub(r"(^|[^:'\"])//[^\n]*", r"\1", js)


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def img_files():
    d = os.path.join(PROJECT_DIR, IMG_DIR)
    if not WITH_IMG or not os.path.isdir(d):
        return []
    return sorted(IMG_DIR + "/" + f for f in os.listdir(d) if f.lower().endswith((".png", ".jpg")))


def pack_list():
    names = list(PACK)
    if os.path.exists(os.path.join(PROJECT_DIR, DATA_JS)):
        names.append(DATA_JS)
    if os.path.exists(os.path.join(PROJECT_DIR, AUDIO_JS)):
        names.append(AUDIO_JS)
    return names + img_files()


def check_data_js(errors):
    """assets_data.js 只允许“键: data:image base64”逐行结构，逐张解码校验文件头，返回图片原始字节数。"""
    import base64
    p = os.path.join(PROJECT_DIR, DATA_JS)
    if not os.path.exists(p):
        print("   - %s: 无（未接入 AI 美术，游戏全部用代码小人）" % DATA_JS)
        return 0
    lines = open(p, encoding="utf-8").read().split("\n")
    total, count = 0, 0
    for i, ln in enumerate(lines, 1):
        if i <= 3 or ln.strip() in ("", "};", "})(window);"):
            continue
        m = DATA_LINE.match(ln)
        if not m:
            errors.append("%s 第 %d 行格式不对（只允许 \"键\": \"data:image/png|jpeg;base64,...\"）" % (DATA_JS, i))
            continue
        raw = base64.b64decode(m.group(3))
        ok = raw[:8] == b"\x89PNG\r\n\x1a\n" if m.group(2) == "png" else raw[:2] == b"\xff\xd8"
        if not ok:
            errors.append("%s 键 %s 解码后不是合法 %s" % (DATA_JS, m.group(1), m.group(2)))
        total += len(raw)
        count += 1
    head = "\n".join(lines[:3])
    if "w.QixiongAssetsData = {" not in head:
        errors.append("%s 文件头不对，应由 tools/build_data.js 生成" % DATA_JS)
    print("   - %s: %d 张图，解码后 %.1f KB" % (DATA_JS, count, total / 1024))
    return total


def check_images(errors):
    total = check_data_js(errors)
    for rel in img_files():
        total += os.path.getsize(os.path.join(PROJECT_DIR, rel))
    if img_files():
        print("   - img/ 目录（--with-img）: %d 个文件" % len(img_files()))
    print("   - 游戏图片合计 %.1f KB / 预算 %.1f KB（不含 icon.png）" % (total / 1024, IMG_BUDGET / 1024))
    if total > IMG_BUDGET:
        errors.append("游戏图片总量 %.1f KB 超出预算 %.1f KB" % (total / 1024, IMG_BUDGET / 1024))


def check_audio_js(errors):
    """audio_data.js 只允许“键: { loop, data:audio/mpeg base64 }”逐行结构，逐首解码校验 mp3 文件头与预算。"""
    import base64
    p = os.path.join(PROJECT_DIR, AUDIO_JS)
    if not os.path.exists(p):
        print("   - %s: 无（不放背景音乐）" % AUDIO_JS)
        return
    lines = open(p, encoding="utf-8").read().split("\n")
    total, names = 0, []
    for i, ln in enumerate(lines, 1):
        if i <= 3 or ln.strip() in ("", "};", "})(window);"):
            continue
        m = AUDIO_LINE.match(ln)
        if not m:
            errors.append("%s 第 %d 行格式不对" % (AUDIO_JS, i))
            continue
        raw = base64.b64decode(m.group(3))
        if not (raw[:3] == b"ID3" or (raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0)):
            errors.append("%s 键 %s 解码后不是 mp3" % (AUDIO_JS, m.group(1)))
        total += len(raw)
        names.append("%s(%.1fs)" % (m.group(1), float(m.group(2))))
    if "w.QixiongAudioData = {" not in "\n".join(lines[:3]):
        errors.append("%s 文件头不对，应由 tools/build_audio_data.py 生成" % AUDIO_JS)
    print("   - %s: %s，mp3 合计 %.1f KB / 预算 %.1f KB" % (AUDIO_JS, " ".join(names), total / 1024, AUDIO_BUDGET / 1024))
    if total > AUDIO_BUDGET:
        errors.append("背景音乐 %.1f KB 超出预算 %.1f KB" % (total / 1024, AUDIO_BUDGET / 1024))


def check_script_order(html, errors):
    srcs = re.findall(r'<script[^>]*src="([^"]+)"', html, re.I)
    if "assets.js" not in srcs:
        print("   ⚠️ index.html 还没引用 assets.js（待总指挥接入；未接入前游戏照常用代码小人）")
        return
    order = [s for s in [DATA_JS, "assets.js", "ui.js", "core.js", "app.js"] if s in srcs]
    if [s for s in srcs if s in order] != order:
        errors.append("index.html 脚本顺序应为 assets_data.js → assets.js → ui.js → core.js → app.js，实际 %s" % srcs)


def validate():
    print("🔍 [1/3] 合规检查 ...")
    errors = []
    for name in PACK:
        p = os.path.join(PROJECT_DIR, name)
        if not os.path.exists(p):
            errors.append("缺少文件 " + name)
        else:
            print("   - %s: %.1f KB" % (name, os.path.getsize(p) / 1024))
    if errors:
        return errors

    html = open(os.path.join(PROJECT_DIR, "index.html"), encoding="utf-8").read()
    inline = [s for s in re.findall(r"<script(?![^>]*src=)[^>]*>(.*?)</script>", html, re.S | re.I) if s.strip()]
    if inline:
        errors.append("index.html 含内联脚本")
    if re.search(r"\son[a-z]+\s*=", html, re.I):
        errors.append("index.html 含内联事件属性（onclick= 等）")
    if 'name="viewport"' not in html:
        errors.append("index.html 缺少 viewport")
    for src in re.findall(r'(?:src|href)="([^"]+)"', html):
        if not os.path.exists(os.path.join(PROJECT_DIR, src)):
            errors.append("index.html 引用的本地文件不存在: " + src)
        elif src not in pack_list():
            errors.append("index.html 引用的文件没有进打包清单: " + src)

    check_script_order(html, errors)
    check_images(errors)
    check_audio_js(errors)

    for name in TEXT:
        content = open(os.path.join(PROJECT_DIR, name), encoding="utf-8").read()
        urls = re.findall(r"(?:https?:)?//[a-z0-9.-]+\.[a-z]{2,}[^\s\"')]*", content, re.I)
        if urls:
            errors.append("%s 含外链: %s" % (name, urls[:3]))
        if name.endswith(".js"):
            code = strip_comments(content)
            for pat, label in JS_RULES:
                m = re.search(pat, code)
                if m:
                    line = code[: m.start()].count("\n") + 1
                    errors.append("%s 第 %d 行附近检测到 %s" % (name, line, label))
        if name.endswith(".css") and re.search(r"@import|url\(\s*['\"]?https?:", content):
            errors.append("style.css 含外部资源引用")

    app = open(os.path.join(PROJECT_DIR, "app.js"), encoding="utf-8").read()
    if "window.xhs" not in app or "saveImageToPhotosAlbum" not in app:
        errors.append("app.js 未接入 window.xhs.miniTool.saveImageToPhotosAlbum")

    size = png_size(os.path.join(PROJECT_DIR, "icon.png"))
    if size != (512, 512):
        errors.append("icon.png 尺寸应为 512×512，实际 %s" % (size,))

    if not errors:
        print("   ✅ 无内联脚本 / 无外链 / 无 ?. ?? / 无 fetch、XHR、WebSocket / Chrome 61 语法基线 / icon 512×512 / 图片预算")
    return errors


def build():
    print("\n📦 [2/3] 打包 -> " + ZIP_PATH)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in pack_list():
            zf.write(os.path.join(PROJECT_DIR, name), arcname=name)
            print("   + " + name)
    print("\n🧪 [3/3] 校验 ZIP 结构与大小")
    with zipfile.ZipFile(ZIP_PATH) as zf:
        names = zf.namelist()
        bad = zf.testzip()
    size = os.path.getsize(ZIP_PATH)
    errs = []
    if "index.html" not in names:
        errs.append("ZIP 根目录缺少 index.html")
    if any("/" in n and not (WITH_IMG and n.startswith(IMG_DIR + "/")) for n in names):
        errs.append("ZIP 内存在子目录: %s" % names)
    if set(names) != set(pack_list()):
        errs.append("ZIP 文件清单不符: %s" % names)
    if bad:
        errs.append("ZIP 损坏文件: " + bad)
    if size >= MAX_ZIP:
        errs.append("ZIP 超过 2MB: %d 字节" % size)
    print("   - 文件: %s" % names)
    print("   - 大小: %.1f KB（上限 2048 KB）" % (size / 1024))
    return errs


if __name__ == "__main__":
    e = validate()
    if e:
        print("\n❌ 合规检查未通过：")
        for x in e:
            print("   - " + x)
        sys.exit(1)
    e = build()
    if e:
        print("\n❌ ZIP 校验未通过：")
        for x in e:
            print("   - " + x)
        sys.exit(1)
    print("\n✅ 合规检查与打包全部通过（仅生成本地 ZIP，未上传、未提审）")
