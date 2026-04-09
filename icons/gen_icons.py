#!/usr/bin/env python3
"""從 checklister-ng_icons.png / checklister-ng_trayicon.png 產生各平台所需的 icon 檔案。

Usage:
    python icons/gen_icons.py
    make icon
"""
import os
import shutil
import subprocess
import sys

try:
    from PIL import Image
except ImportError:
    print("需要 Pillow: pip install Pillow", file=sys.stderr)
    sys.exit(1)

ICONS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_APP = os.path.join(ICONS_DIR, "checklister-ng_icons.png")
SRC_TRAY = os.path.join(ICONS_DIR, "checklister-ng_trayicon.png")


def gen_ico():
    """產生 Windows .ico（多尺寸）"""
    img = Image.open(SRC_APP)
    out = os.path.join(ICONS_DIR, "checklister-ng.ico")
    img.save(out, format="ICO",
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"  {out}")


def gen_icns():
    """產生 macOS .icns（需要 iconutil，僅 macOS 可用）"""
    if sys.platform != "darwin":
        print("  跳過 .icns（非 macOS）")
        return

    img = Image.open(SRC_APP)
    iconset_dir = os.path.join(ICONS_DIR, "checklister-ng.iconset")
    os.makedirs(iconset_dir, exist_ok=True)

    sizes = [16, 32, 64, 128, 256, 512]
    for s in sizes:
        img.resize((s, s), Image.LANCZOS).save(
            os.path.join(iconset_dir, f"icon_{s}x{s}.png"))
        s2 = s * 2
        if s2 <= 1024:
            img.resize((s2, s2), Image.LANCZOS).save(
                os.path.join(iconset_dir, f"icon_{s}x{s}@2x.png"))

    out = os.path.join(ICONS_DIR, "checklister-ng.icns")
    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", out], check=True)
    shutil.rmtree(iconset_dir)
    print(f"  {out}")


def gen_tray():
    """產生各平台 tray icon 精確尺寸"""
    if not os.path.isfile(SRC_TRAY):
        print(f"  跳過 tray icon（找不到 {SRC_TRAY}）")
        return

    img = Image.open(SRC_TRAY)
    # Windows: 16x16, 32x32（高 DPI）
    # macOS: 22x22, 44x44（@2x）
    tray_sizes = {
        "tray_16.png": 16,
        "tray_22.png": 22,
        "tray_32.png": 32,
        "tray_44.png": 44,
        "tray_64.png": 64,
    }
    for name, size in tray_sizes.items():
        out = os.path.join(ICONS_DIR, name)
        img.resize((size, size), Image.LANCZOS).save(out)
        print(f"  {out}")


def main():
    if not os.path.isfile(SRC_APP):
        print(f"找不到來源圖檔: {SRC_APP}", file=sys.stderr)
        sys.exit(1)

    print("產生 icon 檔案：")
    gen_ico()
    gen_icns()
    gen_tray()
    print("完成。")


if __name__ == "__main__":
    main()
