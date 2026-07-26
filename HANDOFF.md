# 浏览器起始页 — Handoff

## 项目概述

本地浏览器起始页，单文件 HTML 为主。功能：时钟、多搜索引擎切换、日夜主题、一键启动 v2rayN。

**路径：** `d:\file\20260726_Html\`

---

## 文件结构

| 文件 | 作用 |
|------|------|
| `index.html` | 主页面（全部 UI + 逻辑） |
| `start.bat` | **推荐入口**，启动本地服务器并打开页面 |
| `server.ps1` | PowerShell 静态服务器，监听 `127.0.0.1:3721` |
| `setup-v2rayn.reg` | 注册 `v2rayn://` 自定义协议（一次性） |
| `launch-v2rayn.bat` | 备用，直接启动 v2rayN |

已删除/未使用：`bookmarks.js`（书签功能已移除，后续可重做）

---

## 当前功能

### 1. 时钟
- Ubuntu 字体，72px
- 实时更新时分 + 日期

### 2. 搜索引擎（6 个）
- Bing、Google、Scholar、PubMed、GitHub、百度
- 仅 logo，无文字
- 滑动指示器 + 缩放动效
- placeholder 淡入淡出
- 选择记忆在 `localStorage.engine`

### 3. 搜索栏
- 比引擎选项更宽
- 右侧搜索按钮
- 支持关键词搜索 / 直接输入网址

### 4. 日夜主题
- 右上角切换按钮
- 日间：柔和蓝灰渐变（非纯白）
- 夜间：深蓝黑渐变
- 背景双层淡入淡出，全局颜色平滑过渡
- 记忆在 `localStorage.theme`

### 5. v2rayN 一键启动
- 搜索栏右侧独立圆形盾牌按钮
- 协议：`v2rayn://open`
- exe 路径：`D:\programs\v2rayN_7.4.6\v2rayN.exe`

---

## 使用方法

### 日常打开（推荐）
```
双击 start.bat
→ 自动打开 http://127.0.0.1:3721/
```

### 首次使用 v2rayN 按钮前
1. 双击 `setup-v2rayn.reg` → 是 → 确定（本机已导入可跳过）
2. 用 `start.bat` 打开页面（**不要**直接双击 `index.html`）
3. 点盾牌按钮，浏览器弹窗选「允许」

### 设为浏览器主页
- Edge 设置 → 开始、主页、新建标签页 → 主页 → 自定义
- 填：`http://127.0.0.1:3721/`（需先运行 `start.bat`，或开机自启 `start.bat`）

---

## 已知限制

| 问题 | 原因 | 解决 |
|------|------|------|
| 直接打开 `index.html` 点 v2rayN 无反应 | `file://` 被浏览器拦截自定义协议 | 用 `start.bat` |
| v2rayN 路径变了按钮失效 | 写死在 reg 里 | 改 `setup-v2rayn.reg` 后重新导入 |
| `start.bat` 关掉后页面失效 | 依赖本地服务器 | 保持 `start.bat` 运行，或做开机自启 |
| Google 字体需联网 | 引用了 Google Fonts CDN | 离线可改成本地字体 |

---

## 技术要点

- **纯前端**：无后端，无构建
- **主题**：CSS 变量 + `[data-theme="dark"]`
- **动效**：`cubic-bezier` 缓动 + 引擎滑动指示器
- **图标**：全部内嵌 SVG（避免 favicon 加载失败）
- **v2rayN**：Windows 自定义 URL 协议，兼容未来 Edge 扩展

---

## 未做 / 后续可做

### 优先级高
- [ ] **书签栏**：之前做过一版被删，需重新设计 UI（用户嫌丑、太罗列）
- [ ] **开机自启** `start.bat`：任务计划程序或启动文件夹
- [ ] **Edge 扩展**：`manifest.json` + `chrome_url_overrides.newtab`，现有 HTML 几乎不用改

### 优先级中
- [ ] 桌面悬浮书签栏（需 Electron/Tauri）
- [ ] 更多搜索引擎（Semantic Scholar、arXiv 等）
- [ ] v2rayN 按钮换官方 logo

### 优先级低
- [ ] 壁纸 / 天气
- [ ] 书签拖拽排序、搜索过滤
- [ ] 离线字体

---

## 改代码速查

| 要改什么 | 改哪里 |
|----------|--------|
| 加搜索引擎 | `index.html` → `ENGINES` 数组 |
| 改 v2rayN 路径 | `setup-v2rayn.reg` + `launch-v2rayn.bat` |
| 改端口 | `server.ps1` 的 `$port = 3721` |
| 改主题色 | `:root` 和 `[data-theme="dark"]` 的 CSS 变量 |
| 改时钟字体大小 | `.time { font-size: 72px }` |

---

## Edge 扩展迁移（预留）

```json
{
  "manifest_version": 3,
  "name": "我的起始页",
  "version": "1.0",
  "chrome_url_overrides": {
    "newtab": "index.html"
  }
}
```

- `index.html` 可直接复用
- `v2rayn://` 按钮不用改
- `start.bat` / `server.ps1` 扩展版不需要
- 需补 16/48/128px 图标

---

## 对话中用户偏好（设计方向）

- 风格：苹果 / Telegram，简约现代
- 颜色：蓝白系，日间不要纯白（刺眼）
- 字体：时钟用 Ubuntu，适中大小
- 搜索：logo 无文字，搜索栏比选项宽
- 不喜欢：密密麻麻的书签列表、丑的 UI
