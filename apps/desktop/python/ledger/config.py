from __future__ import annotations

import os
from pathlib import Path


def get_data_dir() -> Path:
    _root = os.environ.get("ORBITA_LEDGER_DATA_ROOT", "").strip()
    return Path(_root) if _root else Path("data")


class _LazyPath:
    __slots__ = ("_parts",)

    def __init__(self, *parts: str):
        self._parts = parts

    def _path(self) -> Path:
        return get_data_dir().joinpath(*self._parts)

    def __truediv__(self, other: str) -> _LazyPath:
        return _LazyPath(*self._parts, str(other))

    def __fspath__(self) -> str:
        return str(self._path())

    def __str__(self) -> str:
        return str(self._path())

    def __repr__(self) -> str:
        return repr(self._path())

    def __eq__(self, other: object) -> bool:
        try:
            return self._path() == other
        except TypeError:
            return False

    def __hash__(self) -> int:
        return hash(self._path())

    def __getattr__(self, name: str):
        return getattr(self._path(), name)


DATA_DIR = _LazyPath()
CATEGORY_FILE = _LazyPath("category.bean")
ACCOUNT_FILE = _LazyPath("account.bean")
LEDGER_DIR = _LazyPath("ledger")
