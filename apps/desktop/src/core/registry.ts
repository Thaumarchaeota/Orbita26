export type Integration = {
  id: string;
  init(): void | Promise<void>;
};

const integrations: Integration[] = [];

export function registerIntegration(integration: Integration) {
  integrations.push(integration);
}

export async function initIntegrations() {
  for (const item of integrations) {
    await item.init();
  }
}
