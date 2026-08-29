from fastapi import APIRouter, Header, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.services.settings import (
    SettingsRevisionConflict,
    SettingsSchemaVersionError,
    get_settings,
    save_settings,
    settings_etag,
)

router = APIRouter()


class SettingsModel(BaseModel):
    write_target: str
    reporting_currency: str | None = None
    card_stripes: dict[str, str] | None = None
    settings_revision: int | None = None
    expected_settings_revision: int | None = None
    filter_presets_schema_version: int | None = None
    filter_presets_version: int | None = None
    filter_presets: list[dict] | None = None


@router.get("/settings")
def read_settings(response: Response):
    payload = get_settings()
    response.headers["ETag"] = settings_etag(payload.get("settings_revision"))
    return payload


@router.put("/settings")
def update_settings(
    req: SettingsModel,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
):
    body = req.model_dump(exclude_none=True)
    if if_match and "expected_settings_revision" not in body:
        trimmed = if_match.strip().strip('"')
        if trimmed.startswith("settings-revision-"):
            try:
                body["expected_settings_revision"] = int(trimmed.removeprefix("settings-revision-"))
            except ValueError:
                pass
    try:
        saved = save_settings(body)
    except SettingsRevisionConflict as exc:
        return JSONResponse(
            status_code=409,
            content={
                "error": str(exc),
                "settings_revision": exc.current,
            },
            headers={"ETag": settings_etag(exc.current)},
        )
    except SettingsSchemaVersionError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    response.headers["ETag"] = settings_etag(saved.get("settings_revision"))
    return saved
