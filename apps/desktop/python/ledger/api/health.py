from fastapi import APIRouter

router = APIRouter()
VERSION = "0.0.17"
PARSER_REV = "1"
BEANCOUNT_SETUP_HINT = "请在仓库根目录运行 apps/desktop/python/setup.ps1 安装 Finance 依赖（含 Beancount）"


def _beancount_ready() -> tuple[bool, str | None]:
    try:
        import beancount  # noqa: F401
    except ImportError:
        return False, f"Beancount 未安装。{BEANCOUNT_SETUP_HINT}"
    return True, None


@router.get("/health")
def health():
    beancount_ok, beancount_error = _beancount_ready()
    payload: dict[str, object] = {
        "version": VERSION,
        "parser_rev": PARSER_REV,
        "beancount_ok": beancount_ok,
    }
    if beancount_ok:
        payload["ok"] = True
    else:
        payload["ok"] = False
        payload["error"] = beancount_error
    return payload
