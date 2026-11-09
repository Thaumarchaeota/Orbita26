import { getActiveEntry, loadAiConfig } from "../ai/config";
import { completeChat } from "../ai/adapter";
import type { ClassificationRequest, ClassificationResult, FinanceAccountView, FinanceWorkspaceLeftRowView } from "./types";

export type FinanceClassificationProvider = {
  classify(requests: ClassificationRequest[], options: {
    model: string; signal: AbortSignal; accounts: FinanceAccountView[]; rulesMarkdown: string;
  }): Promise<Array<{ request: ClassificationRequest; result?: ClassificationResult; error?: string }>>;
};

function parseClassification(text: string, request: ClassificationRequest, accounts: FinanceAccountView[]): ClassificationResult {
  const value = JSON.parse(text) as Partial<ClassificationResult>;
  const account = accounts.find((item) => item.id === value.account_id && item.active && (item.kind === "Income" || item.kind === "Expenses"));
  if (value.item_id !== request.item_id || value.expected_item_revision !== request.expected_item_revision
      || value.expected_manual_category_revision !== request.expected_manual_category_revision
      || !account || value.account_revision !== account.revision) {
    throw new Error("AI 返回了无效或版本不匹配的分类建议");
  }
  return value as ClassificationResult;
}

function redactLongNumericIdentifiers(value: string): string {
  return value.replace(/(?:\d[ -]?){12,}/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 12 ? "[已隐藏数字标识]" : match;
  });
}

function classifyOne(request: ClassificationRequest, model: string, signal: AbortSignal, accounts: FinanceAccountView[], rulesMarkdown: string): Promise<ClassificationResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: ClassificationResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(result!);
    };
    // `completeChat` has no transport abort API. Cancellation rejects locally and drops its eventual result.
    const onAbort = () => finish(new DOMException("分类任务已取消；底层 plain completion 继续运行，结果将丢弃", "AbortError"));
    if (signal.aborted) { finish(new DOMException("分类任务已取消", "AbortError")); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    void loadAiConfig().then(async (config) => {
      if (signal.aborted) throw new DOMException("分类任务已取消", "AbortError");
      const entry = getActiveEntry(config);
      if (!entry || !entry.models.includes(model)) throw new Error("请在全局 AI 设置中配置提供方，并选择有效的 Finance 模型");
      const summary = JSON.stringify({
        item_id: request.item_id, expected_item_revision: request.expected_item_revision,
        expected_manual_category_revision: request.expected_manual_category_revision,
        merchant: redactLongNumericIdentifiers(request.merchant), summary: redactLongNumericIdentifiers(request.summary),
        notes: redactLongNumericIdentifiers(request.notes),
        amount_text: request.amount_text, commodity: request.commodity,
        allowed_accounts: accounts.filter((item) => item.active && (item.kind === "Income" || item.kind === "Expenses"))
          .map(({ id, revision, name, kind }) => ({ id, revision, name, kind })),
        classification_rules_markdown: rulesMarkdown,
      });
      const response = await completeChat(
        "你只提供 Finance 分类建议，没有任何工具、文件、账本或执行权限。只返回单个 JSON 对象，字段为 item_id,expected_item_revision,expected_manual_category_revision,account_id,account_revision。只能从给定 active Income/Expenses classification Account 中选择；不得建议或修改 Via、候选确认或任何其它字段。必须原样返回给定 item/revision；不得创造目录或输出其它文字。",
        summary, entry, model,
      );
      if (signal.aborted) throw new DOMException("分类任务已取消；底层 plain completion 继续运行，结果将丢弃", "AbortError");
      finish(undefined, parseClassification(response, request, accounts));
    }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

/** Uses global provider credentials; no call happens until the explicit classify action invokes this provider. */
export const globalFinanceAiProvider: FinanceClassificationProvider = {
  async classify(requests, { model, signal, accounts, rulesMarkdown }) {
    return Promise.all(requests.map(async (request) => {
      try { return { request, result: await classifyOne(request, model, signal, accounts, rulesMarkdown) }; }
      catch (error) { return { request, error: error instanceof Error ? error.message : String(error) }; }
    }));
  },
};

export function classificationRequestForWorkspaceRow(row: FinanceWorkspaceLeftRowView): ClassificationRequest {
  const fields = row.observation.fields;
  const textValue = (match: (role: string) => boolean) => {
    const value = fields.find((field) => match(field.role.toLowerCase()) && field.value.kind === "Text")?.value;
    return value?.kind === "Text" ? value.value : "";
  };
  const quantity = fields.find((field) => field.value.kind === "SignedQuantity")?.value;
  const quantityView = quantity?.kind === "SignedQuantity" ? quantity.quantity : null;
  return {
    item_id: row.itemId,
    expected_item_revision: row.itemRevision,
    expected_manual_category_revision: row.manualCategoryRevision,
    merchant: textValue((role) => role.includes("merchant") || role.includes("payee")),
    summary: textValue((role) => role.includes("summary") || role.includes("description")),
    notes: textValue((role) => role.includes("note")),
    amount_text: quantityView?.amount ?? "",
    commodity: quantityView?.commodity ?? "",
  };
}

export async function listFinanceClassificationModels(): Promise<string[]> {
  const config = await loadAiConfig();
  const entry = getActiveEntry(config);
  return entry?.models ?? [];
}

export function canApplyWorkspaceClassification(
  request: ClassificationRequest,
  result: ClassificationResult,
  row: FinanceWorkspaceLeftRowView | undefined,
  cancelled: boolean,
  accountRevisions: ReadonlyMap<string, number>,
): row is FinanceWorkspaceLeftRowView {
  return !cancelled && !!row && row.stillInLeft && row.disposition === "Open" && row.categoryOrigin !== "Human"
    && result.item_id === request.item_id && result.expected_item_revision === request.expected_item_revision
    && result.expected_manual_category_revision === request.expected_manual_category_revision
    && row.itemId === request.item_id && row.itemRevision === request.expected_item_revision
    && row.manualCategoryRevision === request.expected_manual_category_revision
    && accountRevisions.get(result.account_id) === result.account_revision;
}

