"""
SafeSync Backend — 데이터베이스 모델 (SQLAlchemy ORM)
NCP Cloud DB(MySQL Master) / AWS RDS(MySQL Slave) 공통 스키마
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Enum, DateTime,
    DECIMAL, func, Boolean
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# ─────────────────────────────────────
# 재난 현황 테이블
# ─────────────────────────────────────
class Disaster(Base):
    __tablename__ = "disasters"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    type        = Column(
        Enum("FIRE", "FLOOD", "EARTHQUAKE", "CHEMICAL", "TYPHOON", "OTHER"),
        nullable=False
    )
    title       = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    region      = Column(String(100), nullable=False)
    latitude    = Column(DECIMAL(10, 7), nullable=True)
    longitude   = Column(DECIMAL(10, 7), nullable=True)
    severity    = Column(
        Enum("LOW", "MEDIUM", "HIGH", "CRITICAL"),
        nullable=False,
        default="MEDIUM"
    )
    status      = Column(
        Enum("ACTIVE", "RESOLVED"),
        nullable=False,
        default="ACTIVE"
    )
    reported_by = Column(String(100), nullable=True)
    ai_guide    = Column(Text, nullable=True)   # CLOVA Studio 생성 행동 요령
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────
# 대피소 테이블
# ─────────────────────────────────────
class Shelter(Base):
    __tablename__ = "shelters"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(200), nullable=False)
    address     = Column(String(300), nullable=False)
    region      = Column(String(100), nullable=False)
    latitude    = Column(DECIMAL(10, 7), nullable=True)
    longitude   = Column(DECIMAL(10, 7), nullable=True)
    capacity    = Column(Integer, nullable=False, default=0)
    current_cnt = Column(Integer, nullable=False, default=0)
    status      = Column(
        Enum("OPEN", "FULL", "CLOSED"),
        nullable=False,
        default="OPEN"
    )
    contact     = Column(String(50), nullable=True)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────
# 알림 구독자 테이블
# ─────────────────────────────────────
class Subscriber(Base):
    __tablename__ = "subscribers"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    email       = Column(String(200), nullable=False, unique=True)
    region      = Column(String(200), nullable=False)   # 쉼표 구분 "서울,경기"
    severity    = Column(
        Enum("ALL", "HIGH", "CRITICAL"),
        nullable=False,
        default="ALL"
    )
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, server_default=func.now())


# ─────────────────────────────────────
# 시스템 로그 테이블 (DR 이벤트 기록)
# ─────────────────────────────────────
class SystemLog(Base):
    __tablename__ = "system_logs"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    level       = Column(Enum("INFO", "WARN", "ERROR", "ACTION"), default="INFO")
    message     = Column(Text, nullable=False)
    cloud       = Column(String(20), nullable=True)     # NCP | AWS
    created_at  = Column(DateTime, server_default=func.now())
