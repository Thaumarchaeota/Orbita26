import { renderWalletsList } from "./render";

export function mountWalletsView(panel: HTMLElement): () => void {
  panel.innerHTML = `<div class="wallets-view"><div id="wallets-list" class="wallets-list"></div></div>`;
  const listEl = panel.querySelector<HTMLElement>("#wallets-list")!;
  renderWalletsList(listEl);
  return () => {};
}
