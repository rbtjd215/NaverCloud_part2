"""
SafeSync Backend — 설정 모듈
환경변수를 읽어 앱 전체에서 사용하는 설정 객체를 제공합니다.
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    # 앱
    app_name: str = "SafeSync"
    app_env: str = "development"
    debug: bool = True
    port: int = 8000
    cors_origins: str = "http://localhost:3000,http://localhost:8080"

    # DB
    db_host: str = "localhost"
    db_port: int = 3306
    db_name: str = "safesync"
    db_user: str = "root"
    db_password: str = "password"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # CLOVA Studio
    clova_studio_api_key: str = ""
    clova_studio_apigw_url: str = "https://clovastudio.stream.ntruss.com"
    clova_studio_request_id: str = ""

    # JWT
    jwt_secret_key: str = "dev_secret_key_change_in_production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # 관리자
    admin_id: str = "admin"
    admin_password: str = "safesync2024"

    # NCP Object Storage
    ncp_access_key: str = ""
    ncp_secret_key: str = ""
    ncp_endpoint: str = "https://kr.object.ncloudstorage.com"
    ncp_bucket: str = "safesync-images"

    # 클라우드 구분
    cloud_provider: str = "NCP"
    cloud_region: str = "KR-1"

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset=utf8mb4"
        )

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
