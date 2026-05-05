from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str
    redis_url: str = "redis://redis:6379"
    mqtt_broker: str = "mqtt"
    mqtt_port: int = 1883
    secret_key: str
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    ome_webrtc_base: str
    ome_llhls_base: str
    cors_origins: list[str] = ["http://localhost:3000"]
    admin_username: str = "admin"
    admin_password: str = "admin123"
    exports_path: str = "/tmp/exports"


settings = Settings()  # type: ignore[call-arg]
