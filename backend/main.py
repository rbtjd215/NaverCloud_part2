"""
SafeSync Backend — FastAPI 메인 애플리케이션
모든 라우터, 미들웨어, 이벤트를 등록합니다.

실행:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

API 문서:
    http://localhost:8000/docs  (Swagger UI)
    http://localhost:8000/redoc (ReDoc)
"""

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import random, math

from config import get_settings
from database import get_db, init_db
from models import Disaster, Shelter, Subscriber, SystemLog
from schemas import (
    DisasterCreate, DisasterUpdate, DisasterResponse,
    ShelterCreate, ShelterUpdate, ShelterResponse,
    SubscriberCreate, SubscriberResponse,
    AIGuideRequest, AIGuideResponse,
    AdminLogin, TokenResponse,
    CloudStatus, SystemStatusResponse,
    APIResponse
)
from clova_service import clova_service

# JWT
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer

settings = get_settings()

# ─────────────────────────────────────
# FastAPI 앱 생성
# ─────────────────────────────────────
app = FastAPI(
    title="SafeSync API",
    description="""
## 🚨 SafeSync — 국가 재난·응급 알림 포털 Backend API

멀티 클라우드(NCP Primary + AWS DR) 기반 재난 알림 플랫폼의 REST API입니다.

### 주요 기능
- **재난 관리**: 재난 발생/조회/해제
- **대피소 관리**: 대피소 현황 실시간 업데이트
- **AI 행동 요령**: CLOVA Studio HCX-003 연동 자동 생성
- **DR 상태**: 멀티 클라우드 상태 모니터링
- **관리자 인증**: JWT 기반 토큰 인증
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─────────────────────────────────────
# CORS 미들웨어
# ─────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list + ["*"],  # 개발 시 전체 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────
# 인증 유틸리티
# ─────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

def create_access_token(data: dict) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(
        {**data, "exp": expire},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm
    )

def get_current_admin(token: str = Depends(oauth2_scheme)):
    if not token:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")


# ─────────────────────────────────────
# 시작 이벤트: DB 초기화 + 샘플 데이터
# ─────────────────────────────────────
@app.on_event("startup")
def startup_event():
    init_db()
    _seed_initial_data()
    print(f"✅ SafeSync API 시작 — 클라우드: {settings.cloud_provider} ({settings.cloud_region})")
    print(f"📖 API 문서: http://localhost:{settings.port}/docs")


def _seed_initial_data():
    """최초 실행 시 샘플 데이터 삽입"""
    from database import SessionLocal
    db = SessionLocal()
    try:
        if db.query(Shelter).count() == 0:
            sample_shelters = [
                Shelter(name="영통구청 민방위 대피소",   address="경기 수원시 영통구 영통로 224",   region="경기 수원",  capacity=800,   current_cnt=342, status="OPEN"),
                Shelter(name="합정역 지하 대피소",       address="서울 마포구 합정역 3번 출구",     region="서울 마포",  capacity=1200,  current_cnt=670, status="OPEN"),
                Shelter(name="망원동 주민센터 대피소",   address="서울 마포구 월드컵로 190",        region="서울 마포",  capacity=500,   current_cnt=498, status="FULL"),
                Shelter(name="속초고등학교 대피소",      address="강원 속초시 청초호반로 56",       region="강원 속초",  capacity=600,   current_cnt=230, status="OPEN"),
                Shelter(name="해운대구 민방위 대피소",   address="부산 해운대구 해운대로 875",      region="부산 해운대", capacity=2000,  current_cnt=1100, status="OPEN"),
                Shelter(name="전주종합경기장 대피소",    address="전북 전주시 덕진구 백제대로 900", region="전북 전주",  capacity=5000,  current_cnt=120, status="OPEN"),
                Shelter(name="수원월드컵경기장 광역 대피소", address="경기 수원시 팔달구 월드컵로 310", region="경기 수원", capacity=10000, current_cnt=2400, status="OPEN"),
                Shelter(name="강릉아레나 임시 대피소",   address="강원 강릉시 종합운동장길 33",    region="강원 강릉",  capacity=3000,  current_cnt=0,   status="CLOSED"),
            ]
            db.add_all(sample_shelters)

        if db.query(Disaster).count() == 0:
            sample_disasters = [
                Disaster(type="CHEMICAL", title="경기 수원시 영통구 아파트 단지 가스 누출",
                         description="영통구 매탄동 소재 대형 아파트 단지 지하 가스관 파손으로 LPG 누출이 확인되었습니다.",
                         region="경기 수원시 영통구", severity="CRITICAL", latitude=37.2636, longitude=127.0286,
                         ai_guide="1. 즉시 가스 밸브를 잠그십시오.\n2. 전기 스위치를 건드리지 마십시오.\n3. 창문을 열어 환기하십시오.\n4. 계단으로 건물 밖으로 대피하십시오.\n5. 119에 신고하십시오."),
                Disaster(type="FLOOD",    title="서울 마포구 홍수 경보 — 한강 수위 위험",
                         description="집중호우로 한강 수위가 위험 수위를 초과했습니다.",
                         region="서울 마포구", severity="CRITICAL", latitude=37.5548, longitude=126.9092,
                         ai_guide="1. 즉시 높은 지대로 이동하십시오.\n2. 지하층 거주자는 즉시 탈출하십시오.\n3. 침수 도로 통행을 금지하십시오."),
                Disaster(type="FIRE",     title="강원 속초시 설악산 인근 산불 2단계",
                         description="설악산 국립공원 인근에서 산불 발생, 소방 2단계 대응 중.",
                         region="강원 속초시", severity="HIGH", latitude=38.2040, longitude=128.5916),
                Disaster(type="TYPHOON",  title="부산·경남 태풍 카눈 직접 영향권",
                         description="제6호 태풍 카눈이 부산 상륙 예정, 최대 풍속 45m/s.",
                         region="부산·경남 전역", severity="HIGH", latitude=35.1796, longitude=129.0756),
            ]
            db.add_all(sample_disasters)

        db.commit()
    except Exception as e:
        print(f"[seed] 오류: {e}")
        db.rollback()
    finally:
        db.close()


# ═══════════════════════════════════════════
#  AUTH 라우터
# ═══════════════════════════════════════════
@app.post("/auth/login", response_model=TokenResponse, tags=["인증"])
def admin_login(body: AdminLogin):
    """관리자 로그인 — JWT 토큰 발급"""
    if body.admin_id != settings.admin_id or body.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="ID 또는 비밀번호가 올바르지 않습니다.")
    token = create_access_token({"sub": body.admin_id, "role": "admin"})
    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_expire_minutes * 60
    )


# ═══════════════════════════════════════════
#  DISASTER 라우터
# ═══════════════════════════════════════════
@app.get("/disasters", response_model=List[DisasterResponse], tags=["재난"])
def list_disasters(
    status:   Optional[str] = None,
    severity: Optional[str] = None,
    region:   Optional[str] = None,
    page:     int = 1,
    size:     int = 20,
    db:       Session = Depends(get_db)
):
    """
    재난 목록 조회
    - status: ACTIVE | RESOLVED
    - severity: LOW | MEDIUM | HIGH | CRITICAL
    - region: 지역명 부분 검색
    """
    q = db.query(Disaster)
    if status:   q = q.filter(Disaster.status == status)
    if severity: q = q.filter(Disaster.severity == severity)
    if region:   q = q.filter(Disaster.region.contains(region))
    total = q.count()
    items = q.order_by(Disaster.created_at.desc()).offset((page-1)*size).limit(size).all()
    return items


@app.post("/disasters", response_model=DisasterResponse, status_code=201, tags=["재난"])
def create_disaster(body: DisasterCreate, db: Session = Depends(get_db)):
    """재난 신고 접수"""
    d = Disaster(**body.model_dump())
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


@app.get("/disasters/{disaster_id}", response_model=DisasterResponse, tags=["재난"])
def get_disaster(disaster_id: int, db: Session = Depends(get_db)):
    """재난 상세 조회"""
    d = db.query(Disaster).filter(Disaster.id == disaster_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="재난 정보를 찾을 수 없습니다.")
    return d


@app.patch("/disasters/{disaster_id}", response_model=DisasterResponse, tags=["재난"])
def update_disaster(
    disaster_id: int,
    body: DisasterUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin)
):
    """재난 정보 수정 (관리자 전용)"""
    d = db.query(Disaster).filter(Disaster.id == disaster_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="재난 정보를 찾을 수 없습니다.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(d, field, value)
    db.commit()
    db.refresh(d)
    return d


@app.delete("/disasters/{disaster_id}", tags=["재난"])
def resolve_disaster(
    disaster_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin)
):
    """재난 해제 (관리자 전용)"""
    d = db.query(Disaster).filter(Disaster.id == disaster_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="재난 정보를 찾을 수 없습니다.")
    d.status = "RESOLVED"
    db.commit()
    return {"success": True, "message": f"재난 #{disaster_id} 해제 완료"}


# ═══════════════════════════════════════════
#  SHELTER 라우터
# ═══════════════════════════════════════════
@app.get("/shelters", tags=["대피소"])
def list_shelters(
    region:  Optional[str] = None,
    status:  Optional[str] = None,
    page:    int = 1,
    size:    int = 20,
    db:      Session = Depends(get_db)
):
    """대피소 목록 조회"""
    q = db.query(Shelter)
    if region: q = q.filter(Shelter.region.contains(region))
    if status: q = q.filter(Shelter.status == status)
    items = q.order_by(Shelter.name).offset((page-1)*size).limit(size).all()

    result = []
    for s in items:
        rate = round((s.current_cnt / s.capacity * 100), 1) if s.capacity > 0 else 0
        result.append({
            "id": s.id, "name": s.name, "address": s.address,
            "region": s.region, "latitude": s.latitude, "longitude": s.longitude,
            "capacity": s.capacity, "current_cnt": s.current_cnt,
            "occupancy_rate": rate, "status": s.status,
            "contact": s.contact, "updated_at": s.updated_at,
        })
    return result


@app.patch("/shelters/{shelter_id}", tags=["대피소"])
def update_shelter(
    shelter_id: int,
    body: ShelterUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin)
):
    """대피소 현황 업데이트 (관리자 전용)"""
    s = db.query(Shelter).filter(Shelter.id == shelter_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="대피소를 찾을 수 없습니다.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(s, field, value)
    # 수용률에 따라 status 자동 조정
    if body.current_cnt is not None:
        if s.current_cnt >= s.capacity:
            s.status = "FULL"
        elif s.status == "FULL":
            s.status = "OPEN"
    db.commit()
    db.refresh(s)
    return {"success": True, "data": {"id": s.id, "status": s.status, "current_cnt": s.current_cnt}}


# ═══════════════════════════════════════════
#  AI 행동 요령 라우터
# ═══════════════════════════════════════════
@app.post("/ai/guide", response_model=AIGuideResponse, tags=["AI 행동 요령"])
async def generate_ai_guide(
    body: AIGuideRequest,
    db:   Session = Depends(get_db)
):
    """
    CLOVA Studio HCX-003을 사용한 재난 행동 요령 자동 생성
    - API Key 미설정 시 규칙 기반 폴백 응답 반환
    - disaster_id 지정 시 생성된 요령을 DB에도 저장
    """
    result = await clova_service.generate_guide(body.situation)

    # disaster_id 지정 시 DB에 ai_guide 저장
    if body.disaster_id:
        d = db.query(Disaster).filter(Disaster.id == body.disaster_id).first()
        if d:
            d.ai_guide = result["raw_text"]
            db.commit()

    return AIGuideResponse(
        steps=result["steps"],
        raw_text=result["raw_text"],
        model=result["model"],
        generated_at=result["generated_at"],
    )


# ═══════════════════════════════════════════
#  구독자 라우터
# ═══════════════════════════════════════════
@app.post("/subscribers", response_model=SubscriberResponse, status_code=201, tags=["알림 구독"])
def create_subscriber(body: SubscriberCreate, db: Session = Depends(get_db)):
    """알림 구독 신청"""
    existing = db.query(Subscriber).filter(Subscriber.email == str(body.email)).first()
    if existing:
        # 이미 구독 중이면 업데이트
        existing.region   = body.region
        existing.severity = body.severity
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing

    sub = Subscriber(
        email=str(body.email),
        region=body.region,
        severity=body.severity
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@app.delete("/subscribers/{email}", tags=["알림 구독"])
def unsubscribe(email: str, db: Session = Depends(get_db)):
    """구독 해지"""
    sub = db.query(Subscriber).filter(Subscriber.email == email).first()
    if not sub:
        raise HTTPException(status_code=404, detail="구독 정보를 찾을 수 없습니다.")
    sub.is_active = False
    db.commit()
    return {"success": True, "message": "구독이 해지되었습니다."}


# ═══════════════════════════════════════════
#  클라우드 / DR 상태 라우터
# ═══════════════════════════════════════════
# 메모리 내 DR 상태 (실제 환경에서는 Redis 또는 DB 사용)
_dr_state = {
    "dr_mode": False,
    "active_cloud": settings.cloud_provider,
    "ncp_online": True,
    "aws_role": "DR",
}

@app.get("/system/status", response_model=SystemStatusResponse, tags=["시스템 상태"])
def get_system_status():
    """멀티 클라우드 인프라 상태 조회 (DR 대시보드용)"""
    ncp_online = _dr_state["ncp_online"]
    dr_mode    = _dr_state["dr_mode"]

    ncp = CloudStatus(
        provider="NCP",
        role="PRIMARY" if not dr_mode else "OFFLINE",
        online=ncp_online,
        cpu_usage=round(random.uniform(20, 45), 1) if ncp_online else None,
        latency_ms=round(random.uniform(30, 80), 1) if ncp_online else None,
        traffic_pct=100.0 if (ncp_online and not dr_mode) else 0.0,
        db_status="MASTER" if (ncp_online and not dr_mode) else "UNAVAILABLE",
        replication_lag_s=None,
    )
    aws = CloudStatus(
        provider="AWS",
        role="DR" if not dr_mode else "PRIMARY",
        online=True,
        cpu_usage=round(random.uniform(60, 80), 1) if dr_mode else round(random.uniform(2, 6), 1),
        latency_ms=round(random.uniform(35, 90), 1),
        traffic_pct=100.0 if dr_mode else 0.0,
        db_status="MASTER" if dr_mode else "SLAVE",
        replication_lag_s=None if dr_mode else round(random.uniform(0.1, 0.5), 2),
    )
    return SystemStatusResponse(
        ncp=ncp,
        aws=aws,
        active_cloud=_dr_state["active_cloud"],
        dr_mode=dr_mode,
        uptime_pct=99.99,
        checked_at=datetime.now(),
    )


@app.post("/system/failover", tags=["시스템 상태"])
def trigger_failover(_: dict = Depends(get_current_admin)):
    """DR Failover 실행 — NCP → AWS (관리자 전용)"""
    _dr_state["dr_mode"]    = True
    _dr_state["ncp_online"] = False
    _dr_state["active_cloud"] = "AWS"
    return {
        "success": True,
        "message": "Failover 완료: AWS DR 환경이 Primary로 전환되었습니다.",
        "active_cloud": "AWS",
        "dr_mode": True,
    }


@app.post("/system/failback", tags=["시스템 상태"])
def trigger_failback(_: dict = Depends(get_current_admin)):
    """Failback — AWS → NCP Primary 복구 (관리자 전용)"""
    _dr_state["dr_mode"]    = False
    _dr_state["ncp_online"] = True
    _dr_state["active_cloud"] = "NCP"
    return {
        "success": True,
        "message": "Failback 완료: NCP Primary가 서비스를 재개합니다.",
        "active_cloud": "NCP",
        "dr_mode": False,
    }


# ═══════════════════════════════════════════
#  Health Check
# ═══════════════════════════════════════════
@app.get("/health", tags=["헬스 체크"])
def health_check():
    """Route 53 Health Check용 엔드포인트"""
    return {
        "status":   "ok",
        "cloud":    settings.cloud_provider,
        "region":   settings.cloud_region,
        "time":     datetime.now().isoformat(),
        "version":  "1.0.0",
    }


@app.get("/", tags=["헬스 체크"])
def root():
    return {
        "message": "🚨 SafeSync API is running!",
        "docs":    "/docs",
        "cloud":   settings.cloud_provider,
    }
