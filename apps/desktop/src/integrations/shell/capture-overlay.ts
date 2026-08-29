import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import { escHtml } from "../../core/html";

type CaptureMode = "color" | "screenshot";

type CaptureScreenResult = { width: number; height: number; pngBase64: string };

type ColorSample = { hex: string; x: number; y: number };

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export async function openCaptureOverlay(initialMode: CaptureMode) {
  if (!isTauri()) return;
  const shot = await invoke<CaptureScreenResult>("capture_screen");
  const layer = document.createElement("div");
  layer.className = "capture-overlay";
  layer.innerHTML = `
    <div class="capture-overlay-stage" id="captureStage">
      <canvas class="capture-overlay-canvas" id="captureCanvas"></canvas>
      <div class="capture-overlay-rect" id="captureRect" hidden></div>
    </div>
    <div class="capture-overlay-bar">
      <button type="button" class="dialog-btn${initialMode === "color" ? " is-active" : ""}" data-mode="color">取色</button>
      <button type="button" class="dialog-btn${initialMode === "screenshot" ? " is-active" : ""}" data-mode="screenshot">截屏</button>
      <span class="capture-overlay-hint" id="captureHint"></span>
      <button type="button" class="dialog-btn" data-action="close">关闭 (Esc)</button>
    </div>
    <div class="capture-overlay-palette" id="capturePalette">
      <div class="capture-overlay-palette-head" id="paletteHead">色板 · 拖动</div>
      <div class="capture-overlay-palette-list" id="paletteList"></div>
    </div>
  `;
  document.body.appendChild(layer);

  let mode: CaptureMode = initialMode;
  let colors: ColorSample[] = [];
  let pngBase64 = shot.pngBase64;
  let dragStart: { x: number; y: number } | null = null;
  let paletteDrag: { ox: number; oy: number } | null = null;

  const canvas = layer.querySelector<HTMLCanvasElement>("#captureCanvas")!;
  const rectEl = layer.querySelector<HTMLElement>("#captureRect")!;
  const hint = layer.querySelector<HTMLElement>("#captureHint")!;
  const palette = layer.querySelector<HTMLElement>("#capturePalette")!;
  const paletteHead = layer.querySelector<HTMLElement>("#paletteHead")!;
  const paletteList = layer.querySelector<HTMLElement>("#paletteList")!;

  const img = new Image();
  img.src = `data:image/png;base64,${pngBase64}`;
  await img.decode();

  const scale = Math.min(window.innerWidth / img.width, window.innerHeight / img.height, 1);
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.style.width = `${img.width * scale}px`;
  canvas.style.height = `${img.height * scale}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  function canvasPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * canvas.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * canvas.height);
    return {
      x: Math.max(0, Math.min(canvas.width - 1, x)),
      y: Math.max(0, Math.min(canvas.height - 1, y)),
    };
  }

  function syncHint() {
    hint.textContent =
      mode === "color"
        ? "左键采点 · Enter 完成 · Esc 取消"
        : "拖拽框选 · 松开保存剪贴板+文件";
  }

  function renderPalette() {
    paletteList.innerHTML = colors.length
      ? colors
          .map(
            (c, i) =>
              `<div class="capture-color-row" data-i="${i}">
                <span class="capture-color-swatch" style="background:${escHtml(c.hex)}"></span>
                <code class="capture-color-hex">${escHtml(c.hex)}</code>
                <button type="button" class="capture-color-copy" data-i="${i}">复制</button>
                <button type="button" class="capture-color-del" data-i="${i}">删</button>
              </div>`,
          )
          .join("")
      : `<div class="capture-overlay-empty">暂无采色</div>`;
    paletteList.querySelectorAll<HTMLButtonElement>(".capture-color-copy").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        const hex = colors[i]?.hex;
        if (hex) void navigator.clipboard.writeText(hex);
      });
    });
    paletteList.querySelectorAll<HTMLButtonElement>(".capture-color-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        colors = colors.filter((_, idx) => idx !== i);
        renderPalette();
      });
    });
  }

  function setMode(m: CaptureMode) {
    mode = m;
    layer.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.mode === m);
    });
    rectEl.hidden = true;
    dragStart = null;
    palette.style.display = m === "color" ? "" : "none";
    syncHint();
  }

  async function close() {
    layer.remove();
  }

  layer.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode as CaptureMode));
  });
  layer.querySelector('[data-action="close"]')!.addEventListener("click", () => void close());

  paletteHead.addEventListener("pointerdown", (e) => {
    paletteDrag = { ox: e.clientX - palette.offsetLeft, oy: e.clientY - palette.offsetTop };
    palette.setPointerCapture(e.pointerId);
  });
  paletteHead.addEventListener("pointermove", (e) => {
    if (!paletteDrag) return;
    palette.style.left = `${e.clientX - paletteDrag.ox}px`;
    palette.style.top = `${e.clientY - paletteDrag.oy}px`;
  });
  paletteHead.addEventListener("pointerup", () => {
    paletteDrag = null;
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "screenshot") return;
    const p = canvasPoint(e);
    dragStart = p;
    rectEl.hidden = false;
    rectEl.style.left = `${(p.x / canvas.width) * canvas.clientWidth}px`;
    rectEl.style.top = `${(p.y / canvas.height) * canvas.clientHeight}px`;
    rectEl.style.width = "0";
    rectEl.style.height = "0";
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (mode === "screenshot" && dragStart) {
      const p = canvasPoint(e);
      const x0 = Math.min(dragStart.x, p.x);
      const y0 = Math.min(dragStart.y, p.y);
      const w = Math.abs(p.x - dragStart.x);
      const h = Math.abs(p.y - dragStart.y);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      rectEl.style.left = `${(x0 / canvas.width) * cw}px`;
      rectEl.style.top = `${(y0 / canvas.height) * ch}px`;
      rectEl.style.width = `${(w / canvas.width) * cw}px`;
      rectEl.style.height = `${(h / canvas.height) * ch}px`;
      return;
    }
    if (mode === "color") {
      const p = canvasPoint(e);
      const d = ctx.getImageData(p.x, p.y, 1, 1).data;
      hint.textContent = rgbToHex(d[0], d[1], d[2]);
    }
  });

  canvas.addEventListener("pointerup", async (e) => {
    if (mode === "screenshot" && dragStart) {
      const p = canvasPoint(e);
      const x0 = Math.min(dragStart.x, p.x);
      const y0 = Math.min(dragStart.y, p.y);
      const w = Math.max(1, Math.abs(p.x - dragStart.x));
      const h = Math.max(1, Math.abs(p.y - dragStart.y));
      dragStart = null;
      rectEl.hidden = true;
      try {
        const cropped = await invoke<string>("capture_crop", {
          b64: pngBase64,
          x: x0,
          y: y0,
          w,
          h,
        });
        await invoke("capture_copy_clipboard", { b64: cropped });
        const path = await invoke<string>("capture_save_file", { b64: cropped });
        hint.textContent = `已保存 ${path}`;
        window.setTimeout(() => void close(), 800);
      } catch (err) {
        alert(String(err));
      }
      return;
    }
  });

  canvas.addEventListener("click", (e) => {
    if (mode !== "color") return;
    const p = canvasPoint(e);
    const d = ctx.getImageData(p.x, p.y, 1, 1).data;
    const hex = rgbToHex(d[0], d[1], d[2]);
    colors.push({ hex, x: p.x, y: p.y });
    renderPalette();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") void close();
    if (e.key === "Enter" && mode === "color") void close();
  };
  window.addEventListener("keydown", onKey);

  layer.addEventListener("remove", () => window.removeEventListener("keydown", onKey), { once: true });

  setMode(initialMode);
  renderPalette();
}
