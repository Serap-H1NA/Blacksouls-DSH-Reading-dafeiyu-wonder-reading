# 大肥鱼的不思议阅读

给《BLACK SOULS II》做的一个 **DSH 插件**：把游戏里的对话记下来（台词 + 说话人 + 地图 + 来源），
在你按下按钮的那一刻才交给 AI 阅读、看插图、写阅读报告。带一个左侧栏面板，和一个吸在游戏窗口旁边的悬浮窗。

![悬浮窗](docs/preview.png)

> **免责声明**：这是非官方插件，与《BLACK SOULS II》及其原作者没有任何关系。
> 本仓库**不包含任何游戏资源**（脚本、图像、音频、文本都没有），只读取玩家本机上已有的游戏数据。

---

## 一、开始之前：你需要什么

| 需要 | 说明 |
| --- | --- |
| **DSH**（DeepSeek Harness） | 本插件是一段 Cordis 插件，装进 DSH 的 `bundles/` 目录里用 |
| **《BLACK SOULS II》** | 你自己合法拥有的那份（Windows 版） |
| **`black-souls-mcp`** | 把游戏状态读成 JSON 的桥接器，本插件读的就是它写出的文件 |
| **桥接器的两处补丁** | 上游没有「说话人」和「F9 触发」，仓库里带了脚本一键补 |
| **Python 3 + Pillow** | 只有悬浮窗需要；没装 Pillow 时悬浮窗起不来，面板功能不受影响 |

缺了桥接器或补丁，插件照样能装，但会一直显示「○ 等待游戏…」，什么也记不到。

## 二、注意事项（先看这几条）

1. **只有按按钮才花 token**。记录、写文件、贴悬浮窗都是本机行为；把内容交给 AI 的那一步永远由你触发（面板三个按钮，或游戏里按 F9）。
2. **要改游戏文件**。补丁会改你本机的 `Scripts.rvdata2`（打进去之前会自动备份）。以后校验游戏完整性、升级或重装游戏，改动可能被覆盖或导致校验失败——所以**先备份，别删那个 `.bak`**。
3. **报告要先设目录**。不设 `reportDir` 就按「生成阅读报告」，会提示你去设置，不会乱写文件。
4. **清除历史会先备份**。点「清除阅读历史」不是删掉就完，会先存一份 `dialogue-<时间>.bak.*` 在旁边。
5. **只支持 Windows**。悬浮窗大量用 Win32 API（贴窗口、逐像素透明、鼠标命中），没有跨平台实现。
6. **数据都在本机**。记录写在 `dataDir`，截图写在 `dataDir/shots/`，不上传任何地方。
7. **F9 要重启游戏才生效**。补丁打进的是游戏启动时加载的脚本。

## 三、安装

```bash
# 1. 放进 bundles 目录
cp -r dafeiyu-wonder-reading <DSH 工作区>/bundles/

# 2. 复制配置样板，填上你自己的两个路径
cp cordis.patch.yml.example cordis.patch.yml
```

`cordis.patch.yml` 里至少要改这两项：

| 键 | 说明 |
| --- | --- |
| `gameDir` | 游戏副本目录（里面有 `BridgeRuntime/state/*.json`） |
| `dataDir` | 阅读记录写到哪（会生成 `dialogue.md`、`dialogue.jsonl`、`settings.json`） |

然后在 DSH 的插件管理里启用 `@local/dsh-dafeiyu-wonder-reading`，刷新页面，左侧栏会出现入口。

### 装桥接器补丁

```bash
python scripts/apply_bridge_patch.py <你的 black-souls-mcp>/rgss/BlackSoulsBridge.rb
```

脚本会先备份，再按需补上三段（说话人 / 事件来源 / F9），已有就跳过，可以反复跑。
之后仍然要用上游的 `patch_rvdata2_binary.py` 把脚本打进游戏，**然后重启游戏**。
细节见 [`docs/PATCH.md`](docs/PATCH.md)。

## 四、怎么用

- **记录是免费的**：只要游戏在跑，插件就一直在写记录，不打扰 AI。
- **交给我要你按**：面板上的「阅读文字喵~」「欣赏插图」「生成阅读报告」。
- **游戏里按 F9** = 按「阅读文字」。
- **悬浮窗**：贴在游戏窗口右边，收起后变成一条竖线；拖开就脱离，点面板上的「吸附」回来。

## 五、配置项

全部可在面板设置区调整，也会写进 `dataDir/settings.json`。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `gameDir` | 无 | 游戏副本目录 |
| `dataDir` | `~/Documents/deepseek-harness/default-workspace/阅读记录` | 记录写在哪儿 |
| `reportDir` | 空 | 阅读报告写到哪儿；空则按钮会提示先设置 |
| `autoAnalyze` | `false` | 自动交给 AI（会花 token，默认关） |
| `widgetAutoStart` | `true` | 随 DSH 启动悬浮窗 |
| `dockMode` | `normal` | `strong` = 游戏窗口一动就贴回去 |
| `reportAgentId` | 空 | 阅读报告交给哪个会话；空 = 侧栏最上面那个 |
| `ignoreFleeLines` | `true` | 屏蔽「XXX逃跑了」这类战斗提示 |

## 六、它记下来的东西长什么样

`dialogue.md` 是给人读的，每段一个时间、地点、说话人：

```
- 白之兔诺登：「欢迎回来，大人。」
- 〔血迹〕前方那，当心可爱的家伙。
- [战斗] 敌人逃跑了
```

三种来源分开标：有名字的是说话人、`〔血迹〕/〔尸体〕/〔告示牌〕` 是碰了地上的东西、`[战斗]` 是战斗提示；
其余没有说话人的行才是真正的旁白。

## 七、仓库里有什么

| 路径 | 作用 |
| --- | --- |
| `index.js` | Host 半：轮询游戏状态、封口成段、交给 agent |
| `client.js` | 左侧栏面板 |
| `widget.py` / `painter.py` | 悬浮窗与它的 Pillow 绘制层 |
| `cordis.patch.yml.example` | 配置样板 |
| `scripts/apply_bridge_patch.py` | 一键装桥接器补丁 |
| `scripts/release.mjs` | 生成干净的发布副本（去掉本机路径） |
| `docs/PATCH.md` | 桥接器补丁的说明 |
| `docs/DETAIL.md` | 实现细节 |

## 八、许可

MIT，见 [`LICENSE`](LICENSE)。
