import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../ai/adapter";
import {
  countCompletedRounds,
  shouldApplyGeneratedTitle,
  shouldAutoRenameTitle,
  titleSummarizePlan,
  uniqueAutoTitle,
} from "../../ai/chat-title";

function u(content: string): ChatMessage {
  return { role: "user", content };
}
function a(content: string): ChatMessage {
  return { role: "assistant", content };
}

describe("title summarize trigger chain", () => {
  it("does not trigger before the assistant of a round finishes", () => {
    expect(
      titleSummarizePlan({
        messages: [u("总结荣耀手机")],
        currentTitle: "新对话",
      }),
    ).toBeNull();
    expect(
      titleSummarizePlan({
        messages: [u("总结荣耀手机"), a("")],
        currentTitle: "新对话",
      }),
    ).toBeNull();
  });

  it("triggers once per completed round 1-3 with full transcript, not latest user only", () => {
    const r1 = [u("总结荣耀手机50"), a("参数如下")];
    const p1 = titleSummarizePlan({ messages: r1, currentTitle: "总结荣耀…" });
    expect(p1?.round).toBe(1);
    expect(p1?.transcript).toBe("用户：总结荣耀手机50\n助手：参数如下");

    const r2pending = [...r1, u("再加上相机"), a("")];
    expect(countCompletedRounds(r2pending)).toBe(1);
    expect(titleSummarizePlan({ messages: r2pending, currentTitle: "荣耀手机50" })).toBeNull();

    const r2 = [...r1, u("再加上相机"), a("主摄很好")];
    const p2 = titleSummarizePlan({ messages: r2, currentTitle: "荣耀手机50" });
    expect(p2?.round).toBe(2);
    expect(p2?.currentTitle).toBe("荣耀手机50");
    expect(p2?.transcript).toContain("用户：总结荣耀手机50");
    expect(p2?.transcript).toContain("助手：参数如下");
    expect(p2?.transcript).toContain("用户：再加上相机");
    expect(p2?.transcript).toContain("助手：主摄很好");

    const r3 = [...r2, u("改成对比小米"), a("对比如下")];
    const p3 = titleSummarizePlan({ messages: r3, currentTitle: "荣耀手机50" });
    expect(p3?.round).toBe(3);
    expect(p3?.transcript.split("\n")).toHaveLength(6);

    const r4 = [...r3, u("第四轮"), a("结束")];
    expect(titleSummarizePlan({ messages: r4, currentTitle: "荣耀对比小米" })).toBeNull();
  });

  it("does not skip rounds 2-3 because a title already exists", () => {
    const messages = [
      u("主题甲"),
      a("答甲"),
      u("改成主题乙"),
      a("答乙"),
    ];
    const plan = titleSummarizePlan({
      titleLocked: false,
      messages,
      currentTitle: "主题甲",
    });
    expect(plan?.round).toBe(2);
    expect(plan?.currentTitle).toBe("主题甲");
    expect(plan?.transcript).toContain("改成主题乙");
  });

  it("stops when the user locked the title", () => {
    expect(
      titleSummarizePlan({
        titleLocked: true,
        messages: [u("a"), a("b"), u("c"), a("d")],
        currentTitle: "手改标题",
      }),
    ).toBeNull();
  });

  it("empty generated content does not apply over an existing title", () => {
    expect(shouldApplyGeneratedTitle("")).toBe(false);
    expect(shouldApplyGeneratedTitle("   ")).toBe(false);
    expect(shouldApplyGeneratedTitle("新对话")).toBe(false);
    expect(shouldApplyGeneratedTitle("荣耀手机50")).toBe(true);
  });

  it("discards stale jobs so an older round cannot overwrite a newer one", () => {
    let currentJob = 0;
    const applied: string[] = [];
    const run = (job: number, title: string) => {
      if (job !== currentJob) return;
      if (!shouldApplyGeneratedTitle(title)) return;
      applied.push(title);
    };
    const job1 = ++currentJob;
    const job2 = ++currentJob;
    run(job1, "第一轮旧结果");
    run(job2, "第二轮新结果");
    expect(applied).toEqual(["第二轮新结果"]);
  });
});

describe("shouldAutoRenameTitle", () => {
  it("allows rounds 1-3 when unlocked", () => {
    expect(shouldAutoRenameTitle(false, 1)).toBe(true);
    expect(shouldAutoRenameTitle(false, 3)).toBe(true);
    expect(shouldAutoRenameTitle(false, 4)).toBe(false);
    expect(shouldAutoRenameTitle(true, 2)).toBe(false);
    expect(shouldAutoRenameTitle(undefined, 2)).toBe(true);
  });
});

describe("automatic title length", () => {
  it("keeps the title and its collision suffix within eight characters", () => {
    expect(uniqueAutoTitle("荣耀手机相机评测比较", [])).toBe("荣耀手机相机评测");
    expect(uniqueAutoTitle("荣耀手机相机评测比较", ["荣耀手机相机评测"])).toBe("荣耀手机相机 2");
    expect(uniqueAutoTitle("荣耀手机相机评测比较", ["荣耀手机相机评测", "荣耀手机相机 2"])).toBe("荣耀手机相机 3");
  });
});
