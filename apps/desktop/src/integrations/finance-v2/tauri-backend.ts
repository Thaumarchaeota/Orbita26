import { invoke } from "@tauri-apps/api/core";
import { openLocalPath } from "../shell/adapter";
import type {
  FinanceAiCategorySuggestion, FinanceAiApplyResult, FinanceAiModelView, FinanceCalibrationPointView, FinanceFactView, FinanceImportBatchView, FinanceParsedObservationView,
  FinanceDraftListEntryView, FinanceHistoryEntityKind, FinanceIntentPayload, FinanceManagementSaveResult, FinanceRefinementInput, FinanceReportView, FinanceRuleAppendPreview, FinanceRuleView, FinanceSnapshotView, FinanceSourceView, FinanceV2Backend, FinanceViaView,
  FinanceSourceContextView,
  FinanceWorkspaceReadModel, FinanceAccountViaView, IsolatedFinanceSession,
  FinanceWorkspaceLeftRowView,
} from "./types";
import { FINANCE_V2_SOURCE_PROFILES } from "./types";

type JsonObject = Record<string, unknown>;
type WireSession = JsonObject;
const preparedCommits = new Map<string, { prepareToken: string; plan: JsonObject; recordedAtUtcUs: number }>();

const unsupported = (name: string): never => { throw new Error(`隔离 Finance v2 命令尚未实现：${name}`); };

export const financeV2TauriBackend: FinanceV2Backend = {
  async pickEnvironmentDirectory() { return invoke<string | null>("finance_v2_environment_pick_directory"); },
  async createEnvironment(parentPath) {
    return mapSession(await invoke<unknown>("finance_v2_environment_create", { parentPath }));
  },
  async openEnvironment(rootPath) {
    return mapSession(await invoke<unknown>("finance_v2_environment_open", { rootPath }));
  },
  async closeIsolatedSession(_session) { /* Sessions are process-scoped; reopening is explicit after restart. */ },
  async loadSnapshot(session) {
    const response = await invoke<JsonObject>("finance_v2_read_snapshot", { session: toWireSession(session) });
    const snapshot = mapLedgerSnapshot(response.snapshot);
    session.generation = snapshot.generation;
    return { ...snapshot, accountViaMappingRevision: Number(response.accountViaMappingRevision), accountViaBindings: mapArray(response.accountViaBindings).map(mapAccountViaBinding),
      restorableFacts: mapArray(response.restorableFacts).map(mapFact) };
  },
  async loadReports(session) {
    const response = await invoke<JsonObject>("finance_v2_project_reports", { session: toWireSession(session) });
    const ledger = camel(response.ledgerProjection) as JsonObject;
    const reports = camel(response.reportProjection) as JsonObject;
    session.generation = Number(ledger.generation);
    return { ...reports, generation: Number(ledger.generation), transactions: mapArray(ledger.transactions) } as FinanceReportView;
  },
  async saveAccount(session, input) {
    const current = await this.loadSnapshot(session);
    const value = { id: input.id, revision: input.expectedRevision === undefined ? 1 : input.expectedRevision + 1,
      name: input.name, kind: input.kind, bean_path: input.beanPath, parent_id: input.parentId,
      active: input.active, ever_used: false };
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { account: { value, expectedRevision: input.expectedRevision ?? null } }, recordedAtUtcUs: nowMicros(),
    } });
    return mapManagementResult<FinanceSnapshotView["accounts"][number]>(response, session);
  },
  async saveVia(session, input) {
    const current = await this.loadSnapshot(session);
    const value = { id: input.id, revision: input.expectedRevision === undefined ? 1 : input.expectedRevision + 1, name: input.name, active: input.active };
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { via: { value, expectedRevision: input.expectedRevision ?? null } }, recordedAtUtcUs: nowMicros(),
    } });
    return mapManagementResult<FinanceViaView>(response, session);
  },
  async saveCalibration(session, input) {
    const current = await this.loadSnapshot(session);
    const recordedAtUtcMicros = nowMicros();
    const revision = (input.expectedRevision ?? 0) + 1;
    const point = { id: input.id, revision, account_id: input.accountId, business_date: input.businessDate,
      quantity: { amount: input.quantity.amount, commodity: input.quantity.commodity }, status: "Active", recorded_at_utc_micros: recordedAtUtcMicros };
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { calibration: { action: { save: { point } }, expectedRevision: input.expectedRevision ?? null } }, recordedAtUtcUs: recordedAtUtcMicros,
    } });
    return mapManagementResult<FinanceCalibrationPointView>(response, session);
  },
  async deleteCalibration(session, id, expectedRevision) {
    const current = await this.loadSnapshot(session);
    const recordedAtUtcMicros = nowMicros();
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { calibration: { action: { delete: { id } }, expectedRevision } }, recordedAtUtcUs: recordedAtUtcMicros,
    } });
    return mapManagementResult<FinanceCalibrationPointView>(response, session);
  },
  async restoreCalibration(session, id, expectedRevision, sourceRevision) {
    const current = await this.loadSnapshot(session);
    const recordedAtUtcMicros = nowMicros();
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { calibration: { action: { restore: { id, sourceRevision } }, expectedRevision } }, recordedAtUtcUs: recordedAtUtcMicros,
    } });
    return mapManagementResult<FinanceCalibrationPointView>(response, session);
  },
  async loadSourceContexts(session) {
    const response = await invoke<JsonObject>("finance_v2_source_contexts", { session: toWireSession(session) });
    return mapArray(response.contexts) as unknown as FinanceSourceContextView[];
  },
  async saveSourceContext(session, input) {
    const current = await this.loadSnapshot(session);
    const value = { id: input.id, revision: input.expectedRevision === undefined ? 1 : input.expectedRevision + 1,
      label: input.label, provider: input.provider, scope: input.scope, dateSemantics: input.dateSemantics, active: input.active };
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { sourceContext: { value, expectedRevision: input.expectedRevision ?? null } }, recordedAtUtcUs: nowMicros(),
    } });
    return mapManagementResult<FinanceSourceContextView>(response, session);
  },
  async loadSources(session, selectedContextId, selectedProfileId) {
    const contexts = selectedContextId ? (await this.loadSourceContexts(session)).filter((item) => item.id === selectedContextId) : await this.loadSourceContexts(session);
    const rows: FinanceSourceView[] = [];
    for (const context of contexts.filter((item) => item.active)) for (const profile of FINANCE_V2_SOURCE_PROFILES.filter((item) => !selectedProfileId || item.id === selectedProfileId)) {
      const response = await invoke<JsonObject>("finance_v2_source_bindings", { request: {
        session: toWireSession(session), contextId: context.id, contextRevision: context.revision, profileId: profile.id, profileRevision: "1",
      } });
      const revision = Number(response.globalRevision);
      for (const binding of mapArray(response.bindings)) rows.push({
        id: String(binding.id), revision: Number(binding.revision), contextId: String(binding.contextId), contextRevision: Number(binding.contextRevision),
        profileId: String(binding.profileId), profileRevision: String(binding.profileRevision), fieldAlias: String(binding.fieldAlias), sourceHint: binding.sourceHint == null ? null : String(binding.sourceHint),
        accountId: binding.accountId == null ? null : String(binding.accountId), viaId: binding.viaId == null ? null : String(binding.viaId),
        active: Boolean(binding.active), bindingRevision: revision,
      });
    }
    return rows;
  },
  async saveSource(session, input) {
    const current = await this.loadSnapshot(session);
    const accountId = input.accountId ?? null;
    const viaId = input.viaId ?? null;
    if (Boolean(accountId) === Boolean(viaId)) throw new Error("来源绑定必须且只能指定一个 Account 或 Via。");
    const profileAlias = sourceBindingAlias(input.profileId);
    const validAlias = input.fieldAlias === "artifact_account" || input.fieldAlias === "artifact_via" || input.fieldAlias === profileAlias;
    if (!input.contextId || input.contextRevision < 1 || input.profileRevision !== "1" || !validAlias) {
      throw new Error("来源绑定必须引用已验证 SourceContext，并符合固定 Profile、版本与字段 alias。");
    }
    const accountAlias = input.fieldAlias === "account_hint" || input.fieldAlias === "artifact_account";
    if (accountAlias !== Boolean(accountId)) throw new Error("此来源字段只能绑定到 registry 指定的目标类型。");
    const hintAlias = input.fieldAlias === "account_hint" || input.fieldAlias === "via_hint";
    if (hintAlias !== Boolean(input.sourceHint?.trim())) throw new Error("hint alias 必须填写精确来源文本；artifact 默认 alias 不接受 hint 文本。");
    const value = { id: input.id, revision: input.expectedRevision === undefined ? 1 : input.expectedRevision + 1,
      contextId: input.contextId, contextRevision: input.contextRevision, profileId: input.profileId, profileRevision: input.profileRevision,
      fieldAlias: input.fieldAlias, sourceHint: hintAlias ? input.sourceHint!.trim() : null, accountId, viaId, active: input.active };
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { sourceBinding: { value, expectedRevision: input.expectedRevision ?? null } }, recordedAtUtcUs: nowMicros(),
    } });
    const saved = mapManagementResult<FinanceSourceView>(response, session);
    const refreshed = await invoke<JsonObject>("finance_v2_source_bindings", { request: {
      session: toWireSession(session), contextId: input.contextId, contextRevision: input.contextRevision,
      profileId: input.profileId, profileRevision: input.profileRevision,
    } });
    const globalRevision = Number(refreshed.globalRevision);
    const binding = mapArray(refreshed.bindings).map((item) => mapSourceBinding(item, globalRevision)).find((item) => item.id === saved.entity.id);
    return { ...saved, entity: binding ?? { ...saved.entity, bindingRevision: globalRevision } };
  },
  async setAccountViaBinding(session, accountId, viaId, active, expectedRevision) {
    const current = await this.loadSnapshot(session);
    const old = current.accountViaBindings.find((binding) => binding.accountId === accountId && binding.viaId === viaId);
    const expectedMappingRevision = current.accountViaMappingRevision;
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { accountVia: { accountId, viaId, revision: (old?.revision ?? 0) + 1, active,
        expectedMappingRevision: expectedRevision ?? expectedMappingRevision } }, recordedAtUtcUs: nowMicros(),
    } });
    return mapManagementResult<FinanceSnapshotView["accountViaBindings"][number]>(response, session);
  },
  async setAccountActive(session, accountId, expectedRevision, active) {
    const current = await this.loadSnapshot(session);
    const account = current.accounts.find((item) => item.id === accountId && item.revision === expectedRevision);
    if (!account) throw new Error("账户修订已变化，请刷新后重试。");
    const response = await invoke<JsonObject>("finance_v2_management_save", { request: {
      session: toWireSession(session), expectedGeneration: current.generation, operationId: crypto.randomUUID().toLowerCase(),
      mutation: { account: { value: { id: account.id, revision: account.revision + 1, name: account.name, kind: account.kind,
        bean_path: account.beanPath, parent_id: account.parentId, active, ever_used: account.everUsed }, expectedRevision } }, recordedAtUtcUs: nowMicros(),
    } });
    return mapManagementResult<FinanceSnapshotView["accounts"][number]>(response, session);
  },
  async readWorkspace(session, draftId) {
    const response = await invoke<JsonObject>("finance_v2_workspace_read", { request: { session: toWireSession(session), draftId } });
    return mapWorkspace(response.readModel);
  },
  async stageWorkspaceIntent(session, draftId, payload, sourceItemIds) {
    const current = await this.readWorkspace(session, draftId);
    const response = await invoke<JsonObject>("finance_v2_workspace_stage_intent", { request: {
      session: toWireSession(session), draftId, expectedDraftRevision: current.draftRevision,
      payload: intentToWire(payload), sourceItemIds,
    } });
    return String((camel(response.readModel) as JsonObject).undoOperationId ?? "");
  },
  async stageWorkspaceRefinement(session, draftId, input: FinanceRefinementInput, sourceItemIds) {
    const current = await this.readWorkspace(session, draftId);
    const response = await invoke<JsonObject>("finance_v2_workspace_stage_refinement", { request: {
      session: toWireSession(session), draftId, expectedDraftRevision: current.draftRevision,
      input: refinementInputToWire(input), sourceItemIds,
    } });
    return String((camel(response.readModel) as JsonObject).undoOperationId ?? "");
  },
  async undoWorkspaceAction(session, draftId, operationId) {
    const current = await this.readWorkspace(session, draftId);
    await invoke("finance_v2_workspace_undo", { request: {
      session: toWireSession(session), draftId, expectedDraftRevision: current.draftRevision, operationId,
    } });
  },
  async applyAiCategorySuggestions(session, draftId, suggestions: FinanceAiCategorySuggestion[]): Promise<FinanceAiApplyResult[]> {
    const current = await this.readWorkspace(session, draftId);
    const response = await invoke<JsonObject>("finance_v2_workspace_apply_ai_suggestions", { request: {
      session: toWireSession(session), draftId, expectedDraftRevision: current.draftRevision,
      suggestions: suggestions.map((item) => ({ item_id: item.itemId, expected_item_revision: item.expectedItemRevision,
        expected_manual_category_revision: item.expectedManualCategoryRevision, account_id: item.accountId,
        account_revision: item.accountRevision, model: item.model })),
    } });
    return mapArray(response.results).map((result) => ({ itemId: String(result.itemId), applied: Boolean(result.applied), reason: result.reason == null ? null : String(result.reason) }));
  },
  async persistWorkspace(session, draftId) {
    const read = await this.readWorkspace(session, draftId);
    return { draftId, revision: read.draftRevision, durableRevision: read.durableRevision, commitState: "Unprepared", generation: read.ledgerGeneration };
  },
  async pickAndParse(session, contextId, expectedContextRevision, profileId, onProgress, signal) {
    const contexts = await this.loadSourceContexts(session);
    const context = contexts.find((item) => item.id === contextId && item.revision === expectedContextRevision && item.active);
    if (!context) throw new Error("来源主体不存在、已停用或修订已变化，请刷新后重试。");
    const profile = FINANCE_V2_SOURCE_PROFILES.find((item) => item.id === profileId);
    if (!profile) throw new Error("请选择固定 registry 中的来源 Profile。");
    const snapshot = await this.loadSnapshot(session);
    onProgress("请选择来源文件；文件路径不会发送给解析器。");
    const selectedPath = await invoke<string | null>("finance_v2_source_pick_file");
    if (!selectedPath) throw new DOMException("已取消文件选择。", "AbortError");
    if (signal.aborted) throw new DOMException("已取消解析请求。", "AbortError");
    onProgress("正在隔离解析所选文件…");
    const response = await invoke<JsonObject>("finance_v2_parse_artifact", { request: {
      session: toWireSession(session), selectedPath, contextId, expectedContextRevision,
      profileId, profileRevision: "1",
    } });
    if (signal.aborted) throw new DOMException("解析已返回，但界面请求已取消；结果未确认或创建草稿。", "AbortError");
    const observations = mapArray(response.observations).map((item) => ({
      ...item, contextId: String(item.sourceContextId ?? response.contextId),
      contextRevision: Number(item.sourceContextRevision ?? response.contextRevision),
      contextProvider: String(item.sourceContextProvider ?? contexts.find((candidate) => candidate.id === contextId)?.provider ?? ""),
    } as unknown as FinanceParsedObservationView));
    const rows = observations.map((observation) => rowFromObservation(observation));
    return {
      draftId: "", draftRevision: 0, durableRevision: 0, baseGeneration: snapshot.generation, rows,
      observations, accountViaMappingRevision: snapshot.accountViaMappingRevision,
      capturedAccountViaBindings: snapshot.accountViaBindings, contextId, contextRevision: expectedContextRevision, profileId,
    };
  },
  async confirmParsedBatch(session, batch, acceptedItemIds) {
    if (!batch.observations || batch.accountViaMappingRevision === undefined || !batch.contextId || !batch.contextRevision || !batch.profileId) {
      throw new Error("解析批次缺少冻结的 SourceContext、Profile 或 Account/Via 映射快照。");
    }
    const accepted = new Set(acceptedItemIds);
    const observations = batch.observations.filter((item) => accepted.has(observationKey(item)));
    if (!observations.length) throw new Error("请至少选择一条观察行后再确认。");
    const response = await invoke<JsonObject>("finance_v2_workspace_create", { request: {
      session: toWireSession(session), confirmation: true, expectedLedgerGeneration: batch.baseGeneration,
      sourceContextId: batch.contextId, sourceContextRevision: batch.contextRevision,
      observations: observations.map(observationToWire), accountViaMappingRevision: batch.accountViaMappingRevision,
      capturedAccountViaBindings: batch.capturedAccountViaBindings?.map((item) => snake(item)),
    } });
    const model = mapWorkspace(response.readModel);
    return { ...batch, draftId: String(response.draftId), draftRevision: Number(response.draftRevision), durableRevision: Number(response.durableRevision),
      rows: model.leftRows.map(rowFromWorkspaceRow) };
  },
  async createManualWorkspace(session) {
    const snapshot = await this.loadSnapshot(session);
    const response = await invoke<JsonObject>("finance_v2_workspace_create_manual", { request: {
      session: toWireSession(session), expectedLedgerGeneration: snapshot.generation,
      accountViaMappingRevision: snapshot.accountViaMappingRevision,
      capturedAccountViaBindings: snapshot.accountViaBindings.map((item) => snake(item)),
    } });
    const model = mapWorkspace(response.readModel);
    if (response.workspaceKind !== "ManualOnly") throw new Error("后端未返回 ManualOnly 工作区身份，拒绝继续。");
    return { draftId: String(response.draftId), draftRevision: Number(response.draftRevision), durableRevision: Number(response.durableRevision),
      baseGeneration: model.ledgerGeneration, rows: model.leftRows.map(rowFromWorkspaceRow), observations: [],
      accountViaMappingRevision: snapshot.accountViaMappingRevision, capturedAccountViaBindings: snapshot.accountViaBindings, manualOnly: true };
  },
  async saveDraft(session, batch) {
    if (!batch.draftId) throw new Error("请先确认解析观察并创建工作区草稿。");
    const read = await this.readWorkspace(session, batch.draftId);
    return { draftId: batch.draftId, revision: read.draftRevision, durableRevision: read.durableRevision, commitState: "Unprepared", generation: read.ledgerGeneration };
  },
  async confirmWorkspaceCandidate(session, draftId, candidateKey) {
    const model = await this.readWorkspace(session, draftId);
    const candidate = model.candidates.find((item) => item.key === candidateKey);
    if (!candidate || candidate.stale || candidate.confirmed) throw new Error("候选不存在、已过期或已确认。");
    const row = model.leftRows.find((item) => item.observation.artifactId === candidate.observation.artifactId
      && item.observation.locator === candidate.observation.locator
      && item.observation.occurrenceDiscriminator === candidate.observation.occurrenceDiscriminator);
    if (!row) throw new Error("候选对应的来源行已移出工作区。");
    await this.stageWorkspaceIntent(session, draftId, { candidateConfirmation: { candidateKey } }, [row.itemId]);
  },
  async loadDraftStatus(session) {
    const actionable = (await this.listDrafts(session)).filter((item) => item.state === "Open" || item.state === "Prepared" || item.state === "Committed");
    const entry = actionable.length === 1 ? actionable[0] : undefined;
    if (!entry) return { draftId: null, revision: 0, durableRevision: 0, commitState: "Unprepared", generation: session.generation };
    const state = entry.state === "Prepared" ? "Prepared" : entry.state === "Committed" ? "Committed" : "Unprepared";
    return { draftId: entry.draftId, revision: entry.durableRevision, durableRevision: entry.durableRevision, commitState: state,
      operationId: entry.operationId, receiptId: entry.receiptId, generation: session.generation, manualOnly: entry.workspaceKind === "ManualOnly", draftState: entry.state };
  },
  async listDrafts(session): Promise<FinanceDraftListEntryView[]> {
    const response = await invoke<JsonObject>("finance_v2_workspace_list", { request: { session: toWireSession(session) } });
    return mapArray(response.drafts).map((item) => ({
      draftId: String(item.draftId), workspaceKind: item.workspaceKind as FinanceDraftListEntryView["workspaceKind"],
      durableRevision: Number(item.durableRevision), state: String(item.state) as FinanceDraftListEntryView["state"],
      operationId: item.operationId == null ? undefined : String(item.operationId),
      receiptId: item.receiptId == null ? undefined : String(item.receiptId),
      updatedAtUtcUs: item.updatedAtUtcUs == null ? null : item.updatedAtUtcUs as string | number,
    }));
  },
  async setManualCategory(session, draftId, itemId, expectedItemRevision, category, changedAtUtcMicros) {
    await updateWorkspaceRow(session, draftId, itemId, expectedItemRevision, { setCategory: { category: category ? snake(category) : null } }, changedAtUtcMicros);
  },
  async rejectObservation(session, draftId, itemId, expectedItemRevision) {
    await updateWorkspaceRow(session, draftId, itemId, expectedItemRevision, "reject", nowMicros());
  },
  async cancelObservation(session, draftId, itemId, expectedItemRevision) {
    await updateWorkspaceRow(session, draftId, itemId, expectedItemRevision, "cancel", nowMicros());
  },
  async cancelWorkspaceImport(session, draftId) {
    const current = await this.readWorkspace(session, draftId);
    await invoke("finance_v2_workspace_cancel_import", { request: { session: toWireSession(session), draftId, expectedDraftRevision: current.draftRevision } });
  },
  async listRestorableFacts(session) { return (await this.loadSnapshot(session)).restorableFacts; },
  async listHistory(session, entityKind: FinanceHistoryEntityKind, entityId) {
    const response = await invoke<JsonObject>("finance_v2_history", { request: { session: toWireSession(session), entityKind, entityId } });
    const entries = mapArray(response.entries);
    return entries.map((entry, index) => {
      const payload = (entry.fact ?? entry.treatment ?? entry) as JsonObject;
      const revision = Number(payload.revision ?? entry.revision ?? index + 1);
      const recordedMicros = entry.recordedAtUtcUs ?? entry.recordedAtUtcMicros ?? payload.recordedAtUtcUs;
      const millis = recordedMicros == null ? NaN : Number(BigInt(String(recordedMicros)) / 1000n);
      const recordedAt = Number.isFinite(millis) ? new Date(millis).toLocaleString() : `r${revision}`;
      const previous = index > 0 ? mapArray(response.entries)[index - 1] : null;
      const previousPayload = previous ? (previous.fact ?? previous.treatment ?? previous) as JsonObject : null;
      const currentSummary = JSON.stringify(payload);
      const previousSummary = previousPayload ? JSON.stringify(previousPayload) : "—";
      const origin = String(entry.changeOrigin ?? entry.status ?? entry.relationKind ?? "revision");
      return { id: String(payload.id ?? entry.id ?? `${entityId}:${revision}`), revision, recordedAt, entity: entityKind,
        field: "版本快照", before: previousSummary, after: currentSummary, provenance: origin,
        relationChange: entry.relationKind == null ? undefined : String(entry.relationKind) };
    });
  },
  async loadRules(session): Promise<FinanceRuleView> {
    return camel(await invoke<unknown>("finance_v2_rules_read", { request: { session: toWireSession(session) } })) as FinanceRuleView;
  },
  async saveRules(session, expectedRevision, expectedSha256, content): Promise<FinanceRuleView> {
    return camel(await invoke<unknown>("finance_v2_rules_save", { request: { session: toWireSession(session), expectedRevision, expectedSha256, content, recordedAtUtcUs: nowMicros() } })) as FinanceRuleView;
  },
  async previewAppendRules(session, appendContent): Promise<FinanceRuleAppendPreview> {
    const current = await this.loadRules(session);
    const preview = camel(await invoke<unknown>("finance_v2_rules_preview_append", { request: { session: toWireSession(session), expectedRevision: current.revision, expectedSha256: current.sha256, appendText: appendContent } })) as FinanceRuleAppendPreview;
    return { ...preview, appendText: appendContent };
  },
  async confirmAppendRules(session, preview): Promise<FinanceRuleView> {
    return camel(await invoke<unknown>("finance_v2_rules_confirm_append", { request: { session: toWireSession(session), expectedRevision: preview.baseRevision,
      expectedSha256: preview.baseSha256, appendSha256: preview.appendSha256, confirmed: true, recordedAtUtcUs: nowMicros(), appendText: preview.appendText } })) as FinanceRuleView;
  },
  async openRulesFile(session) {
    const path = await invoke<string>("finance_v2_rules_open_file", { request: { session: toWireSession(session) } });
    await openLocalPath(path);
  },
  async loadFinanceAiModel(session): Promise<FinanceAiModelView> {
    return camel(await invoke<unknown>("finance_v2_ai_model_read", { request: { session: toWireSession(session) } })) as FinanceAiModelView;
  },
  async saveFinanceAiModel(session, expectedRevision, modelId): Promise<FinanceAiModelView> {
    return camel(await invoke<unknown>("finance_v2_ai_model_save", { request: { session: toWireSession(session), expectedRevision, modelId, recordedAtUtcUs: nowMicros() } })) as FinanceAiModelView;
  },
  async prepareCommit(session, batch) {
    if (!batch.draftId) throw new Error("没有可预校验的工作区草稿。");
    const response = camel(await invoke<unknown>("finance_v2_prepare_commit", { request: {
      session: toWireSession(session), draftId: batch.draftId, expectedDraftRevision: batch.draftRevision,
    } })) as JsonObject;
    const plan = response.plan as JsonObject;
    const recordedAtUtcUs = Number(response.recordedAtUtcUs);
    if (!Number.isSafeInteger(recordedAtUtcUs) || recordedAtUtcUs < 0 || !response.prepareToken) throw new Error("prepare 响应缺少固定时间戳或 prepare token。");
    preparedCommits.set(batch.draftId, { prepareToken: String(response.prepareToken), plan, recordedAtUtcUs });
    const revision = Number(plan.requiredDurableRevision ?? response.durableRevision);
    return { errors: [], status: { draftId: batch.draftId, revision, durableRevision: Number(response.durableRevision), commitState: "Prepared",
      operationId: String(plan.operationId), generation: Number(plan.ledgerGeneration), manualOnly: batch.manualOnly } };
  },
  async commitPrepared(session, batch) {
    if (!batch.draftId) throw new Error("没有可提交的工作区草稿。");
    let prepared = preparedCommits.get(batch.draftId);
    if (!prepared) {
      await this.prepareCommit(session, batch);
      prepared = preparedCommits.get(batch.draftId);
    }
    if (!prepared) throw new Error("prepare 令牌不可用，请重新预校验。");
    const plan = prepared.plan;
    const operationId = String(plan.operationId ?? "");
    const payloadSha256 = String(plan.payloadSha256 ?? "");
    const expectedDraftRevision = Number(plan.requiredDurableRevision);
    if (!operationId || !payloadSha256 || !Number.isSafeInteger(expectedDraftRevision) || expectedDraftRevision < 1) {
      throw new Error("prepare 响应缺少有效 operation、payload hash 或持久修订。");
    }
    let response: JsonObject;
    try {
      response = camel(await invoke<unknown>("finance_v2_commit_batch", { request: {
        session: toWireSession(session), draftId: batch.draftId, expectedDraftRevision, operationId, payloadSha256,
        prepareToken: prepared.prepareToken, recordedAtUtcUs: prepared.recordedAtUtcUs,
      } })) as JsonObject;
    } catch (commitError) {
      // The IPC reply may be lost after SQLite committed. Resolve by the same operation ID
      // before reporting anything that could invite a replay.
      let lookup: JsonObject;
      try {
        lookup = camel(await invoke<unknown>("finance_v2_find_receipt", {
          session: toWireSession(session), operationId,
        })) as JsonObject;
      } catch (lookupError) {
        throw new Error(`提交结果无法确认；receipt 查询也失败。请勿重提此批。提交错误：${errorMessage(commitError)}；查询错误：${errorMessage(lookupError)}`);
      }
      const recoveredReceipt = lookup.receipt as JsonObject | null;
      if (!recoveredReceipt) {
        preparedCommits.delete(batch.draftId);
        throw new Error(`提交调用未返回，receipt 查询当前未找到该 operation。请刷新草稿状态后再决定下一步，不要直接重放。原始错误：${errorMessage(commitError)}`);
      }
      if (String(recoveredReceipt.payloadSha256) !== payloadSha256) {
        throw new Error("operation 已有 receipt，但 payload hash 与当前预校验不一致；已阻止重放，请检查隔离账本状态。");
      }
      const recoveredJob = lookup.materializationJob as JsonObject | null;
      if (!recoveredJob) throw new Error("已找到 durable receipt，但没有对应物化 job；请保留 operation 并联系修复流程。");
      response = { receipt: recoveredReceipt, materializationJob: recoveredJob, alreadyCommitted: true,
        materializationError: "提交 receipt 已确认；请通过恢复流程核对物化与草稿 finalize 状态。" };
    }
    preparedCommits.delete(batch.draftId);
    const receipt = response.receipt as JsonObject;
    const job = response.materializationJob as JsonObject;
    const materializationReady = String(job.status).toLowerCase() === "ready";
    const pendingMaterialization = response.materializationError == null
      ? (materializationReady && response.alreadyCommitted !== true ? undefined : "已提交；请核对当前 generation 物化与草稿 finalize 状态。")
      : String(response.materializationError);
    session.generation = Number(receipt.generation);
    return { draftId: batch.draftId, revision: Number(plan.requiredDurableRevision), durableRevision: Number(response.durableRevision ?? plan.requiredDurableRevision),
      commitState: "Committed", operationId: String(receipt.operationId), receiptId: String(receipt.receiptId),
      generation: Number(receipt.generation), pendingMaterialization, manualOnly: batch.manualOnly, draftState: pendingMaterialization ? "Committed" : "Finalized" };
  },
  async retryMaterialization(session, operationId) {
    const response = camel(await invoke<unknown>("finance_v2_recover_materialization", { request: {
      session: toWireSession(session), operationId, recordedAtUtcUs: nowMicros(),
    } })) as JsonObject;
    const receipt = response.receipt as JsonObject;
    const job = response.materializationJob as JsonObject;
    session.generation = Number(response.activeGeneration);
    let entry: FinanceDraftListEntryView | undefined;
    let draftListLoaded = false;
    try { entry = (await this.listDrafts(session)).find((item) => item.operationId === operationId); draftListLoaded = true; }
    catch (error) { console.warn("Finance v2 recovery completed; draft list refresh failed", error); }
    const ready = String(job.status).toLowerCase() === "ready" && (Boolean(response.finalized) || (draftListLoaded && !entry));
    if (ready) {
      try { await this.loadReports(session); }
      catch (error) { console.warn("Finance v2 materialization recovered, but report refresh failed", error); }
    }
    return { draftId: entry?.draftId ?? null, revision: entry?.durableRevision ?? 0, durableRevision: entry?.durableRevision ?? 0,
      commitState: "Committed", operationId: String(receipt.operationId), receiptId: String(receipt.receiptId),
      generation: Number(response.activeGeneration), pendingMaterialization: ready ? undefined : "物化修复已返回，但工作区 finalize 尚未完成。",
      manualOnly: entry?.workspaceKind === "ManualOnly", draftState: entry?.state ?? "Committed" };
  },
  async abandonUnsubmittedDraft(session, draftId) {
    await invoke<void>("finance_v2_workspace_abandon", { request: { session: toWireSession(session), draftId } });
    preparedCommits.delete(draftId);
  },
};

function mapSession(value: unknown): IsolatedFinanceSession {
  const item = camel(value) as JsonObject;
  if (item.scope !== "isolated" || !item.sessionId || !item.rootPath || !item.workspaceId || !item.ledgerIdentity || Number(item.markerVersion) < 1) {
    throw new Error("Finance v2 后端返回无效的隔离 session。");
  }
  return { sessionId: String(item.sessionId), rootPath: String(item.rootPath), workspaceId: String(item.workspaceId),
    ledgerIdentity: String(item.ledgerIdentity), markerVersion: Number(item.markerVersion), scope: "isolated", generation: Number(item.generation) };
}

function mapManagementResult<T>(value: JsonObject, session: IsolatedFinanceSession): FinanceManagementSaveResult<T> {
  const response = camel(value) as JsonObject;
  const generation = Number(response.generation);
  session.generation = generation;
  const receipt = camel(response.receipt) as JsonObject;
  const job = camel(response.materializationJob) as JsonObject;
  const status = String(job.status).toLowerCase() as "pending" | "running" | "ready" | "failed";
  return { entity: camel(response.entity) as T, generation, receiptId: String(receipt.receiptId ?? ""),
    operationId: String(receipt.operationId ?? ""), materializationJobId: String(job.jobId ?? ""), materializationStatus: status,
    ...(response.materializationError == null ? {} : { materializationError: String(response.materializationError) }) };
}

function toWireSession(session: IsolatedFinanceSession): WireSession {
  return { sessionId: session.sessionId, rootPath: session.rootPath, workspaceId: session.workspaceId,
    ledgerIdentity: session.ledgerIdentity, markerVersion: session.markerVersion, scope: session.scope, generation: session.generation };
}

function camel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camel);
  if (!value || typeof value !== "object") return value;
  const source = value as JsonObject;
  const keys = Object.keys(source);
  if (keys.length === 1 && enumTags.has(keys[0])) return mapEnum(keys[0], source[keys[0]]);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), camel(item)]));
}

const enumTags = new Set(["Date", "Instant", "Manual", "Imported", "SignedQuantity", "Text", "Missing", "Confirmed", "Unresolved", "Failed", "SourceBinding", "Human", "Ai", "Editing", "ImportCancelled", "Prepared", "Committed", "Abandoned", "Complete", "BudgetExhausted"]);
function mapEnum(tag: string, payload: unknown): unknown {
  const normalized = camel(payload);
  if (tag === "Confirmed" || tag === "Missing" || tag === "SourceBinding" || tag === "Human" || tag === "Editing" || tag === "ImportCancelled" || tag === "Abandoned") return tag;
  if (tag === "Unresolved" || tag === "Failed") return { [tag.toLowerCase()]: normalized };
  if (tag === "Ai") return { ai: normalized };
  if (tag === "Prepared") return { prepared: normalized };
  if (tag === "Committed") return { committed: normalized };
  if (tag === "Complete" || tag === "BudgetExhausted") return { [tag[0].toLowerCase() + tag.slice(1)]: normalized };
  if (tag === "SignedQuantity") return { kind: tag, quantity: normalized };
  if (tag === "Text") return { kind: tag, value: normalized };
  if (tag === "Date" && (typeof normalized === "string" || normalized === null)) return { kind: tag, value: normalized };
  if (tag === "Date" || tag === "Instant" || tag === "Manual" || tag === "Imported") {
    return { kind: tag, ...(normalized && typeof normalized === "object" ? normalized as JsonObject : { value: normalized }) };
  }
  return normalized;
}

function mapArray(value: unknown): JsonObject[] { return Array.isArray(value) ? value.map((item) => camel(item) as JsonObject) : []; }
function mapFact(value: unknown): FinanceFactView { return camel(value) as FinanceFactView; }
function mapAccountViaBinding(value: JsonObject): FinanceAccountViaView {
  return { accountId: String(value.accountId), viaId: String(value.viaId), revision: Number(value.revision), active: Boolean(value.active) };
}
function mapSourceBinding(value: JsonObject, bindingRevision: number): FinanceSourceView {
  return { id: String(value.id), revision: Number(value.revision), contextId: String(value.contextId), contextRevision: Number(value.contextRevision),
    profileId: String(value.profileId), profileRevision: String(value.profileRevision), fieldAlias: String(value.fieldAlias),
    sourceHint: value.sourceHint == null ? null : String(value.sourceHint), accountId: value.accountId == null ? null : String(value.accountId),
    viaId: value.viaId == null ? null : String(value.viaId), active: Boolean(value.active), bindingRevision };
}
function mapLedgerSnapshot(value: unknown): FinanceSnapshotView {
  const snapshot = camel(value) as JsonObject;
  return { generation: Number(snapshot.generation), accounts: mapArray(snapshot.accounts), vias: mapArray(snapshot.vias),
    facts: mapArray(snapshot.activeLeafFacts).map(mapFact), treatments: mapArray(snapshot.currentTreatments),
    calibrations: mapArray(snapshot.calibrations) } as FinanceSnapshotView;
}
function mapWorkspace(value: unknown): FinanceWorkspaceReadModel {
  const model = camel(value) as JsonObject;
  return { ...model, ledgerGeneration: Number(model.ledgerGeneration), draftRevision: Number(model.draftRevision),
    durableRevision: Number(model.durableRevision), undoOperationId: model.undoOperationId == null ? null : String(model.undoOperationId),
    leftRows: mapArray(model.leftRows), rightPreview: mapArray(model.rightPreview).map((item) => ({ ...item, projectedFacts: mapArray(item.projectedFacts).map(mapFact) })),
    candidates: mapArray(model.candidates), unresolvedCandidateObservations: mapArray(model.unresolvedCandidateObservations).map(String) } as FinanceWorkspaceReadModel;
}

function observationKey(observation: FinanceParsedObservationView): string {
  return `${observation.artifactId}|${observation.locator}|${observation.occurrenceDiscriminator}`;
}

function rowFromObservation(observation: FinanceParsedObservationView): FinanceImportBatchView["rows"][number] {
  const quantity = observation.fields.find((field) => field.value.kind === "SignedQuantity")?.value;
  const amount = quantity?.kind === "SignedQuantity" ? quantity.quantity : null;
  const summary = observation.fields.find((field) => /description|summary|merchant|counterparty|transaction_name/i.test(field.role))?.rawText ?? "";
  return {
    itemId: observationKey(observation), itemRevision: 0, manualCategoryRevision: 0, locator: observation.locator,
    merchant: summary, summary, notes: "", amountText: amount?.amount ?? "", commodity: amount?.commodity ?? "",
    quality: observation.quality, categoryId: null, categoryKind: null, stillLeft: true, manuallyEdited: false,
  };
}

function rowFromWorkspaceRow(row: FinanceWorkspaceLeftRowView): FinanceImportBatchView["rows"][number] {
  const view = rowFromObservation(row.observation);
  return { ...view, itemId: row.itemId, itemRevision: row.itemRevision, manualCategoryRevision: row.manualCategoryRevision,
    categoryId: row.category?.accountId ?? null, categoryViaId: row.category?.viaId ?? null,
    categoryAccountRevision: row.category?.accountRevision ?? undefined, categoryViaRevision: row.category?.viaRevision ?? undefined,
    stillLeft: row.stillInLeft, manuallyEdited: row.categoryOrigin === "Human" };
}

function observationToWire(observation: FinanceParsedObservationView): unknown {
  return {
    artifact_id: observation.artifactId, artifact_sha256: observation.artifactSha256, artifact_byte_length: observation.artifactByteLength,
    source_context_id: observation.contextId, source_context_revision: observation.contextRevision,
    source_context_provider: observation.contextProvider,
    contract_id: observation.contractId, contract_revision: observation.contractRevision, profile_id: observation.profileId,
    profile_revision: observation.profileRevision, binding_revision: observation.bindingRevision, locator: observation.locator,
    occurrence_discriminator: observation.occurrenceDiscriminator, source_row: snake(observation.sourceRow),
    fields: observation.fields.map((field) => ({ role: field.role, raw_text: field.rawText,
      value: field.value.kind === "SignedQuantity" ? { SignedQuantity: snake(field.value.quantity) }
        : field.value.kind === "Date" ? { Date: field.value.value }
          : field.value.kind === "Text" ? { Text: field.value.value } : "Missing",
      binding: field.binding ? snake(field.binding) : null })),
    quality: observation.quality === "Confirmed" ? "Confirmed"
      : "unresolved" in observation.quality ? { Unresolved: observation.quality.unresolved } : { Failed: observation.quality.failed },
  };
}

async function updateWorkspaceRow(
  session: IsolatedFinanceSession,
  draftId: string,
  itemId: string,
  expectedItemRevision: number,
  action: unknown,
  changedAtUtcMicros: string | number,
): Promise<void> {
  const current = await invoke<JsonObject>("finance_v2_workspace_read", { request: { session: toWireSession(session), draftId } });
  const readModel = camel(current.readModel) as JsonObject;
  const timestamp = typeof changedAtUtcMicros === "number" ? changedAtUtcMicros : safeInteger(changedAtUtcMicros);
  await invoke("finance_v2_workspace_update_row", { request: {
    session: toWireSession(session), draftId, expectedDraftRevision: Number(readModel.draftRevision),
    itemId, expectedItemRevision, action, changedAtUtcMicros: timestamp,
  } });
}

function intentToWire(intent: FinanceIntentPayload): unknown {
  if ("fact" in intent) {
    const mutation = intent.fact;
    if ("create" in mutation) return { Fact: { Create: { fact: factToWire(mutation.create.fact) } } };
    if ("amend" in mutation) return { Fact: { Amend: { expected: snake(mutation.amend.expected), fact: factToWire(mutation.amend.fact), manual_change: manualChangeToWire(mutation.amend.manualChange) } } };
    if ("delete" in mutation) return { Fact: { Delete: { expected: snake(mutation.delete.expected), deleted_version: factToWire(mutation.delete.deletedVersion), manual_change: manualChangeToWire(mutation.delete.manualChange) } } };
    return { Fact: { Restore: { expected_revision: mutation.restore.expectedRevision, restored_version: factToWire(mutation.restore.restoredVersion), manual_change: manualChangeToWire(mutation.restore.manualChange) } } };
  }
  if ("evidenceMatch" in intent) return { EvidenceMatch: snake(intent.evidenceMatch) };
  if ("treatment" in intent) {
    const value = intent.treatment;
    if ("apply" in value) return { Treatment: { Apply: { treatment: treatmentToWire(value.apply.treatment) } } };
    if ("amend" in value) return { Treatment: { Amend: { expected_revision: value.amend.expectedRevision, treatment: treatmentToWire(value.amend.treatment), manual_change: manualChangeToWire(value.amend.manualChange) } } };
    return { Treatment: { Release: { expected_revision: value.release.expectedRevision, tombstone: treatmentToWire(value.release.tombstone), manual_change: manualChangeToWire(value.release.manualChange) } } };
  }
  if ("candidateConfirmation" in intent) return { CandidateConfirmation: { candidate_key: intent.candidateConfirmation.candidateKey } };
  return unsupported("refinement serializer");
}

function factToWire(fact: FinanceFactView): unknown {
  const source = { ...fact, businessTime: fact.businessTime.kind === "Date"
    ? { Date: { source_date: fact.businessTime.sourceDate } }
    : { Instant: { utc_micros: safeInteger(fact.businessTime.utcMicros), source_date: fact.businessTime.sourceDate } },
    provenance: fact.provenance.kind === "Manual"
      ? { Manual: { created_at_utc_micros: safeInteger(fact.provenance.createdAtUtcMicros) } }
      : { Imported: { evidence_ids: fact.provenance.evidenceIds } } };
  return snake(source);
}
function treatmentToWire(value: unknown): unknown { return snake(value); }
function refinementInputToWire(input: FinanceRefinementInput): unknown {
  return {
    parent_id: input.parentId, parent_revision: input.parentRevision,
    children: input.children.map((fact) => factToWire(fact)),
    evidence_allocations: input.evidenceAllocations.map((allocation) => snake(allocation)),
    treatment_resolutions: input.treatmentResolutions.map((resolution) => "replace" in resolution
      ? { Replace: { old_treatment_id: resolution.replace.oldTreatmentId, old_revision: resolution.replace.oldRevision, replacement: treatmentToWire(resolution.replace.replacement) } }
      : { Dissolve: { old_treatment_id: resolution.dissolve.oldTreatmentId, old_revision: resolution.dissolve.oldRevision, resulting_treatments: resolution.dissolve.resultingTreatments.map(treatmentToWire) } }),
  };
}
function manualChangeToWire(value: { changedAtUtcMicros: string; reason: string }): unknown {
  return { changed_at_utc_micros: safeInteger(value.changedAtUtcMicros), reason: value.reason };
}
function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("时间戳超出安全整数范围，不能无损传递给隔离账本。");
  return parsed;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function nowMicros(): number {
  const value = BigInt(Date.now()) * 1000n;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("当前时间无法无损编码为后端 i64 微秒字段。");
  return parsed;
}
function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject).map(([key, item]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), snake(item)]));
}

function sourceBindingAlias(profileId: string): "account_hint" | "via_hint" | null {
  if (profileId === "credit-card-pdf-text-6/v1") return "account_hint";
  if (["wallet-csv-13/v1", "wallet-xlsx-11/v1", "boc-bank-pdf-text-12/v1"].includes(profileId)) return "via_hint";
  if (FINANCE_V2_SOURCE_PROFILES.some((profile) => profile.id === profileId)) return null;
  throw new Error("Profile 不在固定 v1 registry 中。");
}

