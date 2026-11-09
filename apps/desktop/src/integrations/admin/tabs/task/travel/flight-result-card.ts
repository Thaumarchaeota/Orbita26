import { escHtml } from "../../../../../core/html";
import { createInsightDialog } from "../../../../../ui/insight-dialog";
import "./flight-result-card.css";

export const FLIGHT_CHOICE_DIALOG_CLASS = "travel-rail-flight-query-dialog";

export type FlightResultCardModel = {
  depCode: string;
  depName: string;
  depAt: string;
  arrCode: string;
  arrName: string;
  arrAt: string;
  depOffsetSeconds?: number | null;
  arrOffsetSeconds?: number | null;
};

function flightOffset(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && Math.abs(seconds) <= 86400 && seconds % 60 === 0 ? seconds : null;
}

function flightOffsetLabel(seconds: number | null | undefined): string {
  if (seconds == null) return "时区未知";
  const minutes = Math.abs(seconds) / 60;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `UTC${seconds < 0 ? "−" : "+"}${hours}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`;
}

export function formatFlightStamp(value: string): { date: string; time: string } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
  if (!match) return { date: "", time: "" };
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1] ?? "";
  return { date: `${Number(match[3])} ${month}, ${match[1]}`, time: match[4] };
}

export function flightResultCardFromRecord(record: Record<string, unknown>): FlightResultCardModel {
  return {
    depCode: String(record.FlightDepcode ?? record.depCode ?? ""),
    depName: String(record.FlightDepAirport ?? record.depName ?? ""),
    depAt: String(record.FlightDeptimePlanDate ?? record.depAt ?? ""),
    arrCode: String(record.FlightArrcode ?? record.arrCode ?? ""),
    arrName: String(record.FlightArrAirport ?? record.arrName ?? ""),
    arrAt: String(record.FlightArrtimePlanDate ?? record.arrAt ?? ""),
    depOffsetSeconds: flightOffset(record.org_timezone ?? record.depOffsetSeconds),
    arrOffsetSeconds: flightOffset(record.dst_timezone ?? record.arrOffsetSeconds),
  };
}

const AIRPORT_NAME_MAX_CHARS = 7;

function airportNameMarkup(name: string): string {
  const full = name || "—";
  const chars = [...full];
  const truncated = chars.length > AIRPORT_NAME_MAX_CHARS;
  const text = truncated ? `${chars.slice(0, AIRPORT_NAME_MAX_CHARS).join("")}…` : full;
  const title = truncated ? ` title="${escHtml(full)}"` : "";
  return `<span class="flight-result-airport"${title}>${escHtml(text)}</span>`;
}

export function appendFlightResultCard(
  parent: HTMLElement,
  candidate: FlightResultCardModel,
  selected = false,
): HTMLElement {
  const departure = formatFlightStamp(candidate.depAt);
  const arrival = formatFlightStamp(candidate.arrAt);
  const showOffsets = [candidate.depOffsetSeconds, candidate.arrOffsetSeconds].some((offset) => offset != null && offset !== 28800);
  const stamp = (parts: { date: string; time: string }, offset: number | null | undefined) => parts.date
    ? `<span class="flight-result-stamp"><span class="flight-result-date">${escHtml(parts.date)}</span><span>${escHtml(parts.time)}${showOffsets ? ` (${escHtml(flightOffsetLabel(offset))})` : ""}</span></span>`
    : "";
  const card = document.createElement("div");
  card.className = `flight-result-card${selected ? " is-selected" : ""}`;
  card.setAttribute("role", "radio");
  card.setAttribute("aria-checked", String(selected));
  card.tabIndex = 0;
  card.innerHTML = `<div class="flight-result-codes"><span class="flight-result-end"><span class="flight-result-code">${escHtml(candidate.depCode || "—")}</span>${airportNameMarkup(candidate.depName)}${stamp(departure, candidate.depOffsetSeconds)}</span><span class="flight-result-plane" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" focusable="false"><path d="M3 11h8.2L8.4 5.8 10 4.7l6.4 6.3H21v2h-4.6L10 19.3l-1.6-1.1 2.8-5.2H3z" /></svg></span><span class="flight-result-end flight-result-end-arrival"><span class="flight-result-code">${escHtml(candidate.arrCode || "—")}</span>${airportNameMarkup(candidate.arrName)}${stamp(arrival, candidate.arrOffsetSeconds)}</span></div>`;
  parent.appendChild(card);
  return card;
}

export function paintFlightResultChoices(
  parent: HTMLElement,
  candidates: readonly FlightResultCardModel[],
  selectedIndex: number,
  onSelect: (index: number) => void,
): void {
  parent.replaceChildren();
  candidates.forEach((candidate, index) => {
    const card = appendFlightResultCard(parent, candidate, index === selectedIndex);
    const select = () => onSelect(index);
    card.addEventListener("click", select);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
  });
}

export const SAMPLE_FLIGHT_RESULT_CARDS: FlightResultCardModel[] = [
  { depCode: "SHA", depName: "上海虹桥", depAt: "2026-10-28 08:35", arrCode: "PEK", arrName: "北京首都", arrAt: "2026-10-28 10:50" },
  { depCode: "NQZ", depName: "努尔苏丹纳扎尔巴耶夫", depAt: "2026-10-28 01:30", depOffsetSeconds: 18000, arrCode: "CAN", arrName: "广州白云", arrAt: "2026-10-28 14:10", arrOffsetSeconds: 28800 },
  { depCode: "SZX", depName: "深圳宝安", depAt: "2026-10-28 16:20", arrCode: "CTU", arrName: "成都双流", arrAt: "2026-10-28 18:55" },
];

/** Temporary style harness: same select step as first-add, no query. */
export function openFlightResultCardStylePreview(): void {
  const dlg = createInsightDialog({ title: "选择航班", bodyHtml: "", submitLabel: "继续", cancelLabel: "返回" });
  const form = document.createElement("div");
  form.className = `${FLIGHT_CHOICE_DIALOG_CLASS} is-selecting`;
  const choices = document.createElement("div");
  choices.className = "flight-results";
  form.append(choices);
  dlg.body.append(form);
  let selectedIndex = -1;
  const paint = () => {
    paintFlightResultChoices(choices, SAMPLE_FLIGHT_RESULT_CARDS, selectedIndex, (index) => {
      selectedIndex = index;
      paint();
    });
    dlg.submitBtn.disabled = selectedIndex < 0;
  };
  paint();
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    void dlg.close().then(() => dlg.dispose());
  };
  dlg.bindChrome(finish);
  dlg.panel.addEventListener("submit", (event) => {
    event.preventDefault();
    if (selectedIndex < 0) {
      dlg.setError("请选择航班");
      return;
    }
    finish();
  });
  void dlg.open();
}
