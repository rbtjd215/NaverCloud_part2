# ☁️ NCP (네이버 클라우드 플랫폼) 인프라 구축 가이드
## SafeSync — 국가 재난·응급 알림 포털 (Primary 클라우드)

> 참고 실습 자료: Lab1.VPC / Lab2.서버생성 / Lab3.이미지 / Lab4.로드밸런서 /
> Lab5.오토스케일링 / Lab7.Cloud DB / Lab8.CLOVA Studio / Lab9.모니터링 / Lab10.CLA

---

## 📋 구축 목표 아키텍처

```
[인터넷]
    │
[Load Balancer] ← Health Check: GET /health
    │
    ├── [WAS 서버 #1] (Ubuntu 22.04 + Docker)
    └── [WAS 서버 #2] (Ubuntu 22.04 + Docker)
             │
        [Auto Scaling Group]
             │
    [Cloud DB for MySQL 8.0] ← Master DB
             │
    (AWS RDS로 Replication ──►)
```

---

## 🔢 Step 0. 사전 준비

### 0-1. NCP 콘솔 로그인
- 접속: https://console.ncloud.com
- Sub Account 사용 시: 강사님이 제공한 계정/비밀번호 입력

### 0-2. 리전 확인
- 우측 상단 리전이 **Korea** 인지 확인
- 다르면 드롭다운에서 Korea 선택

### 0-3. 전체 구축 순서 확인

```
VPC 생성 → ACG 설정 → 서버 생성 → Docker + 앱 배포
→ Cloud DB 생성 → DB 초기화 → Load Balancer → Auto Scaling
→ CLOVA Studio API Key 발급 → Monitoring 설정
```

> ⏱️ 예상 소요 시간: 총 3~4시간 (처음 진행 시)

---

## 🔢 Step 1. VPC 및 서브넷 생성

> 📖 참고: Lab1.VPC 실습 자료

### 1-1. VPC 생성

```
NCP 콘솔 → Networking → VPC → VPC 생성

설정값:
  VPC 이름:     safesync-vpc
  IP 주소 범위:  10.0.0.0/16
```

**[생성] 클릭 → 상태가 "운영중"이 될 때까지 대기 (약 30초)**

### 1-2. 서브넷 생성 (2개)

```
VPC → Subnet → Subnet 생성

── Public Subnet (WAS 서버용) ──
  서브넷 이름:  safesync-public-subnet
  VPC:         safesync-vpc
  IP 주소 범위: 10.0.1.0/24
  인터넷 게이트웨이 전용 여부: Y (Public)
  Zone:        KR-1 (첫 번째 가용영역)

── Private Subnet (DB용, 선택사항) ──
  서브넷 이름:  safesync-private-subnet
  VPC:         safesync-vpc
  IP 주소 범위: 10.0.2.0/24
  인터넷 게이트웨이 전용 여부: N (Private)
  Zone:        KR-1
```

> ⚠️ Cloud DB는 VPC 환경에서 별도 관리되므로 Private Subnet은 선택사항입니다.
> 실습 시간이 부족하면 Public Subnet만 생성해도 됩니다.

### 1-3. 인터넷 게이트웨이 연결 확인

```
VPC → Internet Gateway → 생성 여부 확인
→ 없으면 생성 후 safesync-vpc에 연결
```

---

## 🔢 Step 2. ACG (접근 제어 그룹, 보안그룹) 설정

> 📖 참고: Lab2.서버생성 실습 자료 (보안그룹 섹션)

### 2-1. WAS 서버용 ACG 생성

```
Compute → ACG → ACG 생성

  ACG 이름: safesync-was-acg
  VPC:      safesync-vpc
```

**인바운드 규칙 추가:**

| 프로토콜 | 접근 소스 | 포트 | 설명 |
|---------|----------|------|------|
| TCP | 0.0.0.0/0 | 22 | SSH 접속 |
| TCP | 0.0.0.0/0 | 80 | HTTP |
| TCP | 0.0.0.0/0 | 443 | HTTPS |
| TCP | 0.0.0.0/0 | 8000 | FastAPI 앱 |

> 💡 SSH 포트(22)는 보안을 위해 본인 IP만 허용하는 것이 좋습니다.
> (접근 소스에 내 공인 IP/32 입력)

### 2-2. DB용 ACG 생성

```
ACG 이름: safesync-db-acg
VPC:      safesync-vpc
```

**인바운드 규칙 추가:**

| 프로토콜 | 접근 소스 | 포트 | 설명 |
|---------|----------|------|------|
| TCP | 10.0.1.0/24 | 3306 | WAS 서버에서 DB 접근 |
| TCP | [AWS RDS 공인 IP]/32 | 3306 | AWS Slave DB Replication |

> ⚠️ AWS RDS 공인 IP는 Step 4(AWS 구축) 후 추가로 등록합니다.
> 지금은 WAS 서브넷(10.0.1.0/24)만 허용하고, 나중에 추가하세요.

---

## 🔢 Step 3. 서버 생성 (2대)

> 📖 참고: Lab2.서버생성 실습 자료

### 3-1. WAS 서버 #1 생성

```
Compute → Server → 서버 생성

── 서버 이미지 선택 ──
  OS: ubuntu-22.04-base (Ubuntu 22.04 LTS)

── 서버 설정 ──
  VPC:      safesync-vpc
  Subnet:   safesync-public-subnet
  서버 타입:  Standard / s2.g2 (vCPU 2, RAM 4GB) 권장
             ※ 예산 부족 시 s1.g1 (vCPU 1, RAM 1GB)도 가능
  서버 이름:  safesync-was-01
  서버 대수:  1 (두 번째 서버는 별도 생성)

── 인증키 설정 ──
  새 인증키 생성: safesync-key
  → .pem 파일 다운로드 (절대 분실 금지!)

── 네트워크 접근 설정 ──
  ACG: safesync-was-acg 선택

[최종 확인] → [생성]
```

**서버 상태가 "운영중"이 될 때까지 대기 (약 2~3분)**

### 3-2. WAS 서버 #2 생성

같은 방법으로 두 번째 서버 생성:
```
서버 이름: safesync-was-02
나머지 설정은 #1과 동일
(인증키는 같은 safesync-key 사용)
```

### 3-3. 공인 IP 할당

두 서버 모두에 공인 IP를 할당합니다:

```
Server 목록에서 safesync-was-01 선택
→ [서버 관리 및 설정 변경] → [공인 IP 설정]
→ [공인 IP 신청 및 할당]

safesync-was-02도 동일하게 진행
```

> 📌 할당된 공인 IP를 메모해 두세요! (이후 SSH 접속 및 AWS 연동에 필요)
> ```
> WAS-01 공인 IP: ___________________
> WAS-02 공인 IP: ___________________
> ```

### 3-4. 서버 SSH 접속 확인

**Windows에서 접속 (PowerShell 또는 PuTTY):**
```powershell
# PowerShell (Windows 10 이상)
ssh -i safesync-key.pem root@[WAS-01 공인 IP]

# 처음 접속 시 yes 입력
# .pem 파일 권한 오류 발생 시:
icacls safesync-key.pem /inheritance:r /grant:r "%USERNAME%:R"
```

접속 성공하면:
```
Welcome to Ubuntu 22.04.x LTS
root@safesync-was-01:~#
```

---

## 🔢 Step 4. Docker 설치 및 백엔드 배포

> 📖 참고: 2과목_3-1_Docker개요, 2과목_5-1_Docker실습

**WAS-01, WAS-02 서버 모두에서 동일하게 실행:**

### 4-1. Docker 설치

```bash
# 서버에 SSH 접속 후 실행

# 패키지 업데이트
apt-get update && apt-get upgrade -y

# Docker 설치 스크립트 실행
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Docker 서비스 시작 및 부팅 시 자동 시작
systemctl start docker
systemctl enable docker

# 설치 확인
docker --version
# 출력 예: Docker version 24.x.x, build ...
```

### 4-2. .env 파일 생성

```bash
# 앱 디렉토리 생성
mkdir -p /app/safesync
cd /app/safesync

# .env 파일 생성 (아래 값을 실제 값으로 변경)
cat > .env << 'EOF'
APP_ENV=production
DB_HOST=[Cloud DB 공인 IP 또는 내부 IP]
DB_PORT=3306
DB_NAME=safesync
DB_USER=safesync_user
DB_PASSWORD=SafeSync2024!
CLOVA_STUDIO_API_KEY=[Step 9에서 발급]
CLOVA_STUDIO_REQUEST_ID=[Step 9에서 발급]
JWT_SECRET_KEY=safesync-jwt-secret-key-2024-production
ADMIN_ID=admin
ADMIN_PASSWORD=safesync2024
CLOUD_PROVIDER=NCP
CLOUD_REGION=KR-1
CORS_ORIGINS=http://[LB 도메인],http://[WAS-01 공인 IP],http://[WAS-02 공인 IP]
EOF
```

### 4-3. 백엔드 코드 서버에 전송

**로컬 PC에서 실행 (PowerShell):**
```powershell
# backend 폴더를 서버로 전송
scp -i safesync-key.pem -r "c:\Users\rbtjd\OneDrive\Desktop\네이버 클라우드 [매치업]\2과목\2과목 자료\SafeSync\backend\*" root@[WAS-01 공인 IP]:/app/safesync/

# 프론트엔드도 전송
scp -i safesync-key.pem "c:\Users\rbtjd\OneDrive\Desktop\네이버 클라우드 [매치업]\2과목\2과목 자료\SafeSync\index.html" root@[WAS-01 공인 IP]:/app/safesync/
scp -i safesync-key.pem "c:\Users\rbtjd\OneDrive\Desktop\네이버 클라우드 [매치업]\2과목\2과목 자료\SafeSync\style.css" root@[WAS-01 공인 IP]:/app/safesync/
scp -i safesync-key.pem "c:\Users\rbtjd\OneDrive\Desktop\네이버 클라우드 [매치업]\2과목\2과목 자료\SafeSync\app.js" root@[WAS-01 공인 IP]:/app/safesync/
scp -i safesync-key.pem "c:\Users\rbtjd\OneDrive\Desktop\네이버 클라우드 [매치업]\2과목\2과목 자료\SafeSync\nginx.conf" root@[WAS-01 공인 IP]:/app/safesync/
```

### 4-4. Docker 이미지 빌드 및 실행

**서버(WAS-01)에서 실행:**
```bash
cd /app/safesync

# Docker 이미지 빌드
docker build -t safesync-backend:v1.0 .

# 이미지 확인
docker images
# safesync-backend   v1.0   ...

# 백엔드 컨테이너 실행
docker run -d \
  --name safesync-app \
  --restart always \
  -p 8000:8000 \
  --env-file .env \
  safesync-backend:v1.0

# 실행 확인
docker ps
# CONTAINER ID   IMAGE                    STATUS   PORTS
# xxxxxxxxxxxx   safesync-backend:v1.0   Up...    0.0.0.0:8000->8000/tcp

# 로그 확인
docker logs safesync-app
# ✅ SafeSync API 시작 — 클라우드: NCP (KR-1)
# 📖 API 문서: http://localhost:8000/docs
```

### 4-5. Nginx 컨테이너 실행 (정적 파일 서빙)

```bash
# Nginx 컨테이너 실행
docker run -d \
  --name safesync-nginx \
  --restart always \
  -p 80:80 \
  -v /app/safesync/index.html:/usr/share/nginx/html/index.html \
  -v /app/safesync/style.css:/usr/share/nginx/html/style.css \
  -v /app/safesync/app.js:/usr/share/nginx/html/app.js \
  -v /app/safesync/nginx.conf:/etc/nginx/conf.d/default.conf \
  nginx:alpine

# 두 컨테이너 모두 실행 중인지 확인
docker ps
# safesync-nginx    Up ... 0.0.0.0:80->80/tcp
# safesync-app      Up ... 0.0.0.0:8000->8000/tcp
```

### 4-6. 동작 확인

```bash
# 로컬에서 확인
curl http://localhost:8000/health
# {"status":"ok","cloud":"NCP","region":"KR-1",...}

curl http://localhost:80
# HTML 응답 확인
```

**브라우저에서 확인:**
```
http://[WAS-01 공인 IP]      → 웹 화면
http://[WAS-01 공인 IP]:8000/docs  → Swagger UI
```

**WAS-02도 동일하게 Step 4-2 ~ 4-6 반복 실행**

---

## 🔢 Step 5. Cloud DB (MySQL Master) 생성

> 📖 참고: Lab7.Cloud DB 실습 자료

### 5-1. Cloud DB for MySQL 생성

```
NCP 콘솔 → Database → Cloud DB for MySQL → DB 인스턴스 생성

── DB 엔진 설정 ──
  DB 엔진 버전: MySQL 8.0
  고가용성 지원: 미사용 (실습 환경, 비용 절감)
               ※ 실제 운영에서는 사용 권장

── DB 인스턴스 설정 ──
  DB 인스턴스 이름: safesync-db-master
  DB 인스턴스 타입: db.t2.s1-g2 (최소 사양, 실습용)
  데이터 스토리지: HDD 10GB

── DB 설정 ──
  DB 이름 (Database): safesync
  USER 이름: safesync_user
  HOST(IP): %  (모든 IP 허용, 보안그룹으로 제어)
  비밀번호: SafeSync2024!
  (비밀번호 조건: 영문 대소문자 + 숫자 + 특수문자 조합)

── 접근 제어 설정 ──
  VPC: safesync-vpc
  Subnet: safesync-public-subnet (또는 private-subnet)

[생성] 클릭
```

> ⏱️ DB 생성 완료까지 약 5~10분 소요. 상태가 "running"이 될 때까지 대기.

### 5-2. DB 접속 정보 확인

```
Cloud DB 목록에서 safesync-db-master 클릭
→ DB 접속 정보 확인

  Private IP: 10.0.x.x       (VPC 내부 접속용)
  Public IP:  xxx.xxx.xxx.xxx (외부 접속용 — AWS Replication에 사용!)
  Port:       3306

📌 반드시 메모:
  DB Public IP:  ___________________
  DB Private IP: ___________________
```

### 5-3. DB ACG에 WAS 서버 IP 등록 확인

```
ACG → safesync-db-acg → 인바운드 규칙 확인
→ 10.0.1.0/24 (WAS 서브넷) → 3306 등록되어 있는지 확인
→ 없으면 추가
```

---

## 🔢 Step 6. 데이터베이스 초기화

### 6-1. WAS 서버에서 MySQL 클라이언트로 DB 접속

```bash
# WAS-01 서버에서 실행
# MySQL 클라이언트 설치
apt-get install -y mysql-client

# DB 접속 (Private IP 사용 권장)
mysql -h [DB Private IP] -P 3306 -u safesync_user -p
# 비밀번호: SafeSync2024!
```

### 6-2. 스키마 초기화 SQL 실행

```sql
-- DB 선택
USE safesync;

-- 재난 테이블
CREATE TABLE IF NOT EXISTS disasters (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    type        ENUM('FIRE','FLOOD','EARTHQUAKE','CHEMICAL','TYPHOON','OTHER') NOT NULL,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    region      VARCHAR(100) NOT NULL,
    latitude    DECIMAL(10,7),
    longitude   DECIMAL(10,7),
    severity    ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    status      ENUM('ACTIVE','RESOLVED') NOT NULL DEFAULT 'ACTIVE',
    reported_by VARCHAR(100),
    ai_guide    TEXT,
    created_at  DATETIME DEFAULT NOW(),
    updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_status   (status),
    INDEX idx_severity (severity),
    INDEX idx_region   (region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 대피소 테이블
CREATE TABLE IF NOT EXISTS shelters (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    address     VARCHAR(300) NOT NULL,
    region      VARCHAR(100) NOT NULL,
    latitude    DECIMAL(10,7),
    longitude   DECIMAL(10,7),
    capacity    INT NOT NULL DEFAULT 0,
    current_cnt INT NOT NULL DEFAULT 0,
    status      ENUM('OPEN','FULL','CLOSED') NOT NULL DEFAULT 'OPEN',
    contact     VARCHAR(50),
    created_at  DATETIME DEFAULT NOW(),
    updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 구독자 테이블
CREATE TABLE IF NOT EXISTS subscribers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(200) NOT NULL UNIQUE,
    region      VARCHAR(200) NOT NULL,
    severity    ENUM('ALL','HIGH','CRITICAL') NOT NULL DEFAULT 'ALL',
    is_active   TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 시스템 로그 테이블
CREATE TABLE IF NOT EXISTS system_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    level       ENUM('INFO','WARN','ERROR','ACTION') DEFAULT 'INFO',
    message     TEXT NOT NULL,
    cloud       VARCHAR(20),
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 테이블 생성 확인
SHOW TABLES;
-- disasters / shelters / subscribers / system_logs
```

> 💡 FastAPI 앱이 시작될 때 `init_db()`가 자동으로 테이블을 생성하고
> 샘플 데이터를 삽입합니다. 위 SQL은 수동 확인용입니다.

### 6-3. DB Replication을 위한 Master 설정

```sql
-- Replication 전용 계정 생성 (AWS Slave가 접속할 계정)
CREATE USER 'repl_user'@'%' IDENTIFIED BY 'ReplPass2024!';
GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';
FLUSH PRIVILEGES;

-- Master 바이너리 로그 상태 확인 (AWS 설정 시 필요)
SHOW MASTER STATUS;
```

**결과 메모 (AWS 구축 시 필수):**
```
File:     ___________________  (예: mysql-bin.000001)
Position: ___________________  (예: 154)
```

### 6-4. my.cnf 바이너리 로그 활성화 확인

> Cloud DB는 기본적으로 바이너리 로그가 활성화되어 있습니다.
> 만약 SHOW MASTER STATUS 결과가 비어 있다면:

```
NCP 콘솔 → Cloud DB → DB 옵션 그룹 설정
→ binlog_format = ROW
→ log_bin = ON
→ server-id = 1
```

---

## 🔢 Step 7. Load Balancer 설정

> 📖 참고: Lab4.로드밸런서 실습 자료

### 7-1. Load Balancer 생성

```
NCP 콘솔 → Networking → Load Balancer → Load Balancer 생성

── 로드밸런서 설정 ──
  로드밸런서 이름: safesync-lb
  유형: Application Load Balancer
  네트워크: PUBLIC (인터넷 연결)
  VPC: safesync-vpc
  Subnet: safesync-public-subnet

── 리스너 설정 ──
  프로토콜: HTTP
  포트: 80
  → 규칙 추가:
    기본 액션: Forward to → Target Group (아래에서 생성)
```

### 7-2. Target Group 생성

```
── Target Group 설정 ──
  Target Group 이름: safesync-tg
  Target 유형: Instance
  프로토콜: HTTP
  포트: 80
  VPC: safesync-vpc

── Health Check 설정 ──
  프로토콜: HTTP
  포트: 8000
  경로: /health            ← 매우 중요! Route 53도 이 경로 사용
  정상 임계값: 3
  비정상 임계값: 3
  타임아웃: 5초
  간격: 10초

── Target 등록 ──
  safesync-was-01 → 포트 80 → [Add to registered]
  safesync-was-02 → 포트 80 → [Add to registered]
```

### 7-3. Load Balancer DNS 확인

```
Load Balancer 목록 → safesync-lb 클릭
→ DNS 이름: safesync-lb-xxxx.kr.lb.naverncp.com

📌 메모:
  LB DNS: ___________________
  LB IP:  ___________________ (선택적, 고정 IP는 별도 신청)
```

### 7-4. 동작 확인

```bash
# 브라우저 또는 curl로 확인
curl http://[LB DNS 이름]
# HTML 또는 {"status":"ok",...} 응답 확인

curl http://[LB DNS 이름]/api/health
# {"status":"ok","cloud":"NCP",...}
```

> ⚠️ Health Check 상태가 Healthy가 될 때까지 약 30초 소요됩니다.
> 처음에는 "Unknown" → "Healthy" 순서로 변경됩니다.

---

## 🔢 Step 8. Auto Scaling 설정

> 📖 참고: Lab5.오토스케일링 실습 자료

### 8-1. Launch Configuration (시작 설정) 생성

```
Auto Scaling → Launch Configuration → 생성

  이름: safesync-launch-config
  서버 이미지: ubuntu-22.04-base
  서버 타입: s2.g2 (WAS 서버와 동일)
  인증키: safesync-key
  ACG: safesync-was-acg

  ── 사용자 데이터 (User Data) 입력 ──
  [아래 스크립트 입력 — 새 서버 생성 시 자동으로 Docker 설치 + 앱 실행]
```

**User Data 스크립트:**
```bash
#!/bin/bash
# SafeSync 자동 배포 스크립트

# Docker 설치
apt-get update -y
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl start docker
systemctl enable docker

# 앱 디렉토리 생성
mkdir -p /app/safesync
cd /app/safesync

# .env 파일 생성
cat > .env << 'ENVEOF'
APP_ENV=production
DB_HOST=[Cloud DB Private IP]
DB_PORT=3306
DB_NAME=safesync
DB_USER=safesync_user
DB_PASSWORD=SafeSync2024!
CLOUD_PROVIDER=NCP
CLOUD_REGION=KR-1
JWT_SECRET_KEY=safesync-jwt-secret-key-2024-production
ADMIN_ID=admin
ADMIN_PASSWORD=safesync2024
CLOVA_STUDIO_API_KEY=[실제 API Key]
ENVEOF

# Docker Hub 또는 NCP Container Registry에서 이미지 풀
# (실습에서는 미리 빌드한 이미지 사용)
docker pull [이미지 레지스트리]/safesync-backend:v1.0
docker run -d --name safesync-app --restart always \
  -p 8000:8000 --env-file .env \
  [이미지 레지스트리]/safesync-backend:v1.0
```

> 💡 이미지를 직접 빌드할 경우, NCP Container Registry를 사용하거나
> 소스 코드를 git clone 후 서버에서 빌드하는 방식을 사용합니다.

### 8-2. Auto Scaling Group 생성

```
Auto Scaling → Auto Scaling Group → 생성

  이름: safesync-asg
  Launch Configuration: safesync-launch-config
  VPC: safesync-vpc
  Subnet: safesync-public-subnet

  ── 스케일링 설정 ──
  최소 서버 수: 2 (항상 2대 유지 — DR 기본 구성)
  최대 서버 수: 5
  기본 서버 수: 2

  ── Health Check ──
  Health Check 유예 기간: 120초 (앱 시작 시간 고려)
  Load Balancer: safesync-lb / safesync-tg 연결
```

### 8-3. 스케일링 정책 추가

```
Auto Scaling Group → safesync-asg → 스케일링 정책 추가

── Scale Out (증설) ──
  이름: safesync-scale-out
  조건: CPU 사용률 > 70% (3분간 연속)
  조치: 서버 1대 추가
  쿨다운: 300초 (5분)

── Scale In (축소) ──
  이름: safesync-scale-in
  조건: CPU 사용률 < 30% (10분간 연속)
  조치: 서버 1대 제거
  쿨다운: 300초
```

---

## 🔢 Step 9. CLOVA Studio API Key 발급

> 📖 참고: Lab8.CLOVA Studio 실습 자료

### 9-1. CLOVA Studio 접속

```
NCP 콘솔 → AI·NAVER API → CLOVA Studio → 신청/이용하기
→ 약관 동의 후 서비스 활성화
```

### 9-2. 테스트 앱 생성

```
CLOVA Studio → 스튜디오 → 내 프로젝트 → 새 프로젝트

  프로젝트 이름: safesync-disaster-guide
  모델: HyperCLOVA X (HCX-003) 선택
  프롬프트 설정:
    시스템 메시지:
      "당신은 국가 재난안전 전문가입니다.
       사용자가 설명하는 재난 상황을 분석하고,
       즉시 실행 가능한 행동 요령을 5~7단계로 명확하게 제시하세요."

→ [API 연동] 탭 → API Key 확인
```

### 9-3. API Key 발급

```
CLOVA Studio → API 게이트웨이 → API Key 발급

📌 메모 (백엔드 .env에 입력):
  CLOVA_STUDIO_API_KEY:    _____________________
  CLOVA_STUDIO_REQUEST_ID: _____________________
```

### 9-4. 서버의 .env 파일 업데이트

```bash
# WAS-01, WAS-02 서버에서 실행
cd /app/safesync

# .env 파일의 CLOVA 키 업데이트
nano .env
# CLOVA_STUDIO_API_KEY=[발급받은 키]
# CLOVA_STUDIO_REQUEST_ID=[발급받은 요청 ID]

# 컨테이너 재시작
docker restart safesync-app

# 동작 확인
curl -X POST http://localhost:8000/ai/guide \
  -H "Content-Type: application/json" \
  -d '{"situation": "건물에 화재가 발생했어요"}'
# {"steps":["즉시 화재경보기를...", ...], "model": "HCX-003", ...}
```

---

## 🔢 Step 10. 모니터링 설정

> 📖 참고: Lab9.모니터링, Lab10.CLA를 통한 로그 수집 실습 자료

### 10-1. Cloud Monitoring 대시보드 설정

```
NCP 콘솔 → Management & Governance → Cloud Monitoring → 대시보드

── 모니터링 항목 추가 ──
  서버: safesync-was-01, safesync-was-02
  항목:
    ✅ CPU 사용률
    ✅ 메모리 사용률
    ✅ 디스크 사용률
    ✅ 네트워크 IN/OUT
```

### 10-2. 알람 설정

```
Cloud Monitoring → 알람 → 알람 생성

  알람 이름: safesync-cpu-alert
  서버: safesync-was-01, safesync-was-02
  
  조건:
    CPU 사용률 > 80% (5분간)
  
  알람 수신:
    이메일: [팀원 이메일]
```

### 10-3. CLA (Cloud Log Analytics) 로그 수집

```
Management → Cloud Log Analytics → 에이전트 설치

── WAS 서버에서 에이전트 설치 (Lab10 참고) ──
  수집 로그:
    /var/log/nginx/access.log
    /var/log/nginx/error.log
    Docker 컨테이너 로그: safesync-app
```

---

## ✅ 최종 확인 체크리스트

### 인프라 구축 완료 확인

```
□ VPC (safesync-vpc) 생성 완료
□ Public Subnet (10.0.1.0/24) 생성 완료
□ ACG 2개 (WAS용, DB용) 생성 완료
□ 서버 2대 (WAS-01, WAS-02) 생성 및 공인 IP 할당
□ 두 서버 모두 SSH 접속 성공
□ Docker 설치 완료
□ safesync-app 컨테이너 실행 중 (docker ps 확인)
□ safesync-nginx 컨테이너 실행 중
□ Cloud DB MySQL 생성 완료 (running 상태)
□ schema.sql 실행 완료 (테이블 4개 생성)
□ Replication 계정 생성 완료 (repl_user)
□ SHOW MASTER STATUS 결과 메모 완료
□ Load Balancer 생성 완료
□ Target Group에 WAS-01, WAS-02 등록 완료
□ Health Check Healthy 상태 확인
□ Auto Scaling Group 생성 완료 (최소 2대)
□ CLOVA Studio API Key 발급 완료
□ .env에 CLOVA Key 입력 후 컨테이너 재시작
□ POST /ai/guide 테스트 성공
□ Cloud Monitoring 대시보드 설정 완료
```

### 서비스 동작 확인

```bash
# 1. WAS 직접 접속
curl http://[WAS-01 공인 IP]/          # 웹 화면 HTML 응답
curl http://[WAS-01 공인 IP]:8000/health  # {"status":"ok","cloud":"NCP"}

# 2. Load Balancer를 통한 접속
curl http://[LB DNS]/                  # 웹 화면
curl http://[LB DNS]/api/health        # {"cloud":"NCP","status":"ok"}

# 3. API 동작 확인
curl http://[LB DNS]/api/disasters     # 재난 목록 JSON

# 4. AI 행동 요령 생성
curl -X POST http://[LB DNS]/api/ai/guide \
  -H "Content-Type: application/json" \
  -d '{"situation":"아파트에 가스 누출이 발생했어요"}'
```

---

## 🔧 문제 해결 가이드

### 문제 1: 서버 SSH 접속 불가
```bash
# 원인 1: ACG에 SSH(22) 포트가 열려있지 않음
→ ACG → safesync-was-acg → 인바운드 규칙 → TCP 22 추가

# 원인 2: 공인 IP 미할당
→ 서버 → [서버 관리] → [공인 IP 설정] → 신청

# 원인 3: .pem 파일 권한 오류 (Windows)
icacls safesync-key.pem /inheritance:r /grant:r "%USERNAME%:R"
```

### 문제 2: Docker 컨테이너가 시작되지 않음
```bash
# 로그 확인
docker logs safesync-app

# DB 연결 실패인 경우:
# → .env의 DB_HOST 확인 (Private IP 또는 공인 IP)
# → ACG에서 DB 포트(3306) 허용 확인
# → MySQL 계정/비밀번호 확인

# 포트 충돌인 경우:
netstat -tlnp | grep 8000
# 이미 사용 중이면: docker stop [컨테이너명] 후 재실행
```

### 문제 3: Load Balancer Health Check 실패
```bash
# 직접 Health Check 경로 테스트
curl http://[서버 IP]:8000/health
# 응답이 없으면 FastAPI 앱 미실행 상태

# 응답이 있는데 LB Health Check 실패하면:
# → Target Group의 Health Check 포트/경로 확인
# → ACG에서 LB의 IP 대역 허용 여부 확인
```

### 문제 4: DB Replication이 안 됨
```sql
-- Slave 상태 확인
SHOW SLAVE STATUS\G

-- 에러 메시지 확인:
-- Last_IO_Error: error connecting to master  → 네트워크/ACG 문제
-- Last_SQL_Error: ...                        → 데이터 불일치 문제

-- 재시작 시도
STOP SLAVE;
RESET SLAVE;
-- CHANGE MASTER TO 다시 실행
START SLAVE;
```

### 문제 5: CLOVA Studio API 호출 실패
```bash
# API Key 확인
curl -X POST https://clovastudio.stream.ntruss.com/testapp/v1/chat-completions/HCX-003 \
  -H "X-NCP-CLOVASTUDIO-API-KEY: [API_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"안녕"}],"maxTokens":50}'

# 실패 시: API Key가 만료되었거나 요청 ID가 잘못된 경우
# → NCP 콘솔에서 API Key 재발급
```

---

## 📌 다음 단계: AWS DR 환경 구축

NCP 구축이 완료되면 다음 정보를 준비하세요:

```
NCP 구축 결과 정리:
  LB DNS/IP:         ___________________
  WAS-01 공인 IP:    ___________________
  WAS-02 공인 IP:    ___________________
  DB 공인 IP:        ___________________
  DB Master 로그:    File=___________ Position=___
  Replication 계정:  repl_user / ReplPass2024!
```

이 정보를 바탕으로 **AWS VPC, EC2, ALB, RDS(Slave) 구축** 및
**Route 53 Failover DNS 설정**을 진행합니다.

---

> 📋 이 가이드는 건양대학교 매치업 과정 실습 자료
> (Lab1~Lab10)를 기반으로 SafeSync 프로젝트에 맞게 작성되었습니다.
> 실습 환경에 따라 일부 설정값이 달라질 수 있습니다.
