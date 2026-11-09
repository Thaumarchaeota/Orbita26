import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInlineTextField } from "./inline-text-field";

describe("mountInlineTextField", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => { vi.useRealTimers(); });

  function beginDrag(display: HTMLElement) {
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1 });
    Object.defineProperty(down, "pointerType", { value: "mouse" });
    display.dispatchEvent(down);
    return down;
  }

  it("hands a first drag's selection to the editor before a host capture click", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const hostDown = vi.fn();
    const hostClick = vi.fn();
    host.addEventListener("pointerdown", hostDown);
    host.addEventListener("click", hostClick, true);
    const onCommit = vi.fn();
    const field = mountInlineTextField({ container: host, value: "直接拖选文字", onCommit });
    const display = host.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    expect(beginDrag(display).defaultPrevented).toBe(false);
    expect(hostDown).not.toHaveBeenCalled();
    document.getSelection()!.setBaseAndExtent(display.firstChild!, 1, display.firstChild!, 4);
    display.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 45, clientY: 8 }));
    display.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 45, clientY: 8 }));
    vi.runAllTimers();
    const input = host.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([1, 4, "forward"]);
    expect(hostClick).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    field.dispose();
  });

  it("keeps a backward selection when released outside the display without a click", () => {
    vi.useFakeTimers();
    const before = document.createTextNode("前面的文字");
    document.body.append(before);
    const field = mountInlineTextField({ container: document.body, value: "直接拖选文字", onCommit: vi.fn() });
    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    beginDrag(display);
    document.getSelection()!.setBaseAndExtent(display.firstChild!, 4, before, 0);
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    vi.runAllTimers();
    const input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([0, 4, "backward"]);
    field.dispose();
  });

  it("cancels pending selection handoff on value refresh, read-only and disposal", () => {
    vi.useFakeTimers();
    for (const action of ["refresh", "readonly", "dispose"] as const) {
      const onCommit = vi.fn();
      const field = mountInlineTextField({ container: document.body, value: "直接拖选文字", onCommit });
      const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
      beginDrag(display);
      document.getSelection()!.setBaseAndExtent(display.firstChild!, 1, display.firstChild!, 4);
      display.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      if (action === "refresh") field.setValue("刷新后的文字");
      if (action === "readonly") field.setReadOnly(true);
      if (action === "dispose") field.dispose();
      vi.runAllTimers();
      expect(document.querySelector(".orbita-inline-text-field__input")).toBeNull();
      expect(onCommit).not.toHaveBeenCalled();
      field.dispose();
    }
  });

  it("does not swallow an unrelated click after releasing a selection", () => {
    vi.useFakeTimers();
    const field = mountInlineTextField({ container: document.body, value: "直接拖选文字", onCommit: vi.fn() });
    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    beginDrag(display);
    document.getSelection()!.setBaseAndExtent(display.firstChild!, 1, display.firstChild!, 4);
    display.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 40, clientY: 8 }));
    vi.runAllTimers();
    const other = document.createElement("button");
    document.body.append(other);
    const onClick = vi.fn();
    other.addEventListener("click", onClick);
    other.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 40, clientY: 8 }));
    expect(onClick).toHaveBeenCalledOnce();
    field.dispose();
  });

  it("keeps display and input placeholders out of the committed value", () => {
    const onCommit = vi.fn();
    const field = mountInlineTextField({
      container: document.body,
      value: "",
      placeholder: "未命名",
      inputPlaceholder: "输入标题",
      onCommit,
    });

    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    expect(display.textContent).toBe("未命名");
    display.click();

    const input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    expect(input.placeholder).toBe("输入标题");
    expect(input.value).toBe("");
    input.value = "新标题";
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("新标题");
    field.dispose();
  });

  it("keeps an accessible field name in display and edit states", () => {
    const field = mountInlineTextField({ container: document.body, value: "15", ariaLabel: "热量", onCommit: vi.fn() });
    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    expect(display.getAttribute("aria-label")).toBe("热量：15");
    display.click();
    expect(document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!.getAttribute("aria-label")).toBe("热量");
    field.dispose();
  });

  it("uses the display placeholder for input when no input placeholder is given", () => {
    mountInlineTextField({
      container: document.body,
      value: "",
      placeholder: "未命名",
      onCommit: vi.fn(),
    });

    document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    expect(document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!.placeholder).toBe("未命名");
  });

  it("applies the configured maximum length to the editor", () => {
    mountInlineTextField({ container: document.body, value: "", maxLength: 12, onCommit: vi.fn() });
    document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    expect(document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!.maxLength).toBe(12);
  });

  it("places pointer edits at the browser-reported text caret and clamps to the value", () => {
    const field = mountInlineTextField({ container: document.body, value: "文字标题", onCommit: vi.fn() });
    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    const text = display.firstChild!;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: text, offset: 2 }),
    });

    display.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 30, clientY: 4 }));

    const input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
    field.dispose();
    delete (document as Document & { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
  });

  it("uses the legacy caret range API, while keyboard activation starts at the end", () => {
    const field = mountInlineTextField({ container: document.body, value: "文字标题", onCommit: vi.fn() });
    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    const text = display.firstChild!;
    Object.defineProperty(document, "caretPositionFromPoint", { configurable: true, value: undefined });
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => ({ startContainer: text, startOffset: 1 }),
    });

    display.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 20, clientY: 4 }));
    let input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    expect(input.selectionStart).toBe(1);
    field.dispose();

    document.body.replaceChildren();
    const keyboardField = mountInlineTextField({ container: document.body, value: "文字标题", onCommit: vi.fn() });
    document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    expect(input.selectionStart).toBe(input.value.length);
    keyboardField.dispose();
    delete (document as Document & { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
    delete (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
  });

  it("does not show an actionable placeholder for an empty read-only value", () => {
    const field = mountInlineTextField({
      container: document.body,
      value: "",
      placeholder: "未命名",
      readOnly: true,
      onCommit: vi.fn(),
    });

    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    expect(display.disabled).toBe(true);
    expect(display.textContent).toBe("");
    display.click();
    expect(document.querySelector(".orbita-inline-text-field__input")).toBeNull();
    field.dispose();
  });

  it("cancels with Escape and commits on focus loss", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const field = mountInlineTextField({
      container: document.body,
      value: "原值",
      onCommit,
      onCancel,
    });
    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;

    display.click();
    const firstInput = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    firstInput.value = "取消值";
    firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.querySelector(".orbita-inline-text-field__display")?.textContent).toBe("原值");

    const focusTarget = document.createElement("button");
    document.body.append(focusTarget);
    document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    const secondInput = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    secondInput.value = "提交值";
    focusTarget.focus();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("提交值");
    expect(document.activeElement).toBe(focusTarget);
    field.dispose();
  });

  it("does not commit when removing a canceled input synchronously emits focusout", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const field = mountInlineTextField({
      container: document.body,
      value: "原值",
      onCommit,
      onCancel,
    });
    document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    const input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    input.value = "取消值";
    vi.spyOn(input, "remove").mockImplementation(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      HTMLElement.prototype.remove.call(input);
    });

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.querySelector(".orbita-inline-text-field__display")?.textContent).toBe("原值");
    field.dispose();
  });

  it("commits once on Enter and returns focus to display", () => {
    const onCommit = vi.fn();
    const field = mountInlineTextField({
      container: document.body,
      value: "原值",
      onCommit,
    });
    document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    const input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    input.value = "新值";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const display = document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!;
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("新值");
    expect(document.activeElement).toBe(display);
    field.dispose();
  });

  it("leaves Enter and Escape to an active IME composition", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const field = mountInlineTextField({
      container: document.body,
      value: "原值",
      onCommit,
      onCancel,
    });
    document.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    const input = document.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    input.value = "组合中的文字";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
    const legacyEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    Object.defineProperty(legacyEnter, "keyCode", { value: 229 });
    input.dispatchEvent(legacyEnter);
    const legacyEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    Object.defineProperty(legacyEscape, "keyCode", { value: 229 });
    input.dispatchEvent(legacyEscape);

    expect(document.querySelector(".orbita-inline-text-field__input")).toBe(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    field.dispose();
  });
});
