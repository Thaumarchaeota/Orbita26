import { setTabStripStyle } from "../tab-host/host-api";
import { loadTabSession, type TabStripStyle } from "../tab-host/session-persist";

export const globalTabHtml = `
  <div class="insight-settings-panel is-active" data-tab-panel="global">
    <div class="insight-settings-section">
      <h3 class="insight-settings-section-title">标签外观</h3>
      <div class="insight-settings-tab-style" role="group" aria-label="标签外观">
        <button type="button" class="insight-settings-style-btn" data-tab-style="rect" aria-pressed="true">直角</button>
        <button type="button" class="insight-settings-style-btn" data-tab-style="trap" aria-pressed="false">梯形</button>
      </div>
    </div>
    <div class="insight-settings-section">
      <h3 class="insight-settings-section-title">数据目录</h3>
      <div class="insight-settings-field">
        <label class="insight-settings-label" for="insight-data-dir">数据存储位置</label>
        <div class="insight-settings-path-row">
          <input id="insight-data-dir" type="text" placeholder="Orbita 数据根目录" readonly>
          <button type="button" class="insight-settings-btn" data-action="browse-data">浏览</button>
        </div>
        <p class="insight-settings-hint">账本目录固定为此处下的 bill 文件夹（需 account.bean、category.bean、ledger/*.bean）</p>
      </div>
    </div>
  </div>`;

export function bindGlobalTab(root: HTMLElement, _options: { onImmediateSaveError?: (message: string) => void } = {}) {
  const dataDirEl = root.querySelector<HTMLInputElement>("#insight-data-dir")!;
  const styleRectBtn = root.querySelector<HTMLButtonElement>('[data-tab-style="rect"]')!;
  const styleTrapBtn = root.querySelector<HTMLButtonElement>('[data-tab-style="trap"]')!;

  function setStyleUI(style: TabStripStyle): void {
    for (const btn of [styleRectBtn, styleTrapBtn]) {
      const active = btn.dataset.tabStyle === style;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("is-active", active);
    }
  }

  function onStyleChange(style: TabStripStyle): void {
    setTabStripStyle(style);
    setStyleUI(style);
  }

  styleRectBtn.addEventListener("click", () => onStyleChange("rect"));
  styleTrapBtn.addEventListener("click", () => onStyleChange("trap"));


  root.querySelector('[data-action="browse-data"]')!.addEventListener("click", async () => {
    const { pickLocalFolder } = await import("../../shell/adapter");
    const path = await pickLocalFolder();
    if (path) dataDirEl.value = path;
  });

  return {
    fill(dataDir: string) {
      dataDirEl.value = dataDir;
      setStyleUI(loadTabSession().style);
    },
    read() {
      return dataDirEl.value.trim();
    },
  };
}
