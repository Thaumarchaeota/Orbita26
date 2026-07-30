# Orbita Roadmap

> **状态**：**v0.0.12 已收官**（穿透、白屏修复、字体）；**v0.0.13** 候选：实用小组件 + 拖拽简化。  
> **约束**：书签/应用根网格仍 §17.11；本地树 §17.13。  
> **参考**：`HANDOFF.md` §23（v0.0.12）、§24（v0.0.13+）。

## 更新日志

| 版本 | 日期 | 摘要 |
| ---- | ---- | ---- |
| **0.0.12** | 2026-07-30 | **收官**：透明主题点击穿透；休眠 WebView `repair_window`；设置内 7 slot 字体预设 |
| **0.0.11** | 2026-07-29 | Everything 搜索、Shell 图标、工具栏；性能优化（§22.15） |
| **0.0.10** | 2026-07-28 | 监控条、滴答任务、本地行内编辑 |
| **0.0.9** | 2026-07-28 | topGrid/dockLeftGrid、Tile 六键、favicon、Obsidian 笔记 tab |
| **0.0.8** | 2026-07-27 | 本地文件树收官；书签/应用/浮层可交付 |
| **0.0.7** | 2026-07-27 | 数据架构重构（旧 `roadmap.md` Phase 0–6，已落地） |

---

## 1. 背景：我们讨论过什么

### 1.1 代码审计（2026-07-29）

**架构合理（勿动）**

- `core/data/client.ts` 统一读写 + web fallback
- `launcher-grid` / `launcher-store` 书签/应用已泛型合并（§17.17）
- `tile-grid` + `grid-slots` + `folder-overlay` 组合
- `list-tree-drag` 与 `tile-grid` **分文件**（交互模型不同，§17.16.5）

**冗余 / 技术债**

| 级别 | 项 | 说明 |
| ---- | -- | ---- |
| 高 | `theme-*.css` 巨石 | 已拆 4 文件，四主题仍重复块多 |
| 高 | TS ↔ Rust 双份 schema | `client.ts` + `data.rs` |
| 中 | `registry.ts` 非真插件 | AI/TickTick 依赖 shell DOM |
| 低 | `normalizeUrl` | 已统一到 `core/url.ts` |
| 低 | `core/data/index.ts` barrel | 已删 |

**已做性能优化（保留）**

- AI 流式：只更新最后一条 bubble
- 本地树图标：路径 key 缓存，跳过重复 IPC
- 滴答任务列表：增量 `syncTaskRows`
- `isTauri()` 统一
- `file_type_icon` 会话缓存
- FPS：`document.hidden` 时停 rAF

### 1.2 拖拽「不跟手」用户反馈（2026-07-29 晚）

现象：

- 书签/应用、本地树拖拽均不跟手
- 挤开动画消失
- 排序失效

---

## 2. 书签/应用根网格：原定逻辑（§17.11，用户验收过）

> **平时只做排序**；只有指针进目标 tile **中心区** 才 into folder / merge 建夹。

### 2.1 默认手势：排序

| 步骤 | 行为 |
| ---- | ---- |
| 拖动中 | body ghost 跟手；源 tile `visibility:hidden` 占位 |
| 划过其它格 | **实时 `insertBefore` + FLIP 挤开**（预览即最终序） |
| 松手 | `orderFromDom` → `setItems`；无改动则 `paint()` 还原 |

固定槽位根网格：`slotFromPoint` / `previewMoveToSlot`，语义相同。

### 2.2 例外手势（仅根网格，且传入 `onMoveToFolder` / `onMerge`）

| 手势 | 条件 | 松手 / 触发 |
| ---- | ---- | ----------- |
| **into 文件夹** | 目标是 folder，指针在 tile **38%–62%** 中心区 | `onMoveToFolder`；**不打开浮层** |
| **merge 建夹** | 目标是 link/app，两图标中心区重叠 | `onMerge` |
| **拖出浮层** | 浮层内子项指针 **越出 panel** | 立刻 `onMoveOut` + `close()`（不等松手） |

### 2.3 参数（§17.11.4）

```ts
DRAG_THRESHOLD = 6        // 当前共享 pointer-drag 为 4，可改回 6
ABSORB_DWELL_MS = 200     // 仅控制 is-drop-into/merge 高亮，不卡 commit
ZONE_IN = 0.38            // 进入中心区
ZONE_OUT = 0.33           // 迟滞退出
FLIP_MS = 0.28 ~ 0.36
```

### 2.4 松手优先级

`onMoveOut`（拖出）> 中心区 into/merge > **排序 commit**

### 2.5 与点击的区别

- **点击** folder → 打开毛玻璃浮层
- **拖入中心区松手** → 数据进 folder，**不展开浮层**（预期行为 C1）

### 2.6 浮层内子网格

- **无** `gridCapacity` → 稠密列表 + 末尾 `+`
- 仍用同一 `bindTileGrid`，排序逻辑为 `previewMoveTo`（非固定槽位）
- 拖出见 §2.2

---

## 3. 本地文件树：原定逻辑（§17.13）

与书签网格 **不应合并**。

| 阶段 | 行为 |
| ---- | ---- |
| 拖动中 | **不改 DOM**；body ghost + 指示线（before / after-slot / into） |
| 松手 | `moveLocalNode` → `saveLocalFiles` → `paint()` |

参数：`DRAG_THRESHOLD=5`、`INTO_DWELL_MS=320`、`ZONE_BEFORE/AFTER=0.28/0.72`。

§17.13.3 问题 4 已修：ghost 首帧同步指针 + `will-change`。

---

## 4. §22.13 计划 vs §17.11 验收（冲突说明）

HANDOFF §22.13（v0.0.11 未做，留给 v0.0.12）建议：

1. 拖动中只动 ghost + 高亮目标格，松手再 `setItems`（去掉拖动中 FLIP）
2. 轻量 ghost（仅 avatar）
3. `pointermove` rAF + 缓存 layout

**风险**：与 §17.11 用户验收的「拖动中 FLIP 挤开」不一致；若实现不完整会导致排序失效、无动画。

**v0.0.12 决策**：

- **恢复 §17.11 拖动中 DOM+FLIP 排序**（产品逻辑）
- 性能优化只做：ghost 同步跟手、槽位判定 rAF、跳过 `is-drag-source` 的 FLIP、可选轻量 ghost（offset 必须正确）
- **不**在拖动中完全去掉挤开预览

---

## 5. 2026-07-29 改动引入的 Bug（必须修）

### 5.1 排序失效 + 松手无挤开动画（致命）

`finishPointer` 在 commit **之前** 调用 `clearDragTarget()`，清空 `previewTargetSlot` / `previewInsertHover`，导致：

- `commitSlotReorder` / `commitDenseReorder` 永不执行
- 只 `paint()` 还原，不 `setItems`
- `paintWithFlip` 不跑 → 无挤开动画

**修复**：先缓存 `targetSlot` / `insertHover`，commit 后再 clear；或 `clearDragTarget` 移到 commit 之后。

### 5.2 书签 ghost 不跟手（avatar 轻量 ghost）

`createAvatarGhost` 把 ghost 放在 avatar rect，但 `ghostOffsetX/Y` 仍按 **整颗 tile** 计算 → 相对鼠标偏移。

**修复**：offset 用 avatar/main 的 `getBoundingClientRect()`；或恢复整 tile `cloneNode`（§22.12 已验证）。

### 5.3 本地树 ghost 延迟

`list-tree-drag` 把 `movePointerGhost` 放进 rAF，与 hit-test 捆绑 → 高刷指针下钝。

**修复**：ghost **同步** `pointermove`；仅 `rowAtPoint` / `markDrop` 进 rAF。

### 5.4 共享层（保留 + 补强）

`pointer-drag.ts` 已统一 `position:fixed` + `will-change`；`flipElements` 跳过 `is-drag-source` — 保留。

---

## 6. v0.0.12 任务清单

### P0 — 功能回归（必须先做）

- [ ] `tile-grid.ts`：修 `finishPointer` clear 顺序，恢复 `setItems` + `paintWithFlip`
- [ ] `tile-grid.ts`：恢复 `previewMoveToSlot` / `previewMoveTo`（`insertBefore` + `flipAnimate`）
- [ ] 删除或旁路「仅高亮不换位」的 `setDragTargetSlot` / `commitSlotReorder` 错误路径
- [ ] ghost offset：整 tile ghost 或 avatar 对齐 offset
- [ ] `list-tree-drag.ts`：ghost 同步，hit-test rAF

### P1 — 手感与性能（在 P0 通过后）

- [ ] 槽位判定保留 `initDragSlotCtx` + `schedulePointerMove` rAF（不包 ghost）
- [ ] `DRAG_THRESHOLD` 书签 6、本地 5（与 HANDOFF 一致）
- [ ] CSS：`.local-tree-row.is-drag-source` 仅 `visibility:hidden`（已改，保持）

### P2 — 技术债（非阻塞）

- [ ] HANDOFF §22.14：`es.exe` 路径进设置、`addParentId`、删 lhm 残留
- [ ] `theme.css` 模块继续瘦身
- [ ] 浮层内拖拽实机回归（ghost 在 body，§1917）

---

## 7. 回归手测（§17.11.6 + §17.13）

### 书签/应用根网格

1. 满 2 行以上快速跨格排序：有 FLIP 挤开，ghost 跟手，松手顺序正确
2. 拖 link 到 folder **正中心**松手 → into，**不**打开浮层
3. 两 link 中心重叠松手 → 新建 folder
4. 拖过 folder **边缘** → 只排序，不入夹
5. 排序/归入后单击不误开链接/应用
6. 浮层内拖子项排序 → ghost 全程可见
7. 拖子项越出 panel → 落根网格并关浮层

### 本地文件树

1. ghost 跟手，无半透明双影
2. 叶子 before/after、group into（≥320ms 指示）、after-slot
3. 松手后顺序正确；拖动松手不误 `openLocalPath`
4. 嵌套 2 层 group 回归

---

## 8. 关键文件索引

| 文件 | 职责 |
| ---- | ---- |
| `orbita/src/integrations/shell/tile-grid.ts` | 书签/应用/浮层子网格拖拽 |
| `orbita/src/integrations/shell/list-tree-drag.ts` | 本地文件树拖拽 |
| `orbita/src/ui/pointer-drag.ts` | ghost / FLIP 共享 primitive |
| `orbita/src/ui/theme-launcher-local.css` | `.launcher-tile-ghost`、`.local-tree-row-ghost` |
| `orbita/src/integrations/shell/launcher-grid.ts` | 根网格 `onMoveToFolder` / `onMerge` 注入 |
| `orbita/src/integrations/shell/folder-overlay.ts` | 浮层 `onMoveOut` |
| `HANDOFF.md` §17.11、§17.13、§22.12、§22.13 | 历史决策与坑 |

---

## 9. 历史：v0.0.7 数据重构（已落地）

Phase 0–6 已完成：`settings.json` 归集、`dataDir`、书签/应用/本地迁 Rust 读写、图标缓存迁 dataDir、web fallback。  
细节见 `HANDOFF.md` §2.0.7 与 git 历史。

---

## 10. v0.0.13+ 实用小组件（讨论中，未开工）

独立 integration + 全局热键 + 全屏 overlay 窗；Rust 冻屏捕获可共用。

| 插件 | 核心 | 估时 |
| ---- | ---- | ---- |
| **多点取色** | 热键 → 冻屏 → 屏幕任意处左键多点采像素 → 色板 → 退出复制 hex；无框选、无自动聚类 | 1–2 天 |
| **框选截屏** | 同冻屏层 → 拖矩形 → 裁切 → 剪贴板/保存 | +1–2 天 |

其它顺延：`书签稠密拖拽`、`es.exe` 设置、`addParentId`。见 `HANDOFF.md` §24。
