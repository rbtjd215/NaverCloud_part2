# ══════════════════════════════════════════
# SafeSync Backend — Dockerfile
# NCP Server 또는 AWS EC2에 동일하게 배포
# ══════════════════════════════════════════

FROM python:3.11-slim

# 작업 디렉토리
WORKDIR /app

# 시스템 패키지 (MySQL 클라이언트 드라이버 의존)
RUN apt-get update && apt-get install -y \
    default-libmysqlclient-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 먼저 설치 (캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 복사
COPY . .

# 포트 노출
EXPOSE 8000

# 시작 명령
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
