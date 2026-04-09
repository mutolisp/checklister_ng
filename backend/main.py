import os
import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlmodel import SQLModel
from backend.api import search_api, resolve_name, export, synonyms_api, admin_api, taxonomy_api
from backend.db import engine

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="Checklister-NG API",
    description="提供物種名錄匯出與資料管理功能",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8964",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8964",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

app.include_router(search_api.router)
app.include_router(resolve_name.router)
app.include_router(export.router)
app.include_router(synonyms_api.router)
app.include_router(admin_api.router)
app.include_router(taxonomy_api.router)

# Serve frontend static files
_frontend_dir = os.environ.get(
    "CHECKLISTER_FRONTEND_DIR",
    os.path.join(os.path.dirname(__file__), "..", "frontend", "build")
)
if os.path.isdir(_frontend_dir):
    app.mount("/_app", StaticFiles(directory=os.path.join(_frontend_dir, "_app")), name="static")

    # SPA fallback 用 Starlette middleware 處理，不會搶 FastAPI 內建路由
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import Response

    class _SPAFallbackMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            response = await call_next(request)
            # 只有 GET 且 404 且不是 API/靜態資源時才 fallback 到 index.html
            if (response.status_code == 404
                    and request.method == "GET"
                    and not request.url.path.startswith(("/api/", "/_app/"))):
                index = os.path.join(_frontend_dir, "index.html")
                if os.path.isfile(index):
                    return FileResponse(index)
            return response

    app.add_middleware(_SPAFallbackMiddleware)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        file_path = os.path.join(_frontend_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return Response(status_code=404)
