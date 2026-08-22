import os
import shutil
import tempfile
from pathlib import Path

_ISOLATED_MARKERS = (
    "orbita-ledger-test-",
    "orbita-ledger-settings-",
    "orbita-ledger-account-ops-",
    "orbita-ledger-delete-scan-",
)


def _is_isolated_root(path: str) -> bool:
    return any(marker in path for marker in _ISOLATED_MARKERS)


def _is_forbidden_production_root(path: Path) -> bool:
    resolved = path.expanduser().resolve()
    normalized = str(resolved).replace("\\", "/").lower()
    return normalized.endswith("/data_orbita") or normalized.endswith("data_orbita")


def assert_safe_ledger_test_root() -> None:
    """Fail before any bill write when env points at production or non-temp roots."""
    root = os.environ.get("ORBITA_LEDGER_DATA_ROOT")
    if not root:
        return
    if _is_forbidden_production_root(Path(root)):
        raise RuntimeError(
            f"refusing ledger tests: ORBITA_LEDGER_DATA_ROOT={root!r} is production data"
        )
    if not _is_isolated_root(root):
        raise RuntimeError(
            f"refusing ledger tests: ORBITA_LEDGER_DATA_ROOT={root!r} is not an isolated temp root"
        )


def assert_safe_smoke_data_root(path: Path) -> None:
    if _is_forbidden_production_root(path):
        raise RuntimeError(
            f"refusing smoke_test: ORBITA_LEDGER_DATA_ROOT={path!r} is production data"
        )


def isolate_bill_root() -> tuple[Path, str | None, Path | None]:
    previous = os.environ.get("ORBITA_LEDGER_DATA_ROOT")
    if previous:
        if _is_forbidden_production_root(Path(previous)):
            raise RuntimeError(
                f"refusing ledger tests: ORBITA_LEDGER_DATA_ROOT={previous!r} is production data"
            )
        if _is_isolated_root(previous):
            return Path(previous), previous, None
        raise RuntimeError(
            f"refusing ledger tests: ORBITA_LEDGER_DATA_ROOT={previous!r} is not an isolated temp root"
        )
    root = Path(tempfile.mkdtemp(prefix="orbita-ledger-test-"))
    os.environ["ORBITA_LEDGER_DATA_ROOT"] = str(root)
    return root, previous, root


def restore_bill_root(previous: str | None, created: Path | None) -> None:
    if created is None:
        return
    if previous is None:
        os.environ.pop("ORBITA_LEDGER_DATA_ROOT", None)
    else:
        os.environ["ORBITA_LEDGER_DATA_ROOT"] = previous
    shutil.rmtree(created, ignore_errors=True)


class LedgerBillIsolationMixin:
    """Mixin for unittest classes that write under ORBITA_LEDGER_DATA_ROOT."""

    _bill_root_path: Path
    _prev_bill_root: str | None
    _created_bill_root: Path | None

    def setUp_bill_isolation(self) -> None:
        self._bill_root_path, self._prev_bill_root, self._created_bill_root = isolate_bill_root()

    def tearDown_bill_isolation(self) -> None:
        restore_bill_root(self._prev_bill_root, self._created_bill_root)
