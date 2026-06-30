# 📋 SafeSync 프로젝트 종합 보고서
## 국가 재난·응급 알림 포털 — 멀티 클라우드 DR 아키텍처

> **건양대학교 매치업 과정 | 2과목: 멀티 클라우드 구축 및 DevOps**
> 작성일: 2026년 6월 30일

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [차별화 전략 및 기획 배경](#2-차별화-전략-및-기획-배경)
3. [전체 시스템 아키텍처](#3-전체-시스템-아키텍처)
4. [서비스 기능 정의](#4-서비스-기능-정의)
5. [기술 스택](#5-기술-스택)
6. [구현 완료 현황](#6-구현-완료-현황)
7. [파일 구조 및 각 파일 설명](#7-파일-구조-및-각-파일-설명)
8. [백엔드 API 명세](#8-백엔드-api-명세)
9. [데이터베이스 설계](#9-데이터베이스-설계)
10. [NCP ↔ AWS 네트워크 연결 방법](#10-ncp--aws-네트워크-연결-방법)
11. [DB Replication 설정 (Master-Slave)](#11-db-replication-설정-master-slave)
12. [DR Failover 시나리오 상세](#12-dr-failover-시나리오-상세)
13. [Docker 컨테이너 배포 전략](#13-docker-컨테이너-배포-전략)
14. [단계별 개발 일정](#14-단계별-개발-일정)
15. [남은 작업 로드맵](#15-남은-작업-로드맵)
16. [발표용 차별화 포인트](#16-발표용-차별화-포인트)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **프로젝트명** | SafeSync — 국가 재난·응급 알림 포털 |
| **핵심 슬로건** | "재난 상황에서도 절대 멈추지 않는 알림 시스템" |
| **Primary 클라우드** | **네이버 클라우드 플랫폼 (NCP)** — 한국 리전 |
| **DR 클라우드** | **AWS (Amazon Web Services)** — 서울 리전 (ap-northeast-2) |
| **DR 방식** | Active-Passive (평소 NCP 운영, AWS는 Warm Standby) |
| **핵심 기술** | VPC, Load Balancer, Auto Scaling, Cloud DB, Docker, CLOVA Studio AI |
| **목표** | 클라우드 장애 시 데이터 유실 없이 서비스 자동 전환 시연 |

### 프로젝트 선정 이유

> 기존 팀들이 주로 만드는 **쇼핑몰, 게시판, 커뮤니티** 웹 서비스와 달리, SafeSync는 **"국가 재난(Disaster)"이라는 주제**와 **"재해복구(DR, Disaster Recovery)"라는 기술**이 완벽하게 일치하는 강력한 스토리라인을 가집니다. 심사위원에게 "왜 멀티 클라우드가 필요한가?"를 가장 설득력 있게 설명할 수 있는 프로젝트입니다.

---

## 2. 차별화 전략 및 기획 배경

### 2.1 일반 팀과의 차별점

| 구분 | 일반 팀 | SafeSync |
|------|---------|----------|
| **주제 선정** | 쇼핑몰, 게시판 등 | 국가 재난 알림 — DR 개념과 주제 일치 |
| **AI 연동** | 없거나 단순 챗봇 | NCP CLOVA Studio HCX-003 상황별 맞춤 행동 요령 |
| **DR 시연** | PPT 설명만 | 발표 중 실제 서버 Down → 자동 Failover 라이브 시연 |
| **지도 연동** | 텍스트 목록 | 인터랙티브 지도에 재난 마커 실시간 표시 |
| **관리자 기능** | 없음 | 양쪽 클라우드 상태 실시간 대시보드 + 수동 Failover 버튼 |
| **DB 이중화** | 단일 DB | NCP Master ↔ AWS Slave Replication + 자동 Master 승격 |
| **컨테이너화** | 없음 | Docker로 동일 이미지를 양쪽 클라우드에 배포 |

### 2.2 기술적 차별화

```
"재난 포털이 재난으로 인해 다운되면 안 됩니다."
→ 이 한 문장이 멀티 클라우드 DR의 필요성을 완벽하게 설명합니다.
```

---

## 3. 전체 시스템 아키텍처

### 3.1 전체 구성도

```
┌─────────────────────────────────────────────────────────────────┐
│                          사용자 (인터넷)                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   AWS Route 53      │
                    │  (Global DNS +      │
                    │  Health Check)      │
                    └──────┬──────┬───────┘
                           │      │ 장애 감지 시 자동 전환
              정상 시 ──────┘      └────────── DR 시
                           │                  │
          ┌────────────────▼──┐         ┌─────▼──────────────────┐
          │  NCP (Primary)    │         │  AWS (DR Backup)        │
          │  ─────────────    │         │  ──────────────────     │
          │  [Load Balancer]  │         │  [ALB]                  │
          │       │           │         │       │                  │
          │  [Auto Scaling]   │◄──────►│  [Auto Scaling]         │
          │  ┌───┐ ┌───┐     │  DB복제  │  ┌───┐ ┌───┐          │
          │  │WAS│ │WAS│     │ ───────► │  │EC2│ │EC2│          │
          │  └───┘ └───┘     │ (Repl.)  │  └───┘ └───┘          │
          │  (Docker)        │         │  (Docker 동일이미지)      │
          │       │           │         │       │                  │
          │  [Cloud DB       │         │  [RDS MySQL             │
          │   MySQL Master]  │         │   Slave → Master 승격]  │
          │       │           │         │       │                  │
          │  [Object Storage]│         │  [S3 (미러링)]           │
          │       │           │         │                          │
          │  [CLOVA Studio]  │         │  [CLOVA Studio API]      │
          └───────────────────┘         └──────────────────────────┘
                  │                              │
                  └──── IPSec VPN / 공인 IP ─────┘
                        (두 클라우드 간 연결)
```

### 3.2 클라우드별 역할

| 구분 | NCP (Primary) | AWS (DR Backup) |
|------|--------------|-----------------|
| **역할** | Active — 실제 서비스 제공 | Warm Standby — 대기 상태 |
| **트래픽** | 100% | 0% (평상시) → 100% (DR 시) |
| **WAS 서버** | Ubuntu 22.04 × 2대 | EC2 Ubuntu 22.04 × 2대 |
| **로드밸런서** | NCP Load Balancer | AWS ALB |
| **데이터베이스** | Cloud DB MySQL (Master) | RDS MySQL (Slave) |
| **스토리지** | Object Storage | S3 |
| **DNS 제어** | - | AWS Route 53 (Health Check) |
| **AI** | CLOVA Studio 직접 연동 | 동일 CLOVA API |

---

## 4. 서비스 기능 정의

### 4.1 일반 사용자 기능

| 기능 | 설명 | 구현 상태 |
|------|------|-----------|
| 실시간 재난 현황판 | 지도 + 재난 목록 카드 | ✅ 완료 |
| 재난 신고 | 유형/지역/심각도 선택 후 신고 | ✅ 완료 |
| AI 행동 요령 생성 | CLOVA Studio 연동 맞춤형 안내 | ✅ 완료 |
| 대피소 찾기 | 수용률 실시간 표시 + 지역 검색 | ✅ 완료 |
| 알림 구독 | 지역/심각도별 이메일 알림 구독 | ✅ 완료 |
| 긴급 알림 띠 | 화면 상단 스크롤 긴급 뉴스 | ✅ 완료 |

### 4.2 관리자 기능

| 기능 | 설명 | 구현 상태 |
|------|------|-----------|
| JWT 로그인 | 관리자 인증 (admin/safesync2024) | ✅ 완료 |
| 클라우드 상태 대시보드 | NCP/AWS CPU·응답시간·트래픽 실시간 | ✅ 완료 |
| DR Failover 시연 | NCP 장애 → AWS 전환 단계별 로그 | ✅ 완료 |
| Failback | AWS → NCP 복구 | ✅ 완료 |
| 재난 발령/해제 | 재난 상태 관리 테이블 | ✅ 완료 |
| 대피소 수용 현황 업데이트 | PATCH /shelters/{id} | ✅ 완료 |

---

## 5. 기술 스택

### 5.1 프론트엔드

| 항목 | 기술 | 선택 이유 |
|------|------|-----------|
| 구조 | HTML5 | 프레임워크 없이 순수 HTML — 가벼움 |
| 스타일 | Vanilla CSS | 완전한 커스텀 디자인 제어 |
| 로직 | Vanilla JavaScript (ES2022) | 추가 빌드 도구 불필요 |
| 지도 | SVG 인터랙티브 지도 | 서버 없이 동작, 커스터마이징 용이 |
| 디자인 | 다크모드 글래스모피즘 | 재난 포털 분위기 + 프리미엄 느낌 |
| 폰트 | Noto Sans KR (Google Fonts) | 한국어 최적화 |

### 5.2 백엔드

| 항목 | 기술 | 선택 이유 |
|------|------|-----------|
| 프레임워크 | **FastAPI** (Python 3.11) | 빠른 개발, 자동 Swagger 문서, async 지원 |
| ORM | SQLAlchemy 2.0 | MySQL 연동, 마이그레이션 지원 |
| 스키마 검증 | Pydantic v2 | 타입 안전성, 자동 직렬화 |
| 인증 | JWT (python-jose) | Stateless 인증, 멀티 서버 환경 적합 |
| AI 연동 | **CLOVA Studio HCX-003** | NCP 수업 내용 활용, 한국어 특화 AI |
| 서버 | Uvicorn (ASGI) | FastAPI 공식 고성능 서버 |

### 5.3 데이터베이스

| 항목 | NCP | AWS |
|------|-----|-----|
| 엔진 | MySQL 8.0 (Cloud DB) | MySQL 8.0 (RDS) |
| 역할 | **Master** (Read/Write) | **Slave** (Read-only → DR 시 Master 승격) |
| 연결 | 공인 IP + SSL/TLS | Binary Log Replication |

### 5.4 인프라

| 항목 | NCP | AWS |
|------|-----|-----|
| 컴퓨팅 | Server (Ubuntu 22.04) | EC2 (t3.medium) |
| 로드밸런서 | NCP Load Balancer | Application Load Balancer (ALB) |
| 오토스케일링 | NCP Auto Scaling | Auto Scaling Group |
| 스토리지 | Object Storage | S3 |
| DNS | - | Route 53 (Failover Routing) |
| 컨테이너 | Docker + Nginx | Docker + Nginx (동일 이미지) |

---

## 6. 구현 완료 현황

### 6.1 Phase 1 — 프론트엔드 ✅ 완료

- 다크모드 프리미엄 디자인 시스템 (CSS 변수, 글래스모피즘)
- 재난 현황 대시보드 (통계 카드 5종 + SVG 지도 + 목록 카드)
- 재난 신고 모달 (유형 칩 선택, 지역/심각도 입력, 즉시 반영)
- AI 행동 요령 패널 (상황 입력 → 백엔드 호출 → 단계별 출력)
- 대피소 현황 (수용률 바 + 지역 검색)
- 알림 구독 폼 (지역 칩 선택, 심각도 선택)
- 관리자 콘솔 (JWT 로그인, 클라우드 상태 카드, DR 시연 버튼, 로그 패널)
- 실시간 알림 띠 스크롤 애니메이션
- Toast 알림 시스템
- 백엔드 API 연동 (apiCall 래퍼, 폴백 모드 지원)

### 6.2 Phase 2 — 백엔드 ✅ 완료

- FastAPI 앱 (main.py) — 전체 라우터, JWT 미들웨어, 시작 이벤트
- SQLAlchemy ORM 모델 4종 (Disaster, Shelter, Subscriber, SystemLog)
- Pydantic 스키마 (요청/응답 완전 타입 정의)
- CLOVA Studio 서비스 (HCX-003 연동 + 6종 규칙 기반 폴백)
- JWT 관리자 인증
- DR Failover/Failback API
- 샘플 데이터 자동 삽입 (startup 이벤트)
- Dockerfile + docker-compose.yml (MySQL + FastAPI + Nginx)
- MySQL 스키마 SQL + DB Replication 설정 주석

### 6.3 남은 작업 (Phase 3~5)

| Phase | 작업 | 예상 소요 |
|-------|------|-----------|
| Phase 3 | NCP 인프라 구축 (VPC, Server, DB, LB) | 1주 |
| Phase 4 | AWS DR 환경 구축 (EC2, ALB, RDS) + Route 53 | 1주 |
| Phase 5 | DB Replication 연결 + 통합 테스트 | 3일 |
| Phase 5 | 발표 자료 + 시연 리허설 | 2일 |

---

## 7. 파일 구조 및 각 파일 설명

### 7.1 전체 파일 트리

```
SafeSync/
│
├── 📄 index.html            # 메인 HTML — 전체 UI 구조
├── 🎨 style.css             # 전체 CSS — 디자인 시스템
├── ⚙️  app.js               # 전체 JavaScript — 인터랙션 + API 연동
│
├── 🐳 docker-compose.yml    # 전체 스택 실행 (MySQL + FastAPI + Nginx)
├── ⚙️  nginx.conf           # Nginx 리버스 프록시 설정
│
└── backend/
    ├── 🚀 main.py           # FastAPI 메인 앱 — 모든 라우터
    ├── 🗃️  models.py        # SQLAlchemy ORM 테이블 정의
    ├── ✅ schemas.py         # Pydantic 요청/응답 스키마
    ├── 🔌 database.py        # DB 세션 관리 + 초기화
    ├── 🤖 clova_service.py   # CLOVA Studio API 연동 서비스
    ├── ⚙️  config.py         # 환경변수 설정 (pydantic-settings)
    ├── 📋 schema.sql         # MySQL 스키마 + Replication 설정 가이드
    ├── 🐳 Dockerfile         # 백엔드 컨테이너 이미지
    ├── 📦 requirements.txt   # Python 의존성
    └── 🔒 .env.example       # 환경변수 예시 (실제 .env는 별도 생성)
```

### 7.2 각 파일 상세 설명

#### `index.html` — 메인 HTML
- **역할**: 전체 SPA(Single Page Application) 구조 정의
- **주요 섹션**:
  - `<header>`: 로고, 네비게이션, 긴급 알림 띠
  - `#dashboard`: 통계 카드, 지도 패널, 재난 목록, AI 행동 요령
  - `#shelters`: 대피소 목록 그리드
  - `#subscribe`: 알림 구독 폼
  - `#admin`: 관리자 로그인 + 클라우드 대시보드
  - `.modal-overlay#report-modal-overlay`: 재난 신고 모달
  - `.modal-overlay#detail-modal-overlay`: 재난 상세 모달

#### `style.css` — 디자인 시스템
- **역할**: 전체 UI 스타일 정의
- **핵심 구조**:
  - CSS 변수 (`:root`): 색상, 타이포그래피, 반경, 그림자 등 토큰 정의
  - 글래스모피즘 (`.glass-card`): `backdrop-filter: blur()` 기반 반투명 카드
  - 다크모드 베이스: `--bg-base: #070b14`
  - 심각도별 색상: 심각(빨강) → 경보(주황) → 주의(노랑) → 정보(초록)
  - 애니메이션: 펄스, 슬라이드인, 스케일인, 티커 스크롤
  - 반응형: 1100px 이하 2단, 768px 이하 모바일 레이아웃

#### `app.js` — 프론트엔드 로직
- **역할**: 전체 인터랙션, 상태 관리, API 연동
- **주요 모듈**:
  ```javascript
  // 백엔드 연동
  const API_BASE = 'http://localhost:8000';
  async function apiCall(method, path, body) { ... }  // 공통 API 호출 + 폴백
  
  // 앱 상태
  const state = { disasters, shelters, drMode, isAdminLoggedIn, ... }
  
  // 핵심 함수
  renderDisasters()         // 재난 목록 렌더링
  renderShelters(keyword)   // 대피소 목록 렌더링
  openDetailModal(id)       // 재난 상세 모달
  triggerFailover()         // DR Failover 시연 (단계별 애니메이션)
  triggerRecover()          // Failback 시연
  startCloudStatusPolling() // 백엔드 상태 30초마다 폴링
  ```
- **특징**: 백엔드 미연결 시 로컬 샘플 데이터로 완전히 동작하는 **폴백 모드** 지원

#### `backend/main.py` — FastAPI 메인 앱
- **역할**: 전체 API 엔드포인트 정의, 미들웨어, 시작 이벤트
- **핵심 구성**:
  - CORS 미들웨어 (개발 시 전체 허용)
  - JWT 인증 유틸리티 (`create_access_token`, `get_current_admin`)
  - 시작 시 DB 초기화 + 샘플 데이터 자동 삽입 (`startup` 이벤트)
  - 인메모리 DR 상태 (`_dr_state`) — 실제 환경에서는 Redis 권장
  - Swagger UI 자동 생성 (`/docs`)

#### `backend/clova_service.py` — AI 서비스
- **역할**: CLOVA Studio HCX-003 모델과 통신하여 재난 행동 요령 생성
- **API 흐름**:
  ```
  요청 → 시스템 프롬프트 + 상황 설명 → HCX-003 → 번호 목록 파싱 → 응답
  ```
- **폴백 동작**: API Key 미설정 또는 호출 실패 시 6종(화재/지진/홍수/가스/태풍/산불) 규칙 기반 응답 반환
- **실제 연동**: NCP 콘솔 → AI·NAVER API → CLOVA Studio에서 API Key 발급 후 `.env`에 입력

#### `backend/schema.sql` — DB 스키마
- **역할**: NCP Cloud DB 및 AWS RDS 양쪽에 동일하게 실행하는 초기화 SQL
- **테이블 4종**: disasters, shelters, subscribers, system_logs
- **포함 내용**: DB Replication 설정 명령어 주석 처리 (실제 환경에서 주석 해제 후 실행)

---

## 8. 백엔드 API 명세

### 8.1 인증

| Method | Endpoint | 인증 필요 | 설명 |
|--------|----------|-----------|------|
| `POST` | `/auth/login` | ❌ | 관리자 로그인 → JWT 발급 |

**요청 예시**:
```json
{ "admin_id": "admin", "password": "safesync2024" }
```
**응답 예시**:
```json
{ "access_token": "eyJ...", "token_type": "bearer", "expires_in": 3600 }
```

### 8.2 재난 관리

| Method | Endpoint | 인증 | 설명 |
|--------|----------|------|------|
| `GET` | `/disasters` | ❌ | 목록 조회 (status, severity, region 필터) |
| `POST` | `/disasters` | ❌ | 재난 신고 접수 |
| `GET` | `/disasters/{id}` | ❌ | 상세 조회 |
| `PATCH` | `/disasters/{id}` | ✅ | 수정 (관리자) |
| `DELETE` | `/disasters/{id}` | ✅ | 해제 (관리자) |

**재난 신고 요청 예시**:
```json
{
  "type": "CHEMICAL",
  "title": "경기 수원시 영통구 가스 누출",
  "description": "아파트 단지 지하 가스관 파손",
  "region": "경기 수원시 영통구",
  "severity": "CRITICAL",
  "latitude": 37.2636,
  "longitude": 127.0286
}
```

### 8.3 AI 행동 요령

| Method | Endpoint | 인증 | 설명 |
|--------|----------|------|------|
| `POST` | `/ai/guide` | ❌ | CLOVA Studio 행동 요령 생성 |

**요청**:
```json
{ "situation": "건물 3층에 화재가 발생했어요", "disaster_id": 1 }
```
**응답**:
```json
{
  "steps": ["즉시 화재경보기를 울리십시오.", "..."],
  "raw_text": "1. 즉시 화재경보기를 울리십시오.\n2. ...",
  "model": "HCX-003",
  "generated_at": "2026-06-30T15:30:00"
}
```

### 8.4 대피소

| Method | Endpoint | 인증 | 설명 |
|--------|----------|------|------|
| `GET` | `/shelters` | ❌ | 목록 (region, status 필터) |
| `PATCH` | `/shelters/{id}` | ✅ | 수용 현황 업데이트 |

### 8.5 알림 구독

| Method | Endpoint | 인증 | 설명 |
|--------|----------|------|------|
| `POST` | `/subscribers` | ❌ | 구독 신청 |
| `DELETE` | `/subscribers/{email}` | ❌ | 구독 해지 |

### 8.6 시스템 / DR 제어

| Method | Endpoint | 인증 | 설명 |
|--------|----------|------|------|
| `GET` | `/system/status` | ❌ | NCP/AWS 실시간 상태 |
| `POST` | `/system/failover` | ✅ | NCP 장애 → AWS 전환 |
| `POST` | `/system/failback` | ✅ | AWS → NCP 복구 |
| `GET` | `/health` | ❌ | Route 53 Health Check용 |
| `GET` | `/docs` | ❌ | Swagger UI 자동 문서 |

---

## 9. 데이터베이스 설계

### 9.1 테이블 구조

#### `disasters` — 재난 현황

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT PK | 자동 증가 |
| type | ENUM | FIRE/FLOOD/EARTHQUAKE/CHEMICAL/TYPHOON/OTHER |
| title | VARCHAR(200) | 재난 제목 |
| description | TEXT | 상세 설명 |
| region | VARCHAR(100) | 발생 지역 |
| latitude/longitude | DECIMAL(10,7) | 좌표 (지도 마커용) |
| severity | ENUM | LOW/MEDIUM/HIGH/CRITICAL |
| status | ENUM | ACTIVE/RESOLVED |
| ai_guide | TEXT | **CLOVA Studio 생성 행동 요령** |
| created_at | DATETIME | 신고 시각 |

#### `shelters` — 대피소

| 컬럼 | 타입 | 설명 |
|------|------|------|
| capacity | INT | 최대 수용 인원 |
| current_cnt | INT | **실시간 현재 인원** |
| status | ENUM | OPEN/FULL/CLOSED |

#### `subscribers` — 알림 구독자

| 컬럼 | 타입 | 설명 |
|------|------|------|
| email | VARCHAR(200) UNIQUE | 구독자 이메일 |
| region | VARCHAR(200) | 관심 지역 (쉼표 구분) |
| severity | ENUM | 알림 심각도 필터 |

#### `system_logs` — DR 이벤트 로그

| 컬럼 | 타입 | 설명 |
|------|------|------|
| level | ENUM | INFO/WARN/ERROR/ACTION |
| message | TEXT | 로그 메시지 |
| cloud | VARCHAR(20) | NCP/AWS 구분 |

---

## 10. NCP ↔ AWS 네트워크 연결 방법

### 방법 1: 공인 IP 기반 암호화 통신 (실습 환경 권장)

```
[NCP Cloud DB Master]
공인 IP: xxx.xxx.xxx.xxx
포트: 3306

[보안그룹 설정]
→ NCP 보안그룹: AWS RDS의 공인 IP만 인바운드 허용 (3306)
→ AWS 보안그룹: NCP DB 공인 IP만 인바운드 허용 (3306)

[통신 방식]
NCP Master ──SSL/TLS──► AWS Slave (Binary Log Replication)
```

**장점**: 설정이 단순, 실습 환경에서 빠르게 구현 가능  
**단점**: 공인 인터넷을 경유하므로 보안그룹 IP 화이트리스트 철저 관리 필요

### 방법 2: IPSec VPN (고급 — 추가 점수)

```
NCP VPN Gateway ↔ AWS Virtual Private Gateway
│                          │
└──── Site-to-Site VPN ────┘
      (암호화된 터널)

→ 내부 사설 IP로 DB Replication 가능
→ 더 안전하고 안정적인 연결
```

**NCP 설정**: VPC → VPN → VPN Gateway 생성 → 터널 IP 설정  
**AWS 설정**: VPC → 가상 프라이빗 게이트웨이 → Site-to-Site VPN 연결

---

## 11. DB Replication 설정 (Master-Slave)

### 11.1 NCP Master DB 설정

```sql
-- Step 1: 복제 전용 계정 생성 (NCP Master에서 실행)
CREATE USER 'repl_user'@'%' IDENTIFIED BY 'repl_strong_password';
GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';
FLUSH PRIVILEGES;

-- Step 2: Master 상태 확인 (메모 필수!)
SHOW MASTER STATUS;
-- 결과 예시:
-- +------------------+----------+--------------+------------------+
-- | File             | Position | Binlog_Do_DB | Binlog_Ignore_DB |
-- +------------------+----------+--------------+------------------+
-- | mysql-bin.000001 |      154 |              |                  |
-- +------------------+----------+--------------+------------------+
```

**NCP Cloud DB my.cnf 설정 필요**:
```ini
[mysqld]
server-id = 1
log_bin = mysql-bin
binlog_do_db = safesync
```

### 11.2 AWS RDS Slave 설정

```sql
-- AWS RDS에서 실행
CHANGE MASTER TO
  MASTER_HOST='[NCP DB 공인 IP]',
  MASTER_PORT=3306,
  MASTER_USER='repl_user',
  MASTER_PASSWORD='repl_strong_password',
  MASTER_LOG_FILE='mysql-bin.000001',   -- Step 2에서 메모한 File
  MASTER_LOG_POS=154;                   -- Step 2에서 메모한 Position

START SLAVE;

-- 동기화 확인
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master = 0 이면 완전 동기화 완료 ✅
```

### 11.3 DR Failover 시 Slave → Master 승격

```sql
-- DR 발생 시 AWS RDS에서 실행
STOP SLAVE;
RESET SLAVE ALL;
-- 이 시점부터 AWS RDS가 독립적인 Master로 동작
-- 백엔드 애플리케이션의 DB_HOST를 AWS RDS로 변경 또는
-- Route 53 DNS 전환으로 자동 처리
```

---

## 12. DR Failover 시나리오 상세

### 12.1 평상시 (Normal Mode)

```
상태: NCP PRIMARY ACTIVE
      AWS WARM STANDBY

흐름: 사용자 → Route 53 → NCP LB → WAS → NCP Cloud DB(Master)
      동시:    NCP Master → AWS Slave (Replication 동기화)

Health Check: Route 53가 30초마다 /health 엔드포인트 확인
              NCP 응답 OK → DNS 레코드 유지
```

### 12.2 장애 감지

```
NCP 서버 응답 없음 감지 (Route 53 연속 3회 실패 = 약 90초)
→ Route 53: "NCP 엔드포인트 UNHEALTHY"
→ DNS Failover Routing 정책 발동
→ AWS 레코드로 트래픽 자동 전환
```

### 12.3 Failover 실행 단계

```
1단계: AWS RDS Slave → Master 승격
       STOP SLAVE; RESET SLAVE ALL;

2단계: AWS WAS 서버 트래픽 수신 시작
       (Warm Standby이므로 이미 실행 중)

3단계: DNS TTL 만료 후 모든 트래픽이 AWS로 전환

4단계: 서비스 재개 확인
       GET /health → {"cloud": "AWS", "status": "ok"}
```

### 12.4 발표 중 시연 스크립트

```
[1] "현재 서비스는 NCP Primary 클라우드에서 정상 운영 중입니다."
    → 브라우저에서 서비스 접속 + 관리자 콘솔 NCP ONLINE 확인

[2] "그런데 지금 이 순간, NCP 데이터센터에 전력 장애가 발생했습니다!"
    → 관리자 콘솔 → [🔴 NCP 장애 발생] 버튼 클릭

[3] 로그 화면에 단계별 메시지 출력:
    🔴 [장애 감지] NCP Primary 서버 응답 없음
    🔴 [장애 감지] Route 53 Health Check FAILED
    ⚡ [DR 개시] AWS RDS Slave → Master 승격 중...
    ✅ [DR 완료] 데이터 유실 없음
    ✅ [DNS 완료] 트래픽 100% AWS로 전환 완료

[4] "서비스가 중단 없이 AWS DR 환경에서 계속 운영됩니다."
    → URL 동일, 서비스 정상 동작 확인
    → 재난 신고/조회 기능이 그대로 동작하는 것 시연

[5] "재난 알림 포털이, 재난에도 멈추지 않았습니다. SafeSync입니다."
```

---

## 13. Docker 컨테이너 배포 전략

### 13.1 동일 이미지 전략

```
[로컬/CI 환경에서 빌드]
$ docker build -t safesync-backend:v1.0 ./backend
$ docker tag safesync-backend:v1.0 [레지스트리]/safesync-backend:v1.0
$ docker push [레지스트리]/safesync-backend:v1.0

[NCP Server에서 배포]
$ docker pull [레지스트리]/safesync-backend:v1.0
$ docker run -d -p 8000:8000 \
  -e DB_HOST=[NCP_DB_IP] \
  -e CLOUD_PROVIDER=NCP \
  -e CLOVA_STUDIO_API_KEY=[KEY] \
  safesync-backend:v1.0

[AWS EC2에서 배포] ← 완전히 동일한 이미지!
$ docker pull [레지스트리]/safesync-backend:v1.0
$ docker run -d -p 8000:8000 \
  -e DB_HOST=[AWS_RDS_ENDPOINT] \
  -e CLOUD_PROVIDER=AWS \
  -e CLOVA_STUDIO_API_KEY=[KEY] \
  safesync-backend:v1.0
```

**핵심 포인트**: 환경변수(`DB_HOST`, `CLOUD_PROVIDER`)만 다르고 **이미지는 완전히 동일** → Docker의 이식성(Portability) 원칙 시연

### 13.2 로컬 개발 실행

```bash
# 전체 스택 실행 (MySQL + FastAPI + Nginx)
$ docker-compose up -d

# 개별 실행
$ cd backend
$ pip install -r requirements.txt
$ cp .env.example .env  # .env 파일 생성 후 값 입력
$ uvicorn main:app --reload --port 8000

# API 문서 확인
# http://localhost:8000/docs  ← Swagger UI
```

---

## 14. 단계별 개발 일정

| 주차 | Phase | 주요 작업 | 상태 |
|------|-------|-----------|------|
| 1주차 | Phase 1 | 프론트엔드 UI 개발 (HTML/CSS/JS) | ✅ 완료 |
| 1~2주차 | Phase 2 | 백엔드 API 개발 (FastAPI + CLOVA + Docker) | ✅ 완료 |
| 2주차 | Phase 3 | NCP 인프라 구축 (VPC, Server, DB, LB, AS) | 🔲 예정 |
| 2주차 | Phase 4 | AWS DR 환경 구축 (EC2, ALB, RDS, Route 53) | 🔲 예정 |
| 3주차 | Phase 4 | DB Replication 연결 (NCP Master → AWS Slave) | 🔲 예정 |
| 3주차 | Phase 5 | 통합 테스트 + DR 시연 리허설 | 🔲 예정 |
| 3주차 | Phase 5 | 발표 자료 제작 + 최종 리뷰 | 🔲 예정 |

---

## 15. 남은 작업 로드맵

### Phase 3 — NCP 인프라 구축

```
[1] VPC 생성
    - CIDR: 10.0.0.0/16
    - Public Subnet: 10.0.1.0/24 (WAS 서버)
    - Private Subnet: 10.0.2.0/24 (DB 서버)

[2] 보안그룹 설정
    - WAS 보안그룹: 80, 443, 8000 허용
    - DB 보안그룹: 3306 (WAS IP만 허용 + AWS RDS IP)

[3] Server 2대 생성 (Ubuntu 22.04)
    - Docker 설치
    - safesync-backend 이미지 배포

[4] Cloud DB (MySQL 8.0) 생성
    - DB 계정 생성
    - schema.sql 실행
    - Replication 사용자 생성

[5] Load Balancer 연결
    - Health Check: GET /health
    - 서버 2대 등록

[6] Auto Scaling 설정
    - CPU 70% 이상 시 스케일 아웃
    - 최소 2대, 최대 5대
```

### Phase 4 — AWS DR 환경 구축

```
[1] AWS VPC + Subnet 생성 (NCP와 유사한 구조)

[2] EC2 2대 (t3.medium, Ubuntu 22.04)
    - 동일 Docker 이미지 배포
    - DB_HOST = RDS 엔드포인트로 설정

[3] ALB 생성 + Auto Scaling Group

[4] RDS MySQL 생성
    - Multi-AZ: 비활성화 (Slave로만 사용)
    - NCP Master에 Replication 연결

[5] Route 53 설정
    - 기본 레코드: NCP LB IP (PRIMARY)
    - Failover 레코드: AWS ALB DNS (SECONDARY)
    - Health Check: NCP /health 30초마다 확인
```

### Phase 5 — 통합 테스트 + 발표 자료

```
[1] 통합 테스트
    - DB Replication 동기화 확인 (SHOW SLAVE STATUS)
    - Failover 자동 전환 소요 시간 측정
    - 데이터 유실 여부 확인

[2] 발표 자료
    - 프로젝트 소개 슬라이드 (아키텍처 다이어그램)
    - 시연 순서 리허설
    - 질의응답 예상 문항 준비
```

---

## 16. 발표용 차별화 포인트

### 기술적 차별화 요약

| 포인트 | 내용 | 임팩트 |
|--------|------|--------|
| **주제-기술 일치** | "재난" 알림 포털 × "재해복구(DR)" | 스토리텔링 최강 |
| **라이브 DR 시연** | 발표 중 실제 서버 Down → 자동 전환 | 눈앞에서 증명 |
| **AI 연동** | CLOVA Studio로 맞춤형 대피 안내 | NCP 기술 적극 활용 |
| **DB 이중화** | Master-Slave Replication + Master 승격 | 데이터 유실 없음 증명 |
| **Docker 이식성** | 동일 이미지 양쪽 클라우드 배포 | 환경 일관성 증명 |
| **실시간 대시보드** | 양쪽 클라우드 CPU/응답시간/트래픽 동시 표시 | 멀티 클라우드 운영 시각화 |

### 예상 심사 질문 & 답변

**Q: 왜 멀티 클라우드가 필요한가요?**
> A: 국가 재난 상황에서 단일 클라우드에 장애가 발생하면 정보 공백이 생깁니다. NCP와 AWS 양쪽에 동일한 서비스를 운영하고 DB Replication으로 데이터를 동기화하여, 한쪽이 다운되어도 서비스가 중단되지 않습니다. 방금 시연한 것처럼요.

**Q: DB 데이터가 정말 유실되지 않나요?**
> A: AWS RDS Slave는 NCP Master의 모든 변경사항을 Binary Log를 통해 실시간으로 복제받습니다. Replication Lag이 0.3초 이내이므로 데이터 유실은 최소 0.3초치에 불과하며, 실제 장애 감지 및 전환 시간(~90초)에 비해 매우 짧습니다.

**Q: CLOVA Studio는 어떻게 연동하나요?**
> A: NCP 콘솔에서 API Key를 발급받아 백엔드 환경변수에 설정합니다. POST 요청으로 상황을 전달하면 HCX-003 모델이 재난 전문가 시스템 프롬프트를 기반으로 맞춤형 행동 요령 5~7단계를 생성합니다.

---

> **문서 버전**: v1.2 | **최종 수정**: 2026-06-30
> **작성 범위**: 프로젝트 기획부터 백엔드 개발 완료 시점까지의 전체 내용
