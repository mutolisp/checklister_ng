#!/usr/bin/env python3
"""從 icons/mobile/checklister_mobile-logo.png 產生 mobile app 所需的 icon 檔案。

Reads:
    icons/mobile/checklister_mobile-logo.png  (1024x1024 RGBA, 內含 padding)

Writes (mobile/app/assets/images/):
    icon.png                        iOS app icon (1024x1024, 白底)
    android-icon-foreground.png     Android adaptive foreground (1024x1024, 透明)
    android-icon-background.png     Android adaptive background (1024x1024, 純色)
    android-icon-monochrome.png     Material You themed icon (1024x1024, 白色剪影)
    splash-icon.png                 Splash screen 圖示 (1024x1024, 透明)
    favicon.png                     Web favicon (48x48)

Usage:
    cd mobile/app && make icons
    或：python icons/gen_mobile_icons.py
"""
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("No Pillow installed: backend/venv/bin/pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "mobile" / "checklister_mobile-logo.png"
DST = ROOT / "mobile" / "app" / "assets" / "images"

# 必須與 mobile/app/app.config.ts 的 android.adaptiveIcon.backgroundColor 一致
ADAPTIVE_BG_HEX = "#F5EBD9"

# Android adaptive icon safe-area: content must fit within central 66% of canvas
# (Material spec: 108dp canvas, 72dp visible viewport = 0.667). 設稍小留 breathing room。
ANDROID_FG_SAFE_SCALE = 0.62


def hex_to_rgba(h: str) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def open_source() -> Image.Image:
    if not SRC.exists():
        sys.exit(f"Soure file not found: {SRC}")
    img = Image.open(SRC).convert("RGBA")
    if img.size != (1024, 1024):
        print(f"  注意：來源尺寸 {img.size}，自動縮放至 (1024, 1024)")
        img = img.resize((1024, 1024), Image.LANCZOS)
    return img


def save_png(img: Image.Image, path: Path, *, flatten_white: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if flatten_white:
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        bg.convert("RGB").save(path, "PNG", optimize=True)
    else:
        img.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}")


def make_monochrome(src: Image.Image) -> Image.Image:
    """所有非透明像素轉成白色，alpha 保留，給 Material You themed icon 用。"""
    _, _, _, a = src.split()
    white = Image.new("L", src.size, 255)
    return Image.merge("RGBA", (white, white, white, a))


def fit_safe_area(src: Image.Image, safe_scale: float = ANDROID_FG_SAFE_SCALE) -> Image.Image:
    """抓 content bounding box、縮放到 canvas 中央 safe_scale 範圍內、置中。

    給 Android adaptive foreground 用，避免 launcher 圓形 mask 把內容裁掉。
    Source PNG 內含 padding 不影響結果（用 bbox 抓實際 content）。
    """
    bbox = src.getbbox()
    if bbox is None:
        return src.copy()
    content = src.crop(bbox)
    canvas_size = src.size[0]
    target = int(canvas_size * safe_scale)
    scale = min(target / content.size[0], target / content.size[1])
    new_w = max(1, int(content.size[0] * scale))
    new_h = max(1, int(content.size[1] * scale))
    scaled = content.resize((new_w, new_h), Image.LANCZOS)
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    out.alpha_composite(scaled, ((canvas_size - new_w) // 2, (canvas_size - new_h) // 2))
    return out


def main() -> None:
    src = open_source()
    print(f"Source: {SRC.relative_to(ROOT)}")
    print(f"Output: {DST.relative_to(ROOT)}/")
    print()

    android_fg = fit_safe_area(src)

    save_png(src, DST / "icon.png", flatten_white=True)
    save_png(android_fg, DST / "android-icon-foreground.png")
    save_png(
        Image.new("RGBA", src.size, hex_to_rgba(ADAPTIVE_BG_HEX)),
        DST / "android-icon-background.png",
    )
    save_png(make_monochrome(android_fg), DST / "android-icon-monochrome.png")
    save_png(src, DST / "splash-icon.png")
    save_png(src.resize((48, 48), Image.LANCZOS), DST / "favicon.png")

    print("\nDone。")


if __name__ == "__main__":
    main()
