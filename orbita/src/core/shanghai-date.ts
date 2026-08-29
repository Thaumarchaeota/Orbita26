const TZ = "Asia/Shanghai";

export function shanghaiIsoDate(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: TZ });
}

export function shanghaiDateParts(now: Date = new Date()): { y: number; m: number; d: number } {
  const iso = shanghaiIsoDate(now);
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}

export function shanghaiIsoDateOffset(now: Date, dayOffset: number): string {
  const iso = shanghaiIsoDate(now);
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return dt.toISOString().slice(0, 10);
}
