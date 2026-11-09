import type { FinanceV2Backend, IsolatedFinanceSession } from "../../../finance-v2/types";
import { readFinanceEnvironmentPreference, saveFinanceEnvironmentPreference, type FinanceEnvironmentPreference } from "../../../finance-v2/environment-preference";
import { action, el, section, setStatus, statusNode } from "./dom";

export type EnvironmentHandle = { getSession(): IsolatedFinanceSession | null; dispose(): void };

/** Stored values only locate a prior root; every mount reopens and verifies it before enabling ledger pages. */
export function mountEnvironment(root: HTMLElement, backend: FinanceV2Backend | null, onChange: (session: IsolatedFinanceSession | null) => void, preferenceScope: string): EnvironmentHandle {
  const block = section("隔离账本环境", "请选择一个目录，再明确选择创建空隔离账本或打开已有隔离账本。页面不会发现其他目录，也不会自动创建环境。真实账单与 Archive 不会被自动选择或读取。");
  const stored = readFinanceEnvironmentPreference(preferenceScope);
  const pathLabel = el("p", "finance-v2-muted", stored.preference ? `上次成功环境路径（正在重新验证）：${stored.preference.rootPath}` : "尚未选择隔离根目录");
  const identity = el("pre", "finance-v2-identity", stored.preference ? "等待后端重新验证 marker 与隔离身份" : "当前未验证");
  const status = statusNode();
  const controls = el("div", "finance-v2-actions");
  let rootPath: string | null = stored.preference?.rootPath ?? null;
  let verified: IsolatedFinanceSession | null = null;
  let operation = 0;
  let restoring = false;
  let disposed = false;

  if (stored.error) setStatus(status, `未能读取上次环境偏好：${stored.error} 可继续手动选择目录。`, "error");
  else if (stored.preference) setStatus(status, "正在通过隔离环境后端重新验证上次成功选择的目录。", "info");

  const choose = action("选择隔离根目录", async (button) => {
    const request = ++operation;
    restoring = false;
    if (!backend) { setStatus(status, "隔离后端尚未接线；未执行目录选择或账本读取。", "error"); return; }
    button.disabled = true;
    try {
      const previous = verified; verified = null; onChange(null); renderIdentity();
      if (previous) await backend.closeIsolatedSession(previous);
      if (disposed || request !== operation) return;
      const chosen = await backend.pickEnvironmentDirectory();
      if (disposed || request !== operation) return;
      if (chosen !== null) rootPath = chosen;
      pathLabel.textContent = rootPath ? `待验证隔离根目录：${rootPath}` : "未选择目录";
      setStatus(status, chosen ? "目录已选择；请明确选择创建或打开。" : rootPath ? "已取消目录选择；上次路径仍可由你显式打开。" : "已取消目录选择。", "info");
    } catch (error) {
      if (!disposed && request === operation) setStatus(status, errorText(error), "error");
    } finally {
      if (!disposed && request === operation) { button.disabled = false; renderButtons(); }
    }
  });
  const create = action("创建空隔离账本", async (button) => { await openSession(button, "create"); }, true);
  const open = action("打开已有隔离账本", async (button) => { await openSession(button, "open"); }, true);
  controls.append(choose, create, open);
  block.append(pathLabel, controls, identity, status); root.append(block);

  function renderButtons(): void {
    create.disabled = !backend || !rootPath || restoring || disposed;
    open.disabled = !backend || !rootPath || restoring || disposed;
  }
  function renderIdentity(): void {
    if (!verified) { identity.textContent = "当前未验证"; return; }
    identity.textContent = `Workspace：${verified.workspaceId}\nLedger identity：${verified.ledgerIdentity}\nRoot marker v${verified.markerVersion}：已匹配\nGeneration：${verified.generation}\nScope：${verified.scope}`;
  }
  function validSession(value: IsolatedFinanceSession): boolean {
    return Boolean(value.rootPath && value.sessionId && value.workspaceId && value.ledgerIdentity && value.markerVersion >= 1 && value.scope === "isolated");
  }
  function remember(value: IsolatedFinanceSession): string | null {
    const preference: FinanceEnvironmentPreference = { rootPath: value.rootPath, workspaceId: value.workspaceId, ledgerIdentity: value.ledgerIdentity };
    return saveFinanceEnvironmentPreference(preferenceScope, preference);
  }
  async function closeQuietly(value: IsolatedFinanceSession): Promise<void> {
    try { await backend?.closeIsolatedSession(value); } catch { /* A stale session must never be published after a newer selection. */ }
  }
  function publish(value: IsolatedFinanceSession, label: string): void {
    verified = value;
    rootPath = value.rootPath;
    pathLabel.textContent = `当前已验证隔离根目录：${value.rootPath}`;
    renderIdentity();
    onChange(value);
    const storageError = remember(value);
    setStatus(status, storageError ? `${label} 偏好未能保存：${storageError}；当前 session 仍有效。` : label, storageError ? "error" : "success");
  }
  async function openSession(button: HTMLButtonElement, mode: "create" | "open"): Promise<void> {
    if (!backend || !rootPath || restoring) { setStatus(status, "请先选择或等待验证隔离根目录。", "error"); return; }
    const request = ++operation;
    restoring = true;
    renderButtons();
    button.disabled = true;
    const chosenPath = rootPath;
    let candidate: IsolatedFinanceSession | null = null;
    try {
      const previous = verified; verified = null; onChange(null); renderIdentity();
      if (previous) await backend.closeIsolatedSession(previous);
      if (disposed || request !== operation) return;
      candidate = mode === "create" ? await backend.createEnvironment(chosenPath) : await backend.openEnvironment(chosenPath);
      if (disposed || request !== operation) { await closeQuietly(candidate); candidate = null; return; }
      if (!validSession(candidate)) throw new Error("后端返回的隔离身份与所选目录不匹配或不完整。");
      const opened = candidate; candidate = null;
      publish(opened, mode === "create" ? "空隔离账本已创建并验证。" : "已有隔离账本身份与 marker 已验证。");
    } catch (error) {
      if (candidate) await closeQuietly(candidate);
      if (!disposed && request === operation) { verified = null; onChange(null); setStatus(status, errorText(error), "error"); renderIdentity(); }
    } finally {
      if (!disposed && request === operation) { restoring = false; renderButtons(); }
    }
  }
  async function restoreRemembered(value: FinanceEnvironmentPreference, request: number): Promise<void> {
    if (!backend || disposed || request !== operation) return;
    restoring = true;
    renderButtons();
    let candidate: IsolatedFinanceSession | null = null;
    try {
      candidate = await backend.openEnvironment(value.rootPath);
      if (disposed || request !== operation) { await closeQuietly(candidate); candidate = null; return; }
      if (!validSession(candidate) || candidate.workspaceId !== value.workspaceId || candidate.ledgerIdentity !== value.ledgerIdentity) {
        await closeQuietly(candidate); candidate = null;
        throw new Error("上次路径的隔离 marker 或账本身份已变化；未打开该账本，请重新选择目录。");
      }
      const opened = candidate; candidate = null;
      publish(opened, "上次隔离账本已通过后端 marker 与身份复核并重新打开。");
    } catch (error) {
      if (candidate) await closeQuietly(candidate);
      if (!disposed && request === operation) {
        verified = null; renderIdentity();
        pathLabel.textContent = `上次隔离根目录尚未验证：${value.rootPath}`;
        setStatus(status, `${errorText(error)} 可选择其他目录；不会自动创建环境。`, "error");
      }
    } finally {
      if (!disposed && request === operation) { restoring = false; renderButtons(); }
    }
  }

  renderButtons();
  if (backend && stored.preference) {
    const request = ++operation;
    // Defer until the host finishes constructing callbacks captured by onChange.
    void Promise.resolve().then(() => restoreRemembered(stored.preference!, request));
  }
  return {
    getSession: () => verified,
    dispose() {
      disposed = true; operation += 1;
      const previous = verified; verified = null;
      if (previous) void closeQuietly(previous);
      onChange(null); block.remove();
    },
  };
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
