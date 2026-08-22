from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ledger.api.accounts import router as accounts_router
from ledger.api.categories import router as categories_router
from ledger.api.commit import router as commit_router
from ledger.api.entries import router as entries_router
from ledger.api.health import router as health_router
from ledger.api.settings import router as settings_router
from ledger.api.stats import router as stats_router
from ledger.api.validate import router as validate_router

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(entries_router, prefix="/api")
app.include_router(commit_router, prefix="/api")
app.include_router(accounts_router, prefix="/api")
app.include_router(categories_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(validate_router, prefix="/api")


if __name__ == "__main__":
    import os
    import uvicorn

    host = os.environ.get("ORBITA_LEDGER_HOST", "127.0.0.1")
    port = int(os.environ.get("ORBITA_LEDGER_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
