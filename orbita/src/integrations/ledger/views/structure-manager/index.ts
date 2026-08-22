import type { LedgerRouter, LedgerViewHandle } from "../../shell";
import { fetchSettings, updateSettings } from "../../api/client";
import type { SettingsResponse } from "../../types";
import {
  CARD_STRIPE_KEYS,
  CARD_STRIPE_LABELS,
  DEFAULT_CARD_STRIPE_COLORS,
  syncFinanceCardStripes,
  type CardStripeKey,
} from "../../ui/card-stripe-tokens";
import { mountFinancePage } from "../../ui/page-shell";
import { mountCategoriesView } from "../categories";
import { mountWalletsView } from "../wallets";

type StructureTab = "categories" | "accounts";

const stripeFieldsHtml = CARD_STRIPE_KEYS.map(
  (key) => `
    <label class="structure-stripe-field">
      <span>${CARD_STRIPE_LABELS[key]}</span>
      <input type="color" name="stripe_${key}" data-stripe-key="${key}">
    </label>`,
).join("");

/** §8 structure-manager：账户/分类结构操作 */
export function mountStructureManagerView(panel: HTMLElement, router: LedgerRouter): LedgerViewHandle {
  const page = mountFinancePage(panel, {
    title: "账户与分类",
    showBack: true,
    onBack: () => router.back(),
    renderBody(bodyEl) {
      const ac = new AbortController();
      const { signal } = ac;
      let activeTab: StructureTab = "categories";
      let tabCleanup: (() => void) | null = null;

      bodyEl.innerHTML = `
        <div class="structure-manager">
          <form class="structure-settings" id="structure-settings">
            <div>
              <h2 class="structure-settings-title">统计显示</h2>
              <p class="structure-settings-note">报告币种仅影响余额与统计展示，不会改写交易。</p>
            </div>
            <label class="structure-settings-field">报告币种
              <input name="reporting_currency" maxlength="3" pattern="[A-Za-z]{3}" placeholder="CNY" required>
            </label>
            <div>
              <h2 class="structure-settings-title">卡片色条</h2>
              <p class="structure-settings-note">明细左侧类型色条默认色；未分类（unknown）无色条。保存后全局生效。</p>
            </div>
            <div class="structure-stripe-grid">${stripeFieldsHtml}</div>
            <button type="submit" class="structure-settings-save" disabled>保存</button>
            <span class="structure-settings-status" aria-live="polite"></span>
          </form>
          <nav class="structure-manager-tabs" aria-label="结构管理">
            <button type="button" class="structure-manager-tab is-active" data-tab="categories">分类</button>
            <button type="button" class="structure-manager-tab" data-tab="accounts">账户</button>
          </nav>
          <div class="structure-manager-panel" id="structure-manager-panel"></div>
        </div>`;

      const panelEl = bodyEl.querySelector<HTMLElement>("#structure-manager-panel")!;
      const settingsForm = bodyEl.querySelector<HTMLFormElement>("#structure-settings")!;
      const reportingInput = settingsForm.elements.namedItem("reporting_currency") as HTMLInputElement;
      const settingsSave = settingsForm.querySelector<HTMLButtonElement>(".structure-settings-save")!;
      const settingsStatus = settingsForm.querySelector<HTMLElement>(".structure-settings-status")!;
      let settings: SettingsResponse | null = null;

      const fillCardStripes = (loaded: SettingsResponse) => {
        settingsForm.querySelectorAll<HTMLInputElement>("[data-stripe-key]").forEach((input) => {
          const key = input.dataset.stripeKey as CardStripeKey;
          input.value = (loaded.card_stripes?.[key] ?? DEFAULT_CARD_STRIPE_COLORS[key]).toLowerCase();
        });
      };

      const readCardStripes = () => {
        const card_stripes: NonNullable<SettingsResponse["card_stripes"]> = {};
        settingsForm.querySelectorAll<HTMLInputElement>("[data-stripe-key]").forEach((input) => {
          const key = input.dataset.stripeKey as CardStripeKey;
          card_stripes[key] = input.value.toUpperCase();
        });
        return card_stripes;
      };

      void (async () => {
        try {
          const loaded = await fetchSettings(signal);
          if (signal.aborted) return;
          settings = loaded;
          reportingInput.value = loaded.reporting_currency;
          fillCardStripes(loaded);
          settingsSave.disabled = false;
        } catch {
          if (!signal.aborted) settingsStatus.textContent = "设置加载失败";
        }
      })();

      settingsForm.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          if (!settings) return;
          const reporting_currency = reportingInput.value.trim().toUpperCase();
          if (!/^[A-Z]{3}$/.test(reporting_currency)) {
            settingsStatus.textContent = "请输入 3 位字母币种代码";
            return;
          }
          settingsSave.disabled = true;
          settingsStatus.textContent = "保存中…";
          void updateSettings(
            {
              write_target: settings.write_target,
              reporting_currency,
              card_stripes: readCardStripes(),
            },
            signal,
          )
            .then((saved) => {
              if (signal.aborted) return;
              settings = saved;
              reportingInput.value = saved.reporting_currency;
              fillCardStripes(saved);
              const ledgerApp = panel.closest(".ledger-app") ?? document.querySelector(".ledger-app");
              if (ledgerApp instanceof HTMLElement) {
                syncFinanceCardStripes(ledgerApp, saved.card_stripes);
              }
              settingsStatus.textContent = "已保存";
            })
            .catch((error) => {
              if (!signal.aborted) {
                settingsStatus.textContent = error instanceof Error ? error.message : "设置保存失败";
              }
            })
            .finally(() => {
              if (!signal.aborted) settingsSave.disabled = false;
            });
        },
        { signal },
      );

      function mountTab(tab: StructureTab): void {
        if (tabCleanup) tabCleanup();
        tabCleanup =
          tab === "categories" ? mountCategoriesView(panelEl) : mountWalletsView(panelEl);
      }

      mountTab("categories");

      bodyEl.querySelectorAll<HTMLButtonElement>(".structure-manager-tab").forEach((btn) => {
        btn.addEventListener(
          "click",
          () => {
            const tab = btn.dataset.tab as StructureTab;
            if (!tab || tab === activeTab) return;
            activeTab = tab;
            bodyEl.querySelectorAll<HTMLElement>(".structure-manager-tab").forEach((el) => {
              el.classList.toggle("is-active", el.dataset.tab === tab);
            });
            mountTab(tab);
          },
          { signal },
        );
      });

      return () => {
        if (tabCleanup) tabCleanup();
        ac.abort();
      };
    },
  });

  return {
    getScrollEl: () => page.getScrollEl(),
    dispose() {
      page.unmount();
    },
  };
}
