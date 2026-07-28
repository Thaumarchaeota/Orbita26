import { invoke } from "@tauri-apps/api/core";

type SystemStats = {
  cpu_usage: number;
  mem_usage: number;
};

export function mountStatsBar(root: HTMLElement) {
  const fpsEl = root.querySelector<HTMLElement>("#statFps")!;
  const cpuEl = root.querySelector<HTMLElement>("#statCpu")!;
  const memEl = root.querySelector<HTMLElement>("#statMem")!;

  let frames = 0;
  let lastFpsAt = performance.now();
  let fpsLoop = true;

  const tickFps = (now: number) => {
    if (!fpsLoop) return;
    frames += 1;
    if (now - lastFpsAt >= 1000) {
      fpsEl.textContent = String(frames);
      frames = 0;
      lastFpsAt = now;
    }
    requestAnimationFrame(tickFps);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      fpsLoop = false;
      return;
    }
    fpsLoop = true;
    frames = 0;
    lastFpsAt = performance.now();
    requestAnimationFrame(tickFps);
  });

  requestAnimationFrame(tickFps);

  const poll = async () => {
    try {
      const stats = await invoke<SystemStats>("get_system_stats");
      cpuEl.textContent = `${Math.round(stats.cpu_usage)}%`;
      memEl.textContent = `${Math.round(stats.mem_usage)}%`;
    } catch {
      cpuEl.textContent = "--";
      memEl.textContent = "--";
    }
  };

  void poll();
  window.setInterval(poll, 2000);
}
