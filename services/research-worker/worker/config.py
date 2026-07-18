"""Worker configuration loaded from environment / .env at the repo root."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES_DIR = REPO_ROOT / "fixtures"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Neon pooled connection string (worker uses single-statement autocommit,
    # which is safe through the transaction-mode pooler).
    database_url: str = ""
    demo_mode: bool = True

    brave_search_api_key: str = ""
    hunter_api_key: str = ""

    ai_provider: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    ai_model: str = ""

    crawler_user_agent: str = "LeadResearchBot/0.1"
    crawler_contact_email: str = ""

    worker_id: str = "worker-1"
    worker_poll_seconds: int = 5

    # Crawl limits
    crawl_max_pages: int = 7
    crawl_max_depth: int = 2
    crawl_delay_seconds: float = 2.0
    crawl_timeout_seconds: float = 15.0
    crawl_max_response_bytes: int = 1_500_000

    @property
    def user_agent(self) -> str:
        if self.crawler_contact_email:
            return f"{self.crawler_user_agent} (contact: {self.crawler_contact_email})"
        return self.crawler_user_agent


settings = Settings()
