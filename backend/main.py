# backend/main.py
# from fastapi import FastAPI
# from sqlmodel import SQLModel, Session, select
# 
# from backend.api import search_api
# from backend.db import engine, get_session
# from backend.models.schema import PlantType
# 
# app = FastAPI()
# 
# @app.on_event("startup")
# def on_startup():
#     SQLModel.metadata.create_all(engine)
#     with get_session() as session:
#         if not session.exec(select(PlantType)).first():
#             session.add_all([
#                 PlantType(id=0, name_zh="苔蘚地衣類植物", name_en="Mosses and Lichens"),
#                 PlantType(id=1, name_zh="石松類植物", name_en="Lycophytes"),
#                 PlantType(id=3, name_zh="裸子植物", name_en="Gymnosperms"),
#             ])
#             session.commit()
# 
# app.include_router(search_api.router)

# backend/main.py
from fastapi import FastAPI
from sqlmodel import SQLModel
from backend.api import search_api, resolve_name, export
from backend.db import engine

app = FastAPI()

@app.on_event("startup")
def on_startup():
    # 若資料表已存在則不會改動
    SQLModel.metadata.create_all(engine)

app.include_router(search_api.router)
app.include_router(resolve_name.router)
app.include_router(export.router)
