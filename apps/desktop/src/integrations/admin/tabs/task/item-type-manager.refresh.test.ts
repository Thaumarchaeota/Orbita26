import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItemTypeCatalogSnapshot } from "../../../productivity/types";
import { resolveCategoryRoles } from "../../../../ui/color-system";
import { mountItemTypeManager } from "./item-type-manager";

const picker = vi.hoisted(() => ({
  onChange: null as null | ((value: string) => void),
  dispose: vi.fn(),
}));
const client = vi.hoisted(() => ({ save: vi.fn(async () => ({ catalog: null })) }));

vi.mock("../../../../ui/category-color-picker", () => ({
  mountCategoryColorPicker: (options: { onChange: (value: string) => void }) => {
    picker.onChange = options.onChange;
    return { open: vi.fn(), close: vi.fn(), isOpen: () => true, setOptions: vi.fn(), dispose: picker.dispose };
  },
}));
vi.mock("../../../productivity/client", () => ({
  productivityDeleteItemType: vi.fn(),
  productivityGetItemTypeCatalog: vi.fn(),
  productivitySaveItemTypeCatalog: client.save,
}));

function catalog(revision = 1, name = "Travel"): ItemTypeCatalogSnapshot {
  return {
    id: "catalog", revision, createdAtUtc: "2026-10-01T00:00:00Z", updatedAtUtc: "2026-10-01T00:00:00Z", deletedAtUtc: null,
    itemTypes: [{ id: "travel", name, parentItemTypeId: null, colorOverride: "#4879ED", effectiveColor: "#4879ED", inactive: false, effectiveInactive: false, createdAtUtc: "2026-10-01T00:00:00Z", updatedAtUtc: "2026-10-01T00:00:00Z", systemRole: null, canDelete: false }],
  };
}

afterEach(() => {
  document.body.replaceChildren();
  picker.onChange = null;
  picker.dispose.mockClear();
  client.save.mockClear();
  vi.restoreAllMocks();
});

function mount(initial = catalog()) {
  const host = document.createElement("div");
  document.body.append(host);
  const handle = mountItemTypeManager({ host, initialCatalog: initial, expectedDataDir: "test-data", onSaved: vi.fn(), onBack: vi.fn() });
  handle.show();
  return { host, handle };
}

function nameText(host: HTMLElement): string {
  return host.querySelector(".orbita-inline-text-field__display")?.textContent ?? "";
}

function commitName(host: HTMLElement, value: string): void {
  host.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
  const input = host.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
  input.value = value;
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

describe("item type manager canonical refresh", () => {
  it("preserves the open picker and current draft node for cloned revision-only catalogs", () => {
    const { host, handle } = mount();
    const anchor = host.querySelector<HTMLElement>("[data-color-anchor]")!;
    anchor.click();

    handle.syncCanonical(structuredClone(catalog(2)));

    expect(host.querySelector("[data-color-anchor]")).toBe(anchor);
    expect(picker.dispose).not.toHaveBeenCalled();
    picker.onChange!("#E44755");
    expect(host.querySelector<HTMLElement>("[data-color-anchor]")?.title).toBe(resolveCategoryRoles("#E44755").main);
    expect(host.querySelector<HTMLButtonElement>("[data-save]")?.disabled).toBe(false);
    host.querySelector<HTMLButtonElement>("[data-save]")!.click();
    expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ catalog: { id: "catalog", expectedRevision: 2 } }));
    handle.dispose();
  });

  it("renders changed clean catalogs but keeps dirty drafts guarded", () => {
    const clean = mount();
    clean.handle.syncCanonical(catalog(2, "Travel updated"));
    expect(nameText(clean.host)).toBe("Travel updated");
    clean.handle.dispose();

    const dirty = mount();
    commitName(dirty.host, "Local edit");
    dirty.handle.syncCanonical(catalog(2, "Remote update"));
    expect(nameText(dirty.host)).toBe("Local edit");
    dirty.handle.dispose();
  });

  it("advances the revision for an unchanged baseline without losing a dirty local draft", () => {
    const { host, handle } = mount();
    commitName(host, "Local edit");

    handle.syncCanonical(structuredClone(catalog(3)));

    expect(nameText(host)).toBe("Local edit");
    host.querySelector<HTMLButtonElement>("[data-save]")!.click();
    expect(client.save).toHaveBeenCalledWith(expect.objectContaining({
      catalog: { id: "catalog", expectedRevision: 3 },
      nodes: [expect.objectContaining({ id: "travel", name: "Local edit" })],
    }));
    handle.dispose();
  });
});
