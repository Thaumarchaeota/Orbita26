export function createDataStore<T>(cfg: {
  name: string;
  read: () => Promise<T[]>;
  write: (items: T[]) => Promise<void>;
  defaults?: T[];
}): { init: () => Promise<T[]>; load: () => T[]; save: (items: T[]) => void } {
  let cache: T[] | null = null;

  async function init(): Promise<T[]> {
    cache = await cfg.read();
    return cache;
  }

  function load(): T[] {
    if (!cache) throw new Error(`${cfg.name} not loaded`);
    return cache;
  }

  function save(items: T[]): void {
    cache = items;
    void cfg.write(items);
  }

  return { init, load, save };
}
