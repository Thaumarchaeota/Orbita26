"""Exact one-sheet wallet XLSX profile with formula/cache inspection only."""

from __future__ import annotations

import io
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

from ..contract import AmountObservation, ExternalId, UntrustedObservation
from .common import AdapterFailure, ProfileOutput, coverage, make_date, occurrence, raw_field

PROFILE_ID = "wallet-xlsx-11/v1"
PROFILE_REVISION = "1"
DETECTED_FORMAT = "xlsx"
SHEET_NAME = "Sheet1"
HEADERS = (
    "交易时间",
    "交易类型",
    "交易对方",
    "商品",
    "收/支",
    "金额(元)",
    "支付方式",
    "当前状态",
    "交易单号",
    "商户单号",
    "备注",
)
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
COL_LETTER = re.compile(r"([A-Z]+)")


def _column_number(letters: str) -> int:
    result = 0
    for char in letters:
        result = result * 26 + ord(char) - ord("A") + 1
    return result


def detect_format(data: bytes) -> str:
    if len(data) >= 4 and data[:2] == b"PK":
        return "xlsx"
    return "unknown"


def _preflight(data: bytes, limits) -> tuple[zipfile.ZipFile, dict[str, str]]:
    archive = zipfile.ZipFile(io.BytesIO(data), "r")
    infos = archive.infolist()
    if len(infos) > limits.zip_entries:
        archive.close()
        raise AdapterFailure("resource_xlsx_zip_entries", DETECTED_FORMAT)
    total = 0
    names: set[str] = set()
    for info in infos:
        normalized = posixpath.normpath(info.filename.replace("\\", "/"))
        if normalized.startswith("../") or normalized.startswith("/") or normalized == "..":
            archive.close()
            raise AdapterFailure("xlsx_unsafe_zip_path", DETECTED_FORMAT)
        if normalized in names:
            archive.close()
            raise AdapterFailure("xlsx_duplicate_zip_entry", DETECTED_FORMAT)
        names.add(normalized)
        if info.flag_bits & 1:
            archive.close()
            raise AdapterFailure("xlsx_encrypted_entry", DETECTED_FORMAT)
        if info.file_size > limits.zip_entry_bytes:
            archive.close()
            raise AdapterFailure("resource_xlsx_entry_bytes", DETECTED_FORMAT)
        total += info.file_size
        if info.file_size and info.file_size / max(info.compress_size, 1) > limits.zip_compression_ratio:
            archive.close()
            raise AdapterFailure("resource_xlsx_compression_ratio", DETECTED_FORMAT)
    if total > limits.zip_uncompressed_bytes:
        archive.close()
        raise AdapterFailure("resource_xlsx_uncompressed_bytes", DETECTED_FORMAT)
    if "xl/vbaProject.bin" in names:
        archive.close()
        raise AdapterFailure("xlsx_macro_payload_unsupported", DETECTED_FORMAT)
    if "xl/workbook.xml" not in names or "xl/_rels/workbook.xml.rels" not in names:
        archive.close()
        raise AdapterFailure("malformed_xlsx_container", DETECTED_FORMAT)

    workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
    rel_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationships = {
        item.attrib["Id"]: item.attrib["Target"]
        for item in rel_root.findall(f"{{{NS_PKG}}}Relationship")
        if "Id" in item.attrib and "Target" in item.attrib
    }
    sheet_paths: dict[str, str] = {}
    for sheet in workbook_root.findall(f".//{{{NS_MAIN}}}sheet"):
        relation_id = sheet.attrib.get(f"{{{NS_REL}}}id")
        target = relationships.get(relation_id or "")
        if target:
            path = posixpath.normpath(
                target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
            )
            sheet_paths[sheet.attrib.get("name", "")] = path
    return archive, sheet_paths


def _xml_sheet_metadata(archive: zipfile.ZipFile, path: str, limits):
    if path not in archive.namelist():
        raise AdapterFailure("xlsx_sheet_part_missing", DETECTED_FORMAT)
    cells: dict[tuple[int, str], dict[str, str | None]] = {}
    hidden_rows: set[int] = set()
    merges: list[str] = []
    auto_filter = False
    row_count = 0
    nonempty_cells = 0
    extra_column_rows: set[int] = set()
    with archive.open(path) as stream:
        for _, element in ET.iterparse(stream, events=("end",)):
            local = element.tag.rsplit("}", 1)[-1]
            if local == "row":
                row_count += 1
                row_number = int(element.attrib.get("r", row_count))
                if row_count > limits.xlsx_rows_per_sheet:
                    raise AdapterFailure("resource_xlsx_rows", DETECTED_FORMAT)
                if element.attrib.get("hidden") in {"1", "true", "True"}:
                    hidden_rows.add(row_number)
                for cell in element:
                    if cell.tag.rsplit("}", 1)[-1] != "c":
                        continue
                    ref = cell.attrib.get("r", "")
                    col_match = COL_LETTER.match(ref)
                    if not col_match:
                        continue
                    children = {child.tag.rsplit("}", 1)[-1]: child for child in cell}
                    formula = children.get("f")
                    value = children.get("v")
                    inline = children.get("is")
                    cell_data = {
                        "type": cell.attrib.get("t", "n"),
                        "formula": formula.text if formula is not None else None,
                        "value": value.text if value is not None else None,
                        "inline": "" if inline is not None else None,
                    }
                    has_value = cell_data["value"] not in (None, "") or formula is not None or inline is not None
                    if _column_number(col_match.group(1)) > len(HEADERS) and has_value:
                        extra_column_rows.add(row_number)
                    else:
                        cells[(row_number, col_match.group(1))] = cell_data
                    if has_value:
                        nonempty_cells += 1
                        if nonempty_cells > limits.xlsx_nonempty_cells:
                            raise AdapterFailure("resource_xlsx_cells", DETECTED_FORMAT)
                if row_number > limits.xlsx_rows_per_sheet:
                    raise AdapterFailure("resource_xlsx_rows", DETECTED_FORMAT)
                element.clear()
            elif local == "mergeCell":
                merges.append(element.attrib.get("ref", ""))
                element.clear()
            elif local == "autoFilter":
                auto_filter = True
                element.clear()
    return cells, hidden_rows, tuple(merges), auto_filter, row_count, nonempty_cells, extra_column_rows


def _cell_text(cell, xml_cell: dict[str, str | None] | None, cached_cell) -> tuple[str | None, str | None, str | None, bool]:
    """Return raw formula/text view, amount/date cache text, source type, missing-cache."""
    formula = (xml_cell or {}).get("formula")
    raw_type = (xml_cell or {}).get("type", "n")
    if formula is not None:
        formula_text = str(cell.value) if cell.value is not None else "=" + formula
        if cached_cell is None or cached_cell.value is None:
            return formula_text, None, "formula", True
        cached_raw = (xml_cell or {}).get("value")
        if cached_raw is None:
            cached_raw = _display_value(cached_cell.value)
        return formula_text, cached_raw, "formula_cached", False
    if cell.value is None:
        explicit = xml_cell is not None
        return ("" if explicit else None), ("" if explicit else None), "empty" if explicit else "missing", False
    if raw_type == "s" or raw_type == "inlineStr":
        text = str(cell.value)
        return text, text, "text", False
    if raw_type == "b":
        raw = (xml_cell or {}).get("value") or ("1" if cell.value else "0")
        return raw, raw, "boolean", False
    # Use the underlying OOXML number lexeme, avoiding float reformatting.
    raw = (xml_cell or {}).get("value")
    if raw is None:
        raw = _display_value(cell.value)
    source_type = "excel_number"
    if getattr(cell, "is_date", False):
        source_type = "excel_date_serial"
    return raw, raw, source_type, False


def _display_value(value) -> str:
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat(sep=" ")
        except TypeError:
            return value.isoformat()
    return str(value)


def parse(request) -> ProfileOutput:
    try:
        import openpyxl
    except ImportError:
        raise AdapterFailure("dependency_openpyxl_missing", DETECTED_FORMAT)

    try:
        archive, sheet_paths = _preflight(request.source_bytes, request.limits)
    except AdapterFailure:
        raise
    except (zipfile.BadZipFile, OSError, ET.ParseError, KeyError, ValueError):
        raise AdapterFailure("malformed_xlsx_container", DETECTED_FORMAT)
    try:
        if len(sheet_paths) > request.limits.xlsx_sheets:
            raise AdapterFailure("resource_xlsx_sheets", DETECTED_FORMAT)
        if tuple(sheet_paths) != (SHEET_NAME,):
            return ProfileOutput(
                DETECTED_FORMAT,
                "unsupported",
                tuple(
                    coverage("sheet", f"xlsx/sheet/{name}", "unsupported", state="unknown")
                    for name in sheet_paths
                ) or (coverage("sheet", "xlsx/sheets", "unsupported"),),
                (),
                warnings=("sheet_inventory_not_exact",),
                error_code="unsupported_xlsx_sheet_inventory",
            )
        (
            xml_cells,
            hidden_rows,
            merged_ranges,
            has_filter,
            xml_rows,
            xml_cell_count,
            extra_column_rows,
        ) = _xml_sheet_metadata(archive, sheet_paths[SHEET_NAME], request.limits)
    finally:
        archive.close()

    try:
        formula_wb = openpyxl.load_workbook(
            io.BytesIO(request.source_bytes), read_only=True, data_only=False, keep_links=False
        )
        cached_wb = openpyxl.load_workbook(
            io.BytesIO(request.source_bytes), read_only=True, data_only=True, keep_links=False
        )
    except Exception:
        raise AdapterFailure("malformed_or_unsupported_xlsx", DETECTED_FORMAT)

    rows = []
    warnings: list[str] = []
    try:
        formula_ws = formula_wb[SHEET_NAME]
        cached_ws = cached_wb[SHEET_NAME]
        if formula_ws.sheet_state != "visible":
            raise AdapterFailure("xlsx_transaction_sheet_hidden", DETECTED_FORMAT)
        if formula_ws.max_row and formula_ws.max_row > request.limits.xlsx_rows_per_sheet:
            raise AdapterFailure("resource_xlsx_rows", DETECTED_FORMAT)
        header = next(formula_ws.iter_rows(min_row=1, max_row=1, values_only=False), ())
        header_values = tuple(str(cell.value or "") for cell in header[: len(HEADERS)])
        if header_values != HEADERS or len(header) > len(HEADERS) and any(
            cell.value not in (None, "") for cell in header[len(HEADERS) :]
        ):
            return ProfileOutput(
                DETECTED_FORMAT,
                "unsupported",
                (coverage("sheet", "xlsx/sheet/Sheet1", "unsupported", reason="header_not_exact"),),
                (),
                warnings=("header_not_exact",),
                error_code="unsupported_xlsx_header",
            )
        if 1 in extra_column_rows:
            raise AdapterFailure("xlsx_extra_header_columns", DETECTED_FORMAT)
        if extra_column_rows:
            raise AdapterFailure("xlsx_extra_columns_unsupported", DETECTED_FORMAT)
        cell_total = 0
        formula_rows = formula_ws.iter_rows(
            min_row=2, max_row=formula_ws.max_row or 1, min_col=1, max_col=12
        )
        cached_rows = cached_ws.iter_rows(
            min_row=2, max_row=cached_ws.max_row or 1, min_col=1, max_col=12
        )
        for row_number, (row, cached_row) in enumerate(zip(formula_rows, cached_rows), start=2):
            if row_number > request.limits.xlsx_rows_per_sheet:
                raise AdapterFailure("resource_xlsx_rows", DETECTED_FORMAT)
            values = []
            for index in range(11):
                cell = row[index] if index < len(row) else None
                cached_cell = cached_row[index] if index < len(cached_row) else None
                column = chr(ord("A") + index)
                xml_cell = xml_cells.get((row_number, column))
                if cell is None:
                    values.append((None, None, "missing", False))
                else:
                    values.append(_cell_text(cell, xml_cell, cached_cell))
                if values[-1][0] not in (None, ""):
                    cell_total += 1
                value_text = values[-1][0]
                if value_text is not None and len(value_text.encode("utf-8")) > request.limits.raw_field_bytes:
                    raise AdapterFailure("resource_raw_field_bytes", DETECTED_FORMAT)
            if cell_total > request.limits.xlsx_nonempty_cells:
                raise AdapterFailure("resource_xlsx_cells", DETECTED_FORMAT)
            extra_cell = row[11] if len(row) > 11 else None
            if extra_cell is not None and extra_cell.value not in (None, ""):
                rows.append(
                    occurrence(
                        locator=f"xlsx/sheet/{SHEET_NAME}/row/{row_number}",
                        discriminator=f"xlsx-row:{row_number}",
                        fields=tuple(
                            raw_field(HEADERS[index], values[index][0], source_type=values[index][2])
                            for index in range(11)
                        ),
                        binding=request.binding_snapshot,
                        status="failure",
                        failures=("xlsx_extra_columns",),
                    )
                )
                continue
            if not any(value not in (None, "") for value, _, _, _ in values):
                continue
            locator = f"xlsx/sheet/{SHEET_NAME}/row/{row_number};cells/A{row_number}:K{row_number}"
            discriminator = f"xlsx-row:{row_number}"
            fields = tuple(
                raw_field(
                    HEADERS[index],
                    value,
                    present=source_type != "missing",
                    source_type=source_type,
                    cached_value_text=cache_value if source_type.startswith("formula") else None,
                )
                for index, (value, cache_value, source_type, _) in enumerate(values)
            )
            failures: list[str] = []
            row_warnings: list[str] = []
            amount_text = None if values[5][2].startswith("formula") else values[5][0]
            formula_positions = [index for index, value in enumerate(values) if value[2].startswith("formula")]
            untrusted_roles = {
                0: "wallet_transaction_time",
                1: "wallet_transaction_type",
                2: "counterparty",
                3: "item_description",
                4: "source_direction",
                5: "wallet_event_amount",
                6: "via_hint",
                7: "source_status",
                8: "external_id:wallet.transaction",
                9: "external_id:wallet.merchant",
                10: "source_note",
            }
            untrusted_observations = tuple(
                UntrustedObservation(
                    field=HEADERS[index],
                    semantic_role=untrusted_roles[index],
                    formula_text=values[index][0] or "",
                    cached_value_text=values[index][1],
                    cache_present=not values[index][3],
                )
                for index in formula_positions
            )
            for index in formula_positions:
                failures.append(
                    f"xlsx_formula_cache_missing_column_{index + 1}"
                    if values[index][3]
                    else f"xlsx_formula_cache_untrusted_column_{index + 1}"
                )
            if row_number in hidden_rows:
                row_warnings.append("hidden_row_included")
            if has_filter:
                row_warnings.append("sheet_filter_present_all_rows_included")
            if merged_ranges:
                row_warnings.append("merged_ranges_present_not_filled")
            for index in (8, 9):
                raw_value, _, source_type, _ = values[index]
                if source_type == "excel_number" and raw_value and len(raw_value.lstrip("+-0")) > 15:
                    row_warnings.append("numeric_external_id_unreliable")
            via_hint = values[6][0] or None if not values[6][2].startswith("formula") else None
            date_value, _, date_type, _ = values[0]
            amounts = (
                (AmountObservation("金额(元)", amount_text, "wallet_event_amount"),)
                if amount_text not in (None, "")
                else ()
            )
            date_cell = row[0]
            date_observed = date_value
            if date_cell.is_date and not date_type.startswith("formula"):
                date_observed = _display_value(date_cell.value)
            dates = () if date_type.startswith("formula") else make_date(
                "交易时间", date_observed, "wallet_transaction_time", date_type
            )
            external_ids = tuple(
                ExternalId(namespace, values[index][1])
                for index, namespace in ((8, "wallet.transaction"), (9, "wallet.merchant"))
                if values[index][1] and not values[index][2].startswith("formula")
            )
            for index in (8, 9):
                raw_id = values[index][0]
                if values[index][2] == "excel_number" and raw_id and len(raw_id.lstrip("+-0")) > 15:
                    row_warnings.append("numeric_external_id_unreliable")
            rows.append(
                occurrence(
                    locator=locator,
                    discriminator=discriminator,
                    fields=fields,
                    binding=request.binding_snapshot,
                    via_hint=via_hint,
                    amounts=amounts,
                    dates=dates,
                    external_ids=external_ids,
                    untrusted_observations=untrusted_observations,
                    direction=values[4][0],
                    status_text=values[7][0],
                    status="failure" if failures else "success",
                    failures=failures,
                    warnings=row_warnings,
                )
            )
            if len(rows) > request.limits.occurrences:
                raise AdapterFailure("resource_occurrence_limit", DETECTED_FORMAT)
    finally:
        formula_wb.close()
        cached_wb.close()

    if xml_cell_count > request.limits.xlsx_nonempty_cells:
        raise AdapterFailure("resource_xlsx_cells", DETECTED_FORMAT)
    if xml_rows > request.limits.xlsx_rows_per_sheet:
        raise AdapterFailure("resource_xlsx_rows", DETECTED_FORMAT)
    coverage_items = [
        coverage(
            "sheet",
            f"xlsx/sheet/{SHEET_NAME}",
            "recognized",
            rows=str(xml_rows),
            nonempty_cells=str(xml_cell_count),
            hidden_rows=str(len(hidden_rows)),
            merged_ranges=str(len(merged_ranges)),
            filter_present=str(has_filter).lower(),
        )
    ]
    if hidden_rows:
        warnings.append("hidden_rows_included_and_reported")
    if has_filter:
        warnings.append("filter_metadata_present_rows_not_filtered")
    if merged_ranges:
        warnings.append("merged_cells_not_propagated")
    return ProfileOutput(
        DETECTED_FORMAT,
        "partial_with_failures" if any(row.status == "failure" for row in rows) else "complete",
        tuple(coverage_items),
        tuple(rows),
        warnings=tuple(warnings) + ("denominator_unavailable",),
        denominator_unit=None,
        declared_count=None,
    )
