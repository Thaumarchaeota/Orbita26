import { beforeEach, describe, expect, it } from "vitest";
import { mountCdsAdvancedComposer } from "./cds-composer-advanced";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("cds-composer-advanced empty amount", () => {
  it("keeps null amount for empty posting row", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const ac = new AbortController();
    const composer = mountCdsAdvancedComposer(mount, ac.signal);

    const rows = mount.querySelectorAll(".composer-posting-row");
    const accountPickers = mount.querySelectorAll(".composer-posting-account");
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const firstAmount = rows[0]!.querySelector<HTMLInputElement>(".composer-posting-amount")!;
    const firstCurrency = rows[0]!.querySelector<HTMLInputElement>(".composer-posting-currency")!;
    firstAmount.value = "-10";
    firstCurrency.value = "CNY";

    const secondAmount = rows[1]!.querySelector<HTMLInputElement>(".composer-posting-amount")!;
    secondAmount.value = "";

    const draft = composer.getDraft();
    expect(draft.postings[1]?.amount).toBeNull();

    const time = mount.querySelector<HTMLInputElement>(".orbita-time-picker-input");
    expect(time).toBeTruthy();
    expect(time!.value).toBe("");

    ac.abort();
  });
});
