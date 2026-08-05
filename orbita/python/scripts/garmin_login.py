#!/usr/bin/env python3
import argparse
import sys
from datetime import date
from pathlib import Path

from garmin_lib import (
    check_rate_limit_cooldown,
    call_with_timeout,
    clear_rate_limit,
    emit,
    emit_fail,
    emit_login_failure,
    error_rank,
    mark_rate_limit,
    network_routes,
    sso_login_once,
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--token-dir", required=True)
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    return p.parse_args()


def main():
    args = parse_args()
    try:
        from garminconnect import Garmin  # noqa: F401
    except ImportError:
        emit_fail("deps_missing", "未安装 garminconnect，请运行 orbita/python/setup.ps1")

    token_dir = str(Path(args.token_dir).expanduser().resolve())
    email = (args.email or "").strip()
    password = args.password or ""
    if not email or not password:
        emit_fail("bad_credentials", "请填写佳明邮箱和密码")

    check_rate_limit_cooldown(token_dir, for_login=True)
    today = date.today().isoformat()
    routes = network_routes(token_dir)
    route = routes[0]

    try:
        client = call_with_timeout(
            lambda: sso_login_once(token_dir, email, password, route, today),
            120,
            f"佳明 SSO 超时（{route['name']}，120s）",
        )
        clear_rate_limit(token_dir)
        emit({"ok": True, "displayName": client.display_name})
        return 0
    except SystemExit:
        return 1
    except Exception as e:
        if error_rank(e) >= 100:
            mark_rate_limit(token_dir)
            emit_login_failure(e, routes)
        else:
            emit_login_failure(e, routes)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
