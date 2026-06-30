"""
SafeSync Backend — DB 세션 관리
SQLAlchemy 비동기 세션 팩토리 + 의존성 주입용 get_db()
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
from config import get_settings
from models import Base

settings = get_settings()

# ── 엔진 생성 ──
engine = create_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,          # 연결 끊김 자동 감지
    pool_recycle=3600,           # 1시간마다 연결 갱신
    echo=settings.debug,         # 개발 시 SQL 로그 출력
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


def init_db():
    """테이블 자동 생성 (최초 실행 시)"""
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI 의존성 주입용 DB 세션"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
