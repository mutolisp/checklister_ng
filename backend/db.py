from sqlmodel import create_engine, Session
import os

sqlite_file_path = os.environ.get(
    "CHECKLISTER_DB_PATH",
    os.path.join(os.path.dirname(__file__), "twnamelist.db")
)
sqlite_url = f"sqlite:///{sqlite_file_path}"

engine = create_engine(sqlite_url, echo=False)

def get_session():
    return Session(engine)

