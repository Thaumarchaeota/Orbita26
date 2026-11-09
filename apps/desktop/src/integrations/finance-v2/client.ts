import type { FinanceV2Backend, IsolatedFinanceSession } from "./types";

let backend: FinanceV2Backend | null = null;

/** The Finance v2 tab installs the production bridge during module initialization; null is the pre-mount state. */
export function installFinanceV2Backend(next: FinanceV2Backend | null): void {
  backend = next;
}

export function getFinanceV2Backend(): FinanceV2Backend | null {
  return backend;
}

export function requireFinanceV2Backend(): FinanceV2Backend {
  if (!backend) throw new Error("隔离 Finance v2 后端尚未接线");
  return backend;
}

const writeMethods = new Set<keyof FinanceV2Backend>([
  "saveSource", "saveSourceContext", "saveAccount", "saveVia", "saveCalibration", "deleteCalibration", "restoreCalibration", "setAccountViaBinding", "setAccountActive", "pickAndParse", "confirmParsedBatch", "createManualWorkspace",
  "applyAiCategorySuggestions", "saveDraft", "saveRules", "confirmAppendRules", "openRulesFile", "saveFinanceAiModel",
  "setManualCategory", "rejectObservation", "cancelObservation", "stageWorkspaceIntent", "stageWorkspaceRefinement", "undoWorkspaceAction", "persistWorkspace", "confirmWorkspaceCandidate", "cancelWorkspaceImport",
  "prepareCommit", "commitPrepared", "retryMaterialization", "abandonUnsubmittedDraft",
]);

/** Every page capability is locally guarded; the native bridge must repeat marker/scope checks server-side. */
export function createSessionGuardedBackend(backend: FinanceV2Backend, session: IsolatedFinanceSession): FinanceV2Backend {
  return new Proxy(backend, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function" || property === "pickEnvironmentDirectory" || property === "createEnvironment" || property === "openEnvironment" || property === "closeIsolatedSession") return value;
      return (...args: unknown[]) => {
        const scope = writeMethods.has(property as keyof FinanceV2Backend) ? "write" : "read";
        assertFinanceSession(session, scope);
        if (args[0] !== session) throw new Error("Finance 操作缺少当前隔离会话身份");
        return value.apply(target, args);
      };
    },
  });
}

export function assertFinanceSession(
  session: IsolatedFinanceSession | null,
  scope: "read" | "write",
): asserts session is IsolatedFinanceSession {
  if (!session || !session.sessionId || !session.workspaceId || !session.ledgerIdentity || !session.rootPath || session.markerVersion < 1 || session.scope !== "isolated") {
    throw new Error("请先显式选择并验证隔离账本环境");
  }
  void scope;
}

export async function withFinanceSession<T>(
  session: IsolatedFinanceSession | null,
  scope: "read" | "write",
  operation: (backend: FinanceV2Backend, session: IsolatedFinanceSession) => Promise<T>,
): Promise<T> {
  assertFinanceSession(session, scope);
  return operation(requireFinanceV2Backend(), session);
}
