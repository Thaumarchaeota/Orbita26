import contextlib
import os
import sys
import time
import uuid
from pathlib import Path

from ledger.config import DATA_DIR

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl


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


@contextlib.contextmanager
def file_exclusive_lock(lock_path: Path, *, timeout_sec: float = 30.0):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT)
    deadline = time.monotonic() + timeout_sec
    try:
        while True:
            try:
                if sys.platform == "win32":
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"无法在 {timeout_sec}s 内获取文件锁: {lock_path}")
                time.sleep(0.005)
        yield
    finally:
        if sys.platform == "win32":
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        try:
            dir_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError:
            pass
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
