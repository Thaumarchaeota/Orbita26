import { mountSelectField } from "../../../../ui/select-field";
import { mountDecoupledDatePicker } from "../../../../ui/decoupled-date-picker";
import { FINANCE_V2_SOURCE_PROFILES, type FinanceManagementSaveResult, type FinanceV2Backend, type FinanceAccountKind, type FinanceAccountView, type FinanceCalibrationPointView, type FinanceSourceContextView, type FinanceSourceView, type FinanceViaView, type IsolatedFinanceSession } from "../../../finance-v2/types";
import { action, confirmAction, el, section, setStatus, statusNode, textField } from "./dom";

const accountKinds: FinanceAccountKind[] = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];

export function mountManagement(root: HTMLElement, backend: FinanceV2Backend, session: IsolatedFinanceSession): { dispose(): void } {
  const disposers: Array<() => void> = [];
  let accounts: FinanceAccountView[] = [];
  let vias: FinanceViaView[] = [];
  let accountViaBindings: Array<{ accountId: string; viaId: string; revision: number; active: boolean }> = [];
  let accountViaMappingRevision = 0;
  let contexts: FinanceSourceContextView[] = [];
  let bindings: FinanceSourceView[] = [];
  let calibrations: FinanceCalibrationPointView[] = [];
  let editingAccount: FinanceAccountView | null = null;
  let editingContext: FinanceSourceContextView | null = null;
  let editingBinding: FinanceSourceView | null = null;
  let editingCalibration: FinanceCalibrationPointView | null = null;
  const pendingWrites = new Map<string, { label: string; error: string; status: string; jobId: string }>();
  const status = statusNode();
  const materializationSection = section("待修复的物化任务", "管理变更已持久保存后，物化失败不会撤销 receipt。可独立修复各项，不影响继续管理其他目录。");
  const materializationRows = el("div", "finance-v2-list");
  materializationSection.append(materializationRows);

  const accountsSection = section("账户目录", "账户、Via 与来源字段映射均独立保存；所有变更限定在当前隔离账本内。分类候选仅使用启用的 Income/Expenses Account。");
  const accountName = textField("账户名称");
  const accountBean = textField("Beancount 路径（可选）");
  const kindHost = el("div", "finance-v2-field-host");
  const parentHost = el("div", "finance-v2-field-host");
  const kindSelect = mountSelectField(kindHost, { label: "账户类型", placeholder: "选择类型", options: accountKinds.map((kind) => ({ value: kind, label: kind })), search: false, multiple: false, value: null, onChange: () => {} });
  const parentSelect = mountSelectField(parentHost, { label: "父账户", placeholder: "无父账户", options: [], search: true, multiple: false, value: null, onChange: () => {} });
  disposers.push(() => kindSelect.dispose(), () => parentSelect.dispose());
  const accountForm = el("div", "finance-v2-fields"); accountForm.append(accountName.root, accountBean.root, kindHost, parentHost);
  const accountList = el("div", "finance-v2-list");
  const saveAccountButton = action("新增账户", async (button) => {
    const kind = kindSelect.getValue() as FinanceAccountKind | null;
    if (!accountName.input.value.trim() || !kind) { setStatus(status, "请填写账户名称并选择类型。", "error"); return; }
    if (editingAccount?.everUsed && editingAccount.kind !== kind) { setStatus(status, "已使用账户不能修改分类类型。", "error"); return; }
    button.disabled = true;
    try {
      const result = await backend.saveAccount(session, { id: editingAccount?.id ?? crypto.randomUUID().toLowerCase(),
        name: accountName.input.value.trim(), kind, beanPath: accountBean.input.value.trim() || null,
        parentId: parentSelect.getValue() || null, active: editingAccount?.active ?? true,
        ...(editingAccount ? { expectedRevision: editingAccount.revision } : {}) });
      const saved = result.entity;
      accounts = [...accounts.filter((item) => item.id !== saved.id), saved];
      resetAccount(); renderAccounts(); updateTargetOptions();
      trackManagementResult(result, `账户「${saved.name}」`);
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  accountsSection.append(accountForm, actionRow(saveAccountButton), accountList);

  const viaSection = section("Via 目录", "Via 只表示来源/通道。来源绑定保存的是精确字段到单一 Account 或 Via 的映射。");
  const viaName = textField("Via 名称");
  const viaList = el("div", "finance-v2-list");
  const saveViaButton = action("新增 Via", async (button) => {
    if (!viaName.input.value.trim()) { setStatus(status, "请填写 Via 名称。", "error"); return; }
    button.disabled = true;
    try {
      const result = await backend.saveVia(session, { id: crypto.randomUUID().toLowerCase(), name: viaName.input.value.trim(), active: true });
      vias = [...vias.filter((item) => item.id !== result.entity.id), result.entity];
      viaName.input.value = ""; renderVias(); updateTargetOptions();
      trackManagementResult(result, `Via「${result.entity.name}」`);
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  viaSection.append(viaName.root, actionRow(saveViaButton), viaList);

  const calibrationSection = section("余额校准", "仅手工录入账户、业务日期、币种和精确有符号数量（可为零）。不会从账单余额预填、自动创建账户或推算汇率；删除与恢复均按当前修订提交。");
  const calibrationAccountHost = el("div", "finance-v2-field-host");
  const calibrationDateHost = el("div", "finance-v2-field-host");
  calibrationDateHost.append(el("span", "finance-v2-field-label", "业务日期"));
  const calibrationAccount = mountSelectField(calibrationAccountHost, { label: "Account", placeholder: "选择账户", options: [], search: true, multiple: false, value: null, onChange: () => {} });
  const calibrationDate = mountDecoupledDatePicker({ defaultTrigger: { container: calibrationDateHost } });
  const calibrationAmount = textField("精确数量（支持负数或零）");
  const calibrationCommodity = textField("Commodity");
  const calibrationForm = el("div", "finance-v2-fields");
  calibrationForm.append(calibrationAccountHost, calibrationDateHost, calibrationAmount.root, calibrationCommodity.root);
  const calibrationRows = el("div", "finance-v2-list");
  const calibrationHistory = el("div", "finance-v2-list");
  const saveCalibrationButton = action("新增校准点", async (button) => {
    const accountId = calibrationAccount.getValue();
    const businessDate = calibrationDate.getValue();
    const amount = calibrationAmount.input.value.trim();
    const commodity = calibrationCommodity.input.value.trim();
    if (!accountId || !businessDate || !amount || !commodity) { setStatus(status, "请填写 Account、业务日期、精确数量和 Commodity。", "error"); return; }
    button.disabled = true;
    try {
      const saved = await backend.saveCalibration(session, { id: editingCalibration?.id ?? crypto.randomUUID().toLowerCase(),
        accountId, businessDate, quantity: { amount, commodity }, ...(editingCalibration ? { expectedRevision: editingCalibration.revision } : {}) });
      trackManagementResult(saved, `余额校准点 ${saved.entity.id} r${saved.entity.revision}`);
      await refreshCalibrations();
      resetCalibration();
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  calibrationSection.append(calibrationForm, actionRow(saveCalibrationButton), calibrationRows, calibrationHistory);
  disposers.push(() => calibrationAccount.dispose(), () => calibrationDate.dispose());

  const mappingSection = section("Account / Via 映射", "管理同一 Account 可使用的 Via 组合。AI 分类只建议 Account，Via 始终保留当前工作区绑定；映射修订变化会使旧解析快照保持可追溯并拒绝陈旧应用。");
  const mappingAccountHost = el("div", "finance-v2-field-host");
  const mappingViaHost = el("div", "finance-v2-field-host");
  const mappingAccount = mountSelectField(mappingAccountHost, { label: "Account", placeholder: "选择启用账户", options: [], search: true, multiple: false, value: null, onChange: () => {} });
  const mappingVia = mountSelectField(mappingViaHost, { label: "Via", placeholder: "选择启用 Via", options: [], search: true, multiple: false, value: null, onChange: () => {} });
  disposers.push(() => mappingAccount.dispose(), () => mappingVia.dispose());
  const mappingList = el("div", "finance-v2-list");
  const saveMapping = action("允许 Account / Via 组合", async (button) => {
    const accountId = mappingAccount.getValue(); const viaId = mappingVia.getValue();
    if (!accountId || !viaId) { setStatus(status, "请选择 Account 与 Via。", "error"); return; }
    button.disabled = true;
    try {
      const result = await backend.setAccountViaBinding(session, accountId, viaId, true, accountViaMappingRevision);
      trackManagementResult(result, "Account / Via 映射");
      const refreshed = await backend.loadSnapshot(session); accountViaBindings = refreshed.accountViaBindings; accountViaMappingRevision = refreshed.accountViaMappingRevision; renderMappings();
    } catch (error) { setStatus(status, errorText(error), "error"); } finally { button.disabled = false; }
  });
  mappingSection.append(mappingAccountHost, mappingViaHost, actionRow(saveMapping), mappingList);

  const sourceSection = section("来源字段绑定", "Profile 与版本来自固定 registry。hint 仅按该 Profile 的明确字段绑定；artifact 默认值由你显式指定。CMB 没有 hint alias，可使用 artifact_account，否则保持 unresolved。");
  const contextLabel = textField("来源主体名称（如钱包/银行产品与账户范围）");
  const contextProvider = textField("机构或钱包提供方");
  const contextScope = textField("产品或账户范围");
  const contextDate = textField("日期语义说明");
  const contextList = el("div", "finance-v2-list");
  const saveContextButton = action("新增来源主体", async (button) => {
    if (!contextLabel.input.value.trim() || !contextProvider.input.value.trim() || !contextScope.input.value.trim() || !contextDate.input.value.trim()) {
      setStatus(status, "请填写来源主体标签、提供方、范围和日期语义。", "error"); return;
    }
    button.disabled = true;
    try {
      const result = await backend.saveSourceContext(session, { id: editingContext?.id ?? crypto.randomUUID().toLowerCase(), label: contextLabel.input.value.trim(), provider: contextProvider.input.value.trim(), scope: contextScope.input.value.trim(), dateSemantics: contextDate.input.value.trim(), active: editingContext?.active ?? true, ...(editingContext ? { expectedRevision: editingContext.revision } : {}) });
      contexts = [...contexts.filter((item) => item.id !== result.entity.id), result.entity]; editingContext = null; contextLabel.input.value = ""; contextProvider.input.value = ""; contextScope.input.value = ""; contextDate.input.value = ""; saveContextButton.textContent = "新增来源主体";
      refreshContexts(); renderContexts(); trackManagementResult(result, `来源主体「${result.entity.label}」`);
    } catch (error) { setStatus(status, errorText(error), "error"); } finally { button.disabled = false; }
  });
  sourceSection.append(contextLabel.root, contextProvider.root, contextScope.root, contextDate.root, actionRow(saveContextButton), contextList);
  const profileHost = el("div", "finance-v2-field-host");
  const contextHost = el("div", "finance-v2-field-host");
  const aliasHost = el("div", "finance-v2-field-host");
  const targetHost = el("div", "finance-v2-field-host");
  const sourceHint = textField("精确来源 hint（需与解析值一致；artifact 默认 alias 留空）");
  sourceHint.root.hidden = true;
  const contextSelect = mountSelectField(contextHost, { label: "已确认来源主体", placeholder: "先创建并选择主体", options: [], search: true, multiple: false, value: null, onChange: () => renderBindingsForContext() });
  const profileSelect = mountSelectField(profileHost, { label: "来源 Profile", placeholder: "选择固定 v1 Profile", options: FINANCE_V2_SOURCE_PROFILES.map((profile) => ({ value: profile.id, label: profile.label })), search: true, multiple: false, value: null, onChange: () => { refreshAliases(); updateTargetOptions(); } });
  const aliasSelect = mountSelectField(aliasHost, { label: "来源字段 alias", placeholder: "先选择 Profile", options: [], search: false, multiple: false, value: null, onChange: () => { updateTargetOptions(); updateHintVisibility(); } });
  const targetSelect = mountSelectField(targetHost, { label: "目标 Account / Via", placeholder: "选择 alias 后选择目标", options: [], search: true, multiple: false, value: null, onChange: () => {} });
  disposers.push(() => contextSelect.dispose(), () => profileSelect.dispose(), () => aliasSelect.dispose(), () => targetSelect.dispose());
  const bindingForm = el("div", "finance-v2-fields"); bindingForm.append(contextHost, profileHost, aliasHost, sourceHint.root, targetHost);
  const bindingList = el("div", "finance-v2-list");
  const saveBindingButton = action("新增字段绑定", async (button) => {
    const profileId = profileSelect.getValue(); const fieldAlias = aliasSelect.getValue(); const targetId = targetSelect.getValue();
    const context = contexts.find((item) => item.id === contextSelect.getValue() && item.active);
    if (!context || !profileId || !fieldAlias || !targetId) { setStatus(status, "请先选择已确认的来源主体、Profile、字段 alias 与目标。", "error"); return; }
    if ((fieldAlias === "account_hint" || fieldAlias === "via_hint") && !sourceHint.input.value.trim()) { setStatus(status, "hint alias 必须填写完全匹配的来源文本。", "error"); return; }
    const targetKind = aliasTargetKind(fieldAlias);
    const target = targetKind === "account" ? accounts.find((item) => item.id === targetId && item.active) : vias.find((item) => item.id === targetId && item.active);
    if (!target) { setStatus(status, "目标必须是当前启用的 registry 对应类型。", "error"); return; }
    button.disabled = true;
    try {
      const prior = editingBinding;
      const result = await backend.saveSource(session, { id: prior?.id ?? crypto.randomUUID().toLowerCase(),
        revision: prior ? prior.revision + 1 : 1, contextId: context.id, contextRevision: context.revision, profileId, profileRevision: "1", fieldAlias,
        sourceHint: fieldAlias === "account_hint" || fieldAlias === "via_hint" ? sourceHint.input.value.trim() : null,
        accountId: targetKind === "account" ? targetId : null, viaId: targetKind === "via" ? targetId : null,
        active: true, ...(prior ? { expectedRevision: prior.revision } : {}) });
      bindings = [...bindings.filter((item) => item.id !== result.entity.id), result.entity];
      editingBinding = null; saveBindingButton.textContent = "新增字段绑定"; targetSelect.setValue(null); renderBindings();
      trackManagementResult(result, `来源主体「${context.label}」/ ${profileId} / ${fieldAlias} 绑定`);
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  sourceSection.append(bindingForm, actionRow(saveBindingButton), bindingList);

  root.append(accountsSection, viaSection, calibrationSection, mappingSection, sourceSection, materializationSection, status);

  function trackManagementResult<T>(result: FinanceManagementSaveResult<T>, label: string): void {
    session.generation = result.generation;
    if (result.materializationStatus === "ready" && !result.materializationError) {
      setStatus(status, `${label}；receipt ${result.receiptId} 已持久保存，物化就绪。`, "success");
      return;
    }
    const operationId = result.operationId;
    if (operationId) pendingWrites.set(operationId, { label, jobId: result.materializationJobId,
      status: result.materializationStatus, error: result.materializationError ?? "receipt 已持久保存，物化任务尚未就绪。" });
    renderPendingWrites();
    setStatus(status, `${label}已持久保存，receipt ${result.receiptId}；物化待修复：${result.materializationError ?? result.materializationStatus}。`, "error");
  }

  function renderPendingWrites(): void {
    materializationRows.replaceChildren();
    materializationSection.hidden = pendingWrites.size === 0;
    for (const [operationId, item] of pendingWrites) {
      const row = el("article", "finance-v2-row");
      row.append(el("div", "finance-v2-row-content", `${item.label} · ${item.status} · job ${item.jobId || "未知"} · operation ${operationId} · ${item.error}`));
      row.append(action("修复此物化", async (button) => {
        button.disabled = true;
        try {
          const result = await backend.retryMaterialization(session, operationId);
          if (result.pendingMaterialization) {
            pendingWrites.set(operationId, { ...item, status: "failed", error: result.pendingMaterialization });
            setStatus(status, `${item.label}仍待修复；receipt 保持有效：${result.pendingMaterialization}`, "error");
          } else {
            pendingWrites.delete(operationId);
            setStatus(status, `${item.label}物化修复完成；session generation 已更新。`, "success");
            try { await refreshAll(); }
            catch (error) { setStatus(status, `物化已修复，但管理快照刷新失败：${errorText(error)}`, "error"); }
          }
          renderPendingWrites();
        } catch (error) {
          pendingWrites.set(operationId, { ...item, error: errorText(error) });
          renderPendingWrites();
          setStatus(status, `${item.label}仍待修复；receipt 保持有效：${errorText(error)}`, "error");
        } finally { button.disabled = false; }
      }));
      materializationRows.append(row);
    }
  }

  async function refreshAll(): Promise<void> {
    const [snapshot, contextRows] = await Promise.all([backend.loadSnapshot(session), backend.loadSourceContexts(session)]);
    accounts = snapshot.accounts; vias = snapshot.vias; calibrations = snapshot.calibrations;
    accountViaBindings = snapshot.accountViaBindings; accountViaMappingRevision = snapshot.accountViaMappingRevision;
    contexts = contextRows; refreshContexts(); renderContexts();
    bindings = await backend.loadSources(session, contextSelect.getValue() || undefined);
    renderAccounts(); renderVias(); renderCalibrationRows(); renderMappings(); renderBindings(); refreshAliases(); updateTargetOptions();
  }

  function resetAccount(): void { editingAccount = null; accountName.input.value = ""; accountBean.input.value = ""; kindSelect.setValue(null); parentSelect.setValue(null); saveAccountButton.textContent = "新增账户"; }
  function resetCalibration(): void {
    editingCalibration = null; calibrationAccount.setValue(null); calibrationDate.setValue(""); calibrationAmount.input.value = "";
    calibrationCommodity.input.value = ""; saveCalibrationButton.textContent = "新增校准点"; renderCalibrationRows();
  }
  async function refreshCalibrations(): Promise<void> {
    const current = await backend.loadSnapshot(session);
    calibrations = current.calibrations;
    accounts = current.accounts;
    session.generation = current.generation;
    renderAccounts(); renderCalibrationRows();
  }
  function renderCalibrationRows(): void {
    calibrationRows.replaceChildren();
    calibrationAccount.setOptions(accounts.filter((item) => item.active || item.id === editingCalibration?.accountId)
      .map((item) => ({ value: item.id, label: item.name + " · " + item.kind + " · " + item.id })));
    for (const point of calibrations) {
      const account = accounts.find((item) => item.id === point.accountId);
      const row = el("article", "finance-v2-row");
      const info = el("div", "finance-v2-row-content");
      info.append(el("strong", "finance-v2-row-title", point.businessDate + " · " + (account?.name ?? point.accountId)));
      info.append(el("span", "finance-v2-muted", point.quantity.amount + " " + point.quantity.commodity
        + " · " + point.status + " · r" + point.revision));
      row.append(info);
      if (point.status === "Active") {
        row.append(action("编辑", () => {
          editingCalibration = point; renderCalibrationRows(); calibrationAccount.setValue(point.accountId); calibrationDate.setValue(point.businessDate);
          calibrationAmount.input.value = point.quantity.amount; calibrationCommodity.input.value = point.quantity.commodity;
          saveCalibrationButton.textContent = "保存校准点修改";
        }));
        row.append(action("删除", async () => confirmAction(root, "删除校准点",
          "删除会追加一个带新修订的删除版本，历史记录仍可用于明确恢复。", "确认删除", async () => {
            const result = await backend.deleteCalibration(session, point.id, point.revision);
            trackManagementResult(result, `已删除余额校准点 ${point.id}`);
            await refreshCalibrations();
          })));
      }
      row.append(action("读取历史", async (button) => {
        button.disabled = true;
        try { await renderCalibrationHistory(point); }
        catch (error) { setStatus(status, errorText(error), "error"); }
        finally { button.disabled = false; }
      }));
      calibrationRows.append(row);
    }
  }
  async function renderCalibrationHistory(point: FinanceCalibrationPointView): Promise<void> {
    const history = await backend.listHistory(session, "calibration", point.id);
    calibrationHistory.replaceChildren(el("h3", "finance-v2-section-title", "校准点历史 · " + point.id));
    for (const entry of history) {
      const row = el("article", "finance-v2-row");
      row.append(el("div", "finance-v2-row-content", entry.recordedAt + " · r" + entry.revision + " · " + entry.provenance));
      const snapshot = parseCalibrationHistoryPoint(entry.after);
      if (point.status === "Deleted" && snapshot?.status === "Active") {
        row.append(action("恢复此历史版本", async () => confirmAction(root, "恢复校准点",
          "将以当前删除修订为基线，追加所选历史版本的恢复记录。", "确认恢复", async () => {
            const result = await backend.restoreCalibration(session, point.id, point.revision, entry.revision);
            trackManagementResult(result, `已恢复余额校准点 ${point.id}`);
            await refreshCalibrations();
            await renderCalibrationHistory(result.entity);
          })));
      }
      calibrationHistory.append(row);
    }
    setStatus(status, history.length ? "已读取校准点历史；恢复操作会追加新修订。" : "此校准点暂无历史版本。", "info");
  }
  function refreshContexts(): void {
    const active = contexts.filter((item) => item.active);
    contextSelect.setOptions(active.map((item) => ({ value: item.id, label: `${item.label} · ${item.provider} · ${item.scope}` })));
  }
  function renderContexts(): void {
    contextList.replaceChildren();
    for (const context of contexts) {
      const row = el("article", "finance-v2-row"); row.append(el("div", "finance-v2-row-content", `${context.label} · ${context.provider} · ${context.scope} · ${context.dateSemantics} · r${context.revision}`));
      row.append(action("选择主体", () => { contextSelect.setValue(context.id); renderBindingsForContext(); }));
      row.append(action("编辑", () => { editingContext = context; contextLabel.input.value = context.label; contextProvider.input.value = context.provider; contextScope.input.value = context.scope; contextDate.input.value = context.dateSemantics; saveContextButton.textContent = "保存主体修改"; }));
      row.append(action(context.active ? "停用主体" : "启用主体", async (button) => {
        button.disabled = true;
        try { const result = await backend.saveSourceContext(session, { ...context, active: !context.active, expectedRevision: context.revision }); contexts = contexts.map((item) => item.id === result.entity.id ? result.entity : item); refreshContexts(); renderContexts(); trackManagementResult(result, `来源主体「${result.entity.label}」`); }
        catch (error) { setStatus(status, errorText(error), "error"); } finally { button.disabled = false; }
      })); contextList.append(row);
    }
  }
  function renderBindingsForContext(): void {
    const contextId = contextSelect.getValue();
    void backend.loadSources(session, contextId || undefined).then((rows) => { bindings = contextId ? bindings.filter((row) => row.contextId !== contextId).concat(rows) : rows; renderBindings(); }).catch((error) => setStatus(status, errorText(error), "error"));
  }
  function refreshAliases(): void {
    const profileId = profileSelect.getValue() ?? "";
    const aliases = aliasesForProfile(profileId);
    aliasSelect.setOptions(aliases.map((alias) => ({ value: alias, label: alias })));
    aliasSelect.setValue(aliases[0] ?? null);
    updateHintVisibility();
  }
  function updateHintVisibility(): void { const alias = aliasSelect.getValue(); sourceHint.root.hidden = alias !== "account_hint" && alias !== "via_hint"; }
  function updateTargetOptions(): void {
    const alias = aliasSelect.getValue() ?? "";
    const kind = aliasTargetKind(alias);
    const options = kind === "account" ? accounts.filter((item) => item.active).map((item) => ({ value: item.id, label: `${item.name} · ${item.kind}` }))
      : kind === "via" ? vias.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name })) : [];
    targetSelect.setOptions(options);
  }
  function renderAccounts(): void {
    calibrationAccount.setOptions(accounts.map((item) => ({ value: item.id, label: item.name + " · " + item.kind + " · " + item.id })));
    accountList.replaceChildren();
    for (const account of accounts) {
      const row = el("article", "finance-v2-row"); const info = el("div", "finance-v2-row-content");
      info.append(el("strong", "finance-v2-row-title", account.name), el("span", "finance-v2-muted", `${account.kind} · r${account.revision}${account.everUsed ? " · 已使用" : ""}${account.parentId ? ` · 上级 ${account.parentId}` : ""}`)); row.append(info);
      if (account.kind !== "Income" && account.kind !== "Expenses") row.append(el("span", "finance-v2-muted", "不作为 AI 分类 Account"));
      row.append(action("编辑", () => { editingAccount = account; accountName.input.value = account.name; accountBean.input.value = account.beanPath ?? ""; kindSelect.setValue(account.kind); parentSelect.setValue(account.parentId); saveAccountButton.textContent = "保存账户修改"; }));
      row.append(action(account.active ? "停用" : "启用", async (button) => {
        button.disabled = true;
        try { const result = await backend.setAccountActive(session, account.id, account.revision, !account.active); accounts = accounts.map((item) => item.id === result.entity.id ? result.entity : item); renderAccounts(); updateTargetOptions(); trackManagementResult(result, `账户「${result.entity.name}」${result.entity.active ? "启用" : "停用"}`); }
        catch (error) { setStatus(status, errorText(error), "error"); } finally { button.disabled = false; }
      })); accountList.append(row);
    }
    parentSelect.setOptions([{ value: "", label: "无父账户" }, ...accounts.filter((account) => account.active).map((account) => ({ value: account.id, label: `${account.name} · ${account.kind}` }))]);
  }
  function renderVias(): void {
    viaList.replaceChildren();
    for (const via of vias) {
      const row = el("article", "finance-v2-row"); row.append(el("div", "finance-v2-row-content", `${via.name} · r${via.revision} · ${via.active ? "启用" : "停用"}`));
      row.append(action(via.active ? "停用" : "启用", async (button) => {
        button.disabled = true;
        try { const result = await backend.saveVia(session, { id: via.id, name: via.name, active: !via.active, expectedRevision: via.revision }); vias = vias.map((item) => item.id === result.entity.id ? result.entity : item); renderVias(); updateTargetOptions(); trackManagementResult(result, `Via「${result.entity.name}」${result.entity.active ? "启用" : "停用"}`); }
        catch (error) { setStatus(status, errorText(error), "error"); } finally { button.disabled = false; }
      })); viaList.append(row);
    }
  }
  function renderMappings(): void {
    mappingAccount.setOptions(accounts.filter((item) => item.active).map((item) => ({ value: item.id, label: `${item.name} · ${item.kind}` })));
    mappingVia.setOptions(vias.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name })));
    mappingList.replaceChildren();
    for (const binding of accountViaBindings) {
      const account = accounts.find((item) => item.id === binding.accountId); const via = vias.find((item) => item.id === binding.viaId);
      const row = el("article", "finance-v2-row"); row.append(el("div", "finance-v2-row-content", `${account?.name ?? binding.accountId} / ${via?.name ?? binding.viaId} · r${binding.revision} · ${binding.active ? "启用" : "停用"}`));
      row.append(action(binding.active ? "解除映射" : "重新启用", async (button) => {
        button.disabled = true;
        try { const result = await backend.setAccountViaBinding(session, binding.accountId, binding.viaId, !binding.active, accountViaMappingRevision); trackManagementResult(result, "Account / Via 映射"); const refreshed = await backend.loadSnapshot(session); accountViaBindings = refreshed.accountViaBindings; accountViaMappingRevision = refreshed.accountViaMappingRevision; renderMappings(); }
        catch (error) { setStatus(status, errorText(error), "error"); } finally { button.disabled = false; }
      })); mappingList.append(row);
    }
  }
  function renderBindings(): void {
    bindingList.replaceChildren();
    for (const binding of bindings) {
      const target = binding.accountId ? accounts.find((item) => item.id === binding.accountId)?.name ?? binding.accountId : vias.find((item) => item.id === binding.viaId)?.name ?? binding.viaId ?? "";
      const context = contexts.find((item) => item.id === binding.contextId);
      const row = el("article", "finance-v2-row"); row.append(el("div", "finance-v2-row-content", `${context?.label ?? binding.contextId} / ${binding.profileId} / ${binding.fieldAlias}${binding.sourceHint ? ` = ${binding.sourceHint}` : ""} → ${target} · r${binding.revision} · binding snapshot ${binding.bindingRevision}`));
      row.append(action("编辑映射", () => { editingBinding = binding; contextSelect.setValue(binding.contextId); profileSelect.setValue(binding.profileId); refreshAliases(); aliasSelect.setValue(binding.fieldAlias); sourceHint.input.value = binding.sourceHint ?? ""; updateHintVisibility(); updateTargetOptions(); targetSelect.setValue(binding.accountId ?? binding.viaId); saveBindingButton.textContent = "保存字段映射"; }));
      row.append(action("停用", async (button) => {
        button.disabled = true;
        try { const result = await backend.saveSource(session, { ...binding, active: false, expectedRevision: binding.revision }); bindings = bindings.filter((item) => item.id !== binding.id); renderBindings(); trackManagementResult(result, `已停用 ${binding.profileId} / ${binding.fieldAlias} 映射`); }
        catch (error) { setStatus(status, errorText(error), "error"); } finally { button.disabled = false; }
      })); bindingList.append(row);
    }
  }

  renderPendingWrites();
  void refreshAll().catch((error) => setStatus(status, errorText(error), "error"));
  return { dispose() { for (const dispose of disposers) dispose(); root.replaceChildren(); } };
}

function parseCalibrationHistoryPoint(value: string): { status?: string } | null {
  try {
    const parsed = JSON.parse(value) as { status?: unknown };
    return typeof parsed.status === "string" ? { status: parsed.status } : null;
  } catch { return null; }
}

function aliasesForProfile(profileId: string): string[] {
  const aliases = ["artifact_account", "artifact_via"];
  if (["wallet-csv-13/v1", "wallet-xlsx-11/v1", "boc-bank-pdf-text-12/v1"].includes(profileId)) aliases.push("via_hint");
  if (profileId === "credit-card-pdf-text-6/v1") aliases.push("account_hint");
  return aliases;
}
function aliasTargetKind(alias: string): "account" | "via" | null { return alias === "account_hint" || alias === "artifact_account" ? "account" : alias === "via_hint" || alias === "artifact_via" ? "via" : null; }
function actionRow(...buttons: HTMLButtonElement[]): HTMLElement { const row = el("div", "finance-v2-actions"); row.append(...buttons); return row; }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
