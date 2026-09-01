import type { HealthDaySummary } from "./types";
import { beijingToday, formatMissing } from "./format";

export function renderSummary(root: HTMLElement, summary: HealthDaySummary): void {
  const isToday = summary.date === beijingToday();
  const title = isToday ? `今日摘要 · ${summary.date}` : `当日摘要 · ${summary.date}`;

  const cards = summary.cards
    .filter((c) => c.everSeen)
    .map((c) => {
      const val = formatMissing(c.value);
      const unit = c.unit ? ` <span class="health-summary-unit">${c.unit}</span>` : "";
      return `<div class="health-summary-card" data-id="${c.id}">
        <div class="health-summary-label">${c.label}</div>
        <div class="health-summary-value">${val}${unit}</div>
      </div>`;
    })
    .join("");

  const e = summary.energy;
  let energyBody: string;
  if (e.mealCount === 0) {
    energyBody = `<div class="health-summary-label">摄入</div><div class="health-summary-value">未记餐食</div>`;
  } else {
    energyBody = `
      <div class="health-summary-label">摄入</div>
      <div class="health-summary-value">${formatMissing(e.intakeKcal?.toFixed(0) ?? null)} <span class="health-summary-unit">kcal</span></div>
      <div class="health-summary-label">消耗</div>
      <div class="health-summary-value">${formatMissing(e.burnKcal)} <span class="health-summary-unit">kcal</span></div>
      <div class="health-summary-label">差额</div>
      <div class="health-summary-value">${formatMissing(e.deltaKcal?.toFixed(0) ?? null)} <span class="health-summary-unit">kcal</span></div>`;
  }
  const coverage =
    e.daysInWindow > 0
      ? `<div class="health-summary-coverage">餐食记录覆盖 ${e.daysWithMeals}/${e.daysInWindow} 天</div>`
      : "";

  const energyCard = `<div class="health-summary-card health-summary-card-energy" data-id="energy">
    <div class="health-summary-label">能量</div>
    ${energyBody}
    ${coverage}
  </div>`;

  root.innerHTML = `
    <section class="health-summary">
      <h3 class="health-section-title">${title}</h3>
      <div class="health-summary-rail">
        <div class="health-summary-grid">${cards}${energyCard}</div>
      </div>
    </section>`;
}
