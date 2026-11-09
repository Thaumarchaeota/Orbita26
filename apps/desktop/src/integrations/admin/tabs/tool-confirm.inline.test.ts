import { afterEach, describe, expect, it } from "vitest";
import { openToolConfirm } from "../../ai/tool-confirm";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("inline tool confirmation", () => {
  it("keeps the editable form in the assistant message and returns edited args", async () => {
    const message = document.createElement("div");
    message.className = "insight-chat-msg-assistant";
    document.body.append(message);
    const result = openToolConfirm(message, {
      confirmId: "confirm-1",
      name: "journal_add_event",
      label: "确认记录事件",
      args: { date: "2026-09-29", remark: "原内容" },
    }, { presentation: "inline" });

    await Promise.resolve();
    const card = message.querySelector<HTMLFormElement>(".insight-tool-confirm-card");
    expect(card).not.toBeNull();
    expect(document.querySelector(".dialog-backdrop")).toBeNull();
    const remark = card!.querySelector<HTMLInputElement>('input[name="remark"]')!;
    remark.value = "修改后的内容";
    card!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(await result).toMatchObject({ remark: "修改后的内容" });
    expect(message.textContent).toContain("等待执行结果");
  });

  it("stops a pending confirmation when the chat request is aborted", async () => {
    const message = document.createElement("div");
    document.body.append(message);
    const controller = new AbortController();
    const result = openToolConfirm(message, {
      confirmId: "confirm-2",
      name: "journal_add_event",
      label: "确认记录事件",
      args: {},
    }, { presentation: "inline", signal: controller.signal });

    await Promise.resolve();
    controller.abort();
    expect(await result).toBeNull();
    expect(message.textContent).toContain("未执行");
  });

  it("keeps a Health batch confirmation open for invalid JSON", async () => {
    const message = document.createElement("div");
    document.body.append(message);
    const result = openToolConfirm(message, {
      confirmId: "confirm-3",
      name: "health_apply_ai_batch",
      label: "正在写入餐食",
      args: { addMeal: [] },
    }, { presentation: "inline" });

    await Promise.resolve();
    const card = message.querySelector<HTMLFormElement>(".insight-tool-confirm-card")!;
    expect(card.querySelector(".dialog-title")?.textContent).toBe("确认 Health");
    card.querySelector<HTMLTextAreaElement>('textarea[name="_json"]')!.value = "{";
    card.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(card.querySelector('[data-region="json-error"]')?.textContent).toContain("JSON 格式无效");
    expect(message.querySelector("form")).not.toBeNull();
    message.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(await result).toBeNull();
  });
});
