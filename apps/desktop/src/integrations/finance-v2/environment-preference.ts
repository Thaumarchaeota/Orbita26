export type FinanceEnvironmentPreference = {
  rootPath: string;
  workspaceId: string;
  ledgerIdentity: string;
};

export type FinanceEnvironmentPreferenceRead = {
  preference: FinanceEnvironmentPreference | null;
  error?: string;
};

const KEY_PREFIX = "orbita.data.stores.";

function preferenceKey(dataDirKey: string): string {
  return `${KEY_PREFIX}${dataDirKey || "_default"}.financeV2.isolatedEnvironment`;
}

/** This preference is a locator and identity hint only; callers must re-open and verify it with the backend. */
export function readFinanceEnvironmentPreference(dataDirKey: string): FinanceEnvironmentPreferenceRead {
  try {
    if (typeof localStorage === "undefined") throw new Error("本机偏好存储不可用。");
    const raw = localStorage.getItem(preferenceKey(dataDirKey));
    if (raw === null) return { preference: null };
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.schemaVersion !== 1 || typeof value.rootPath !== "string" || !value.rootPath.trim()
      || typeof value.workspaceId !== "string" || !value.workspaceId.trim()
      || typeof value.ledgerIdentity !== "string" || !value.ledgerIdentity.trim()) {
      return { preference: null, error: "上次隔离环境记录格式无效，请重新选择目录。" };
    }
    return { preference: { rootPath: value.rootPath, workspaceId: value.workspaceId, ledgerIdentity: value.ledgerIdentity } };
  } catch (error) {
    return { preference: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function saveFinanceEnvironmentPreference(dataDirKey: string, preference: FinanceEnvironmentPreference): string | null {
  try {
    if (typeof localStorage === "undefined") throw new Error("本机偏好存储不可用。");
    localStorage.setItem(preferenceKey(dataDirKey), JSON.stringify({ schemaVersion: 1,
      rootPath: preference.rootPath, workspaceId: preference.workspaceId, ledgerIdentity: preference.ledgerIdentity }));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
