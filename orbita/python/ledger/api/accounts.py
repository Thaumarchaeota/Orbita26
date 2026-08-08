from fastapi import APIRouter

from ledger.services.accounts import list_accounts

router = APIRouter()


@router.get("/accounts")
def get_accounts():
    return list_accounts()
