import { mountSelectField } from "../../../../ui/select-field";
import { mountDecoupledDatePicker } from "../../../../ui/decoupled-date-picker";
import type { FinanceAccountView, FinanceFactView, FinanceTreatmentView } from "../../../finance-v2/types";
import { el, textField } from "./dom";

export type FinanceFactEditorHandle = { root: HTMLElement; build(status?: FinanceFactView["status"], original?: FinanceFactView): FinanceFactView; dispose(): void };
export type FinanceTreatmentEditorHandle = { root: HTMLElement; build(original?: FinanceTreatmentView): FinanceTreatmentView; dispose(): void };

/** Form state only. It neither stages nor saves the resulting explicit fact intent. */
export function mountFactEditor(container: HTMLElement, accounts: FinanceAccountView[], existing?: FinanceFactView): FinanceFactEditorHandle {
  const root = el("div", "finance-v2-fields");
  const dateHost = el("div", "finance-v2-field-host");
  dateHost.append(el("span", "finance-v2-field-label", "生效日期"));
  const positiveHost = el("div", "finance-v2-field-host");
  const negativeHost = el("div", "finance-v2-field-host");
  const positive = mountSelectField(positiveHost, {
    label: "正向 Account", placeholder: "选择正向端", options: accountOptions(accounts), search: true, multiple: false,
    value: existing?.positiveAccountId ?? null, onChange: () => {},
  });
  const negative = mountSelectField(negativeHost, {
    label: "负向 Account", placeholder: "选择负向端", options: accountOptions(accounts), search: true, multiple: false,
    value: existing?.negativeAccountId ?? null, onChange: () => {},
  });
  const positiveAmount = textField("正向精确数量", existing?.positive.amount ?? "");
  const positiveCommodity = textField("正向币种", existing?.positive.commodity ?? "");
  const negativeAmount = textField("负向精确数量", existing?.negative.amount ?? "");
  const negativeCommodity = textField("负向币种", existing?.negative.commodity ?? "");
  const title = textField("标题", existing?.title ?? "");
  const notes = textField("备注", existing?.notes ?? "", true);
  const date = mountDecoupledDatePicker({
    defaultTrigger: { container: dateHost },
    value: existing?.effectiveDate ?? shanghaiToday(),
  });
  root.append(dateHost, positiveHost, negativeHost, positiveAmount.root, positiveCommodity.root,
    negativeAmount.root, negativeCommodity.root, title.root, notes.root);
  container.append(root);
  return {
    root,
    build(status = "Active", original) {
      const positiveAccountId = positive.getValue();
      const negativeAccountId = negative.getValue();
      const effectiveDate = date.getValue();
      const pAmount = positiveAmount.input.value.trim();
      const pCommodity = positiveCommodity.input.value.trim();
      const nAmount = negativeAmount.input.value.trim();
      const nCommodity = negativeCommodity.input.value.trim();
      if (!positiveAccountId || !negativeAccountId || positiveAccountId === negativeAccountId) throw new Error("请选择不同的正向与负向 Account。");
      if (!effectiveDate || !pAmount || !pCommodity || !nAmount || !nCommodity) throw new Error("请完整填写日期、两端精确数量与币种。");
      if (!/^(?=.*[1-9])\d+(?:\.\d+)?$/.test(pAmount) || !/^(?=.*[1-9])\d+(?:\.\d+)?$/.test(nAmount)) throw new Error("数量必须是正的十进制文本；不会通过浮点转换。");
      const nowMicros = (BigInt(Date.now()) * 1000n).toString();
      const fact: FinanceFactView = {
        id: original?.id ?? crypto.randomUUID().toLowerCase(),
        revision: original ? original.revision + 1 : 1,
        status,
        effectiveDate,
        businessTime: { kind: "Date", sourceDate: effectiveDate },
        positiveAccountId, positive: { amount: pAmount, commodity: pCommodity },
        negativeAccountId, negative: { amount: nAmount, commodity: nCommodity },
        viaId: original?.viaId ?? null,
        title: title.input.value.trim(), notes: notes.input.value.trim(),
        provenance: original?.provenance ?? { kind: "Manual", createdAtUtcMicros: nowMicros },
      };
      return fact;
    },
    dispose() { positive.dispose(); negative.dispose(); date.dispose(); root.remove(); },
  };
}

/** Builds explicit treatment data; backend/E0 remains authoritative for relationship validation. */
export function mountTreatmentEditor(container: HTMLElement, facts: FinanceFactView[], existing?: FinanceTreatmentView): FinanceTreatmentEditorHandle {
  const root = el("div", "finance-v2-fields");
  const ownerHost = el("div", "finance-v2-field-host");
  const memberHost = el("div", "finance-v2-field-host");
  const refundHost = el("div", "finance-v2-field-host");
  const paymentHost = el("div", "finance-v2-field-host");
  const eligible = facts.filter((fact) => fact.status === "Active");
  const options = eligible.map((fact) => ({ value: `${fact.id}@${fact.revision}`, label: `${fact.effectiveDate} · ${fact.title || fact.id} · r${fact.revision}` }));
  const owner = mountSelectField(ownerHost, { label: "关系归属事实", placeholder: "选择归属事实", options, search: options.length > 6, multiple: false,
    value: existing ? `${existing.ownerL0Id}@${existing.members.find((member) => member.l0Id === existing.ownerL0Id)?.revision ?? 1}` : null, onChange: () => {} });
  const selectedMembers = new Set((existing?.members ?? []).map((member) => `${member.l0Id}@${member.revision}`));
  const members = mountSelectField(memberHost, { label: "参与事实", placeholder: "选择一个或多个事实", options, search: options.length > 6, multiple: true, values: selectedMembers, onChange: () => {} });
  const refunds = mountSelectField(refundHost, { label: "退款事实（可选）", placeholder: "选择退款事实", options, search: options.length > 6, multiple: false,
    value: existing?.refundEdges[0] ? `${existing.refundEdges[0].refund.l0Id}@${existing.refundEdges[0].refund.revision}` : null, onChange: () => {} });
  const payments = mountSelectField(paymentHost, { label: "原付款事实（可选）", placeholder: "选择原付款事实", options, search: options.length > 6, multiple: false,
    value: existing?.refundEdges[0] ? `${existing.refundEdges[0].payment.l0Id}@${existing.refundEdges[0].payment.revision}` : null, onChange: () => {} });
  const title = textField("关系标题", existing?.title ?? "");
  const notes = textField("关系备注", existing?.notes ?? "", true);
  const refundAmount = textField("退款精确数量（原币）", existing?.refundEdges[0]?.amount.amount ?? "");
  const refundCommodity = textField("退款币种", existing?.refundEdges[0]?.amount.commodity ?? "");
  const together = document.createElement("input"); together.type = "checkbox"; together.checked = Boolean(existing?.mergeGroups.length);
  const togetherLabel = el("label", "finance-v2-field-label", "将所选事实作为同一合并组"); togetherLabel.prepend(together);
  root.append(ownerHost, memberHost, togetherLabel, refundHost, paymentHost, refundAmount.root, refundCommodity.root, title.root, notes.root);
  container.append(root);
  const resolveMember = (value: string) => {
    const [l0Id, revision] = value.split("@");
    if (!l0Id || !revision) throw new Error("关系成员版本无效。");
    return { l0Id, revision: Number(revision) };
  };
  return {
    root,
    build(original) {
      const ownerValue = owner.getValue();
      if (!ownerValue) throw new Error("请选择关系归属事实。");
      const selected = [...members.getValues()];
      if (!selected.includes(ownerValue)) selected.push(ownerValue);
      if (selected.length < 2) throw new Error("关系至少需要两个不同事实。");
      const memberRefs = selected.map(resolveMember);
      const ownerRef = resolveMember(ownerValue);
      const refundId = refunds.getValue(); const paymentId = payments.getValue();
      const refundEdges = refundId || paymentId ? (() => {
        if (!refundId || !paymentId || refundId === paymentId) throw new Error("退款关系需要不同的退款事实和原付款事实。");
        const amount = refundAmount.input.value.trim(); const commodity = refundCommodity.input.value.trim();
        if (!/^(?=.*[1-9])\d+(?:\.\d+)?$/.test(amount) || !commodity) throw new Error("退款数量必须是正的精确十进制文本并填写币种。");
        return [{ refund: resolveMember(refundId), payment: resolveMember(paymentId), amount: { amount, commodity } }];
      })() : [];
      return { id: original?.id ?? crypto.randomUUID().toLowerCase(), revision: original ? original.revision + 1 : 1,
        ownerL0Id: ownerRef.l0Id, members: memberRefs,
        mergeGroups: together.checked ? [{ members: memberRefs }] : [], refundEdges,
        title: title.input.value.trim(), notes: notes.input.value.trim() };
    },
    dispose() { owner.dispose(); members.dispose(); refunds.dispose(); payments.dispose(); root.remove(); },
  };
}

function accountOptions(accounts: FinanceAccountView[]) {
  return accounts.filter((account) => account.active).map((account) => ({ value: account.id, label: `${account.name} · ${account.kind}` }));
}

function shanghaiToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
