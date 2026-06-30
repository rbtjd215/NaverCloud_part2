-- ═══════════════════════════════════════════
-- SafeSync — MySQL 스키마 초기화 SQL
-- NCP Cloud DB 또는 AWS RDS에서 실행하세요
-- ═══════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS safesync
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE safesync;

-- ── 재난 현황 ──
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
    INDEX idx_region   (region),
    INDEX idx_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 대피소 ──
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
    updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_region (region),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 알림 구독자 ──
CREATE TABLE IF NOT EXISTS subscribers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(200) NOT NULL UNIQUE,
    region      VARCHAR(200) NOT NULL,
    severity    ENUM('ALL','HIGH','CRITICAL') NOT NULL DEFAULT 'ALL',
    is_active   TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT NOW(),
    INDEX idx_email  (email),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 시스템 로그 (DR 이벤트) ──
CREATE TABLE IF NOT EXISTS system_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    level       ENUM('INFO','WARN','ERROR','ACTION') DEFAULT 'INFO',
    message     TEXT NOT NULL,
    cloud       VARCHAR(20),
    created_at  DATETIME DEFAULT NOW(),
    INDEX idx_level   (level),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ═══════════════════════════════════════════
-- ▶ DB Replication 설정 (NCP Master → AWS Slave)
-- NCP Master DB에서 실행
-- ═══════════════════════════════════════════

-- 1. 복제용 전용 계정 생성 (NCP Master에서 실행)
-- CREATE USER 'repl_user'@'%' IDENTIFIED BY 'repl_strong_password_here';
-- GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';
-- FLUSH PRIVILEGES;

-- 2. Master 상태 확인 (File명과 Position 메모)
-- SHOW MASTER STATUS;

-- ═══════════════════════════════════════════
-- ▶ AWS RDS Slave에서 실행
-- ═══════════════════════════════════════════

-- CHANGE MASTER TO
--   MASTER_HOST='[NCP_DB_공인IP]',
--   MASTER_PORT=3306,
--   MASTER_USER='repl_user',
--   MASTER_PASSWORD='repl_strong_password_here',
--   MASTER_LOG_FILE='[SHOW MASTER STATUS의 File값]',
--   MASTER_LOG_POS=[SHOW MASTER STATUS의 Position값];
--
-- START SLAVE;
-- SHOW SLAVE STATUS\G  -- Seconds_Behind_Master 가 0이면 동기화 완료

-- ═══════════════════════════════════════════
-- ▶ DR Failover 시: AWS Slave → Master 승격
-- ═══════════════════════════════════════════

-- STOP SLAVE;
-- RESET SLAVE ALL;
-- -- 이제 AWS RDS가 독립 Master로 동작
