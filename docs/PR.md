# 投稿到 awesome-dsh-plugin（让市场收录）

市场（dshmarket）和官方的「插件 → 发现」都读同一份精选列表：
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
**上架 = 去那边提一个 PR，在列表里加一条**，站点与市场会自动收录，通常一天内生效。

## 分类（市场里的「标签」）

分类是预设的固定表，一个条目只能选一个主分类：

```
agi  ui  usage  theme  model  identity  session  memory  tools
wsl  browser  vision  voice  fun  notify  security  skill  ...
```

本插件建议：**`session`**（会话与消息）。
理由：它的核心是「把游戏里读到的对话作为消息交给会话」，而不是工具类或视觉类。
（`tools`、`vision` 也是勉强能归的，但只写一个更清楚。）

## 建议的条目行

列表按分类分组，一行一个插件。请照抄同分类邻居那一行的写法，大致是：

```markdown
- [大肥鱼的不思议阅读](https://github.com/Serap-H1NA/dafeiyu-wonder-reading-v0.01) — 记录《BLACK SOULS II》的对话（台词 + 说话人 + 地图 + 来源），按下按钮才交给 agent 阅读、看插图、写阅读报告；附一个吸在游戏窗口旁的悬浮窗。需要 black-souls-mcp 桥接器。
```

## 安装命令（给别人看）

```bash
dsh plugin --profile web add github:Serap-H1NA/dafeiyu-wonder-reading-v0.01
```

## PR 标题

```
Add 大肥鱼的不思议阅读 — BLACK SOULS II dialogue reader plugin
```

## PR 正文（可直接粘贴）

```markdown
Adds **大肥鱼的不思议阅读 (Dafeiyu's Wonder Reading)** to the list under `session`.

It is a DSH plugin for *BLACK SOULS II*: it logs the dialogue you read in game —
the line, who said it, the map, and whether it came from a bloodstain / corpse /
sign — and hands it to the agent only when you press a button (read the text,
look at a screenshot, or write a reading report). A small Python floating widget
docks beside the game window.

- Repo: https://github.com/Serap-H1NA/dafeiyu-wonder-reading-v0.01
- Install: `dsh plugin --profile web add github:Serap-H1NA/dafeiyu-wonder-reading-v0.01`
- License: MIT
- Screenshot: https://raw.githubusercontent.com/Serap-H1NA/dafeiyu-wonder-reading-v0.01/HEAD/docs/preview.png
- Icon: https://raw.githubusercontent.com/Serap-H1NA/dafeiyu-wonder-reading-v0.01/HEAD/icon.svg
- Notes: contains no game assets; it reads files written by the
  [`black-souls-mcp`](https://github.com/yk4464/black-souls-mcp) bridge (MIT).
  Windows only (the widget uses Win32 APIs); the sidebar panel works without it.
```

## 上架之后（可选但推荐）

1. 仓库 **About → Topics** 填：`dsh-plugin` `deepseek-harness` `black-souls-2` `dialogue-logger` `tkinter`
2. 仓库 **About → Description** 用一句和上面条目一致的话，方便别人搜到
3. 打一个 Release（例如 `v2.0.0`），市场和更新检查会更容易认出「有新版本」
