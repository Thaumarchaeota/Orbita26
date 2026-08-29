import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

function guardVitestRun(): void {
  const isRun = process.argv.some((arg) => /(?:^|[\\/])vitest(?:\.mjs)?$/i.test(arg))
    && process.argv.includes("run");
  if (!isRun) return;

  const lockPath = join(tmpdir(), "orbita-vitest-run.lock");
  const isLivePid = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  const release = () => {
    try {
      if (Number(readFileSync(lockPath, "utf8")) === process.pid) unlinkSync(lockPath);
    } catch {
      // A forced shutdown can already have removed the temporary lock.
    }
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = openSync(lockPath, "wx");
      writeFileSync(descriptor, String(process.pid));
      closeSync(descriptor);
      process.once("exit", release);
      return;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(lockPath, "utf8"));
      if (Number.isInteger(pid) && pid > 0 && isLivePid(pid)) {
        throw new Error(`Another Orbita Vitest run is already active (PID ${pid}). Wait for it to finish instead of starting a parallel run.`);
      }
      try { unlinkSync(lockPath); } catch { /* another contender resolved it */ }
    }
  }
  throw new Error("Unable to acquire the Orbita Vitest run lock. Retry after the active test exits.");
}

guardVitestRun();

export default defineConfig({
  clearScreen: false,
  test: {
    environment: "happy-dom",
    // Vitest otherwise creates one fork per available CPU. A cancelled test
    // run can strand that whole worker tree on Windows. Keep parallelism small
    // while preserving per-file isolation so long DOM suites do not accumulate
    // into one multi-gigabyte worker; test-session.ps1 owns the entire tree.
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 2, isolate: true },
    },
    include: [
      "src/integrations/ledger/**/*.test.ts",
      "src/integrations/admin/**/*.test.ts",
      "src/ui/**/*.test.ts",
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
