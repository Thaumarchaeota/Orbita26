from pathlib import Path

from ledger.config import DATA_DIR


def resolve_data_path(relative: str) -> Path:
    target = (relative or "").strip().replace("\\", "/")
    if not target:
        raise ValueError("路径不能为空")
    if target.endswith("_inv.bean"):
        raise ValueError("不支持 inv 文件")
    path = (DATA_DIR / target).resolve()
    try:
        path.relative_to(DATA_DIR.resolve())
    except ValueError:
        raise ValueError(f"无效路径: {relative}")
    return path


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
