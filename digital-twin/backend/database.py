from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# SQLite создаст файл app.db в этой же папке
SQLALCHEMY_DATABASE_URL = "postgresql://neondb_owner:npg_xWlMfQv2nVT4@ep-icy-boat-aii6ib5l-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Зависимость (Dependency) для роутеров
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
