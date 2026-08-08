import os
from pathlib import Path

_root = os.environ.get("ORBITA_LEDGER_DATA_ROOT", "").strip()
DATA_DIR = Path(_root) if _root else Path("data")
CATEGORY_FILE = DATA_DIR / "category.bean"
ACCOUNT_FILE = DATA_DIR / "account.bean"
LEDGER_DIR = DATA_DIR / "ledger"
