from pydantic import BaseModel, Field


class PostingModel(BaseModel):
    account: str
    amount: float | None = None
    currency: str = ""
    price_amount: float | None = None
    price_currency: str = ""
    cost_amount: float | None = None
    cost_currency: str = ""
    lot_amount: float | None = None
    lot_currency: str = ""
    lot_date: str = ""


class MetadataModel(BaseModel):
    key: str
    value: str


class EntryModel(BaseModel):
    kind: str = "transaction"
    id: str = ""
    source_file: str
    source_line: int = 0
    type: str = ""
    date: str
    flag: str = "*"
    payee: str = ""
    remark: str = ""
    tags: str = ""
    postings: list[PostingModel] = Field(default_factory=list)
    metadata: list[MetadataModel] = Field(default_factory=list)
    seq: str = ""
    account: str = ""
    source_account: str = ""
    amount: str = ""
    currency: str = ""
