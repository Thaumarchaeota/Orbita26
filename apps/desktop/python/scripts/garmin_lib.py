import json
import logging
import os
import socket
import sys
import time
import warnings
from datetime import date, datetime, timedelta
from pathlib import Path

warnings.filterwarnings("ignore")
logging.getLogger("garminconnect").setLevel(logging.CRITICAL)

CURRENT_ROUTE = {"name": "direct", "proxies": {"http": None, "https": None}}

RATE_LIMIT_COOLDOWN_SEC = 6 * 3600
SLEEP_LOOKBACK_DAYS = 7


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
            return int(datetime.fromisoformat(s).timestamp())
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


def in_sleep_window(d: str, to_date: str) -> bool:
    end = date.fromisoformat(to_date)
    cur = date.fromisoformat(d)
    return (end - cur).days < SLEEP_LOOKBACK_DAYS


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
    return {"date": d, "fetchedAt": int(time.time()), "data": data}


def sport_key(activity):
    t = activity.get("activityType") or activity.get("activityTypeDTO") or {}
    if isinstance(t, dict):
        return (t.get("typeKey") or t.get("typeId") or "").lower()
    return str(t).lower()


def map_exercise(act):
    sk = sport_key(act)
    if "cycling" not in sk and "ride" not in sk and "biking" not in sk:
        return None
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
    if not day:
        return None
    metrics = {
        "distance_km": dist_km,
        "elevation_gain_m": safe_int(elev) if elev is not None else None,
        "avg_speed_kmh": avg_speed_kmh,
        "avg_power_w": avg_power,
        "normalized_power": np,
    }
    return {
        "date": day,
        "externalId": aid,
        "sport": "cycling",
        "duration": duration or 0,
        "metrics": metrics,
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
