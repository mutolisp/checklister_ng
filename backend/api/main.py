from fastapi import FastAPI
from sqlmodel import SQLModel, create_engine, Session

from backend.api import search_api
from backend.models.schema import PlantName, PlantType

sqlite_file_name = "twnamelist.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

engine = create_engine(sqlite_url, echo=True)

app = FastAPI()

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

# 可在其他模組使用 session
session = Session(engine)

# load router
app.include_router(search_api.router)
app.include_router(export.router)

