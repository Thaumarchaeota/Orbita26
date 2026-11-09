import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinanceV2Backend, IsolatedFinanceSession } from "./types";
import {
  readFinanceEnvironmentPreference,
  saveFinanceEnvironmentPreference,
  type FinanceEnvironmentPreference,
} from "./environment-preference";
import { mountEnvironment } from "../admin/tabs/finance-v2/environment";

const PREFIX = "orbita.data.stores.";

function preferenceKey(scope: string): string {
  return `${PREFIX}${scope}.financeV2.isolatedEnvironment`;
}

function session(overrides: Partial<IsolatedFinanceSession> = {}): IsolatedFinanceSession {
  return {
    sessionId: "synthetic-session-token",
    rootPath: "C:/synthetic/finance-ledger",
    workspaceId: "synthetic-workspace",
    ledgerIdentity: "synthetic-ledger-identity",
    markerVersion: 1,
    scope: "isolated",
    generation: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function backend(overrides: Partial<FinanceV2Backend> = {}): FinanceV2Backend {
  return {
    pickEnvironmentDirectory: vi.fn().mockResolvedValue(null),
    createEnvironment: vi.fn().mockResolvedValue(session()),
    openEnvironment: vi.fn().mockResolvedValue(session()),
    closeIsolatedSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FinanceV2Backend;
}

function seedPreference(scope: string, value = session()): void {
  saveFinanceEnvironmentPreference(scope, {
    rootPath: value.rootPath,
    workspaceId: value.workspaceId,
    ledgerIdentity: value.ledgerIdentity,
  });
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`missing button ${label}`);
  return found;
}

afterEach(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX) && key.endsWith(".financeV2.isolatedEnvironment")) localStorage.removeItem(key);
  }
});

describe("Finance v2 isolated environment restoration", () => {
  it("scopes locator preferences by dataDir and persists only the locator identity fields", () => {
    const firstScope = `synthetic-data-dir-${crypto.randomUUID()}`;
    const secondScope = `${firstScope}-other`;
    const withExtraToken = {
      rootPath: "C:/synthetic/finance-ledger",
      workspaceId: "synthetic-workspace",
      ledgerIdentity: "synthetic-ledger-identity",
      sessionId: "must-not-persist",
    } as FinanceEnvironmentPreference;

    expect(saveFinanceEnvironmentPreference(firstScope, withExtraToken)).toBeNull();
    expect(readFinanceEnvironmentPreference(firstScope).preference).toEqual({
      rootPath: withExtraToken.rootPath,
      workspaceId: withExtraToken.workspaceId,
      ledgerIdentity: withExtraToken.ledgerIdentity,
    });
    expect(readFinanceEnvironmentPreference(secondScope).preference).toBeNull();
    expect(JSON.parse(localStorage.getItem(preferenceKey(firstScope))!)).toEqual({
      schemaVersion: 1,
      rootPath: withExtraToken.rootPath,
      workspaceId: withExtraToken.workspaceId,
      ledgerIdentity: withExtraToken.ledgerIdentity,
    });
  });

  it("reopens the remembered root through the backend before publishing its session", async () => {
    const scope = `synthetic-restore-${crypto.randomUUID()}`;
    const remembered = session({ generation: 4 });
    seedPreference(scope, remembered);
    const opened = session({ generation: 5 });
    const openEnvironment = vi.fn().mockResolvedValue(opened);
    const api = backend({ openEnvironment });
    const root = document.createElement("div");
    const onChange = vi.fn();

    const handle = mountEnvironment(root, api, onChange, scope);
    expect(onChange).not.toHaveBeenCalledWith(opened);
    await flushMicrotasks();

    expect(openEnvironment).toHaveBeenCalledTimes(1);
    expect(openEnvironment).toHaveBeenCalledWith(remembered.rootPath);
    expect(onChange).toHaveBeenLastCalledWith(opened);
    expect(handle.getSession()).toBe(opened);
    const persisted = JSON.parse(localStorage.getItem(preferenceKey(scope))!);
    expect(Object.keys(persisted).sort()).toEqual(["ledgerIdentity", "rootPath", "schemaVersion", "workspaceId"]);
    handle.dispose();
  });

  it("lets an explicit directory selection supersede a pending remembered open", async () => {
    const scope = `synthetic-choice-${crypto.randomUUID()}`;
    const remembered = session();
    seedPreference(scope, remembered);
    const pendingOpen = deferred<IsolatedFinanceSession>();
    const openEnvironment = vi.fn().mockReturnValue(pendingOpen.promise);
    const pickEnvironmentDirectory = vi.fn().mockResolvedValue("C:/synthetic/other-ledger");
    const closeIsolatedSession = vi.fn().mockResolvedValue(undefined);
    const api = backend({ openEnvironment, pickEnvironmentDirectory, closeIsolatedSession });
    const root = document.createElement("div");
    const onChange = vi.fn();
    const handle = mountEnvironment(root, api, onChange, scope);
    await flushMicrotasks();
    expect(openEnvironment).toHaveBeenCalledWith(remembered.rootPath);

    button(root, "选择隔离根目录").click();
    await flushMicrotasks();
    pendingOpen.resolve(session({ rootPath: remembered.rootPath }));
    await flushMicrotasks();

    expect(pickEnvironmentDirectory).toHaveBeenCalledTimes(1);
    expect(closeIsolatedSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "synthetic-session-token" }));
    expect(handle.getSession()).toBeNull();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: "synthetic-session-token" }));
    expect(readFinanceEnvironmentPreference(scope).preference?.rootPath).toBe(remembered.rootPath);
    expect(button(root, "打开已有隔离账本").disabled).toBe(false);
    handle.dispose();
  });

  it("closes a late restored session after dispose without publishing or replacing the preference", async () => {
    const scope = `synthetic-dispose-${crypto.randomUUID()}`;
    const remembered = session();
    seedPreference(scope, remembered);
    const pendingOpen = deferred<IsolatedFinanceSession>();
    const closeIsolatedSession = vi.fn().mockResolvedValue(undefined);
    const api = backend({ openEnvironment: vi.fn().mockReturnValue(pendingOpen.promise), closeIsolatedSession });
    const root = document.createElement("div");
    const onChange = vi.fn();
    const handle = mountEnvironment(root, api, onChange, scope);
    await flushMicrotasks();
    handle.dispose();

    const lateSession = session({ rootPath: "C:/synthetic/late-response" });
    pendingOpen.resolve(lateSession);
    await flushMicrotasks();

    expect(closeIsolatedSession).toHaveBeenCalledWith(lateSession);
    expect(onChange).not.toHaveBeenCalledWith(lateSession);
    expect(readFinanceEnvironmentPreference(scope).preference?.rootPath).toBe(remembered.rootPath);
  });

  it("rejects a changed remembered identity while leaving explicit selection available", async () => {
    const scope = `synthetic-stale-${crypto.randomUUID()}`;
    const remembered = session();
    seedPreference(scope, remembered);
    const changedIdentity = session({ ledgerIdentity: "different-ledger-identity" });
    const closeIsolatedSession = vi.fn().mockResolvedValue(undefined);
    const api = backend({ openEnvironment: vi.fn().mockResolvedValue(changedIdentity), closeIsolatedSession });
    const root = document.createElement("div");
    const onChange = vi.fn();
    const handle = mountEnvironment(root, api, onChange, scope);
    await flushMicrotasks();

    expect(closeIsolatedSession).toHaveBeenCalledWith(changedIdentity);
    expect(handle.getSession()).toBeNull();
    expect(onChange).not.toHaveBeenCalledWith(changedIdentity);
    await vi.waitFor(() => {
      expect(button(root, "选择隔离根目录").disabled).toBe(false);
      expect(button(root, "打开已有隔离账本").disabled).toBe(false);
    });
    handle.dispose();
  });
});
