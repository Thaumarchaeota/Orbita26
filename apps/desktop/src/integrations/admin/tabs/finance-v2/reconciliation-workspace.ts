import { mountSelectField, type SelectFieldHandle } from "../../../../ui/select-field";
import { createChoiceCheckbox, setTriStateMarker } from "../../../../ui/choice-control";
import { globalFinanceAiProvider, classificationRequestForWorkspaceRow, canApplyWorkspaceClassification, listFinanceClassificationModels } from "../../../finance-v2/ai";
import type {
  FinanceAccountBindingView, FinanceAiCategorySuggestion, FinanceFactView, FinanceImportBatchView, FinanceIntentPayload, FinanceRefinementInput,
  FinanceAiModelView, FinanceSnapshotView, FinanceV2Backend, FinanceWorkspaceLeftRowView, FinanceWorkspaceReadModel, IsolatedFinanceSession,
} from "../../../finance-v2/types";
import { action, confirmAction, el, section, setStatus, statusNode, textField } from "./dom";
import { mountFactEditor, mountTreatmentEditor, type FinanceFactEditorHandle, type FinanceTreatmentEditorHandle } from "./editors";
import { mountFinanceDraftPicker } from "./draft-picker";

type WorkspaceProps = { draftId?: string | null; batch?: FinanceImportBatchView | null; onStatus?: (revision: number, durableRevision: number) => void; onBatch?: (batch: FinanceImportBatchView) => void };

export function mountReconciliationWorkspace(root: HTMLElement, backend: FinanceV2Backend, session: IsolatedFinanceSession, props: WorkspaceProps = {}): { dispose(): void } {
  const block = section("核对工作区", "左侧管理冻结的来源观察；右侧只显示明确暂存的事实、证据与关系意图。AI 与人工分类只改分类 Account，不改 Via 或候选确认。");
  const status = statusNode();
  const columns = el("div", "finance-v2-grid");
  const left = section("来源观察与分类");
  const right = section("意图与账本预览");
  const leftRows = el("div", "finance-v2-list");
  const rightRows = el("div", "finance-v2-list");
  const leftTools = el("div", "finance-v2-actions");
  const factStatus = statusNode();
  const aiStatus = statusNode();
  const treatmentStatus = statusNode();
  const evidenceStatus = statusNode();
  const refinementStatus = statusNode();
  const evidenceBody = el("div", "finance-v2-fields");
  const refinementBody = el("div", "finance-v2-fields");
  const factEditorBlockBody = el("div", "finance-v2-fields");
  const treatmentEditorBlockBody = el("div", "finance-v2-fields");
  const baseInfo = el("p", "finance-v2-muted");
  const undo = action("撤销最近草稿操作", async (button) => {
    const operationId = model?.undoOperationId;
    if (!operationId) { setStatus(status, "当前没有可撤销的草稿操作。", "info"); return; }
    await mutate(button, async (draftId) => backend.undoWorkspaceAction(session, draftId, operationId));
  }, true);
  left.append(baseInfo, leftRows, leftTools);
  right.append(rightRows, factEditorBlock(), factStatus, evidenceEditorBlock(), evidenceStatus, refinementEditorBlock(), refinementStatus, treatmentEditorBlock(), treatmentStatus);
  columns.append(left, right); block.append(columns, status); root.append(block);
  let model: FinanceWorkspaceReadModel | null = null;
  let snapshot: FinanceSnapshotView | null = null;
  let restorable: FinanceFactView[] = [];
  let draftId = props.draftId ?? props.batch?.draftId ?? null;
  let manualOnly = props.batch?.manualOnly ?? false;
  let draftPicker: SelectFieldHandle | null = null;
  let selectedSourceItem = "";
  const aiSelected = new Set<string>();
  let aiModels: string[] = [];
  let aiModelPreference: FinanceAiModelView = { modelId: null, revision: 0 };
  let aiModelSelect: SelectFieldHandle | null = null;
  let aiController: AbortController | null = null;
  let categorySelects: SelectFieldHandle[] = [];
  let rightSelects: SelectFieldHandle[] = [];
  const evidenceSelects: SelectFieldHandle[] = [];
  const refinementSelects: SelectFieldHandle[] = [];
  let evidenceMemberKeys = new Set<string>();
  let evidenceFieldKey = "";
  let evidenceGroupingKind: "Ordinary" | "Refinement" = "Ordinary";
  const evidenceAllocationValues = new Map<string, string>();
  let selectedRefinementParent = "";
  let refinementChildEditors: Array<{ id: string; editor: FinanceFactEditorHandle }> = [];
  const refinementChildren = new Set<string>();
  const refinementAllocations: Array<{ itemId: string; fieldIndex: number; pieces: Map<string, string> }> = [];
  const refinementModes = new Map<string, "Replace" | "Dissolve">();
  const refinementTreatmentEditors = new Map<string, FinanceTreatmentEditorHandle>();
  let editor: FinanceFactEditorHandle | null = null;
  let treatmentEditor: FinanceTreatmentEditorHandle | null = null;
  let disposed = false;
  const clearCategoryHandles = () => { for (const select of categorySelects) select.dispose(); categorySelects = []; };

  async function ensureDraftId(): Promise<string | null> {
    if (draftId) return draftId;
    const entries = await backend.listDrafts(session);
    const actionable = entries.filter((entry) => entry.state === "Open" || entry.state === "Prepared" || entry.state === "Committed");
    if (actionable.length === 1) {
      draftId = actionable[0].draftId;
      manualOnly = actionable[0].workspaceKind === "ManualOnly";
    }
    return draftId;
  }
  async function refresh(): Promise<void> {
    const id = await ensureDraftId();
    if (!id) {
      const entries = await backend.listDrafts(session);
      const actionable = entries.filter((entry) => entry.state === "Open" || entry.state === "Prepared" || entry.state === "Committed");
      leftRows.replaceChildren(el("p", "finance-v2-muted", actionable.length
        ? "请选择要继续的隔离工作区草稿；终态草稿显示为禁用项。"
        : "当前隔离环境没有可继续的草稿。可先导入来源观察，也可直接新建空白手工工作区。"));
      rightRows.replaceChildren();
      draftPicker?.dispose(); draftPicker = null;
      leftTools.replaceChildren();
      if (actionable.length > 1) {
        draftPicker = mountFinanceDraftPicker(leftTools, entries, null, (selectedId) => {
          if (!selectedId) return;
          draftId = selectedId;
          manualOnly = entries.find((entry) => entry.draftId === selectedId)?.workspaceKind === "ManualOnly";
          void refresh().catch((error) => setStatus(status, errorText(error), "error"));
        });
      }
      const createManual = action("新建空白手工工作区", async (button) => {
        button.disabled = true;
        try {
          const batch = await backend.createManualWorkspace(session);
          draftId = batch.draftId; manualOnly = true; props.onBatch?.(batch);
          props.onStatus?.(batch.draftRevision, batch.durableRevision);
          await refresh(); setStatus(status, "已创建空白手工工作区；现在可在右侧新建事实并明确暂存。", "success");
        } catch (error) { setStatus(status, errorText(error), "error"); }
        finally { button.disabled = false; }
      });
      leftTools.append(createManual);
      return;
    }
    draftPicker?.dispose(); draftPicker = null;
    const [nextModel, nextSnapshot, oldFacts] = await Promise.all([
      backend.readWorkspace(session, id), backend.loadSnapshot(session), backend.listRestorableFacts(session),
    ]);
    if (disposed) return;
    if (nextModel.ledgerGeneration !== session.generation || nextSnapshot.generation !== session.generation) throw new Error("核对工作区与当前隔离会话 generation 不一致，请重新验证环境。");
    model = nextModel; snapshot = nextSnapshot; restorable = oldFacts;
    undo.disabled = !model.undoOperationId;
    props.onStatus?.(model.draftRevision, model.durableRevision);
    baseInfo.textContent = `账本 generation ${model.ledgerGeneration} · 草稿 r${model.draftRevision} / 持久 r${model.durableRevision}${model.stale ? " · 已过期，不能提交" : ""}`;
    renderLeft(); renderRight();
  }
  async function mutate(button: HTMLButtonElement, operation: (id: string) => Promise<unknown>): Promise<void> {
    const id = await ensureDraftId();
    if (!id) { setStatus(status, "没有可编辑草稿。", "error"); return; }
    button.disabled = true;
    try {
      await operation(id);
      const durable = await backend.persistWorkspace(session, id);
      props.onStatus?.(durable.revision, durable.durableRevision);
      await refresh();
      setStatus(status, "草稿意图已保存；请核对右侧 blockers 与事实预览。", "success");
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  }
  function renderLeft(): void {
    clearCategoryHandles(); leftRows.replaceChildren(); leftTools.replaceChildren();
    if (!model || !snapshot) return;
    for (const row of model.leftRows) {
      const article = el("article", "finance-v2-row");
      article.dataset.selected = String(selectedSourceItem === row.itemId);
      const content = el("div", "finance-v2-row-content");
      content.append(el("strong", "finance-v2-row-title", observationTitle(row)),
        el("span", "finance-v2-muted", `${row.observation.locator} · ${qualityLabel(row.quality)} · ${row.disposition} · item r${row.itemRevision}/分类 r${row.manualCategoryRevision}`));
      for (const field of row.observation.fields) {
        if (field.rawText) content.append(el("span", "finance-v2-muted", `${field.role}：${field.rawText}`));
      }
      const rowTools = el("div", "finance-v2-row-tools");
      if (row.stillInLeft) {
        const isAiEligible = row.disposition === "Open" && row.quality === "Confirmed" && row.categoryOrigin !== "Human";
        if (isAiEligible) {
          const checkbox = createChoiceCheckbox(aiSelected.has(row.itemId) ? "checked" : "unchecked");
          checkbox.setAttribute("aria-label", `选择 AI 分类行 ${observationTitle(row)}`);
          checkbox.addEventListener("click", () => {
            if (aiSelected.has(row.itemId)) aiSelected.delete(row.itemId); else aiSelected.add(row.itemId);
            setTriStateMarker(checkbox, aiSelected.has(row.itemId) ? "checked" : "unchecked");
          });
          rowTools.append(checkbox);
        }
        const accountHost = el("div", "finance-v2-field-host");
        const choices = snapshot.accounts.filter((account) => account.active && (account.kind === "Income" || account.kind === "Expenses"));
        const select = mountSelectField(accountHost, {
          label: "分类 Account", placeholder: "选择分类 Account", options: choices.map((account) => ({ value: account.id, label: `${account.name} · ${account.kind}` })),
          search: choices.length > 6, multiple: false, value: row.category?.accountId ?? null, onChange: () => {},
        });
        categorySelects.push(select); rowTools.append(accountHost);
        rowTools.append(action("保存人工分类", async (button) => {
          const accountId = select.getValue();
          const account = choices.find((item) => item.id === accountId);
          const binding: FinanceAccountBindingView | null = account ? {
            accountId: account.id, accountRevision: account.revision,
            viaId: row.category?.viaId ?? null, viaRevision: row.category?.viaRevision ?? null,
          } : null;
          await mutate(button, (id) => backend.setManualCategory(session, id, row.itemId, row.itemRevision, binding, (BigInt(Date.now()) * 1000n).toString()));
        }));
        rowTools.append(action("拒绝此观察", async () => confirmAction(root, "拒绝来源观察", "此操作只更新可撤销草稿中的行状态，不会产生账本事实。", "确认拒绝", async () => {
          const id = await ensureDraftId(); if (!id) throw new Error("没有可编辑草稿。");
          await backend.rejectObservation(session, id, row.itemId, row.itemRevision);
          const durable = await backend.persistWorkspace(session, id); props.onStatus?.(durable.revision, durable.durableRevision); await refresh();
        })));
        rowTools.append(action("取消此观察", async () => confirmAction(root, "取消来源观察", "此行将从左侧待处理内容移出；右侧没有对应事实的情况下不会写入账本。", "确认取消", async () => {
          const id = await ensureDraftId(); if (!id) throw new Error("没有可编辑草稿。");
          await backend.cancelObservation(session, id, row.itemId, row.itemRevision);
          const durable = await backend.persistWorkspace(session, id); props.onStatus?.(durable.revision, durable.durableRevision); await refresh();
        })));
        article.addEventListener("click", (event) => {
          if ((event.target as HTMLElement).closest("button, input, [role=combobox]")) return;
          selectedSourceItem = row.itemId; renderLeft();
        });
      }
      article.append(content, rowTools); leftRows.append(article);
    }
    if (model.candidates.length) {
      const candidates = section("账本匹配候选", "候选只供核对；明确确认后才会生成右侧证据意图。退款候选需先处理退款关系。");
      for (const candidate of model.candidates) {
        const row = model.leftRows.find((item) => item.observation.artifactId === candidate.observation.artifactId
          && item.observation.locator === candidate.observation.locator
          && item.observation.occurrenceDiscriminator === candidate.observation.occurrenceDiscriminator);
        const card = el("article", "finance-v2-row");
        card.append(el("div", "finance-v2-row-content", `${candidate.kind} · ${candidate.members.length} 个事实 · ${candidate.signedQuantity.amount} ${candidate.signedQuantity.commodity} · ${candidate.reason ? JSON.stringify(candidate.reason) : ""}`));
        card.append(action(candidate.confirmed ? "已确认" : candidate.stale ? "候选过期" : "确认匹配", async (button) => {
          if (candidate.confirmed || candidate.stale || !row) { setStatus(status, "候选已确认、过期或找不到对应来源行。", "error"); return; }
          await mutate(button, (id) => backend.confirmWorkspaceCandidate(session, id, candidate.key));
        }, candidate.confirmed || candidate.stale || !row));
        candidates.append(card);
      }
      candidates.append(el("p", "finance-v2-muted", model.candidateCoverage ? JSON.stringify(model.candidateCoverage) : "无候选覆盖信息"));
      if (model.unresolvedCandidateObservations.length) candidates.append(el("p", "finance-v2-status", `未解决观察：${model.unresolvedCandidateObservations.join("、")}`));
      leftRows.append(candidates);
    }
    leftTools.append(undo);
    if (!manualOnly) leftTools.append(action("取消整批导入", async () => confirmAction(root, "取消整批导入", "所有仍在左侧的来源行将标记取消，草稿意图与候选确认按 E3 规则撤销；此动作可用最近操作撤销。", "确认取消", async () => {
      const id = await ensureDraftId(); if (!id) throw new Error("没有可编辑草稿。");
      await backend.cancelWorkspaceImport(session, id);
      const durable = await backend.persistWorkspace(session, id); props.onStatus?.(durable.revision, durable.durableRevision); await refresh();
    })));
    leftTools.append(aiPanel());
  }
  function renderRight(): void {
    rightRows.replaceChildren();
    if (!model || !snapshot) return;
    for (const select of rightSelects) select.dispose(); rightSelects = [];
    for (const preview of model.rightPreview) {
      const item = el("article", "finance-v2-row");
      const text = el("div", "finance-v2-row-content");
      text.append(el("strong", "finance-v2-row-title", `${preview.kind} · intent ${preview.intentId}`),
        el("span", "finance-v2-muted", `base generation ${preview.baseGeneration} · ${preview.confirmed ? "已明确暂存" : "待确认"} · source ${preview.sourceItemIds.join(", ") || "手工创建"}`));
      if (preview.blockingReasons.length) text.append(el("span", "finance-v2-status", preview.blockingReasons.join("；")));
      for (const fact of preview.projectedFacts) text.append(el("span", "finance-v2-muted", `${fact.effectiveDate} · ${fact.title || "无标题"} · ${fact.positive.amount} ${fact.positive.commodity} → ${fact.negative.amount} ${fact.negative.commodity}`));
      item.append(text); rightRows.append(item);
    }
    if (!model.rightPreview.length) rightRows.append(el("p", "finance-v2-muted", "尚无右侧意图。左栏分类或处理状态不会自动创建事实。"));
    renderEvidenceEditor();
    renderRefinementEditor();
    const currentSource = model.leftRows.find((row) => row.itemId === selectedSourceItem && row.stillInLeft);
    const sourceHost = el("div", "finance-v2-field-host");
    const sourceSelect = mountSelectField(sourceHost, {
      label: "关联来源观察（可选）", placeholder: "选择左栏来源行", options: model.leftRows.filter((row) => row.stillInLeft).map((row) => ({ value: row.itemId, label: observationTitle(row) })),
      search: model.leftRows.length > 6, multiple: false, value: currentSource?.itemId ?? null,
      onChange: (value) => { selectedSourceItem = value ?? ""; },
    });
    rightSelects.push(sourceSelect);
    const operationHost = el("div", "finance-v2-field-host");
    const operationSelect = mountSelectField(operationHost, {
      label: "事实操作", placeholder: "选择操作", options: ["Create", "Amend", "Delete", "Restore"].map((value) => ({ value, label: ({ Create: "新增", Amend: "修改", Delete: "删除", Restore: "恢复" } as Record<string, string>)[value] })),
      search: false, multiple: false, value: "Create", onChange: (value) => { selectedOperation = value ?? "Create"; renderEditorForm(); },
    });
    rightSelects.push(operationSelect);
    const targetHost = el("div", "finance-v2-field-host");
    const reason = textField("人工变更原因（修改/删除/恢复必填）");
    factEditorBlockBody.replaceChildren();
    factEditorBlockBody.append(operationHost, targetHost, sourceHost);
    const editorHost = el("div", "finance-v2-editor-host");
    factEditorBlockBody.append(reason.root, editorHost);
    let selectedOperation = "Create";
    let selectedFact: FinanceFactView | null = null;
    const renderEditorForm = () => {
      for (const select of targetSelects) select.dispose(); targetSelects.length = 0;
      editor?.dispose(); editor = null; targetHost.replaceChildren(); editorHost.replaceChildren();
      selectedFact = null;
      if (selectedOperation === "Create") {
        editor = mountFactEditor(editorHost, snapshot!.accounts);
        return;
      }
      const options = selectedOperation === "Restore" ? restorable : snapshot!.facts;
      const picker = mountSelectField(targetHost, {
        label: selectedOperation === "Restore" ? "已删除事实" : "当前事实", placeholder: "选择事实", options: options.map((fact) => ({ value: fact.id, label: `${fact.effectiveDate} · ${fact.title || fact.id} · r${fact.revision}` })),
        search: options.length > 6, multiple: false, value: null,
        onChange: (value) => {
          selectedFact = options.find((fact) => fact.id === value) ?? null;
          editor?.dispose(); editor = null; editorHost.replaceChildren();
          if (selectedFact && selectedOperation !== "Delete") editor = mountFactEditor(editorHost, snapshot!.accounts, selectedFact);
          else if (selectedFact) editorHost.append(el("p", "finance-v2-muted", `${selectedFact.effectiveDate} · ${selectedFact.title} · ${selectedFact.positive.amount} ${selectedFact.positive.commodity} → ${selectedFact.negative.amount} ${selectedFact.negative.commodity}`));
        },
      });
      targetSelects.push(picker);
      if (!options.length) editorHost.append(el("p", "finance-v2-muted", selectedOperation === "Restore" ? "没有可恢复的已删除事实。" : "当前没有可修改的活动事实。"));
    };
    const targetSelects: SelectFieldHandle[] = [];
    renderEditorForm();
    const stage = action("明确暂存此事实意图", async (button) => {
      try {
        let payload: FinanceIntentPayload;
        if (selectedOperation === "Create") {
          payload = { fact: { create: { fact: editor!.build("Active") } } };
        } else {
          if (!selectedFact) throw new Error("请先选择目标事实。");
          const change = { changedAtUtcMicros: (BigInt(Date.now()) * 1000n).toString(), reason: reason.input.value.trim() };
          if (!change.reason) throw new Error("请填写人工变更原因。");
          if (selectedOperation === "Amend") {
            const fact = editor!.build("Active", selectedFact);
            payload = { fact: { amend: { expected: { l0Id: selectedFact.id, revision: selectedFact.revision }, fact, manualChange: change } } };
          } else if (selectedOperation === "Delete") {
            const deletedVersion = { ...selectedFact, revision: selectedFact.revision + 1, status: "Deleted" as const };
            payload = { fact: { delete: { expected: { l0Id: selectedFact.id, revision: selectedFact.revision }, deletedVersion, manualChange: change } } };
          } else {
            const restoredVersion = editor!.build("Active", selectedFact);
            payload = { fact: { restore: { expectedRevision: selectedFact.revision, restoredVersion, manualChange: change } } };
          }
        }
        const sourceIds = sourceSelect.getValue() ? [sourceSelect.getValue()!] : [];
        await mutate(button, async (id) => { await backend.stageWorkspaceIntent(session, id, payload, sourceIds); });
      } catch (error) { setStatus(factStatus, errorText(error), "error"); }
    });
    factEditorBlockBody.append(stage);
    renderTreatmentForm();
  }
  function evidenceEditorBlock(): HTMLElement {
    const box = el("div", "finance-v2-section");
    box.append(el("h3", "finance-v2-section-title", "手工证据匹配"), evidenceBody);
    return box;
  }
  function refinementEditorBlock(): HTMLElement {
    const box = el("div", "finance-v2-section");
    box.append(el("h3", "finance-v2-section-title", "细化既有事实"),
      el("p", "finance-v2-muted", "只收集子事实、来源分配与关系处理输入；E3 后端负责派生依赖修订并验证精确向量闭合。"), refinementBody);
    return box;
  }
  function renderRefinementEditor(): void {
    for (const select of refinementSelects) { select.dispose(); const index = rightSelects.indexOf(select); if (index >= 0) rightSelects.splice(index, 1); }
    refinementSelects.length = 0;
    refinementBody.replaceChildren();
    if (!model || !snapshot) return;
    const activeFacts = snapshot.facts.filter((fact) => fact.status === "Active");
    const parentHost = el("div", "finance-v2-field-host");
    const parentSelect = mountSelectField(parentHost, {
      label: "待细化的父事实", placeholder: "选择活动叶事实", options: activeFacts.map((fact) => ({ value: `${fact.id}@${fact.revision}`, label: `${fact.effectiveDate} · ${fact.title || fact.id} · r${fact.revision}` })),
      search: activeFacts.length > 6, multiple: false, value: selectedRefinementParent || null,
      onChange: (value) => { selectedRefinementParent = value ?? ""; renderRefinementEditor(); },
    });
    refinementSelects.push(parentSelect); rightSelects.push(parentSelect);
    const parentKey = parentSelect.getValue();
    const [parentId, parentRevisionText] = parentKey?.split("@") ?? [];
    const parent = activeFacts.find((fact) => fact.id === parentId && fact.revision === Number(parentRevisionText));
    const childHost = el("div", "finance-v2-fields");
    const addChild = action("添加细化子事实", () => {
      const id = crypto.randomUUID().toLowerCase();
      const host = el("div", "finance-v2-section");
      const editor = mountFactEditor(host, snapshot!.accounts);
      refinementChildEditors.push({ id, editor });
      refinementChildren.add(id); childHost.append(host); renderRefinementEditor();
    }, !parent);
    const childList = el("div", "finance-v2-fields");
    for (const child of refinementChildEditors) {
      if (!refinementChildren.has(child.id)) continue;
      const row = el("div", "finance-v2-section");
      row.append(el("p", "finance-v2-muted", `子事实 ${child.id}`), child.editor.root,
        action("移除此子事实", () => {
          child.editor.dispose(); refinementChildren.delete(child.id);
          refinementChildEditors = refinementChildEditors.filter((item) => item.id !== child.id);
          for (const allocation of refinementAllocations) allocation.pieces.delete(child.id);
          renderRefinementEditor();
        }));
      childList.append(row);
    }
    childHost.append(addChild, childList);
    refinementBody.append(parentHost, childHost);
    if (!parent) { refinementBody.append(el("p", "finance-v2-muted", "选择父事实后添加一条或多条子事实。")); return; }

    const openRows = model.leftRows.filter((row) => row.stillInLeft && row.disposition === "Open" && row.quality === "Confirmed");
    const allocationSection = el("div", "finance-v2-section");
    allocationSection.append(el("h4", "finance-v2-section-title", "来源证据分配"),
      el("p", "finance-v2-muted", "每个来源金额按原始精确文本填写正数分配；来源符号、账户、角色和闭合由 E3 校验。"));
    const allocationList = el("div", "finance-v2-fields");
    const addAllocation = action("添加来源金额分配", () => { refinementAllocations.push({ itemId: "", fieldIndex: -1, pieces: new Map() }); renderRefinementEditor(); }, !openRows.length || refinementChildEditors.length === 0);
    allocationSection.append(addAllocation, allocationList);
    for (const allocation of refinementAllocations) {
      const row = el("div", "finance-v2-section");
      const sourceHost = el("div", "finance-v2-field-host");
      const source = mountSelectField(sourceHost, { label: "来源观察", placeholder: "选择观察行", options: openRows.map((item) => ({ value: item.itemId, label: observationTitle(item) })), search: openRows.length > 6, multiple: false, value: allocation.itemId || null, onChange: (value) => { allocation.itemId = value ?? ""; allocation.fieldIndex = -1; renderRefinementEditor(); } });
      refinementSelects.push(source); rightSelects.push(source);
      const sourceRow = openRows.find((item) => item.itemId === allocation.itemId);
      const fields = sourceRow?.observation.fields.map((field, index) => ({ field, index })).filter(({ field }) => field.binding?.accountId && field.value.kind === "SignedQuantity") ?? [];
      const fieldHost = el("div", "finance-v2-field-host");
      const field = mountSelectField(fieldHost, { label: "来源金额角色", placeholder: "选择绑定账户的金额字段", options: fields.map(({ field: item, index }) => ({ value: String(index), label: `${item.role} · ${item.rawText ?? ""} · ${item.binding?.accountId ?? ""}` })), search: fields.length > 6, multiple: false, value: fields.some((item) => item.index === allocation.fieldIndex) ? String(allocation.fieldIndex) : null, onChange: (value) => { allocation.fieldIndex = value ? Number(value) : -1; renderRefinementEditor(); } });
      refinementSelects.push(field); rightSelects.push(field);
      row.append(sourceHost, fieldHost);
      for (const child of refinementChildEditors.filter((item) => refinementChildren.has(item.id))) {
        const input = textField(`分配给子事实 ${child.id} 的正精确数量`, allocation.pieces.get(child.id) ?? "");
        input.input.addEventListener("input", () => allocation.pieces.set(child.id, input.input.value)); row.append(input.root);
      }
      row.append(action("移除此来源分配", () => { const index = refinementAllocations.indexOf(allocation); if (index >= 0) refinementAllocations.splice(index, 1); renderRefinementEditor(); }));
      allocationList.append(row);
    }
    refinementBody.append(allocationSection);

    const affectedTreatments = snapshot.treatments.filter((item) => item.members.some((member) => member.l0Id === parent.id && member.revision === parent.revision));
    const treatmentSection = el("div", "finance-v2-section");
    treatmentSection.append(el("h4", "finance-v2-section-title", "受影响关系处理"), el("p", "finance-v2-muted", "每个涉及父事实的 Treatment 都必须明确替换或解除；E3 会再次校验闭合。"));
    for (const treatment of affectedTreatments) {
      const host = el("div", "finance-v2-fields");
      const modeHost = el("div", "finance-v2-field-host");
      const mode = mountSelectField(modeHost, { label: `关系 ${treatment.id} · r${treatment.revision}`, placeholder: "选择关系处理方式", options: [{ value: "Replace", label: "替换关系" }, { value: "Dissolve", label: "解除关系" }], search: false, multiple: false, value: refinementModes.get(treatment.id) ?? null, onChange: (value) => { if (value === "Replace" || value === "Dissolve") refinementModes.set(treatment.id, value); renderRefinementEditor(); } });
      refinementSelects.push(mode); rightSelects.push(mode); host.append(modeHost);
      if (refinementModes.get(treatment.id) === "Replace") {
        let editor = refinementTreatmentEditors.get(treatment.id);
        if (!editor) {
          const editorHost = el("div", "finance-v2-fields");
          editor = mountTreatmentEditor(editorHost, [...activeFacts, ...refinementChildEditors.filter((item) => refinementChildren.has(item.id)).map((item) => ({ ...item.editor.build(), id: item.id, revision: 1 }))], treatment);
          refinementTreatmentEditors.set(treatment.id, editor);
        }
        host.append(editor.root);
      }
      treatmentSection.append(host);
    }
    refinementBody.append(treatmentSection);
    const stage = action("明确暂存细化意图", async (button) => {
      try {
        const children = refinementChildEditors.filter((item) => refinementChildren.has(item.id)).map(({ id, editor }) => ({ ...editor.build("Active"), id, revision: 1 }));
        if (!children.length) throw new Error("请至少添加一条细化子事实。");
        const evidenceAllocations: FinanceRefinementInput["evidenceAllocations"] = [];
        for (const allocation of refinementAllocations) {
          const sourceRow = openRows.find((item) => item.itemId === allocation.itemId);
          const sourceField = sourceRow?.observation.fields[allocation.fieldIndex];
          if (!sourceRow || !sourceField || sourceField.value.kind !== "SignedQuantity" || !sourceField.binding?.accountId) throw new Error("每条来源分配都必须指定已绑定 Account 的来源金额字段。");
          const signedQuantity = sourceField.value.quantity;
          const sign: "Negative" | "Positive" = signedQuantity.amount.startsWith("-") ? "Negative" : "Positive";
          const pieces = children.filter((child) => allocation.pieces.get(child.id)?.trim()).map((child) => {
            const amount = allocation.pieces.get(child.id)!.trim();
            if (!/^(?=.*[1-9])\d+(?:\.\d+)?$/.test(amount)) throw new Error("每笔来源分配必须是正的精确十进制文本。");
            return { childId: child.id, childRevision: child.revision, sign, allocated: { amount, commodity: signedQuantity.commodity } };
          });
          if (!pieces.length) throw new Error("每条来源金额至少需要分配给一个子事实。");
          evidenceAllocations.push({ source: { artifactId: sourceRow.observation.artifactId, locator: sourceRow.observation.locator,
            occurrenceDiscriminator: sourceRow.observation.occurrenceDiscriminator, accountId: sourceField.binding.accountId,
            signedQuantity, sign, role: sourceField.role }, pieces });
        }
        for (const child of children) if (evidenceAllocations.some((allocation) => allocation.pieces.some((piece) => piece.childId === child.id))) {
          child.provenance = { kind: "Imported", evidenceIds: [] };
        }
        const treatmentResolutions: FinanceRefinementInput["treatmentResolutions"] = affectedTreatments.map((treatment) => {
          const mode = refinementModes.get(treatment.id);
          if (!mode) throw new Error(`请明确处理关联 Treatment ${treatment.id}。`);
          return mode === "Dissolve"
            ? { dissolve: { oldTreatmentId: treatment.id, oldRevision: treatment.revision, resultingTreatments: [] } }
            : { replace: { oldTreatmentId: treatment.id, oldRevision: treatment.revision, replacement: refinementTreatmentEditors.get(treatment.id)!.build(treatment) } };
        });
        const input: FinanceRefinementInput = { parentId: parent.id, parentRevision: parent.revision, children, evidenceAllocations, treatmentResolutions };
        const sourceItemIds = [...new Set(evidenceAllocations.flatMap((allocation) => {
          const row = openRows.find((item) => item.observation.artifactId === allocation.source.artifactId
            && item.observation.locator === allocation.source.locator
            && item.observation.occurrenceDiscriminator === allocation.source.occurrenceDiscriminator);
          return row ? [row.itemId] : [];
        }))];
        await mutate(button, (id) => backend.stageWorkspaceRefinement(session, id, input, sourceItemIds));
      } catch (error) { setStatus(refinementStatus, errorText(error), "error"); }
    });
    refinementBody.append(stage);
  }
  function renderEvidenceEditor(): void {
    for (const select of evidenceSelects) { select.dispose(); const index = rightSelects.indexOf(select); if (index >= 0) rightSelects.splice(index, 1); }
    evidenceSelects.length = 0;
    evidenceBody.replaceChildren();
    if (!model || !snapshot) return;
    const rows = model.leftRows.filter((row) => row.stillInLeft && row.disposition === "Open");
    const sourceHost = el("div", "finance-v2-field-host");
    const source = mountSelectField(sourceHost, { label: "来源观察", placeholder: "选择仍在左栏的观察", options: rows.map((row) => ({ value: row.itemId, label: observationTitle(row) })), search: rows.length > 6, multiple: false, value: selectedSourceItem || null, onChange: (value) => { selectedSourceItem = value ?? ""; renderEvidenceEditor(); } });
    evidenceSelects.push(source); rightSelects.push(source);
    const chosenRow = rows.find((row) => row.itemId === (selectedSourceItem || source.getValue()));
    const usableFields = chosenRow?.observation.fields.map((field, index) => ({ field, index })).filter(({ field }) => field.binding?.accountId && field.value.kind === "SignedQuantity") ?? [];
    const fieldHost = el("div", "finance-v2-field-host");
    const field = mountSelectField(fieldHost, { label: "观察金额与 Account 角色", placeholder: usableFields.length ? "选择解析字段" : "所选行没有已绑定金额", options: usableFields.map(({ field, index }) => ({ value: String(index), label: `${field.role} · ${field.rawText ?? ""} · ${field.binding?.accountId ?? ""}` })), search: usableFields.length > 6, multiple: false, value: usableFields.length ? (usableFields.some((item) => String(item.index) === evidenceFieldKey) ? evidenceFieldKey : String(usableFields[0].index)) : null, onChange: (value) => { evidenceFieldKey = value ?? ""; renderEvidenceEditor(); } });
    evidenceSelects.push(field); rightSelects.push(field);
    const observed = usableFields.find((item) => String(item.index) === field.getValue())?.field;
    const modeHost = el("div", "finance-v2-field-host");
    const grouping = mountSelectField(modeHost, { label: "关系分组类型", placeholder: "选择分组类型", options: [{ value: "Ordinary", label: "普通证据匹配" }, { value: "Refinement", label: "细化分配证据" }], search: false, multiple: false, value: evidenceGroupingKind, onChange: (value) => { evidenceGroupingKind = value === "Refinement" ? "Refinement" : "Ordinary"; renderEvidenceEditor(); } });
    evidenceSelects.push(grouping); rightSelects.push(grouping);
    const factHost = el("div", "finance-v2-field-host");
    const eligibleFacts = snapshot.facts.filter((fact) => fact.status === "Active");
    const memberSelect = mountSelectField(factHost, { label: "支持的事实成员", placeholder: "选择一个或多个已核对事实", options: eligibleFacts.map((fact) => ({ value: `${fact.id}@${fact.revision}`, label: `${fact.effectiveDate} · ${fact.title || fact.id} · r${fact.revision}` })), search: eligibleFacts.length > 6, multiple: true, values: evidenceMemberKeys, onChange: (values) => { evidenceMemberKeys = new Set(values); renderEvidenceEditor(); } });
    evidenceSelects.push(memberSelect); rightSelects.push(memberSelect);
    const allocationInputs: Array<{ key: string; input: HTMLInputElement | HTMLTextAreaElement }> = [];
    const allocations = el("div", "finance-v2-fields");
    const selectedMembers = [...memberSelect.getValues()];
    if (evidenceGroupingKind === "Refinement") for (const key of selectedMembers) {
      const match = key.match(/^(.+)@(\d+)$/); if (!match) continue;
      const fact = eligibleFacts.find((item) => item.id === match[1] && item.revision === Number(match[2])); if (!fact) continue;
      const input = textField(`分配给 ${fact.title || fact.id} 的正数量`, evidenceAllocationValues.get(key) ?? "");
      input.input.addEventListener("input", () => evidenceAllocationValues.set(key, input.input.value));
      allocations.append(input.root); allocationInputs.push({ key, input: input.input });
    }
    const refund = document.createElement("input"); refund.type = "checkbox";
    const refundLabel = el("label", "finance-v2-field-label", "此匹配需要有效退款 Treatment"); refundLabel.prepend(refund);
    const stage = action("明确暂存证据匹配", async (button) => {
      try {
        if (!chosenRow || !observed || observed.value.kind !== "SignedQuantity" || !observed.binding?.accountId) throw new Error("请先选择带有已绑定 observed Account 的来源金额字段。");
        if (chosenRow.quality !== "Confirmed") throw new Error("只有 Confirmed 观察可以匹配账本事实。");
        const refs = [...memberSelect.getValues()]; if (!refs.length) throw new Error("至少选择一个事实成员。");
        const signedQuantity = observed.value.quantity;
        const sign: "Negative" | "Positive" = signedQuantity.amount.startsWith("-") ? "Negative" : "Positive";
        const memberPayload = refs.map((key) => {
          const match = key.match(/^(.+)@(\d+)$/); if (!match) throw new Error("事实成员版本格式无效。");
          const fact = eligibleFacts.find((item) => item.id === match[1] && item.revision === Number(match[2])); if (!fact) throw new Error("所选事实修订已变化。");
          const memberSign: "Positive" | "Negative" | null = fact.positiveAccountId === observed.binding!.accountId ? "Positive" : fact.negativeAccountId === observed.binding!.accountId ? "Negative" : null;
          if (!memberSign) throw new Error(`事实「${fact.title || fact.id}」不包含来源观察的 Account。`);
          let allocation: { amount: string; commodity: string } | null = null;
          if (evidenceGroupingKind === "Refinement") {
            const input = allocationInputs.find((item) => item.key === key)?.input.value.trim() ?? "";
            if (!/^(?=.*[1-9])\d+(?:\.\d+)?$/.test(input)) throw new Error("每个细化成员都需要填写正的精确分配数量。");
            allocation = { amount: input, commodity: signedQuantity.commodity };
          }
          return { member: { l0Id: fact.id, revision: fact.revision }, sign: memberSign, allocation };
        });
        const payload: FinanceIntentPayload = { evidenceMatch: {
          artifactId: chosenRow.observation.artifactId, locator: chosenRow.observation.locator,
          occurrenceDiscriminator: chosenRow.observation.occurrenceDiscriminator, observedAccountId: observed.binding.accountId,
          sourceRole: observed.role, groupingKind: evidenceGroupingKind, requiresRefundTreatment: refund.checked,
          signedQuantity, sign, members: memberPayload,
        } };
        await mutate(button, async (id) => { await backend.stageWorkspaceIntent(session, id, payload, [chosenRow.itemId]); });
      } catch (error) { setStatus(evidenceStatus, errorText(error), "error"); }
    });
    evidenceBody.append(sourceHost, fieldHost, modeHost, factHost, allocations, refundLabel, stage);
  }
  function treatmentEditorBlock(): HTMLElement { const box = el("div", "finance-v2-section"); box.append(el("h3", "finance-v2-section-title", "合并与退款关系"), treatmentEditorBlockBody); return box; }
  function renderTreatmentForm(): void {
    treatmentEditor?.dispose(); treatmentEditor = null;
    treatmentEditorBlockBody.replaceChildren();
    if (!snapshot) return;
    const modeHost = el("div", "finance-v2-field-host");
    const targetHost = el("div", "finance-v2-field-host");
    const reason = textField("人工变更原因（修改/释放必填）");
    const modes = ["Apply", "Amend", "Release"] as const;
    let mode: typeof modes[number] = "Apply";
    let selectedTreatment: typeof snapshot.treatments[number] | null = null;
    const modeSelect = mountSelectField(modeHost, { label: "关系操作", placeholder: "选择操作", options: modes.map((value) => ({ value, label: ({ Apply: "新建合并/退款关系", Amend: "修改已有关系", Release: "释放关系" } as const)[value] })), search: false, multiple: false, value: mode, onChange: (value) => { mode = (value as typeof mode) ?? "Apply"; renderTreatmentFields(); } });
    rightSelects.push(modeSelect);
    const targetSelects: SelectFieldHandle[] = [];
    const editorHost = el("div", "finance-v2-editor-host");
    const fields = el("div", "finance-v2-fields");
    const renderTreatmentFields = () => {
      for (const select of targetSelects) { select.dispose(); const index = rightSelects.indexOf(select); if (index >= 0) rightSelects.splice(index, 1); }
      targetSelects.length = 0; treatmentEditor?.dispose(); treatmentEditor = null;
      targetHost.replaceChildren(); editorHost.replaceChildren();
      selectedTreatment = null;
      if (mode !== "Apply") {
        const picker = mountSelectField(targetHost, { label: "现有关系", placeholder: "选择关系", options: snapshot!.treatments.map((item) => ({ value: item.id, label: `${item.title || item.id} · r${item.revision}` })), search: snapshot!.treatments.length > 6, multiple: false, value: null, onChange: (value) => {
          selectedTreatment = snapshot!.treatments.find((item) => item.id === value) ?? null;
          treatmentEditor?.dispose(); treatmentEditor = null; editorHost.replaceChildren();
          if (selectedTreatment && mode === "Amend") treatmentEditor = mountTreatmentEditor(editorHost, snapshot!.facts, selectedTreatment);
          else if (selectedTreatment) editorHost.append(el("p", "finance-v2-muted", `${selectedTreatment.title || selectedTreatment.id} · ${selectedTreatment.members.length} 个事实 · ${selectedTreatment.refundEdges.length} 条退款关系`));
        } });
        targetSelects.push(picker); rightSelects.push(picker);
      }
      if (mode === "Apply") treatmentEditor = mountTreatmentEditor(editorHost, snapshot!.facts);
    };
    renderTreatmentFields();
    const stage = action("明确暂存此关系意图", async (button) => {
      try {
        let mutation: FinanceIntentPayload;
        if (mode === "Apply") {
          if (!treatmentEditor) throw new Error("请填写关系内容。");
          mutation = { treatment: { apply: { treatment: treatmentEditor.build() } } };
        } else {
          if (!selectedTreatment) throw new Error("请先选择现有关系。");
          if (mode === "Release") {
            const manualChange = { changedAtUtcMicros: (BigInt(Date.now()) * 1000n).toString(), reason: reason.input.value.trim() };
            if (!manualChange.reason) throw new Error("请填写人工释放原因。");
            mutation = { treatment: { release: { expectedRevision: selectedTreatment.revision, tombstone: { ...selectedTreatment, revision: selectedTreatment.revision + 1 }, manualChange } } };
          } else {
            const manualChange = { changedAtUtcMicros: (BigInt(Date.now()) * 1000n).toString(), reason: reason.input.value.trim() };
            if (!manualChange.reason) throw new Error("请填写人工变更原因。");
            mutation = { treatment: { amend: { expectedRevision: selectedTreatment.revision, treatment: treatmentEditor!.build(selectedTreatment), manualChange } } };
          }
        }
        await mutate(button, async (id) => { await backend.stageWorkspaceIntent(session, id, mutation, []); });
      } catch (error) { setStatus(treatmentStatus, errorText(error), "error"); }
    });
    fields.append(modeHost, targetHost, reason.root, editorHost, stage);
    treatmentEditorBlockBody.replaceChildren(fields);
  }
  function aiPanel(): HTMLElement {
    const panel = section("AI 分类建议", "仅对你勾选的 Confirmed 且仍在左栏、未手工分类的行生成 Account 建议。模型无工具权限；Via、候选和账本事实不会交给或受其修改。取消会丢弃迟到结果，底层 plain completion 仍可能继续运行。");
    const modelHost = el("div", "finance-v2-field-host");
    let saveModelButton: HTMLButtonElement | null = null;
    aiModelSelect?.dispose();
    aiModelSelect = mountSelectField(modelHost, {
      label: "全局 AI 模型", placeholder: aiModels.length ? "选择全局 AI 配置中的模型" : "全局 AI 尚未配置模型",
      options: aiModels.map((value) => ({ value, label: value })), search: aiModels.length > 6, multiple: false, value: aiModelPreference.modelId,
      onChange: (value) => { if (saveModelButton) saveModelButton.disabled = !value || value === aiModelPreference.modelId; },
    });
    const saveModel = action("保存 Finance 分类模型", async (button) => {
      const modelId = aiModelSelect?.getValue();
      if (!modelId) { setStatus(aiStatus, "请先选择全局 AI 配置中的模型。", "error"); return; }
      button.disabled = true;
      try { aiModelPreference = await backend.saveFinanceAiModel(session, aiModelPreference.revision, modelId); renderLeft(); setStatus(aiStatus, `Finance 分类模型已保存：${modelId}`, "success"); }
      catch (error) { setStatus(aiStatus, errorText(error), "error"); }
      finally { button.disabled = false; }
    }, true);
    saveModelButton = saveModel;
    saveModel.disabled = !aiModelSelect.getValue() || aiModelSelect.getValue() === aiModelPreference.modelId;
    const cancel = action("取消建议（丢弃迟到结果）", async () => aiController?.abort(), true);
    const run = action("为勾选行生成建议", async (button) => {
      const currentModel = aiModelSelect?.getValue();
      const selectedRows = model?.leftRows.filter((row) => aiSelected.has(row.itemId) && row.stillInLeft && row.disposition === "Open" && row.quality === "Confirmed" && row.categoryOrigin !== "Human") ?? [];
      if (!currentModel || currentModel !== aiModelPreference.modelId || !selectedRows.length || !draftId) { setStatus(aiStatus, "请先选择并保存 Finance 分类模型，再选择至少一条符合条件的来源行。", "error"); return; }
      aiController?.abort(); aiController = new AbortController(); const controller = aiController;
      cancel.disabled = false; button.disabled = true;
      try {
        const rules = await backend.loadRules(session);
        const requests = selectedRows.map(classificationRequestForWorkspaceRow);
        const results = await globalFinanceAiProvider.classify(requests, {
          model: currentModel, signal: controller.signal,
          accounts: snapshot!.accounts.filter((account) => account.active && (account.kind === "Income" || account.kind === "Expenses")),
          rulesMarkdown: rules.content,
        });
        if (controller.signal.aborted) throw new DOMException("已取消建议应用", "AbortError");
        await refresh();
        if (controller.signal.aborted || !model || !snapshot) throw new DOMException("已取消建议应用", "AbortError");
        const accountRevisions = new Map(snapshot.accounts.filter((account) => account.active && (account.kind === "Income" || account.kind === "Expenses")).map((account) => [account.id, account.revision] as const));
        const suggestions: FinanceAiCategorySuggestion[] = [];
        const failures: string[] = []; let skipped = 0;
        for (const item of results) {
          const row = model.leftRows.find((candidate) => candidate.itemId === item.request.item_id);
          if (!item.result) { failures.push(`${item.request.item_id}: ${item.error ?? "AI 未返回建议"}`); continue; }
          if (!canApplyWorkspaceClassification(item.request, item.result, row, controller.signal.aborted, accountRevisions)) { skipped++; continue; }
          suggestions.push({ itemId: item.result.item_id, expectedItemRevision: item.result.expected_item_revision,
            expectedManualCategoryRevision: item.result.expected_manual_category_revision, accountId: item.result.account_id,
            accountRevision: item.result.account_revision, model: currentModel });
        }
        if (controller.signal.aborted) throw new DOMException("已取消建议应用", "AbortError");
        let applied = 0;
        if (suggestions.length) {
          const outcomes = await backend.applyAiCategorySuggestions(session, draftId, suggestions);
          applied = outcomes.filter((outcome) => outcome.applied).length;
          skipped += outcomes.filter((outcome) => !outcome.applied).length;
          failures.push(...outcomes.filter((outcome) => !outcome.applied && outcome.reason).map((outcome) => outcome.reason!));
          const durable = await backend.persistWorkspace(session, draftId);
          props.onStatus?.(durable.revision, durable.durableRevision);
          await refresh();
        }
        setStatus(aiStatus, `已应用 ${applied} 条；跳过过期或不符合条件 ${skipped} 条${failures.length ? `；失败 ${failures.length} 条：${failures.join("；")}` : ""}`, failures.length ? "error" : "success");
      } catch (error) { setStatus(aiStatus, errorText(error), "error"); }
      finally { cancel.disabled = true; button.disabled = false; }
    });
    panel.append(modelHost, el("div", "finance-v2-actions"));
    panel.lastElementChild!.append(saveModel, run, cancel);
    panel.append(aiStatus);
    return panel;
  }
  function factEditorBlock(): HTMLElement { const box = el("div", "finance-v2-section"); box.append(el("h3", "finance-v2-section-title", "新建账本事实"), factEditorBlockBody); return box; }
  function observationTitle(row: FinanceWorkspaceLeftRowView): string {
    const text = row.observation.fields.find((field) => field.role.toLowerCase().includes("merchant") && field.value.kind === "Text");
    const quantity = row.observation.fields.find((field) => field.value.kind === "SignedQuantity");
    const merchant = text?.value.kind === "Text" ? text.value.value : row.observation.locator;
    const amount = quantity?.value.kind === "SignedQuantity" ? `${quantity.value.quantity.amount} ${quantity.value.quantity.commodity}` : "";
    return `${merchant}${amount ? ` · ${amount}` : ""}`;
  }
  void Promise.all([listFinanceClassificationModels(), backend.loadFinanceAiModel(session)]).then(([models, preference]) => {
    aiModels = models; aiModelPreference = preference;
    if (aiModelPreference.modelId && !aiModels.includes(aiModelPreference.modelId)) aiModelPreference = { ...aiModelPreference, modelId: null };
    if (!disposed) renderLeft();
  }).catch((error) => setStatus(aiStatus, errorText(error), "error"));
  void refresh().catch((error) => setStatus(status, errorText(error), "error"));
  return { dispose() { disposed = true; aiController?.abort(); draftPicker?.dispose(); aiModelSelect?.dispose(); editor?.dispose(); treatmentEditor?.dispose(); for (const child of refinementChildEditors) child.editor.dispose(); for (const child of refinementTreatmentEditors.values()) child.dispose(); clearCategoryHandles(); for (const select of rightSelects) select.dispose(); root.replaceChildren(); } };
}

function qualityLabel(value: FinanceWorkspaceLeftRowView["quality"]): string {
  if (value === "Confirmed") return "已确认";
  if ("unresolved" in value) return `待核实：${value.unresolved}`;
  return `失败：${value.failed}`;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
