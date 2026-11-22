# 桥接器补丁（可选，但说话人和 F9 需要它）

本插件读的是 [`black-souls-mcp`](https://github.com/yk4464/black-souls-mcp)（MIT）注入到游戏里的
`BlackSoulsBridge.rb` 写出的 JSON。上游版本**没有**说话人，也没有 F9 触发，
所以这里记录需要补的三段。补丁很小，只改 `rgss/BlackSoulsBridge.rb` 一个文件。

> ⚠️ 不要分发打过补丁的 `Scripts.rvdata2`，也不要分发完整的桥接器脚本——
> 那是别人的仓库。这里只给出要加进去的代码。

## 一键装补丁

```bash
python scripts/apply_bridge_patch.py <你的 black-souls-mcp>/rgss/BlackSoulsBridge.rb
```

脚本会先备份原文件，然后按下面的三段补齐缺少的部分；已经存在的会跳过，可以反复运行。

## 1. 读出说话人

游戏的姓名窗口存在消息窗口的 `@name_windows` 里（key 就是名字）。加到 `self.` 方法区：

```ruby
  # 話者名：メッセージウィンドウの @name_windows から、表示中のものを拾う。
  def self.speaker_summary
    scene = defined?(SceneManager) ? SceneManager.scene : nil
    return nil unless scene
    window = safe_instance_variable(scene, :@message_window, nil)
    return nil unless window
    windows = safe_instance_variable(window, :@name_windows, nil)
    return nil unless windows.is_a?(Hash)
    windows.each_key do |name|
      entry = windows[name]
      next unless safe_call(entry, :visible, false) == true
      next unless safe_call(entry, :openness, 0).to_i > 0
      text = name.to_s
      return text unless text.empty?
    end
    nil
  rescue
    nil
  end
```

## 2. 记下「这次对话是哪个事件触发的」

用来区分旁白 / 血迹 / 尸体（插件按事件的图形名判断）。

```ruby
  def self.message_event_summary
    return nil unless defined?($game_map) && $game_map
    interpreter = safe_call($game_map, :interpreter, nil)
    return nil unless interpreter
    event_id = safe_call(interpreter, :event_id, 0).to_i
    return nil if event_id <= 0
    events = safe_call($game_map, :events, {})
    return nil unless events.is_a?(Hash)
    event = events[event_id]
    return nil unless event
    data = safe_instance_variable(event, :@event, nil)
    name = data ? safe_call(data, :name, '').to_s : ''
    { "id" => event_id, "name" => name }
  rescue
    nil
  end
```

然后让 `message_summary` 带上它们——在上游的哈希里加两行：

```ruby
      "speaker" => speaker_summary,
      "event"   => message_event_summary,
```

## 3. 游戏内 F9 = 「阅读文字」

写一个令牌文件，插件轮询到就等于按了面板上的按钮。

```ruby
  def self.poll_send_hotkey
    return unless defined?(Input) && Input.respond_to?(:trigger?)
    return unless Input.trigger?(:F9)
    path = ROOT + "/send.token"
    return if File.exist?(path)
    File.open(path, "wb") { |file| file.write("send\n") }
  rescue
  end
```

并在每帧调用的 `self.update` 里加一行：

```ruby
    poll_send_hotkey
```

## 打进去

上游自带 `scripts/patch_rvdata2_binary.py`（逐字节替换 `Main` 脚本），按它的说明把
`BlackSoulsBridge.rb` 打进游戏的 `Scripts.rvdata2` 即可；改完需要**重启游戏**才生效。

## 验证

重启游戏后，在地图上和 NPC 说一句，看 `<gameDir>/BridgeRuntime/state/state-*.json`：

- `message.speaker` 是名字 → 说话人补丁生效；
- `message.event.name` 形如 `EV068` → 事件补丁生效；
- 游戏里按 F9，`BridgeRuntime/send.token` 出现 → 热键补丁生效。
