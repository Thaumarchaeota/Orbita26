export type Listener = () => void;

export type Store<T> = {
  getState: () => T;
  setState: (patch: Partial<T>) => void;
  subscribe: (listener: Listener) => () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state = { ...initial };
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(patch) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
