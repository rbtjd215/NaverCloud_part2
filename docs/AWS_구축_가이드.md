# ☁️ AWS DR (재해복구) 인프라 구축 가이드
## SafeSync — 국가 재난·응급 알림 포털 (Secondary 클라우드)

> **팀원 B 전용 가이드**
> NCP 구축 가이드와 동일한 수준의 단계별 상세 매뉴얼

---

## 📋 구축 목표 아키텍처

```
[인터넷]
    │
[Route 53] ← Health Check: NCP 정상 → NCP로, NCP 장애 → AWS로
    │
[AWS ALB (Application Load Balancer)] ← Health Check: GET /health
    │
    ├── [EC2 WAS 서버 #1] (Ubuntu 22.04 + Docker) ap-northeast-2a
    └── [EC2 WAS 서버 #2] (Ubuntu 22.04 + Docker) ap-northeast-2c
             │
        [Auto Scaling Group]
             │
    [AWS RDS for MySQL 8.0] ← Slave DB (NCP 장애 시 Master 승격)
             │
    (◄── NCP Cloud DB Master에서 Binary Log Replication)
```

---

## 🔢 Step 0. 사전 준비

### 0-1. NCP에서 받아야 할 정보 확인

**팀원 A(NCP 담당)의 작업이 완료되어야 Step 5(DB Replication)를 진행할 수 있습니다.**
아래 표를 미리 준비해 두세요:

```
□ NCP Cloud DB 공인 IP:      ___________________
□ NCP Cloud DB 내부 IP:      ___________________
□ Master 로그 File명:        ___________________  (예: mysql-bin.000001)
□ Master 로그 Position:      ___________________  (예: 154)
□ Replication 계정/비번:     repl_user / ReplPass2024!
□ CLOVA_STUDIO_API_KEY:      ___________________  (팀장에게 확인)
```

### 0-2. AWS 콘솔 로그인

```
접속: https://aws.amazon.com/ko/console/
→ [콘솔에 로그인] 클릭
→ 루트 사용자 또는 IAM 사용자 이메일/비밀번호 입력
```

### 0-3. 리전(Region) 확인

```
우측 상단 리전 드롭다운 → 서울 (ap-northeast-2) 선택
→ NCP와 같은 국내 리전이므로 Replication 지연 최소화
```

> ⚠️ **매우 중요**: 리전이 서울(ap-northeast-2)인지 항상 확인하고 작업하세요.
> 실수로 미국(us-east-1) 등에서 작업하면 Replication 지연이 심각해집니다.

### 0-4. 전체 구축 순서 확인

```
VPC 생성 → 보안 그룹 설정 → EC2 2대 생성 → Docker + 앱 배포
→ RDS 생성 → DB Replication 연결 → ALB 생성 → Auto Scaling
→ Route 53 Failover DNS 설정
```

> ⏱️ 예상 소요 시간: 총 3~4시간 (처음 진행 시)

---

## 🔢 Step 1. VPC 및 서브넷 생성

### 1-1. VPC 생성

```
AWS 콘솔 상단 검색창 → "VPC" 검색 → VPC 서비스 클릭
→ 왼쪽 메뉴 [VPC] → 우상단 [VPC 생성] 클릭

── 설정값 ──
  생성할 리소스:   VPC만
  이름 태그:       safesync-aws-vpc
  IPv4 CIDR:      10.1.0.0/16     ← NCP(10.0.0.0/16)와 다른 대역 사용!
  IPv6 CIDR:      없음
  테넌시:          기본값

→ [VPC 생성] 클릭
```

> 📌 생성 직후 VPC ID(vpc-xxxxxxxx)를 메모하세요.

### 1-2. 서브넷 생성 (2개 — 다른 가용영역에 1개씩)

ALB 사용을 위해 **반드시 2개의 가용영역(AZ)에 서브넷**이 있어야 합니다.

```
VPC 콘솔 → 왼쪽 메뉴 [서브넷] → [서브넷 생성] 클릭

── 서브넷 1 (AZ-2a) ──
  VPC ID:           방금 생성한 safesync-aws-vpc
  서브넷 이름:       safesync-public-2a
  가용 영역:         ap-northeast-2a
  IPv4 CIDR:        10.1.1.0/24

── 서브넷 2 (AZ-2c) ──  (같은 페이지에서 [새 서브넷 추가] 클릭 후 추가)
  서브넷 이름:       safesync-public-2c
  가용 영역:         ap-northeast-2c
  IPv4 CIDR:        10.1.2.0/24

→ [서브넷 생성] 클릭
```

**서브넷 퍼블릭 IP 자동 할당 활성화 (2개 모두):**
```
서브넷 목록에서 safesync-public-2a 선택
→ [작업] → [서브넷 설정 편집] 클릭
→ "퍼블릭 IPv4 주소 자동 할당 활성화" 체크박스 ✅ 선택
→ [저장] 클릭

safesync-public-2c도 동일하게 반복
```

### 1-3. 인터넷 게이트웨이(IGW) 생성 및 연결

```
VPC 콘솔 → 왼쪽 메뉴 [인터넷 게이트웨이] → [인터넷 게이트웨이 생성]

  이름 태그: safesync-igw

→ [인터넷 게이트웨이 생성] 클릭
→ 생성 직후 상단 팝업에서 [VPC에 연결] 클릭
→ safesync-aws-vpc 선택 → [인터넷 게이트웨이 연결] 클릭
```

### 1-4. 라우팅 테이블 설정

```
VPC 콘솔 → 왼쪽 메뉴 [라우팅 테이블]
→ safesync-aws-vpc에 연결된 메인 라우팅 테이블 선택
→ 하단 [라우팅] 탭 → [라우팅 편집] 클릭

  [라우팅 추가]:
    대상:   0.0.0.0/0
    대상:   safesync-igw (인터넷 게이트웨이 선택)

→ [변경 사항 저장]

→ [서브넷 연결] 탭 → [서브넷 연결 편집] 클릭
  safesync-public-2a ✅
  safesync-public-2c ✅
→ [연결 저장]
```

---

## 🔢 Step 2. 보안 그룹(Security Group) 설정

### 2-1. WAS 서버용 보안 그룹 생성

```
EC2 콘솔 검색창에 "EC2" 입력 → EC2 서비스 클릭
→ 왼쪽 메뉴 [보안 그룹] → [보안 그룹 생성] 클릭

  보안 그룹 이름:  safesync-aws-was-sg
  설명:           SafeSync WAS Server Security Group
  VPC:            safesync-aws-vpc
```

**인바운드 규칙 추가:**

| 유형 | 프로토콜 | 포트 범위 | 소스 | 설명 |
|------|---------|----------|------|------|
| SSH | TCP | 22 | 내 IP (자동 감지) | SSH 원격 접속용 |
| HTTP | TCP | 80 | 0.0.0.0/0 | 웹 트래픽 |
| HTTPS | TCP | 443 | 0.0.0.0/0 | 보안 웹 트래픽 |
| 사용자 지정 TCP | TCP | 8000 | 0.0.0.0/0 | FastAPI 앱 포트 |

```
→ [보안 그룹 생성] 클릭
```

> 💡 SSH 포트(22)는 "내 IP"를 선택하면 현재 내 공인 IP가 자동으로 입력됩니다.

### 2-2. DB용 보안 그룹 생성

```
[보안 그룹 생성] 클릭

  보안 그룹 이름:  safesync-aws-db-sg
  설명:           SafeSync RDS Security Group
  VPC:            safesync-aws-vpc
```

**인바운드 규칙 추가:**

| 유형 | 프로토콜 | 포트 범위 | 소스 | 설명 |
|------|---------|----------|------|------|
| MySQL/Aurora | TCP | 3306 | safesync-aws-was-sg | EC2에서 DB 접근 |
| MySQL/Aurora | TCP | 3306 | [NCP DB 공인 IP]/32 | NCP→AWS Replication 허용 |

> ⚠️ 소스에 보안 그룹 ID를 넣으려면 드롭다운에서 "사용자 지정"을 선택 후
> safesync-aws-was-sg를 검색하여 선택합니다.
> NCP DB IP는 Step 0에서 메모한 값을 입력하세요.

```
→ [보안 그룹 생성] 클릭
```

---

## 🔢 Step 3. EC2 인스턴스 생성 (2대)

### 3-1. EC2 인스턴스 #1 생성

```
EC2 콘솔 → 왼쪽 메뉴 [인스턴스] → [인스턴스 시작] 클릭

── 이름 및 태그 ──
  이름:  safesync-aws-was-01

── 애플리케이션 및 OS 이미지(AMI) ──
  Ubuntu Server 22.04 LTS (HVM), SSD Volume Type
  아키텍처: 64비트(x86)

── 인스턴스 유형 ──
  t3.small  (vCPU 2, 메모리 2GB — 프리티어: t2.micro도 가능)

── 키 페어(로그인) ──
  [새 키 페어 생성] 클릭
    키 페어 이름:  safesync-aws-key
    키 페어 유형:  RSA
    프라이빗 키 파일 형식: .pem (OpenSSH용)
  → [키 페어 생성] → .pem 파일 자동 다운로드 (절대 분실 금지!)

── 네트워크 설정 ──
  [편집] 클릭
    VPC:                safesync-aws-vpc
    서브넷:              safesync-public-2a
    퍼블릭 IP 자동 할당:  활성화
    방화벽(보안 그룹):     기존 보안 그룹 선택 → safesync-aws-was-sg

── 스토리지 구성 ──
  루트 볼륨: 20 GiB, gp3 (기본값 유지)

→ [인스턴스 시작] 클릭
```

**인스턴스 상태가 "실행 중"이 될 때까지 대기 (약 1~2분)**

### 3-2. EC2 인스턴스 #2 생성

#1과 동일하게 진행하되 아래 항목만 변경:

```
  이름:    safesync-aws-was-02
  서브넷:   safesync-public-2c   ← 다른 가용영역(AZ)으로!
  키 페어:  safesync-aws-key (기존 키 재사용)
```

### 3-3. 공인(퍼블릭) IP 확인

```
인스턴스 목록에서 safesync-aws-was-01 클릭
→ 하단 [세부 정보] 탭 → "퍼블릭 IPv4 주소" 확인

📌 반드시 메모:
  EC2-01 공인 IP:  ___________________
  EC2-02 공인 IP:  ___________________
```

### 3-4. EC2 SSH 접속 확인

**Windows에서 접속 (PowerShell):**
```powershell
# .pem 파일 권한 설정 (최초 1회)
icacls safesync-aws-key.pem /inheritance:r /grant:r "%USERNAME%:R"

# SSH 접속
ssh -i safesync-aws-key.pem ubuntu@[EC2-01 공인 IP]

# 처음 접속 시 "Are you sure you want to continue connecting?" → yes 입력
```

> ⚠️ NCP는 기본 계정이 `root`이지만, AWS Ubuntu AMI는 기본 계정이 `ubuntu`입니다!

접속 성공 시:
```
Welcome to Ubuntu 22.04.x LTS ...
ubuntu@ip-10-1-1-xxx:~$
```

---

## 🔢 Step 4. Docker 설치 및 앱 배포

> **EC2-01, EC2-02 서버 모두에서 동일하게 실행**

### 4-1. Docker 설치

```bash
# SSH 접속 후 실행

# 패키지 업데이트
sudo apt-get update && sudo apt-get upgrade -y

# Docker 설치 스크립트 실행
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Docker 서비스 시작 및 부팅 시 자동 시작
sudo systemctl start docker
sudo systemctl enable docker

# ubuntu 계정에 Docker 권한 부여 (sudo 없이 사용 가능)
sudo usermod -aG docker ubuntu

# 로그아웃 후 재접속 (그룹 권한 적용)
exit
# 다시 SSH 접속

# 설치 확인
docker --version
# 출력 예: Docker version 24.x.x, build ...
```

### 4-2. GitHub에서 코드 클론

```bash
# 앱 디렉토리 생성
sudo mkdir -p /app/safesync
sudo chown ubuntu:ubuntu /app/safesync
cd /app/safesync

# 깃허브에서 코드 다운로드
git clone https://github.com/rbtjd215/NaverCloud_part2.git .

# 파일 목록 확인
ls -la
# index.html  style.css  app.js  nginx.conf  backend/  .gitignore
```

### 4-3. .env 파일 생성

```bash
cd /app/safesync

# .env 파일 생성 (아래 값을 실제 값으로 변경)
cat > .env << 'EOF'
APP_ENV=production
DB_HOST=[Step 5에서 생성할 RDS 엔드포인트]
DB_PORT=3306
DB_NAME=safesync
DB_USER=safesync_user
DB_PASSWORD=SafeSync2024!
CLOVA_STUDIO_API_KEY=[팀장에게 받은 API Key]
CLOVA_STUDIO_REQUEST_ID=[팀장에게 받은 Request ID]
JWT_SECRET_KEY=safesync-jwt-secret-key-2024-production
ADMIN_ID=admin
ADMIN_PASSWORD=safesync2024
CLOUD_PROVIDER=AWS
CLOUD_REGION=ap-northeast-2
CORS_ORIGINS=http://[ALB DNS],http://[EC2-01 공인 IP],http://[EC2-02 공인 IP]
EOF
```

> 💡 RDS 엔드포인트는 Step 5 완료 후 확인할 수 있습니다.
> 지금은 임시로 비워두거나, 나중에 `nano .env`로 수정합니다.

### 4-4. Docker 이미지 빌드

```bash
cd /app/safesync/backend

# Docker 이미지 빌드 (약 2~3분 소요)
docker build -t safesync-backend:v1.0 .

# 이미지 확인
docker images
# REPOSITORY          TAG    IMAGE ID   CREATED   SIZE
# safesync-backend    v1.0   xxxxxxxx   ...       ...
```

### 4-5. 백엔드 컨테이너 실행

```bash
cd /app/safesync

# 백엔드 컨테이너 실행
docker run -d \
  --name safesync-app \
  --restart always \
  -p 8000:8000 \
  --env-file .env \
  safesync-backend:v1.0

# 실행 확인
docker ps
# CONTAINER ID  IMAGE                   STATUS  PORTS
# xxxxxxxxxxxx  safesync-backend:v1.0   Up...   0.0.0.0:8000->8000/tcp

# 로그 확인 (DB 연결 오류 메시지가 나오는 건 RDS 설정 전이므로 정상)
docker logs safesync-app
```

### 4-6. Nginx 컨테이너 실행 (프론트엔드)

```bash
cd /app/safesync

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
# safesync-nginx   Up ... 0.0.0.0:80->80/tcp
# safesync-app     Up ... 0.0.0.0:8000->8000/tcp
```

### 4-7. 동작 확인

```bash
# 서버에서 직접 테스트
curl http://localhost:80
# HTML 응답 확인

curl http://localhost:8000/health
# {"status":"ok","cloud":"AWS","region":"ap-northeast-2",...}
```

**브라우저에서 확인:**
```
http://[EC2-01 공인 IP]        → 웹 화면 (SafeSync UI)
http://[EC2-01 공인 IP]:8000/docs → Swagger API 문서
```

**EC2-02도 Step 4-1 ~ 4-7 동일하게 반복 실행**

---

## 🔢 Step 5. RDS MySQL 생성 (Slave 용도)

### 5-1. DB 서브넷 그룹 생성

RDS 사용을 위해 서브넷 그룹이 먼저 필요합니다.

```
AWS 콘솔 검색창 → "RDS" → RDS 서비스 클릭
→ 왼쪽 메뉴 [서브넷 그룹] → [DB 서브넷 그룹 생성] 클릭

  이름:         safesync-db-subnet-group
  설명:         SafeSync RDS Subnet Group
  VPC:          safesync-aws-vpc

  [가용 영역 추가]:
    ap-northeast-2a → safesync-public-2a 선택
    ap-northeast-2c → safesync-public-2c 선택

→ [생성] 클릭
```

### 5-2. 파라미터 그룹 생성 (Slave 설정용)

Slave DB는 쓰기를 막고 `server-id`를 Master와 다르게 설정해야 합니다.

```
RDS 콘솔 → 왼쪽 메뉴 [파라미터 그룹] → [파라미터 그룹 생성] 클릭

  파라미터 그룹 패밀리:  mysql8.0
  유형:                DB Parameter Group
  그룹 이름:            safesync-slave-params
  설명:                SafeSync Slave Parameters

→ [생성] 클릭

── 파라미터 편집 ──
파라미터 그룹 목록에서 safesync-slave-params 클릭
→ [편집] 버튼 클릭

  server-id   →  2      (Master는 1, Slave는 2)
  read_only   →  1      (Slave이므로 쓰기 방지)
  log_bin     →  1      (나중에 Slave→Master 전환 시 필요)

→ [변경 사항 저장] 클릭
```

### 5-3. RDS 데이터베이스 생성

```
RDS 콘솔 → 왼쪽 메뉴 [데이터베이스] → [데이터베이스 생성] 클릭

── 데이터베이스 생성 방식 ──
  표준 생성

── 엔진 옵션 ──
  엔진 유형:      MySQL
  엔진 버전:      MySQL 8.0.x (최신 8.0 버전 선택)

── 템플릿 ──
  개발/테스트   (프리 티어: t2.micro / t3.micro만 허용됨)

── 설정 ──
  DB 인스턴스 식별자:  safesync-rds-slave
  마스터 사용자 이름:   safesync_user
  암호:               SafeSync2024!
  암호 확인:          SafeSync2024!

── 인스턴스 구성 ──
  DB 인스턴스 클래스:  db.t3.micro (프리티어) 또는 db.t3.small

── 스토리지 ──
  스토리지 유형:  gp2
  할당된 스토리지: 20 GiB
  스토리지 자동 조정 활성화: 해제 (실습용)

── 연결 ──
  VPC:                  safesync-aws-vpc
  DB 서브넷 그룹:          safesync-db-subnet-group
  퍼블릭 액세스:           예  ← NCP와 통신해야 하므로 반드시 "예"!
  VPC 보안 그룹:          기존 항목 제거 → safesync-aws-db-sg 선택
  가용 영역:              ap-northeast-2a

── 추가 구성 ──
  초기 데이터베이스 이름:  safesync
  DB 파라미터 그룹:        safesync-slave-params
  백업:                   자동 백업 활성화 해제 (실습용, 비용 절감)

→ [데이터베이스 생성] 클릭
```

> ⏱️ RDS 생성 완료까지 약 5~10분 소요. 상태가 "사용 가능"이 될 때까지 대기.

### 5-4. RDS 엔드포인트 확인

```
RDS 콘솔 → 데이터베이스 목록 → safesync-rds-slave 클릭
→ [연결 및 보안] 탭

  엔드포인트: safesync-rds-slave.xxxxxxxxxx.ap-northeast-2.rds.amazonaws.com
  포트: 3306

📌 반드시 메모:
  RDS 엔드포인트: ___________________
```

### 5-5. EC2에서 .env 파일의 DB_HOST 수정

```bash
# EC2-01, EC2-02 서버에서 각각 실행
cd /app/safesync
nano .env

# DB_HOST 항목을 RDS 엔드포인트로 수정:
# DB_HOST=safesync-rds-slave.xxxxxxxxxx.ap-northeast-2.rds.amazonaws.com

# 컨테이너 재시작 (설정 반영)
docker restart safesync-app

# DB 연결 확인 로그
docker logs safesync-app
# ✅ SafeSync API 시작 — 클라우드: AWS (ap-northeast-2)
```

---

## 🔢 Step 6. DB Replication 설정 (핵심 ⭐)

**NCP Master → AWS RDS Slave 방향으로 데이터를 복제합니다.**
이 단계는 팀원 A의 NCP 작업(SHOW MASTER STATUS 결과)이 있어야 합니다.

### 6-1. EC2에서 MySQL 클라이언트 설치

```bash
# EC2-01 서버에서 실행
sudo apt-get install -y mysql-client-8.0
```

### 6-2. RDS에 접속

```bash
# EC2 서버에서 RDS로 접속 (EC2 서버의 보안 그룹에서 RDS 접근 허용 상태)
mysql -h [RDS 엔드포인트] -P 3306 -u safesync_user -p
# 비밀번호: SafeSync2024!
```

접속 성공 시:
```
mysql>
```

### 6-3. DB 스키마 초기화

```sql
-- RDS DB에 테이블 생성 (NCP Master와 동일한 구조)
USE safesync;

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

CREATE TABLE IF NOT EXISTS subscribers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(200) NOT NULL UNIQUE,
    region      VARCHAR(200) NOT NULL,
    severity    ENUM('ALL','HIGH','CRITICAL') NOT NULL DEFAULT 'ALL',
    is_active   TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

### 6-4. AWS RDS Slave Replication 설정

```sql
-- RDS의 Slave 설정 (AWS RDS 전용 프로시저 사용)
CALL mysql.rds_set_external_master (
  '[NCP Cloud DB 공인 IP]',  -- 팀원 A에게 받은 NCP DB IP
  3306,                       -- 포트
  'repl_user',                -- Replication 계정
  'ReplPass2024!',            -- 비밀번호
  '[Master 로그 File명]',     -- 예: 'mysql-bin.000001'
  [Master 로그 Position],     -- 예: 154  (따옴표 없는 숫자!)
  0                           -- SSL 사용 여부 (0=미사용)
);

-- Replication 시작
CALL mysql.rds_start_replication;
```

### 6-5. Replication 동기화 확인

```sql
-- Slave 상태 확인
SHOW SLAVE STATUS\G
```

**✅ 정상 동기화 상태 확인 항목:**
```
Slave_IO_Running:   Yes     ← IO 스레드 실행 중
Slave_SQL_Running:  Yes     ← SQL 스레드 실행 중
Seconds_Behind_Master: 0    ← 0이면 완전 동기화!

Last_IO_Error:  (비어있어야 함)
Last_SQL_Error: (비어있어야 함)
```

> ⚠️ `Seconds_Behind_Master`가 0이 될 때까지 약 1~2분 기다린 후 다시 확인하세요.

---

## 🔢 Step 7. ALB (Application Load Balancer) 생성

### 7-1. 대상 그룹(Target Group) 생성

```
EC2 콘솔 → 왼쪽 메뉴 [대상 그룹] → [대상 그룹 생성] 클릭

── 기본 구성 ──
  대상 유형:  인스턴스
  대상 그룹 이름:  safesync-aws-tg
  프로토콜:  HTTP
  포트:  80
  VPC:  safesync-aws-vpc

── 상태 검사(Health Check) ──
  프로토콜:  HTTP
  상태 검사 경로:  /health        ← Route 53도 이 경로 사용, 매우 중요!

상태 검사 고급 설정 펼치기:
  정상 임계값:   3   (3번 연속 성공 시 정상으로 판단)
  비정상 임계값:  3   (3번 연속 실패 시 비정상으로 판단)
  제한 시간:     5초
  간격:         10초
  성공 코드:     200

→ [다음] 클릭
```

**대상(Target) 등록:**
```
  인스턴스 목록에서:
  safesync-aws-was-01 ✅ 선택 → 포트: 8000 → [아래에 보류 중인 것으로 포함]
  safesync-aws-was-02 ✅ 선택 → 포트: 8000 → [아래에 보류 중인 것으로 포함]

→ [대상 그룹 생성] 클릭
```

> 💡 Health Check 포트는 Nginx(80)가 아닌 FastAPI(8000)로 설정합니다.
> `/health` 엔드포인트는 FastAPI에서만 응답하기 때문입니다.

### 7-2. ALB 생성

```
EC2 콘솔 → 왼쪽 메뉴 [로드 밸런서] → [로드 밸런서 생성] 클릭
→ Application Load Balancer [생성] 클릭

── 기본 구성 ──
  로드 밸런서 이름:  safesync-aws-alb
  체계:            인터넷 경계 (Internet-facing)
  IP 주소 유형:     IPv4

── 네트워크 매핑 ──
  VPC:  safesync-aws-vpc
  매핑 (AZ 선택):
    ap-northeast-2a → safesync-public-2a ✅
    ap-northeast-2c → safesync-public-2c ✅

── 보안 그룹 ──
  기존 보안 그룹 제거 후:
  safesync-aws-was-sg ✅ 선택

── 리스너 및 라우팅 ──
  프로토콜: HTTP
  포트: 80
  기본 작업: 대상 그룹으로 전달 → safesync-aws-tg 선택

→ [로드 밸런서 생성] 클릭
```

### 7-3. ALB DNS 이름 확인

```
로드 밸런서 목록 → safesync-aws-alb 클릭
→ [세부 정보] 탭

  DNS 이름: safesync-aws-alb-xxxxxxxxxx.ap-northeast-2.elb.amazonaws.com

📌 반드시 메모:
  AWS ALB DNS: ___________________
```

### 7-4. 동작 확인

```bash
# 브라우저 또는 curl로 확인
curl http://[ALB DNS 이름]
# HTML 응답 확인

curl http://[ALB DNS 이름]/api/health
# {"status":"ok","cloud":"AWS","region":"ap-northeast-2",...}
```

> ⚠️ Health Check 상태가 Healthy가 될 때까지 약 30초~1분 소요됩니다.
> EC2 콘솔 → 대상 그룹 → safesync-aws-tg → [대상] 탭에서 상태 확인

---

## 🔢 Step 8. Auto Scaling 설정

### 8-1. 시작 템플릿(Launch Template) 생성

```
EC2 콘솔 → 왼쪽 메뉴 [시작 템플릿] → [시작 템플릿 생성] 클릭

── 시작 템플릿 이름 및 설명 ──
  시작 템플릿 이름:  safesync-launch-template
  Auto Scaling 지침 체크박스: ✅ 체크

── 애플리케이션 및 OS 이미지 ──
  Ubuntu Server 22.04 LTS (퀵 시작에서 선택)

── 인스턴스 유형 ──
  t3.small

── 키 페어 ──
  safesync-aws-key 선택

── 네트워크 설정 ──
  보안 그룹: safesync-aws-was-sg 선택

── 고급 세부 정보 → 사용자 데이터 ──
아래 스크립트 입력 (새 EC2 생성 시 자동으로 Docker 설치 + 앱 실행):
```

**User Data 스크립트:**
```bash
#!/bin/bash
# SafeSync AWS 자동 배포 스크립트

# Docker 설치
apt-get update -y
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
systemctl start docker
systemctl enable docker

# 앱 디렉토리 생성
mkdir -p /app/safesync
cd /app/safesync

# GitHub에서 코드 클론
git clone https://github.com/rbtjd215/NaverCloud_part2.git .

# .env 파일 생성 (실제 값으로 반드시 수정)
cat > .env << 'ENVEOF'
APP_ENV=production
DB_HOST=[RDS 엔드포인트]
DB_PORT=3306
DB_NAME=safesync
DB_USER=safesync_user
DB_PASSWORD=SafeSync2024!
CLOUD_PROVIDER=AWS
CLOUD_REGION=ap-northeast-2
JWT_SECRET_KEY=safesync-jwt-secret-key-2024-production
ADMIN_ID=admin
ADMIN_PASSWORD=safesync2024
CLOVA_STUDIO_API_KEY=[실제 API Key]
ENVEOF

# Docker 이미지 빌드
cd /app/safesync/backend
docker build -t safesync-backend:v1.0 .

# 컨테이너 실행
cd /app/safesync
docker run -d --name safesync-app --restart always \
  -p 8000:8000 --env-file .env safesync-backend:v1.0

docker run -d --name safesync-nginx --restart always \
  -p 80:80 \
  -v /app/safesync/index.html:/usr/share/nginx/html/index.html \
  -v /app/safesync/style.css:/usr/share/nginx/html/style.css \
  -v /app/safesync/app.js:/usr/share/nginx/html/app.js \
  -v /app/safesync/nginx.conf:/etc/nginx/conf.d/default.conf \
  nginx:alpine
```

```
→ [시작 템플릿 생성] 클릭
```

### 8-2. Auto Scaling 그룹 생성

```
EC2 콘솔 → 왼쪽 메뉴 [Auto Scaling 그룹] → [Auto Scaling 그룹 생성] 클릭

── Step 1: 시작 템플릿 선택 ──
  이름:            safesync-aws-asg
  시작 템플릿:      safesync-launch-template
→ [다음]

── Step 2: 네트워크 설정 ──
  VPC:      safesync-aws-vpc
  서브넷:    safesync-public-2a ✅ + safesync-public-2c ✅
→ [다음]

── Step 3: 로드 밸런서 연결 ──
  기존 로드 밸런서에 연결 선택
  대상 그룹: safesync-aws-tg 선택
  상태 확인:
    ✅ Elastic Load Balancing 상태 확인 켜기
    유예 기간: 120초 (앱 시작 시간 고려)
→ [다음]

── Step 4: 그룹 크기 및 스케일링 ──
  최소 용량:  2  (항상 2대 유지)
  최대 용량:  5
  원하는 용량: 2

  자동 크기 조정 정책:
    대상 추적 크기 조정 정책 선택
    정책 이름: safesync-cpu-scaling
    지표 유형: 평균 CPU 사용률
    대상 값:   70  (CPU 70% 초과 시 자동 증설)

→ [다음] → [다음] → [Auto Scaling 그룹 생성] 클릭
```

---

## 🔢 Step 9. Route 53 DNS Failover 설정

### 9-1. 호스팅 영역(Hosted Zone) 확인

```
AWS 콘솔 검색창 → "Route 53" → Route 53 서비스 클릭
→ 왼쪽 메뉴 [호스팅 영역]

  ※ 도메인이 없는 경우:
  Route 53 → [도메인 등록] → 원하는 도메인 구매 (약 $12/년)
  또는
  팀 실습용으로 무료 도메인 서비스 활용 (freenom.com 등)
```

### 9-2. 상태 검사(Health Check) 생성 — NCP 모니터링용

```
Route 53 → 왼쪽 메뉴 [상태 검사] → [상태 검사 생성] 클릭

── 이름 및 모니터링 대상 ──
  이름:        NCP-Primary-Health-Check
  모니터링 대상: 엔드포인트

── 엔드포인트 모니터링 설정 ──
  프로토콜:    HTTP
  IP 주소:    [NCP LB 공인 IP 또는 DNS]
  포트:       80
  경로:       /health        ← GET /health → 200 OK 확인

── 요청 간격 ──
  빠름(10초) 선택 (장애 전환 속도 향상)

── 실패 임계값 ──
  3   (3번 연속 실패 시 비정상으로 판단)

→ [생성] 클릭
```

### 9-3. DNS Failover 레코드 생성

**[기본(Primary) 레코드 — NCP 서버]:**
```
호스팅 영역 클릭 → [레코드 생성] 클릭

  레코드 이름:  www
  레코드 유형:  A
  값:          [NCP LB 공인 IP]
  TTL:         60초

  라우팅 정책: 장애 조치(Failover)
  장애 조치 레코드 유형: 기본(Primary)
  상태 검사 ID: NCP-Primary-Health-Check 선택
  레코드 ID:    primary-ncp

→ [레코드 생성]
```

**[보조(Secondary) 레코드 — AWS ALB]:**
```
[레코드 생성] 클릭

  레코드 이름:  www   (기본 레코드와 동일한 이름)
  레코드 유형:  A
  별칭:        활성화 ✅
  트래픽 라우팅 대상:
    Application/Classic Load Balancer에 대한 별칭
    리전: ap-northeast-2 (서울)
    값: safesync-aws-alb 선택

  라우팅 정책: 장애 조치(Failover)
  장애 조치 레코드 유형: 보조(Secondary)
  레코드 ID:    secondary-aws

→ [레코드 생성]
```

---

## ✅ 최종 확인 체크리스트

### 인프라 구축 완료 확인

```
□ VPC (safesync-aws-vpc, 10.1.0.0/16) 생성 완료
□ Public 서브넷 2개 (2a, 2c) 생성 및 공인 IP 자동 할당 활성화
□ IGW 생성 및 VPC 연결 완료
□ 라우팅 테이블에 0.0.0.0/0 → IGW 설정 완료
□ 보안 그룹 2개 (WAS용, DB용) 생성 완료
□ EC2 2대 (was-01: 2a, was-02: 2c) 생성 완료
□ EC2 SSH 접속 성공 (ubuntu@)
□ Docker 설치 완료 (두 서버 모두)
□ safesync-app 컨테이너 실행 중 (docker ps 확인)
□ safesync-nginx 컨테이너 실행 중
□ RDS MySQL 생성 완료 ("사용 가능" 상태)
□ RDS 파라미터 그룹 적용 완료 (server-id=2, read_only=1)
□ schema.sql 실행 완료 (테이블 4개 생성)
□ DB Replication 연결 완료 (Slave_IO_Running: Yes)
□ Seconds_Behind_Master: 0 확인
□ EC2 .env의 DB_HOST를 RDS 엔드포인트로 수정 완료
□ ALB (safesync-aws-alb) 생성 완료
□ 대상 그룹에 EC2 2대 등록 완료
□ Health Check Healthy 상태 확인
□ ALB DNS로 접속 시 웹 화면 표시 확인
□ Auto Scaling 그룹 생성 완료 (최소 2대)
□ Route 53 Health Check 생성 완료
□ Primary(NCP), Secondary(AWS) DNS 레코드 생성 완료
```

### 서비스 동작 확인 명령어

```bash
# 1. EC2 직접 접속 확인
curl http://[EC2-01 공인 IP]
curl http://[EC2-01 공인 IP]:8000/health
# {"status":"ok","cloud":"AWS","region":"ap-northeast-2",...}

# 2. ALB를 통한 접속 확인
curl http://[ALB DNS]/api/health
# {"cloud":"AWS","status":"ok"}

# 3. Replication 동기화 확인 (NCP에서 새 재난 등록 후 AWS DB에서 확인)
mysql -h [RDS 엔드포인트] -u safesync_user -p safesync
  → SELECT COUNT(*) FROM disasters;  -- NCP와 동일한 숫자여야 함

# 4. Route 53 Failover 테스트
# NCP LB를 내린 뒤, www.[도메인]에 접속해 AWS로 전환되는지 확인
```

---

## 🔧 문제 해결 가이드

### 문제 1: EC2 SSH 접속 불가
```bash
# 원인 1: 보안 그룹에 SSH(22) 포트가 열려있지 않음
→ EC2 콘솔 → 보안 그룹 → safesync-aws-was-sg
→ 인바운드 규칙 → TCP 22 / 내 IP 추가

# 원인 2: .pem 파일 권한 오류 (Windows)
icacls safesync-aws-key.pem /inheritance:r /grant:r "%USERNAME%:R"

# 원인 3: 계정명이 root가 아닌 ubuntu임
ssh -i safesync-aws-key.pem ubuntu@[공인 IP]   ← ubuntu로 접속!
```

### 문제 2: Docker 컨테이너가 DB에 연결 못 함
```bash
# 로그 확인
docker logs safesync-app

# RDS 엔드포인트 확인
# → .env 파일의 DB_HOST가 RDS 엔드포인트인지 확인
cat .env | grep DB_HOST

# EC2에서 RDS 접속 테스트
mysql -h [RDS 엔드포인트] -u safesync_user -p
# 접속이 안 되면 RDS 보안 그룹에서 EC2 보안 그룹 허용 여부 확인
```

### 문제 3: DB Replication이 안 됨
```sql
-- Slave 상태 확인
SHOW SLAVE STATUS\G

-- 에러 메시지별 대처:
-- Last_IO_Error: error connecting to master
--   → NCP DB ACG에서 AWS RDS 공인 IP(3306) 허용 여부 확인
--   → RDS 보안 그룹에서 NCP DB IP 허용 여부 확인

-- Last_IO_Error: Got fatal error from master
--   → NCP repl_user 계정 권한 재확인 (GRANT REPLICATION SLAVE)

-- 재설정 시도
CALL mysql.rds_stop_replication;
CALL mysql.rds_reset_external_master;
-- CALL mysql.rds_set_external_master 다시 실행
CALL mysql.rds_start_replication;
```

### 문제 4: ALB Health Check 실패 (Unhealthy)
```bash
# EC2 서버에서 직접 Health Check 테스트
curl http://localhost:8000/health
# 응답이 없으면 FastAPI 컨테이너 미실행 상태

# 컨테이너 상태 확인
docker ps -a
# STATUS가 Exited이면 → docker logs safesync-app 으로 원인 확인

# 포트 확인
sudo netstat -tlnp | grep 8000
# 0.0.0.0:8000이 LISTEN 상태여야 함
```

### 문제 5: Route 53 Failover가 AWS로 안 전환됨
```
Route 53 → 상태 검사 → NCP-Primary-Health-Check → [모니터링] 탭
→ 현재 상태가 "비정상"인지 확인

비정상으로 표시되었는데도 전환이 안 되면:
→ DNS TTL 값 확인 (TTL=60초면 최대 60초 대기)
→ 브라우저 DNS 캐시 삭제 후 재시도
   (Chrome: 주소창에 chrome://net-internals/#dns → Clear host cache)
```

---

## 📌 팀원 B가 완료 후 팀장에게 전달할 정보

```
AWS 구축 결과 정리 (단톡방에 공유):

  AWS ALB DNS:          ___________________
  EC2-01 공인 IP:       ___________________
  EC2-02 공인 IP:       ___________________
  RDS 엔드포인트:        ___________________
  Route 53 도메인:       ___________________
  Slave 동기화 확인:     Seconds_Behind_Master = 0 ✅
```

---

## 📌 DR Failover 시연 순서 (발표용 참고)

```
1. 브라우저에서 Route 53 도메인 접속 → NCP 서버에서 서비스 중 확인
   (웹 페이지 우상단: "현재 클라우드: NCP | 상태: 정상")

2. NCP 콘솔에서 LB 또는 서버를 고의로 정지
   (또는 SafeSync 관리자 콘솔 → [DR 수동 전환] 버튼)

3. Route 53 Health Check 실패 감지 (약 30초~1분)

4. DNS가 AWS ALB로 자동 전환

5. 브라우저 새로고침 → AWS에서 동일한 데이터로 서비스 재개 확인
   (웹 페이지: "현재 클라우드: AWS | 상태: DR 운영 중")

6. DB는 Replication으로 이미 동기화되어 있으므로 데이터 유실 없음!
```

---

> 📋 이 가이드는 NCP 구축 가이드와 쌍을 이루는 AWS DR 환경 구축 가이드입니다.
> NCP 가이드와 함께 [SafeSync_프로젝트_종합보고서.md](file:///C:/Users/rbtjd/.gemini/antigravity-ide/brain/be9f9ea3-7439-456a-aa5c-de4607149e1b/SafeSync_%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8_%EC%A2%85%ED%95%A9%EB%B3%B4%EA%B3%A0%EC%84%9C.md)를 참고하세요.
