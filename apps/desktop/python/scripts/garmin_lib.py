import json
import logging
import os
import socket
import sys
import time
import warnings
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

warnings.filterwarnings("ignore")
logging.getLogger("garminconnect").setLevel(logging.CRITICAL)

CURRENT_ROUTE = {"name": "direct", "proxies": {"http": None, "https": None}}

RATE_LIMIT_COOLDOWN_SEC = 6 * 3600


def port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.4):
            return True
    except OSError:
        return False


def _normalize_proxy(host_port: str):
    host_port = host_port.strip()
    if not host_port:
        return None
    if "://" in host_port:
        return host_port
    return f"http://{host_port}"


def _parse_ie_proxy(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    if "://" in raw:
        return raw
    if "=" in raw:
        for part in raw.split(";"):
            part = part.strip()
            if part.lower().startswith("http="):
                return _normalize_proxy(part.split("=", 1)[1])
            if part.lower().startswith("https="):
                return _normalize_proxy(part.split("=", 1)[1])
        return None
    return _normalize_proxy(raw)


def windows_ie_proxy():
    if sys.platform != "win32":
        return None
    import winreg

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        ) as key:
            enable = winreg.QueryValueEx(key, "ProxyEnable")[0]
            if not enable:
                return None
            raw = winreg.QueryValueEx(key, "ProxyServer")[0]
            return _parse_ie_proxy(str(raw))
    except OSError:
        return None


def _host_port(url: str):
    from urllib.parse import urlparse

    if not url:
        return None, None
    p = urlparse(url if "://" in url else f"http://{url}")
    host = p.hostname
    if not host:
        return None, None
    port = p.port
    if port is None:
        port = 443 if p.scheme == "https" else 80
    return host, port


def _proxy_alive(url: str) -> bool:
    host, port = _host_port(url)
    if not host or not port:
        return False
    return port_open(host, port)


def route_cache_path(token_dir: str) -> Path:
    return Path(token_dir) / "garmin_route.json"


def load_route_cache(token_dir: str) -> str | None:
    p = route_cache_path(token_dir)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        name = data.get("name")
        return str(name) if name else None
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def load_display_name_cache(token_dir: str) -> str | None:
    p = route_cache_path(token_dir)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        dn = data.get("displayName")
        return str(dn).strip() if dn else None
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def save_route_cache(token_dir: str, name: str, display_name: str | None = None):
    try:
        data: dict = {"name": name}
        if display_name:
            data["displayName"] = display_name
        route_cache_path(token_dir).write_text(
            json.dumps(data, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


def rate_limit_path(token_dir: str) -> Path:
    return Path(token_dir) / "garmin_rate_limit.json"


def is_rate_limited(token_dir: str) -> bool:
    p = rate_limit_path(token_dir)
    if not p.is_file():
        return False
    try:
        until = int(json.loads(p.read_text(encoding="utf-8")).get("until", 0))
        return int(time.time()) < until
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return False


def rate_limit_until(token_dir: str) -> int:
    p = rate_limit_path(token_dir)
    if not p.is_file():
        return 0
    try:
        return int(json.loads(p.read_text(encoding="utf-8")).get("until", 0))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 0


def check_rate_limit_cooldown(token_dir: str, for_login: bool = False):
    p = rate_limit_path(token_dir)
    if not p.is_file():
        return
    try:
        until = int(json.loads(p.read_text(encoding="utf-8")).get("until", 0))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return
    now = int(time.time())
    if now < until:
        wait_min = max(1, (until - now + 59) // 60)
        msg = (
            f"佳明仍在限流冷却，请约 {wait_min} 分钟后再试（佳明封禁可能 24h+，删本地冷却文件不能解封）"
            if for_login
            else f"佳明仍在限流冷却，请约 {wait_min} 分钟后再试"
        )
        emit_fail("rate_limited", msg)


def mark_rate_limit(token_dir: str):
    until = int(time.time()) + RATE_LIMIT_COOLDOWN_SEC
    try:
        rate_limit_path(token_dir).write_text(
            json.dumps({"until": until}, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


def clear_rate_limit(token_dir: str):
    try:
        rate_limit_path(token_dir).unlink(missing_ok=True)
    except OSError:
        pass


def network_routes(token_dir: str | None = None):
    direct = {"name": "direct", "proxies": {"http": None, "https": None}, "timeout": 75}
    v2ray_on = os.environ.get("ORBITA_V2RAY_RUNNING") == "1"
    cached = load_route_cache(token_dir) if token_dir else None

    proxy_candidates: list[dict] = []
    seen = set()

    def add_proxy(name: str, url: str):
        if not url or url in seen or not _proxy_alive(url):
            return
        seen.add(url)
        proxy_candidates.append(
            {"name": name, "proxies": {"http": url, "https": url}, "timeout": 60}
        )

    env_px = os.environ.get("ORBITA_HTTP_PROXY", "").strip()
    if env_px:
        add_proxy("env-proxy", _normalize_proxy(env_px) or env_px)

    ie_px = windows_ie_proxy()
    if ie_px:
        add_proxy("system-proxy", ie_px)

    if v2ray_on or _proxy_alive("http://127.0.0.1:10808"):
        add_proxy("v2ray-10808", "http://127.0.0.1:10808")

    if v2ray_on or _proxy_alive("http://127.0.0.1:7890"):
        add_proxy("v2ray-7890", "http://127.0.0.1:7890")

    if cached and cached != "direct":
        proxy_candidates.sort(key=lambda r: 0 if r["name"] == cached else 1)

    routes: list[dict] = []
    if cached == "direct":
        routes.append(direct)
    elif cached:
        hit = next((r for r in proxy_candidates if r["name"] == cached), None)
        if hit:
            routes.append(hit)
        else:
            routes.append(direct)
    else:
        routes.append(direct)

    for pr in proxy_candidates:
        if pr not in routes:
            routes.append(pr)
        if len(routes) >= 2:
            break

    return routes


def apply_route(route):
    global CURRENT_ROUTE
    CURRENT_ROUTE = route
    for key in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
    ):
        os.environ.pop(key, None)
    http_px = route["proxies"].get("http")
    if http_px:
        os.environ["HTTP_PROXY"] = http_px
        os.environ["HTTPS_PROXY"] = route["proxies"].get("https") or http_px
    else:
        os.environ["NO_PROXY"] = "*"
        os.environ["no_proxy"] = "*"


import requests

_OriginalRequestsSession = requests.Session


def _garmin_session(*args, **kwargs):
    s = _OriginalRequestsSession(*args, **kwargs)
    s.trust_env = False
    s.proxies = dict(CURRENT_ROUTE["proxies"])
    return s


requests.Session = _garmin_session
apply_route(CURRENT_ROUTE)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def emit_fail(reason: str, message: str):
    emit({"ok": False, "reason": reason, "message": message})
    raise SystemExit(1)


def progress(stage: str):
    print(json.dumps({"progress": stage}, ensure_ascii=False), file=sys.stderr)
    sys.stderr.flush()


class RouteTimeoutError(Exception):
    pass


def call_with_timeout(fn, timeout: float, timeout_message: str):
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(fn)
        try:
            return fut.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            raise RouteTimeoutError(timeout_message)


def token_usable(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 2


def token_file_path(token_dir: str) -> Path:
    return Path(token_dir) / "garmin_tokens.json"


def safe_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def safe_float(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_ts_seconds(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        n = int(v)
        if n > 1_000_000_000_000:
            return n // 1000
        if n > 1_000_000_000:
            return n
        return n
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return parse_ts_seconds(int(s))
        except ValueError:
            pass
        s = s.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except ValueError:
            return None
    return None


def error_rank(err: Exception) -> int:
    from garminconnect.exceptions import (
        GarminConnectAuthenticationError,
        GarminConnectTooManyRequestsError,
    )

    if isinstance(err, GarminConnectTooManyRequestsError):
        return 100
    if isinstance(err, GarminConnectAuthenticationError):
        return 90
    msg = str(err).lower()
    if "429" in msg or "rate limit" in msg or "too many" in msg:
        return 100
    if "invalid username" in msg or "401" in msg or "password" in msg:
        return 90
    if "mfa" in msg:
        return 85
    if _is_proxy_dead(err):
        return 20
    return 50


def _is_proxy_dead(err: Exception) -> bool:
    msg = str(err).lower()
    return ("proxy" in msg or "127.0.0.1" in msg) and any(
        k in msg for k in ("refused", "10061", "cannot connect", "积极拒绝", "proxyerror")
    )


def classify_error(err: Exception) -> str:
    rank = error_rank(err)
    if rank >= 100:
        return "rate_limited"
    if rank >= 90:
        return "token_invalid"
    if rank >= 85:
        return "mfa"
    if _is_proxy_dead(err):
        return "network_proxy"
    return "network_error"


def emit_login_failure(err: Exception, routes: list):
    rank = error_rank(err)
    v2ray_on = os.environ.get("ORBITA_V2RAY_RUNNING") == "1"
    if rank >= 100:
        emit_fail(
            "rate_limited",
            "佳明登录频率限制，请等待 24h+ 后再试（删本地冷却文件不能解佳明封禁）",
        )
    if rank >= 90:
        emit_fail("bad_credentials", "佳明邮箱或密码错误，请检查生活区凭据")
    if rank >= 85:
        emit_fail("mfa", "账号开启 MFA，本期不支持")
    if _is_proxy_dead(err):
        if v2ray_on:
            emit_fail(
                "network_proxy",
                "佳明登录失败：v2ray 已开但代理端口不通，请确认 HTTP 代理为 10808",
            )
        else:
            emit_fail(
                "network_proxy",
                "佳明登录失败：系统代理已启用但 v2ray 未开，请开启 v2rayN 或关闭 Windows 系统代理",
            )
    tried = ",".join(r["name"] for r in routes)
    emit_fail("internal", f"佳明登录失败（已试 {tried}）")


def connect_with_token(token_dir: str, token_file: Path):
    from garminconnect import Garmin

    if not token_file.is_file():
        return None, "no_token", "尚未登录佳明，请到设置填写邮箱密码并点击「重新登录佳明」"

    if not token_usable(token_file):
        return None, "no_token", "尚未登录佳明，请到设置填写邮箱密码并点击「重新登录佳明」"

    today = date.today().isoformat()
    routes = network_routes(token_dir)
    saw_proxy = False
    saw_auth = False
    saw_rate = False
    load_failed = False

    def try_token_session(route):
        nonlocal saw_proxy, saw_auth, saw_rate, load_failed
        apply_route(route)
        progress(f"token:{route['name']}")
        client = Garmin(retry_attempts=0, verify_login=False)
        path = str(Path(token_dir).resolve())
        client.client._tokenstore_path = path
        try:
            client.client.load(path)
        except Exception:
            load_failed = True
            return None

        try:
            if client.client.di_refresh_token and client.client._token_expires_soon():
                client.client._refresh_session()
        except Exception as e:
            r = classify_error(e)
            if r == "rate_limited":
                saw_rate = True
            elif r == "network_proxy":
                saw_proxy = True
            elif r == "token_invalid":
                saw_auth = True
            return None

        dn = load_display_name_cache(token_dir)
        if dn:
            client.display_name = dn
        else:
            try:
                prof = client.client.connectapi("/userprofile-service/socialProfile")
                if isinstance(prof, dict):
                    client.display_name = prof.get("displayName")
            except Exception as e:
                r = classify_error(e)
                if r == "rate_limited":
                    saw_rate = True
                elif r == "network_proxy":
                    saw_proxy = True
                elif r == "token_invalid":
                    saw_auth = True
                return None

        if not client.display_name:
            saw_auth = True
            return None

        try:
            stats = client.get_stats(today)
        except Exception as e:
            r = classify_error(e)
            if r == "rate_limited":
                saw_rate = True
            elif r == "network_proxy":
                saw_proxy = True
            elif r == "token_invalid":
                saw_auth = True
            return None
        if not isinstance(stats, dict) or not stats:
            saw_auth = True
            return None
        save_route_cache(token_dir, route["name"], client.display_name)
        clear_rate_limit(token_dir)
        return client

    for route in routes:
        client = try_token_session(route)
        if client:
            return client, None, None

    if saw_rate:
        return None, "rate_limited", "佳明请求频率限制，请稍后再试"
    if saw_auth or load_failed:
        return None, "token_invalid", "佳明 token 已失效，请到设置点击「重新登录佳明」获取新 token"
    if saw_proxy:
        v2ray_on = os.environ.get("ORBITA_V2RAY_RUNNING") == "1"
        if v2ray_on:
            return None, "network_proxy", "代理异常：v2ray 已开但端口不通，请确认 HTTP 代理为 10808"
        return None, "network_proxy", "代理异常：请开启 v2rayN（HTTP 10808）或关闭 Windows 系统代理"
    return None, "network_error", "网络连接失败，请检查网络后重试"


def sso_login_once(token_dir: str, email, password, route, today: str):
    from garminconnect import Garmin
    from garminconnect.exceptions import GarminConnectAuthenticationError

    apply_route(route)
    progress(f"sso:{route['name']}")
    path = str(Path(token_dir).resolve())
    client = Garmin(email, password, retry_attempts=0, verify_login=False)
    client.client.skip_strategies = {
        "mobile+cffi",
        "mobile+requests",
        "portal+cffi",
        "portal+requests",
    }
    client.client._tokenstore_path = path
    client.client.login(email, password)
    prof = client.client.connectapi("/userprofile-service/socialProfile")
    if not isinstance(prof, dict):
        raise GarminConnectAuthenticationError("social profile empty")
    client.display_name = prof.get("displayName") or email
    client.client.dump(path)
    stats = client.get_stats(today)
    if not isinstance(stats, dict) or not stats:
        raise GarminConnectAuthenticationError("stats empty after login")
    save_route_cache(token_dir, route["name"], client.display_name)
    return client


def date_range(start: str, end: str):
    d0 = date.fromisoformat(start)
    d1 = date.fromisoformat(end)
    if d1 < d0:
        d0, d1 = d1, d0
    cur = d0
    while cur <= d1:
        yield cur.isoformat()
        cur += timedelta(days=1)

def body_battery_hl(bb_list):
    highs, lows = [], []
    if not isinstance(bb_list, list):
        return None, None
    for item in bb_list:
        if not isinstance(item, dict):
            continue
        for key in ("bodyBatteryHighestValue", "highestValue", "high"):
            if key in item:
                highs.append(safe_int(item.get(key)))
        for key in ("bodyBatteryLowestValue", "lowestValue", "low"):
            if key in item:
                lows.append(safe_int(item.get(key)))
        vals = item.get("bodyBatteryValuesArray") or item.get("values")
        if isinstance(vals, list) and vals:
            nums = [safe_int(x) for x in vals if safe_int(x) is not None]
            if nums:
                highs.append(max(nums))
                lows.append(min(nums))
    highs = [x for x in highs if x is not None]
    lows = [x for x in lows if x is not None]
    if not highs and not lows:
        return None, None
    return (max(highs) if highs else None), (min(lows) if lows else None)


def map_naps(raw, dto):
    naps = []
    nap_list = (
        raw.get("naps")
        or dto.get("naps")
        or dto.get("napDTOList")
        or dto.get("dailyNapDTOS")
    )
    if isinstance(nap_list, list):
        for item in nap_list:
            if not isinstance(item, dict):
                continue
            start_ms = (
                item.get("napStartTimestampGMT")
                or item.get("startTimestampGMT")
                or item.get("sleepStartTimestampGMT")
            )
            end_ms = (
                item.get("napEndTimestampGMT")
                or item.get("endTimestampGMT")
                or item.get("sleepEndTimestampGMT")
            )
            dur = safe_int(
                item.get("napDuration")
                or item.get("durationInSeconds")
                or item.get("napTimeSeconds")
            )
            entry = {"source": "garmin"}
            start_sec = parse_ts_seconds(start_ms)
            end_sec = parse_ts_seconds(end_ms)
            if start_sec and end_sec:
                entry["start"] = start_sec
                entry["end"] = end_sec
            elif dur and dur > 0:
                entry["duration"] = dur
            else:
                continue
            naps.append(entry)
    nap_total = safe_int(dto.get("napTimeSeconds")) or 0
    if not naps and nap_total > 0:
        naps.append({"duration": nap_total, "source": "garmin"})
    return naps


def map_sleep_levels(raw):
    stage_map = {0: "deep", 1: "light", 2: "rem", 3: "awake"}
    levels = raw.get("sleepLevels") or []
    if not isinstance(levels, list):
        return []
    segments = []
    for entry in levels:
        if not isinstance(entry, dict):
            continue
        start = parse_ts_seconds(entry.get("startGMT") or entry.get("startTimestampGMT"))
        end = parse_ts_seconds(entry.get("endGMT") or entry.get("endTimestampGMT"))
        level = entry.get("activityLevel")
        if level is None:
            level = entry.get("sleepLevel")
        if level is None:
            continue
        try:
            stage_id = int(float(level))
        except (TypeError, ValueError):
            continue
        stage = stage_map.get(stage_id)
        if not stage or start is None or end is None or end <= start:
            continue
        segments.append({"start": start, "end": end, "stage": stage})
    return segments


def map_sleep(client, d: str):
    try:
        raw = client.get_sleep_data(d) or {}
    except Exception:
        return None
    dto = raw.get("dailySleepDTO") or {}
    if not dto.get("id"):
        return None
    deep = safe_int(dto.get("deepSleepSeconds")) or 0
    light = safe_int(dto.get("lightSleepSeconds")) or 0
    rem = safe_int(dto.get("remSleepSeconds")) or 0
    awake = safe_int(dto.get("awakeSleepSeconds")) or 0
    if deep + light + rem <= 0:
        return None
    start_sec = parse_ts_seconds(dto.get("sleepStartTimestampGMT"))
    end_sec = parse_ts_seconds(dto.get("sleepEndTimestampGMT"))
    if not start_sec or not end_sec:
        return None
    wake_date = dto.get("calendarDate") or d
    score = None
    scores = dto.get("sleepScores") or {}
    overall = scores.get("overall") if isinstance(scores, dict) else None
    if isinstance(overall, dict):
        score = safe_int(overall.get("value"))
    night = {
        "sleep": start_sec,
        "wake": end_sec,
        "source": "garmin",
        "stages": {"deep": deep, "light": light, "rem": rem, "awake": awake},
    }
    level_segments = map_sleep_levels(raw)
    if level_segments:
        night["levelSegments"] = level_segments
    if score is not None:
        night["score"] = score
    out = {"date": str(wake_date)[:10], "night": night}
    naps = map_naps(raw, dto)
    if naps:
        out["naps"] = naps
    return out


def map_intensity_minutes(stats, im_data=None):
    mod = safe_int(stats.get("moderateIntensityMinutes") if stats else None)
    vig = safe_int(stats.get("vigorousIntensityMinutes") if stats else None)
    if im_data and isinstance(im_data, dict):
        if mod is None:
            mod = safe_int(im_data.get("moderateValue") or im_data.get("moderateMinutes"))
        if vig is None:
            vig = safe_int(im_data.get("vigorousValue") or im_data.get("vigorousMinutes"))
    if mod is None and vig is None:
        return None
    return {"moderate": mod or 0, "vigorous": vig or 0}


def map_daily(client, d: str):
    data = {}
    stats = {}
    try:
        stats = client.get_stats(d) or {}
        data["steps"] = safe_int(stats.get("totalSteps"))
        data["activeCalories"] = safe_int(stats.get("activeKilocalories"))
        data["totalCalories"] = safe_int(stats.get("totalKilocalories"))
    except Exception:
        pass
    try:
        im = map_intensity_minutes(stats)
        if im is None:
            im_raw = client.get_intensity_minutes_data(d) or {}
            im = map_intensity_minutes({}, im_raw)
        if im is not None:
            data["intensityMinutes"] = im
    except Exception:
        pass
    try:
        hr = client.get_heart_rates(d) or {}
        data["restingHr"] = safe_int(hr.get("restingHeartRate"))
    except Exception:
        pass
    try:
        hyd = client.get_hydration_data(d) or {}
        ml = hyd.get("valueInML") or hyd.get("totalValueInML") or hyd.get("hydrationAmount")
        data["hydrationMl"] = safe_int(ml)
    except Exception:
        data["hydrationMl"] = None
    try:
        bb = client.get_body_battery(d, d) or []
        hi, lo = body_battery_hl(bb)
        if hi is not None or lo is not None:
            data["bodyBattery"] = {"high": hi, "low": lo}
    except Exception:
        pass
    enrich_daily_metrics(client, d, data)
    return {"date": d, "fetchedAt": int(time.time()), "data": data}


def sport_key(activity):
    t = activity.get("activityType") or activity.get("activityTypeDTO") or {}
    if isinstance(t, dict):
        return (t.get("typeKey") or t.get("typeId") or "").lower()
    return str(t).lower()


def normalize_sport(sk: str) -> str:
    if not sk:
        return "activity"
    if "cycling" in sk or "ride" in sk or "biking" in sk:
        return "cycling"
    if "run" in sk or "jog" in sk:
        return "running"
    if "walk" in sk or "hike" in sk:
        return "walking"
    return sk.split("_")[0] if "_" in sk else sk


def map_exercise(act):
    aid = str(act.get("activityId") or act.get("activityIdDTO") or "")
    if not aid:
        return None
    duration = safe_int(act.get("duration") or act.get("movingDuration") or act.get("elapsedDuration"))
    dist_m = safe_float(act.get("distance") or act.get("distanceDTO"))
    dist_km = round(dist_m / 1000.0, 3) if dist_m else None
    elev = safe_float(act.get("elevationGain") or act.get("elevationGainDTO"))
    avg_speed = safe_float(act.get("averageSpeed") or act.get("avgSpeed"))
    avg_speed_kmh = round(avg_speed * 3.6, 2) if avg_speed else None
    avg_power = safe_int(act.get("avgPower") or act.get("averagePower"))
    np = safe_int(act.get("normPower") or act.get("normalizedPower"))
    start = act.get("startTimeLocal") or act.get("startTimeGMT") or ""
    day = start[:10] if isinstance(start, str) and len(start) >= 10 else None
    start_ts = parse_ts_seconds(act.get("startTimeGMT") or act.get("startTimeLocal") or start)
    if not day or not start_ts:
        return None
    sk = sport_key(act)
    sport = normalize_sport(sk)
    metrics = {
        "startTime": start_ts,
        "distance": dist_m,
        "distance_km": dist_km,
        "elevation_gain_m": safe_int(elev) if elev is not None else None,
        "avg_speed_kmh": avg_speed_kmh,
        "avg_power_w": avg_power,
        "normalized_power": np,
    }
    return {
        "date": day,
        "externalId": aid,
        "sport": sport,
        "duration": duration or 0,
        "metrics": metrics,
    }


def map_body_measurement(client, d: str):
    try:
        raw = client.get_body_composition(d) or {}
    except Exception:
        return None
    weight = safe_float(raw.get("weight"))
    if weight is None:
        wlist = raw.get("dateWeightList") or raw.get("allWeightMetrics") or []
        if isinstance(wlist, list) and wlist:
            latest = wlist[-1]
            if isinstance(latest, dict):
                weight = safe_float(latest.get("weight"))
    if weight is None:
        return None
    if weight > 500:
        weight = weight / 1000.0
    ts = parse_ts_seconds(raw.get("measurementTimeInGMT") or raw.get("timestampGMT"))
    ext_id = f"garmin-weight-{d}-{int(ts or 0)}"
    return {
        "date": d,
        "externalId": ext_id,
        "weightKg": round(weight, 2),
    }


def fetch_activities(client, from_date: str, to_date: str, max_pages: int = 15):
    activities = []
    start = 0
    limit = 20
    url = client.garmin_connect_activities
    params = {
        "startDate": from_date,
        "start": "0",
        "limit": str(limit),
        "endDate": to_date,
    }
    for _ in range(max_pages):
        params["start"] = str(start)
        act = client.connectapi(url, params=params)
        if not act:
            break
        if not isinstance(act, list):
            break
        activities.extend(act)
        if len(act) < limit:
            break
        start += limit
    return activities


def fetch_activities_with_evidence(client, from_date: str, to_date: str, max_pages: int = 15):
    """Fetch a bounded activity list and report whether the final page was observed.

    An empty/short page is explicit terminal evidence. Hitting the page cap is never
    reported complete, even when the last page happens to be short due to provider quirks.
    """
    activities = []
    start, limit = 0, 20
    url = client.garmin_connect_activities
    params = {"startDate": from_date, "start": "0", "limit": str(limit), "endDate": to_date}
    seen_offsets = set()
    terminal = False
    pages = 0
    for _ in range(max_pages):
        if start in seen_offsets:
            break
        seen_offsets.add(start)
        params["start"] = str(start)
        page = client.connectapi(url, params=params)
        pages += 1
        if not isinstance(page, list):
            break
        activities.extend(page)
        if len(page) < limit:
            terminal = True
            break
        start += limit
    ids = [str(x.get("activityId") or x.get("activityIdDTO") or x.get("id") or "") for x in activities]
    duplicate_ids = len([x for x in ids if x]) != len(set(x for x in ids if x))
    return activities, {"pages": pages, "terminalPageObserved": terminal,
                        "offsets": sorted(seen_offsets), "duplicateActivityIds": duplicate_ids,
                        "complete": terminal and not duplicate_ids}


def values_array_from(raw, *keys):
    if not isinstance(raw, dict):
        return None
    for key in keys:
        arr = raw.get(key)
        if isinstance(arr, list) and arr:
            return arr
    return None


def map_pair_array(arr, value_index=1):
    samples = []
    if not isinstance(arr, list):
        return samples
    for item in arr:
        if not isinstance(item, (list, tuple)) or len(item) <= value_index:
            continue
        ts = parse_ts_seconds(item[0])
        val = safe_float(item[value_index])
        if val is None:
            val = safe_int(item[value_index])
        if ts is not None and val is not None:
            samples.append({"t": ts, "v": val})
    return samples


def map_hrv_readings(raw):
    samples = []
    if not isinstance(raw, dict):
        return samples
    readings = raw.get("hrvReadings")
    if not isinstance(readings, list):
        return samples
    for entry in readings:
        if not isinstance(entry, dict):
            continue
        ts = parse_ts_seconds(entry.get("readingTimeGMT") or entry.get("readingTimeLocal"))
        val = safe_float(entry.get("hrvValue"))
        if val is None:
            val = safe_int(entry.get("hrvValue"))
        if ts is not None and val is not None:
            samples.append({"t": ts, "v": val})
    return samples


def _sleep_spo2_base_sec(container, dto):
    for src in (container, dto):
        if not isinstance(src, dict):
            continue
        for key in (
            "startTimeInSeconds",
            "StartTimeInSeconds",
            "sleepStartTimestampGMT",
            "sleepStartTimestampLocal",
            "startGMT",
            "startTimestampGMT",
        ):
            ts = parse_ts_seconds(_dict_get_ci(src, key))
            if ts is not None:
                return ts
    return None


def _spo2_sample(t, v, src):
    return {"t": t, "v": v, "src": src}


def _append_spo2_offset_map(samples, offsets, base, src="daily_offset"):
    if base is None or not isinstance(offsets, dict):
        return
    for offset, val in offsets.items():
        try:
            off = int(offset)
        except (TypeError, ValueError):
            continue
        if off < 0:
            continue
        v = _valid_spo2_value(val)
        if v is not None:
            samples.append(_spo2_sample(base + off, v, src))


def map_sleep_spo2_samples(client, d: str):
    samples = []
    try:
        sleep_raw = client.get_sleep_data(d) or {}
        dto = sleep_raw.get("dailySleepDTO") or {}
        spo2_block = sleep_raw.get("sleepSpO2Summary") or dto.get("sleepSpO2Summary")
        for container in (sleep_raw, dto, spo2_block if isinstance(spo2_block, dict) else None):
            if not isinstance(container, dict):
                continue
            offsets = _dict_get_ci(
                container,
                "timeOffsetSleepSpo2",
                "TimeOffsetSleepSpo2",
                "timeOffsetSpo2Values",
                "TimeOffsetSpo2Values",
            )
            if isinstance(offsets, dict):
                _append_spo2_offset_map(samples, offsets, _sleep_spo2_base_sec(container, dto), "sleep_offset")
        epoch_list = sleep_raw.get("wellnessEpochSPO2DataDTOList")
        if not isinstance(epoch_list, list):
            epoch_list = dto.get("wellnessEpochSPO2DataDTOList")
        if not isinstance(epoch_list, list) and isinstance(spo2_block, dict):
            epoch_list = spo2_block.get("wellnessEpochSPO2DataDTOList") or spo2_block.get("epochData")
        if isinstance(epoch_list, list):
            for entry in epoch_list:
                if not isinstance(entry, dict):
                    continue
                ts = parse_ts_seconds(
                    entry.get("epochTimestamp")
                    or entry.get("startGMT")
                    or entry.get("timestampGMT")
                    or entry.get("startTimeInSeconds")
                    or entry.get("StartTimeInSeconds")
                    or entry.get("readingTimeGMT")
                )
                val = _valid_spo2_value(entry.get("spo2Reading") or entry.get("spO2Reading") or entry.get("value") or entry)
                if ts is not None and val is not None:
                    samples.append(_spo2_sample(ts, val, "sleep_epoch"))
    except Exception:
        pass
    return samples


def _dict_get_ci(raw, *keys):
    if not isinstance(raw, dict):
        return None
    lower = {str(k).lower(): v for k, v in raw.items()}
    for key in keys:
        if key in raw:
            return raw[key]
        v = lower.get(str(key).lower())
        if v is not None:
            return v
    return None


def _spo2_reading_value(entry):
    if entry is None:
        return None
    if isinstance(entry, (int, float)):
        return safe_float(entry)
    if isinstance(entry, dict):
        return safe_float(
            entry.get("spo2Reading")
            or entry.get("spO2Reading")
            or entry.get("value")
            or entry.get("reading")
        )
    return safe_float(entry)


def _valid_spo2_value(entry):
    val = _spo2_reading_value(entry)
    if val is None:
        return None
    if val < 50 or val > 100:
        return None
    return val


def _parse_spo2_batch(raw, d: str):
    samples = []
    if not isinstance(raw, dict):
        return samples

    start = None
    for key in (
        "startTimeInSeconds",
        "StartTimeInSeconds",
        "startTimestampGMT",
        "startTimestamp",
        "startGMT",
    ):
        start = parse_ts_seconds(_dict_get_ci(raw, key))
        if start is not None:
            break
    day_start = parse_ts_seconds(f"{d}T00:00:00+08:00")
    if start is None:
        start = day_start

    offsets = _dict_get_ci(
        raw,
        "timeOffsetSpo2Values",
        "TimeOffsetSpo2Values",
        "spo2OffsetValues",
        "offsetSpo2Values",
    )
    if isinstance(offsets, dict):
        base = (
            parse_ts_seconds(_dict_get_ci(raw, "startTimeInSeconds", "StartTimeInSeconds"))
            or parse_ts_seconds(_dict_get_ci(raw, "startTimestampGMT"))
            or start
        )
        _append_spo2_offset_map(samples, offsets, base, "daily_offset")

    if not samples and isinstance(offsets, list):
        base = start
        for item in offsets:
            if not isinstance(item, dict):
                continue
            off = item.get("offset") or item.get("timeOffset") or item.get("timeOffsetInSeconds")
            try:
                off = int(off)
            except (TypeError, ValueError):
                continue
            if off < 0:
                continue
            v = _valid_spo2_value(item)
            if v is None:
                v = _valid_spo2_value(item.get("value") or item.get("spo2Reading"))
            if base is not None and v is not None:
                samples.append(_spo2_sample(base + off, v, "daily_offset"))

    if not samples:
        epoch_list = _dict_get_ci(
            raw,
            "wellnessEpochSPO2DataDTOList",
            "spO2ReadingsDTOList",
            "readings",
        )
        if isinstance(epoch_list, list):
            for entry in epoch_list:
                if not isinstance(entry, dict):
                    continue
                ts = parse_ts_seconds(
                    entry.get("epochTimestamp")
                    or entry.get("startGMT")
                    or entry.get("timestampGMT")
                    or entry.get("startTimeInSeconds")
                    or entry.get("StartTimeInSeconds")
                )
                val = _valid_spo2_value(entry)
                if ts is not None and val is not None:
                    samples.append(_spo2_sample(ts, val, "epoch"))

    if not samples:
        arr = values_array_from(
            raw,
            "spO2HourlyAverages",
            "spo2HourlyAverages",
            "spO2ValuesArray",
            "spo2ValuesArray",
            "values",
            "spO2SingleValues",
        )
        if arr:
            for item in arr:
                if not isinstance(item, (list, tuple)) or len(item) < 2:
                    continue
                t_raw = item[0]
                val = _valid_spo2_value(item[1])
                if val is None:
                    continue
                ts = parse_ts_seconds(t_raw)
                if ts is None:
                    continue
                if ts < 200000 and start is not None:
                    ts = start + int(ts)
                elif ts < 200000 and day_start is not None:
                    ts = day_start + int(ts)
                samples.append(_spo2_sample(ts, val, "hourly"))
    return samples


def _fetch_spo2_raw(client, d: str):
    try:
        raw = client.get_spo2_data(d)
        if raw:
            return raw
    except Exception:
        pass
    garth = getattr(client, "client", client)
    connectapi = getattr(garth, "connectapi", None)
    if not callable(connectapi):
        return {}
    for path in (
        f"/wellness-service/wellness/daily/spo2/{d}",
        f"/wellness-service/wellness/spo2/{d}",
    ):
        try:
            raw = connectapi(path)
            if raw:
                return raw
        except Exception:
            continue
    return {}


def map_daily_spo2_samples(client, d: str):
    samples = []
    raw = _fetch_spo2_raw(client, d)
    batches = []
    if isinstance(raw, list):
        batches = [x for x in raw if isinstance(x, dict)]
    elif isinstance(raw, dict):
        nested = _dict_get_ci(raw, "pulseOx", "pulseOxSummary", "spO2Summary")
        if isinstance(nested, dict):
            batches = [nested]
        elif isinstance(nested, list):
            batches = [x for x in nested if isinstance(x, dict)]
        else:
            batches = [raw]
    for batch in batches:
        samples.extend(_parse_spo2_batch(batch, d))
    return samples


def map_spo2_samples(client, d: str):
    daily = map_daily_spo2_samples(client, d)
    sleep = map_sleep_spo2_samples(client, d)
    merged = {s["t"]: s for s in daily}
    for s in sleep:
        merged[s["t"]] = s
    return sorted(merged.values(), key=lambda s: s["t"])


def enrich_daily_metrics(client, d: str, data: dict):
    try:
        stress = client.get_stress_data(d) or {}
        avg = safe_int(stress.get("avgStressLevel"))
        if avg is not None:
            data["avgStress"] = avg
    except Exception:
        pass
    try:
        spo2 = client.get_spo2_data(d) or {}
        avg = safe_float(
            spo2.get("averageSpO2")
            or spo2.get("avgSpO2")
            or spo2.get("lowestSpO2")
            or spo2.get("lastSevenDaysAvgSpO2")
        )
        if avg is not None:
            data["spo2Avg"] = avg
    except Exception:
        pass
    try:
        hrv = client.get_hrv_data(d) or {}
        if isinstance(hrv, dict):
            nightly = safe_float(
                hrv.get("lastNightAvg")
                or hrv.get("weeklyAvg")
                or hrv.get("hrvSummary")
            )
            if nightly is None and isinstance(hrv.get("hrvReadings"), list) and hrv["hrvReadings"]:
                last = hrv["hrvReadings"][-1]
                if isinstance(last, dict):
                    nightly = safe_float(last.get("hrvValue"))
            if nightly is not None:
                data["hrvNightly"] = nightly
    except Exception:
        pass
    return data


def map_series_samples(raw, value_keys):
    samples = []
    if not raw:
        return samples
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                ts = parse_ts_seconds(item[0])
                val = safe_float(item[1])
                if val is None:
                    val = safe_int(item[1])
                if ts is not None:
                    samples.append({"t": ts, "v": val})
            elif isinstance(item, dict):
                ts = parse_ts_seconds(item.get("startGMT") or item.get("timestampGMT"))
                val = None
                for key in value_keys:
                    if key in item and item[key] is not None:
                        val = safe_float(item[key])
                        if val is None:
                            val = safe_int(item[key])
                        break
                if ts is not None:
                    samples.append({"t": ts, "v": val})
    elif isinstance(raw, dict):
        arr = (
            raw.get("heartRateValues")
            or raw.get("stressValuesArray")
            or raw.get("stressValues")
            or raw.get("bodyBatteryValuesArray")
            or raw.get("respirationValuesArray")
            or raw.get("values")
        )
        if isinstance(arr, list):
            samples = map_series_samples(arr, value_keys)
    return samples


def map_steps_cumulative(client, d: str):
    samples = []
    try:
        raw = client.get_steps_data(d) or []
    except Exception:
        return samples
    if not isinstance(raw, list):
        return samples
    cumulative = 0
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        ts = parse_ts_seconds(entry.get("startGMT") or entry.get("endGMT"))
        delta = safe_int(entry.get("steps")) or 0
        cumulative += delta
        if ts is not None:
            samples.append({"t": ts, "v": cumulative})
    return samples


def map_metric_snapshot(client, d: str, metric: str):
    samples = []
    coverage = None
    try:
        if metric == "hr":
            raw = client.get_heart_rates(d) or {}
            arr = raw.get("heartRateValues") if isinstance(raw, dict) else raw
            samples = map_series_samples(arr or raw, [])
        elif metric == "stress":
            raw = client.get_stress_data(d) or {}
            arr = values_array_from(raw, "stressValuesArray", "stressValues")
            samples = map_pair_array(arr, 1) if arr else map_series_samples([raw], ["stressLevel", "value"])
        elif metric == "body_battery":
            stress_raw = client.get_stress_data(d) or {}
            arr = values_array_from(stress_raw, "bodyBatteryValuesArray", "bodyBatteryValues")
            if arr:
                samples = map_pair_array(arr, 2)
            if not samples:
                raw = client.get_body_battery(d, d) or []
                if isinstance(raw, list) and raw and isinstance(raw[0], dict):
                    arr = values_array_from(raw[0], "bodyBatteryValuesArray", "bodyBatteryValues")
                    if arr:
                        samples = map_pair_array(arr, 1 if len(arr[0]) <= 2 else 2)
                    else:
                        samples = map_series_samples(raw[0].get("bodyBatteryValuesArray") or raw, [])
                else:
                    samples = map_series_samples(raw, [])
        elif metric == "spo2":
            samples = map_spo2_samples(client, d)
        elif metric == "respiration":
            raw = client.get_respiration_data(d) or {}
            arr = values_array_from(raw, "respirationValuesArray", "respirationValues")
            samples = map_pair_array(arr, 1) if arr else map_series_samples([raw], ["respirationValue", "value"])
        elif metric == "hrv":
            raw = client.get_hrv_data(d) or {}
            samples = map_hrv_readings(raw)
            if not samples:
                samples = map_series_samples(raw if isinstance(raw, list) else [raw], ["hrvValue", "value"])
        elif metric in ("steps", "steps_cumulative"):
            samples = map_steps_cumulative(client, d)
    except Exception:
        pass
    valid = [s for s in samples if s.get("v") is not None]
    if samples:
        coverage = len(valid) / len(samples)
    return {
        "metric": metric,
        "localDate": d,
        "samples": samples,
        "coverage": coverage,
        "sampleCount": len(samples),
        "validCount": len(valid),
    }


def probe_series(client, d: str):
    metrics = ["hr", "stress", "body_battery", "spo2", "respiration", "hrv", "steps_cumulative"]
    out = {}
    for m in metrics:
        snap = map_metric_snapshot(client, d, m)
        out[m] = {
            "sampleCount": snap["sampleCount"],
            "validCount": snap["validCount"],
            "coverage": snap["coverage"],
        }
    return out


def fetch_day_series(client, d: str):
    metrics = ["hr", "stress", "body_battery", "spo2", "respiration", "hrv", "steps_cumulative"]
    out = []
    for m in metrics:
        snap = map_metric_snapshot(client, d, m)
        if snap["sampleCount"] > 0:
            out.append(snap)
    return out
