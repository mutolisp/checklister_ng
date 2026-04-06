import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlmodel import SQLModel
from backend.api import search_api, resolve_name, export, synonyms_api, admin_api
from backend.db import engine

app = FastAPI(
    title="Checklister-NG API",
    description="提供植物名錄匯出與資料管理功能",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

app.include_router(search_api.router)
app.include_router(resolve_name.router)
app.include_router(export.router)
app.include_router(synonyms_api.router)
app.include_router(admin_api.router)

# Serve frontend static files
_frontend_dir = os.environ.get(
    "CHECKLISTER_FRONTEND_DIR",
    os.path.join(os.path.dirname(__file__), "..", "frontend", "build")
)
if os.path.isdir(_frontend_dir):
    app.mount("/_app", StaticFiles(directory=os.path.join(_frontend_dir, "_app")), name="static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = os.path.join(_frontend_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_frontend_dir, "index.html"))
