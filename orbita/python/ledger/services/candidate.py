import hashlib
import secrets
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from ledger.config import DATA_DIR
from ledger.services.settings import get_write_target

if TYPE_CHECKING:
    from ledger.services.ledger_render import CandidateItemRange

TokenStore = dict[str, tuple[str, float]]


@dataclass(frozen=True)
class VersionFingerprint:
    write_target: str
    write_target_hash: str
    account_bean_hash: str
    category_bean_hash: str


@dataclass
class CandidateToken:
    token: str
    candidate_hash: str
    created_at: float
    fingerprint: VersionFingerprint | None = None


_tokens: dict[str, CandidateToken] = {}
TOKEN_TTL_SEC = 600
_write_target_locks: dict[str, threading.Lock] = {}
_write_target_lock_guard = threading.Lock()


def _purge_expired() -> None:
    now = time.time()
    expired = [k for k, v in _tokens.items() if now - v.created_at > TOKEN_TTL_SEC]
    for k in expired:
        del _tokens[k]


def hash_candidate(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _hash_file_bytes(path: Path) -> str:
    if not path.is_file():
        return hashlib.sha256(b"").hexdigest()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compute_version_fingerprint() -> VersionFingerprint:
    write_target = get_write_target()
    return VersionFingerprint(
        write_target=write_target,
        write_target_hash=_hash_file_bytes(DATA_DIR / write_target),
        account_bean_hash=_hash_file_bytes(DATA_DIR / "account.bean"),
        category_bean_hash=_hash_file_bytes(DATA_DIR / "category.bean"),
    )


def fingerprints_match(
    stored: VersionFingerprint | None,
    current: VersionFingerprint | None,
) -> bool:
    if stored is None:
        return True
    if current is None:
        return False
    return stored == current


def write_target_lock(write_target: str) -> threading.Lock:
    key = (write_target or "").strip().replace("\\", "/")
    with _write_target_lock_guard:
        lock = _write_target_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _write_target_locks[key] = lock
        return lock


def get_token_entry(token: str) -> CandidateToken | None:
    _purge_expired()
    return _tokens.get(token)


def issue_token(
    candidate_hash: str,
    fingerprint: VersionFingerprint | None = None,
) -> str:
    _purge_expired()
    token = secrets.token_urlsafe(32)
    _tokens[token] = CandidateToken(
        token=token,
        candidate_hash=candidate_hash,
        created_at=time.time(),
        fingerprint=fingerprint,
    )
    return token


def verify_token(token: str, candidate_hash: str) -> bool:
    _purge_expired()
    entry = _tokens.get(token)
    if not entry:
        return False
    if entry.candidate_hash != candidate_hash:
        return False
    return time.time() - entry.created_at <= TOKEN_TTL_SEC


def consume_token(token: str, candidate_hash: str) -> bool:
    if not verify_token(token, candidate_hash):
        return False
    _tokens.pop(token, None)
    return True


_inflight: dict[str, str] = {}


def reserve_token(token: str, candidate_hash: str) -> bool:
    _purge_expired()
    if token in _inflight:
        return False
    if not verify_token(token, candidate_hash):
        return False
    _inflight[token] = candidate_hash
    return True


def release_token(token: str) -> None:
    _inflight.pop(token, None)


def finalize_token(token: str, candidate_hash: str) -> bool:
    if _inflight.get(token) != candidate_hash:
        return False
    # TTL is enforced by reserve_token before any write begins.  Rechecking it
    # after atomic_write could report failure although the file was already
    # replaced if a slow filesystem crosses the TTL boundary.
    release_token(token)
    _tokens.pop(token, None)
    return True


@dataclass
class CandidateDiagnostic:
    message: str
    item_ids: list[str] = field(default_factory=list)
    raw: str | None = None

    def to_dict(self) -> dict:
        out: dict = {"message": self.message, "item_ids": self.item_ids}
        if self.raw:
            out["raw"] = self.raw
        return out


def _source_filename(meta) -> str | None:
    if not meta:
        return None
    if isinstance(meta, dict):
        filename = meta.get("filename") or meta.get("file")
    else:
        filename = getattr(meta, "filename", None) or getattr(meta, "file", None)
    return str(filename) if filename else None


def _source_lineno(meta) -> int | None:
    if not meta:
        return None
    if isinstance(meta, dict):
        lineno = meta.get("lineno") or meta.get("line")
    else:
        lineno = getattr(meta, "lineno", None) or getattr(meta, "line", None)
    if lineno is None:
        return None
    return int(lineno)


def _line_in_candidate_ledger(filename: str | None, ledger_path: Path) -> bool:
    if not filename:
        return True
    return ledger_path.name in filename.replace("\\", "/")


def _collect_error_sources(err) -> list[tuple[str | None, int]]:
    pairs: list[tuple[str | None, int]] = []
    seen: set[tuple[str | None, int]] = set()

    def add(meta) -> None:
        lineno = _source_lineno(meta)
        if lineno is None:
            return
        filename = _source_filename(meta)
        key = (filename, lineno)
        if key in seen:
            return
        seen.add(key)
        pairs.append(key)

    def walk_entry(entry) -> None:
        if entry is None:
            return
        add(getattr(entry, "meta", None))
        for posting in getattr(entry, "postings", None) or []:
            add(getattr(posting, "meta", None))

    add(getattr(err, "source", None))
    add(getattr(err, "meta", None))
    walk_entry(getattr(err, "entry", None))
    for entry in getattr(err, "entries", None) or []:
        walk_entry(entry)
    for other in getattr(err, "others", None) or []:
        add(getattr(other, "meta", None))
        walk_entry(other)
    return pairs


def _map_line_to_item_id(lineno: int, line_ranges: list["CandidateItemRange"]) -> str | None:
    for item_range in line_ranges:
        if item_range.start_line <= lineno <= item_range.end_line:
            return item_range.item_id
    return None


def _map_error_to_item_ids(
    err,
    ledger_path: Path,
    line_ranges: list["CandidateItemRange"],
) -> list[str]:
    item_ids: list[str] = []
    seen: set[str] = set()
    for filename, lineno in _collect_error_sources(err):
        if not _line_in_candidate_ledger(filename, ledger_path):
            continue
        item_id = _map_line_to_item_id(lineno, line_ranges)
        if item_id and item_id not in seen:
            seen.add(item_id)
            item_ids.append(item_id)
    return item_ids


def beancount_check_in_temp(
    bill_root: Path,
    write_target_rel: str,
    ledger_text: str,
    line_ranges: list["CandidateItemRange"] | None = None,
) -> list[CandidateDiagnostic]:
    try:
        from beancount import loader
    except ImportError:
        return [CandidateDiagnostic(message="Beancount 未安装", item_ids=[])]

    with tempfile.TemporaryDirectory(prefix="orbita-candidate-") as tmp:
        tmp_root = Path(tmp)
        for name in ("account.bean", "category.bean"):
            src = bill_root / name
            if src.is_file():
                (tmp_root / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        ledger_path = tmp_root / write_target_rel
        ledger_path.parent.mkdir(parents=True, exist_ok=True)
        ledger_path.write_text(ledger_text, encoding="utf-8")
        main_bean = tmp_root / "main.bean"
        main_bean.write_text(
            "\n".join(
                [
                    f'include "{name}"' for name in ("account.bean", "category.bean") if (tmp_root / name).is_file()
                ]
                + [f'include "{write_target_rel}"']
            )
            + "\n",
            encoding="utf-8",
        )
        entries, errors, _options = loader.load_file(str(main_bean))
        if not errors:
            return []
        diags: list[CandidateDiagnostic] = []
        ranges = line_ranges or []
        for err in errors:
            msg = getattr(err, "message", None) or str(err)
            item_ids = _map_error_to_item_ids(err, ledger_path, ranges)
            diags.append(CandidateDiagnostic(message=msg, item_ids=item_ids, raw=str(err)))
        return diags
