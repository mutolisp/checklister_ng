import argparse
import os
import sys
import socket
import time
import uvicorn
import threading
import webbrowser


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


def main():
    base = get_base_path()

    # 設定環境變數讓 backend 找到資源（必須在 import app 之前）
    os.environ.setdefault("CHECKLISTER_DB_PATH", os.path.join(base, "backend", "twnamelist.db"))
    os.environ.setdefault("CHECKLISTER_FRONTEND_DIR", os.path.join(base, "frontend", "build"))

    # 如果 bundle 內有 pandoc，加入 PATH
    bundled_pandoc = os.path.join(base, "pandoc")
    if os.path.isfile(bundled_pandoc):
        os.environ["PATH"] = os.path.dirname(bundled_pandoc) + os.pathsep + os.environ.get("PATH", "")

    parser = argparse.ArgumentParser(description="Run the Checklister-NG backend")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind")
    parser.add_argument("--port", type=int, default=8964, help="Port number to listen on")
    args = parser.parse_args()

    # import app 在環境變數設定之後，確保路徑正確
    from backend.main import app

    def start_server(host, port):
        uvicorn.run(app, host=host, port=port)

    thread = threading.Thread(target=start_server, args=(args.host, args.port), daemon=True)
    thread.start()

    if wait_for_server(args.host, args.port):
        webbrowser.open(f"http://{args.host}:{args.port}")
    else:
        print(f"Warning: server did not start within timeout, open http://{args.host}:{args.port} manually")

    thread.join()

if __name__ == "__main__":
    main()
