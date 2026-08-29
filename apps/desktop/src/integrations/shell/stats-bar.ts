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
  let fpsActive = false;
  let pollTimer = 0;

  const tickFps = (now: number) => {
    if (!fpsActive) return;
    frames += 1;
    if (now - lastFpsAt >= 1000) {
      fpsEl.textContent = String(Math.max(frames, 0));
      frames = 0;
      lastFpsAt = now;
    }
    requestAnimationFrame(tickFps);
  };

  const startFps = () => {
    if (fpsActive) return;
    fpsActive = true;
    frames = 0;
    lastFpsAt = performance.now();
    fpsEl.textContent = "0";
    requestAnimationFrame(tickFps);
  };

  const stopFps = () => {
    fpsActive = false;
  };

  const stopPoll = () => {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
  };

  const startPoll = () => {
    if (pollTimer) return;
    void poll();
    pollTimer = window.setInterval(() => void poll(), 5000);
  };

  const stopLoops = () => {
    stopFps();
    stopPoll();
  };

  const startLoops = () => {
    startFps();
    startPoll();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoops();
    else startLoops();
  });

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

  if (!document.hidden) startLoops();
}
