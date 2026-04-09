import argparse
import os
import sys
import socket
import time
import uvicorn
import threading
import webbrowser


# Windows PyInstaller console=False 時 sys.stdout/stderr 是 None，
# 任何 print/logging 都會崩潰。重導向到 devnull。
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")


def get_base_path():
    """PyInstaller 打包後用 sys._MEIPASS，開發時用專案根目錄"""
    if getattr(sys, '_MEIPASS', None):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def wait_for_server(host, port, timeout=10):
    """等待 server 真正可連線後才回傳"""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def _run_with_tray(host, port, app):
    """啟動 server + system tray icon（Windows/macOS 打包時使用）"""
    from PIL import Image
    import pystray

    base = get_base_path()
    # 載入 tray icon（優先使用預先縮放的精確尺寸）
    if sys.platform == "win32":
        tray_candidates = ["icons/tray_32.png", "icons/tray_16.png"]
    else:
        tray_candidates = ["icons/tray_44.png", "icons/tray_22.png"]
    tray_candidates += ["icons/checklister-ng_trayicon.png", "icons/checklister-ng.ico"]

    icon_path = None
    for name in tray_candidates:
        p = os.path.join(base, name)
        if os.path.isfile(p):
            icon_path = p
            break
    if icon_path:
        image = Image.open(icon_path)
    else:
        image = Image.new("RGB", (64, 64), color=(34, 139, 34))

    url = f"http://{host}:{port}"

    def open_browser(icon, item):
        webbrowser.open(url)

    def quit_app(icon, item):
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("開啟 Checklister-NG", open_browser, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(f"伺服器: {url}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("結束", quit_app),
    )

    icon = pystray.Icon("checklister-ng", image, "Checklister-NG", menu)

    def start_server():
        uvicorn.run(app, host=host, port=port, log_level="warning")

    thread = threading.Thread(target=start_server, daemon=True)
    thread.start()

    if wait_for_server(host, port):
        webbrowser.open(url)

    # pystray.Icon.run() 會 block 主線程（這是必要的）
    icon.run()


def _run_without_tray(host, port, app):
    """開發模式：不使用 system tray，直接啟動 server"""
    def start_server():
        uvicorn.run(app, host=host, port=port, log_level="warning")

    thread = threading.Thread(target=start_server, daemon=True)
    thread.start()

    if wait_for_server(host, port):
        webbrowser.open(f"http://{host}:{port}")

    thread.join()


def main():
    base = get_base_path()

    # 設定環境變數讓 backend 找到資源（必須在 import app 之前）
    os.environ.setdefault("CHECKLISTER_DB_PATH", os.path.join(base, "backend", "twnamelist.db"))
    os.environ.setdefault("CHECKLISTER_FRONTEND_DIR", os.path.join(base, "frontend", "build"))

    # 如果 bundle 內有 pandoc，加入 PATH（Windows 和 macOS）
    bundled_pandoc = os.path.join(base, "pandoc")
    bundled_pandoc_exe = os.path.join(base, "pandoc.exe")
    for p in [bundled_pandoc, bundled_pandoc_exe]:
        if os.path.isfile(p):
            os.environ["PATH"] = os.path.dirname(p) + os.pathsep + os.environ.get("PATH", "")
            break

    parser = argparse.ArgumentParser(description="Run the Checklister-NG backend")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind")
    parser.add_argument("--port", type=int, default=8964, help="Port number to listen on")
    parser.add_argument("--no-tray", action="store_true", help="不使用 system tray icon")
    args = parser.parse_args()

    # import app 在環境變數設定之後，確保路徑正確
    from backend.main import app

    # PyInstaller 打包時預設使用 tray；開發模式或 --no-tray 時不使用
    use_tray = getattr(sys, '_MEIPASS', None) and not args.no_tray
    if use_tray:
        try:
            _run_with_tray(args.host, args.port, app)
        except ImportError:
            # pystray 或 PIL 不可用時 fallback
            _run_without_tray(args.host, args.port, app)
    else:
        _run_without_tray(args.host, args.port, app)

if __name__ == "__main__":
    main()
