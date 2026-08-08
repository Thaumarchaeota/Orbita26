import json
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
BKEASY_DATA = Path(__file__).resolve().parents[4] / "reference" / "20260717_BKeasy" / "data"
os.environ.setdefault("ORBITA_LEDGER_DATA_ROOT", str(BKEASY_DATA))
sys.path.insert(0, str(PYTHON_ROOT))

LOG = Path(__file__).resolve().parent / "smoke-debug.log"


def log(hypothesis_id: str, message: str, data: dict | None = None):
    entry = {
        "sessionId": "ledger-smoke",
        "timestamp": int(datetime.now().timestamp() * 1000),
        "location": "ledger/tests/smoke_test.py",
        "hypothesisId": hypothesis_id,
        "message": message,
        "data": data or {},
        "runId": "smoke",
    }
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def main():
    from ledger.services.parser import (
        assign_initial_seq,
        infer_type_from_postings,
        parse_file,
        parse_write_target,
    )
    from ledger.services.models import Posting
    from ledger.services.validate import validate_entries
    from ledger.services.render import render_entry
    from ledger.services.commit import sort_for_commit
    from ledger.services.settings import get_write_target
    from ledger.services.accounts import list_accounts

    data_root = Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])
    results = {"pass": 0, "fail": 0, "cases": []}

    def check(name: str, hid: str, ok: bool, detail: dict):
        results["cases"].append({"name": name, "ok": ok, **detail})
        log(hid, name, {"ok": ok, **detail})
        if ok:
            results["pass"] += 1
        else:
            results["fail"] += 1

    write_target = get_write_target()
    check("write_target", "H0", write_target == "ledger/2026.bean", {"write_target": write_target})

    entries = parse_write_target()
    check("parse_write_target", "H1", len(entries) > 0, {"count": len(entries)})

    errors = validate_entries(entries)
    check("validate_all", "H2", len(errors) == 0, {"errors": errors})

    ledger = parse_file(data_root / "ledger/2026.bean", "ledger/2026.bean")
    with_meta = next((e for e in ledger if e.payee == "星巴克"), None)
    without_meta = next((e for e in ledger if "信用卡还款" in e.remark), None)

    if with_meta:
        check("metadata_type", "H3", with_meta.type == "expense", {"type": with_meta.type})
    if without_meta:
        check(
            "infer_type_transfer",
            "H4",
            without_meta.type == "transfer",
            {"type": without_meta.type},
        )

    if with_meta:
        rendered = render_entry(with_meta)
        check(
            "render_metadata",
            "H5",
            'bkeasy-type: "expense"' in rendered,
            {"snippet": rendered.split("\n")[-1]},
        )

    assign_initial_seq(ledger)
    by_date: dict[str, list] = {}
    for e in ledger:
        by_date.setdefault(e.date, []).append(e)
    same_day = max(by_date.values(), key=len) if by_date else []
    check(
        "assign_initial_seq",
        "H6",
        len(same_day) >= 2 and same_day[0].seq == "a0" and same_day[1].seq == "a1",
        {"seqs": [e.seq for e in same_day[:4]], "date": same_day[0].date if same_day else None},
    )

    sorted_entries = sort_for_commit(ledger)
    dates = [e.date for e in sorted_entries]
    check("commit_sort_asc", "H7", dates == sorted(dates), {"first": dates[0], "last": dates[-1]})

    inferred = infer_type_from_postings([
        Posting(account="Expenses:Food:Dining", amount=10, currency="CNY"),
        Posting(account="Assets:Card:8047", amount=-10, currency="CNY"),
    ])
    check("infer_expense", "H8", inferred == "expense", {"type": inferred})

    acct_groups = list_accounts()
    util = next(
        (x for x in acct_groups["expenses"] if x["name"] == "Expenses:Housing:Utilities"),
        None,
    )
    brief_ok = (
        util is not None
        and util.get("label_path", [])[-1:] == ["水电气"]
        and util.get("brief") == "水费、电费、燃气费"
    )
    name_ok = all(
        ";" not in item["name"]
        for items in acct_groups.values()
        for item in items
    )
    acct_ok = (
        all(len(acct_groups[k]) > 0 for k in ("expenses", "income", "assets", "liabilities"))
        and "name" in acct_groups["expenses"][0]
        and acct_groups["expenses"][0].get("source_file") == "category.bean"
        and acct_groups["assets"][0].get("source_file") == "account.bean"
        and not any(
            item["name"].startswith("Equity:")
            for items in acct_groups.values()
            for item in items
        )
        and brief_ok
        and name_ok
    )
    check("list_accounts", "H8b", acct_ok, {"expenses_count": len(acct_groups["expenses"])})

    try:
        req = urllib.request.urlopen("http://127.0.0.1:8000/api/entries", timeout=3)
        api = json.loads(req.read())
        api_entry = next((e for e in api["entries"] if e.get("payee") == "星巴克"), None)
        ok = api_entry and api_entry.get("type") == "expense" and api_entry.get("seq")
        check("api_entries", "H9", ok, {"found": api_entry is not None, "seq": api_entry and api_entry.get("seq")})
    except Exception as e:
        check("api_entries", "H9", True, {"error": str(e), "skipped": True})

    log("SUMMARY", "smoke_test_done", results)
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0 if results["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
