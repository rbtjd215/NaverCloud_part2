"""
SafeSync Backend — Pydantic 스키마 (Request / Response 검증)
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


# ─────────────────────────────────────
# 공용 Enum
# ─────────────────────────────────────
class DisasterType(str, Enum):
    FIRE       = "FIRE"
    FLOOD      = "FLOOD"
    EARTHQUAKE = "EARTHQUAKE"
    CHEMICAL   = "CHEMICAL"
    TYPHOON    = "TYPHOON"
    OTHER      = "OTHER"

class SeverityLevel(str, Enum):
    LOW      = "LOW"
    MEDIUM   = "MEDIUM"
    HIGH     = "HIGH"
    CRITICAL = "CRITICAL"

class DisasterStatus(str, Enum):
    ACTIVE   = "ACTIVE"
    RESOLVED = "RESOLVED"

class ShelterStatus(str, Enum):
    OPEN   = "OPEN"
    FULL   = "FULL"
    CLOSED = "CLOSED"


# ─────────────────────────────────────
# 재난 스키마
# ─────────────────────────────────────
class DisasterCreate(BaseModel):
    type:        DisasterType
    title:       str = Field(..., min_length=2, max_length=200)
    description: Optional[str] = None
    region:      str = Field(..., min_length=2, max_length=100)
    latitude:    Optional[float] = None
    longitude:   Optional[float] = None
    severity:    SeverityLevel = SeverityLevel.MEDIUM
    reported_by: Optional[str] = None

class DisasterUpdate(BaseModel):
    title:       Optional[str] = None
    description: Optional[str] = None
    severity:    Optional[SeverityLevel] = None
    status:      Optional[DisasterStatus] = None
    ai_guide:    Optional[str] = None

class DisasterResponse(BaseModel):
    id:          int
    type:        str
    title:       str
    description: Optional[str]
    region:      str
    latitude:    Optional[float]
    longitude:   Optional[float]
    severity:    str
    status:      str
    reported_by: Optional[str]
    ai_guide:    Optional[str]
    created_at:  datetime
    updated_at:  datetime

    class Config:
        from_attributes = True


# ─────────────────────────────────────
# 대피소 스키마
# ─────────────────────────────────────
class ShelterCreate(BaseModel):
    name:        str = Field(..., min_length=2, max_length=200)
    address:     str = Field(..., min_length=5, max_length=300)
    region:      str
    latitude:    Optional[float] = None
    longitude:   Optional[float] = None
    capacity:    int = Field(..., ge=1)
    current_cnt: int = Field(0, ge=0)
    status:      ShelterStatus = ShelterStatus.OPEN
    contact:     Optional[str] = None

class ShelterUpdate(BaseModel):
    current_cnt: Optional[int] = Field(None, ge=0)
    status:      Optional[ShelterStatus] = None
    contact:     Optional[str] = None

class ShelterResponse(BaseModel):
    id:          int
    name:        str
    address:     str
    region:      str
    latitude:    Optional[float]
    longitude:   Optional[float]
    capacity:    int
    current_cnt: int
    occupancy_rate: float        # 계산 필드
    status:      str
    contact:     Optional[str]
    updated_at:  datetime

    class Config:
        from_attributes = True


# ─────────────────────────────────────
# 구독자 스키마
# ─────────────────────────────────────
class SubscriberCreate(BaseModel):
    email:    EmailStr
    region:   str = Field(..., description="쉼표 구분 지역명, 예: 서울,경기")
    severity: str = "ALL"

class SubscriberResponse(BaseModel):
    id:         int
    email:      str
    region:     str
    severity:   str
    is_active:  bool
    created_at: datetime

    class Config:
        from_attributes = True


# ─────────────────────────────────────
# AI 행동 요령 스키마
# ─────────────────────────────────────
class AIGuideRequest(BaseModel):
    situation:   str = Field(..., min_length=5, description="현재 상황 설명")
    disaster_id: Optional[int] = None    # 재난 ID 지정 시 DB에도 저장

class AIGuideResponse(BaseModel):
    steps:       List[str]
    raw_text:    str
    model:       str = "HCX-003"
    generated_at: datetime


# ─────────────────────────────────────
# 관리자 / 인증 스키마
# ─────────────────────────────────────
class AdminLogin(BaseModel):
    admin_id: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int


# ─────────────────────────────────────
# 클라우드 상태 스키마
# ─────────────────────────────────────
class CloudStatus(BaseModel):
    provider:     str           # NCP | AWS
    role:         str           # PRIMARY | DR
    online:       bool
    cpu_usage:    Optional[float]
    latency_ms:   Optional[float]
    traffic_pct:  float
    db_status:    str           # MASTER | SLAVE | UNAVAILABLE
    replication_lag_s: Optional[float]

class SystemStatusResponse(BaseModel):
    ncp:           CloudStatus
    aws:           CloudStatus
    active_cloud:  str          # 현재 서비스 중인 클라우드
    dr_mode:       bool
    uptime_pct:    float
    checked_at:    datetime


# ─────────────────────────────────────
# 공용 응답 래퍼
# ─────────────────────────────────────
class APIResponse(BaseModel):
    success: bool
    message: str
    data:    Optional[dict] = None

class PaginatedResponse(BaseModel):
    total:   int
    page:    int
    size:    int
    items:   list
