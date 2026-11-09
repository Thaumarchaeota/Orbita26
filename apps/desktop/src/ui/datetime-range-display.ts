export type DateTimeRangeValue = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

export function emptyDateTimeRange(): DateTimeRangeValue {
  return { startDate: "", startTime: "", endDate: "", endTime: "" };
}

export function isDateTimeRangeComplete(value: DateTimeRangeValue): boolean {
  return Boolean(value.startDate && value.startTime && value.endDate && value.endTime);
}

export function shanghaiYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function sameYear(ymd: string, todayYmd: string): boolean {
  return ymd.slice(0, 4) === todayYmd.slice(0, 4);
}

function formatSide(ymd: string, time: string, withYear: boolean): string {
  return withYear ? `${ymd} ${time}` : `${ymd.slice(5)} ${time}`;
}

/** Gallery / picker trigger copy. todayYmd is Asia/Shanghai `YYYY-MM-DD`. */
export function formatDateTimeRangeLabel(value: DateTimeRangeValue, todayYmd: string): string {
  if (!isDateTimeRangeComplete(value)) return "";
  const { startDate, startTime, endDate, endTime } = value;
  const sameDay = startDate === endDate;
  if (sameDay) {
    if (startDate === todayYmd) return `${startTime}-${endTime}`;
    if (sameYear(startDate, todayYmd)) return `${startDate.slice(5)} ${startTime}-${endTime}`;
    return `${startDate} ${startTime}-${endTime}`;
  }
  const withYear = !sameYear(startDate, todayYmd) || !sameYear(endDate, todayYmd);
  return `${formatSide(startDate, startTime, withYear)} - ${formatSide(endDate, endTime, withYear)}`;
}
