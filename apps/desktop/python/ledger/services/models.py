from dataclasses import dataclass, asdict
from typing import Literal

EntryType = Literal["expense", "income", "transfer", "inv"]


@dataclass
class Posting:
    account: str
    amount: float
    currency: str
    cost_amount: float | None = None
    cost_currency: str = ""


@dataclass
class Entry:
    id: str
    source_file: str
    source_line: int
    type: EntryType
    date: str
    flag: str
    payee: str
    remark: str
    tags: str
    postings: list[Posting]
    seq: str = ""

    def to_dict(self) -> dict:
        return asdict(self)
