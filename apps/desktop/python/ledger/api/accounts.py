from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.services.account_create import create_account
from ledger.services.account_delete import delete_account
from ledger.services.account_label_commit import commit_account_labels
from ledger.services.account_delete_scan import scan_account_delete
from ledger.services.account_migrate import (
    commit_account_migration,
    scan_account_migration,
    validate_account_migration,
)
from ledger.services.accounts import list_accounts

router = APIRouter()


class AccountNameRequest(BaseModel):
    name: str


class AccountDeleteScanRequest(BaseModel):
    name: str


class AccountCreateRequest(BaseModel):
    name: str
    open_date: str = "2026-01-01"
    extra: str = ""
    label: str = ""


class AccountMigrateScanRequest(BaseModel):
    old_name: str
    new_name: str


class AccountMigrateCommitRequest(BaseModel):
    old_name: str
    new_name: str
    validation_token: str
    candidate_hash: str


class AccountLabelModel(BaseModel):
    name: str
    source_file: str
    source_line: int
    label: str = ""
    open_date: str = "2026-01-01"
    extra: str = ""


class AccountLabelCommitRequest(BaseModel):
    accounts: list[AccountLabelModel]


@router.get("/accounts")
def get_accounts():
    return list_accounts()


@router.post("/accounts/delete-scan")
def account_delete_scan(req: AccountDeleteScanRequest):
    try:
        return scan_account_delete(req.name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@router.post("/accounts/delete")
def account_delete(req: AccountNameRequest):
    try:
        return delete_account(req.name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@router.post("/accounts/create")
def account_create(req: AccountCreateRequest):
    try:
        return create_account(
            req.name,
            open_date=req.open_date,
            extra=req.extra,
            label=req.label,
        )
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@router.post("/accounts/migrate/scan")
def account_migrate_scan(req: AccountMigrateScanRequest):
    try:
        return scan_account_migration(req.old_name, req.new_name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@router.post("/accounts/migrate/validate")
def account_migrate_validate(req: AccountMigrateScanRequest):
    try:
        return validate_account_migration(req.old_name, req.new_name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@router.post("/accounts/migrate/commit")
def account_migrate_commit(req: AccountMigrateCommitRequest):
    try:
        return commit_account_migration(
            req.old_name,
            req.new_name,
            validation_token=req.validation_token,
            candidate_hash=req.candidate_hash,
        )
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@router.post("/accounts/label")
def account_label_commit(req: AccountLabelCommitRequest):
    if not req.accounts:
        return JSONResponse(status_code=400, content={"ok": False, "error": "无账户可提交"})
    try:
        commit_account_labels([a.model_dump() for a in req.accounts])
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
    return {"ok": True}
