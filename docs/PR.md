# 上架到插件市场（awesome-dsh-plugin）

市场（dshmarket）和官方「插件 → 发现」都读同一份列表：
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。

**它的两个 README 是脚本生成的，不要手改。** 投稿 = 往 `data/plugins/` 加**一个 YAML 文件**，
一个插件一个文件，所以 PR 之间不会互相冲突。

## 投稿文件

路径（文件名必须和 url 里的 owner/repo 完全一致）：

```
data/plugins/Serap-H1NA__dafeiyu-wonder-reading-v0.01.yml
```

内容（`fun` 是分类，见下文；`zh` 可省，维护者会补，但写了更好）：

```yaml
url: https://github.com/Serap-H1NA/dafeiyu-wonder-reading-v0.01
name: Serap-H1NA/dafeiyu-wonder-reading-v0.01
category: fun
description:
  en: 'Reads BLACK SOULS II in-game dialogue (line, speaker, map, and whether it came from a bloodstain, corpse or sign) and hands it to the agent only when you press a button — read, look at a screenshot, or write a reading report; ships a floating widget that docks beside the game window.'
  zh: '把《BLACK SOULS II》游戏里读到的对话（台词、说话人、地图、是血迹还是尸体）记下来，按下按钮才交给 agent 阅读、看插图或写阅读报告；附一个吸在游戏窗口旁的悬浮窗。'
icon: https://raw.githubusercontent.com/Serap-H1NA/dafeiyu-wonder-reading-v0.01/HEAD/docs/preview.png
```

> 描述里如果出现**英文冒号加空格**（`: `），整行必须加引号，否则 YAML 解析失败。

同目录下还有一份可直接复制的 [`awesome-entry.yml`](awesome-entry.yml)。

## 分类怎么选

市场里的「标签」就是 `category`，取值是固定的这一组：

```
agi  ui  usage  theme  model  identity  session  memory  tools  wsl
browser  vision  voice  docs  skill  workflow  git  notify  dev
security  remote  market  fun
```

- `fun` = 娱乐 —— **本插件选它**：这是个为玩游戏做的插件，定位清楚、同类竞争少。
- `session`（会话与消息）、`tools`（工具与能力）也说得通，但选一个就够。
- 分类选得不够准**不会被拒**，维护者会直接帮你改；CI 只校验格式和 manifest。

## 收录要求

1. `package.json` 里必须声明 **`dsh.bundle`**（本仓库有；只写 `dsh.client` 的会被拒）；
2. `url` 必须和仓库地址完全一致（**改过仓库名的话，以新名字为准**）；
3. CI 会检查仓库年龄、格式、README 能否重新生成——通过只是前置条件，合并前维护者会实际读一遍仓库。

## 上架之后（可选但有用）

1. 仓库 **About → Topics**：`dsh-plugin` `deepseek-harness` `black-souls-2` `dialogue-logger` `tkinter`
2. 仓库 **About → Description** 用上面那句英文，方便搜索；
3. 打一个 Release（如 `v2.0.0`），市场和更新检查更容易识别版本。
