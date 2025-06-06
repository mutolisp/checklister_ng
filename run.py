import argparse
import uvicorn

from backend.main import app


def main():
    parser = argparse.ArgumentParser(description="Run the Checklister-NG backend")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind")
    parser.add_argument("--port", type=int, default=8000, help="Port number to listen on")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
