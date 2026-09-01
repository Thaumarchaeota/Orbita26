export const globalTabHtml = `
  <div class="insight-settings-panel" data-tab-panel="global">
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

export function bindGlobalTab(root: HTMLElement) {
  const dataDirEl = root.querySelector<HTMLInputElement>("#insight-data-dir")!;

  root.querySelector('[data-action="browse-data"]')!.addEventListener("click", async () => {
    const { pickLocalFolder } = await import("../../shell/adapter");
    const path = await pickLocalFolder();
    if (path) dataDirEl.value = path;
  });

  return {
    fill(dataDir: string) {
      dataDirEl.value = dataDir;
    },
    read() {
      return dataDirEl.value.trim();
    },
  };
}
