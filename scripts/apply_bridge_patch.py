"""把本插件需要的三段桥接器补丁装进 BlackSoulsBridge.rb。

用法：
    python scripts/apply_bridge_patch.py <BlackSoulsBridge.rb 的路径>

它会：
  1. 先备份原文件（同名 .bak-<时间戳>）；
  2. 缺哪个函数就补哪个（已有的不会重复插入，可以反复跑）；
  3. 在 message_summary 的哈希里补 speaker / event 两个键；
  4. 在每帧的 update 里补一行 poll_send_hotkey。

脚本只改这一个 .rb 文件。把改好的脚本打进游戏仍然用上游自带的
scripts/patch_rvdata2_binary.py，改完要重启游戏。
"""

from __future__ import annotations

import datetime
import pathlib
import sys

SPEAKER = '''  # 話者名：メッセージウィンドウの @name_windows から、表示中のものを拾う。
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

'''

EVENT = '''  # メッセージを出しているイベント（助言や死体かどうかを機械的に分けるために使う）。
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

'''

HOTKEY = '''  # ゲーム内 F9 で「読み上げ」を一回押す。
  def self.poll_send_hotkey
    return unless defined?(Input) && Input.respond_to?(:trigger?)
    return unless Input.trigger?(:F9)
    path = ROOT + "/send.token"
    return if File.exist?(path)
    File.open(path, "wb") { |file| file.write("send\\n") }
  rescue
  end

'''


def apply(path: pathlib.Path) -> list[str]:
    text = path.read_text(encoding='utf-8')
    if 'safe_call' not in text or 'def self.message_summary' not in text:
        raise SystemExit('这看起来不是 BlackSoulsBridge.rb（找不到 message_summary / safe_call）')

    changes: list[str] = []
    backup = path.with_suffix(path.suffix + '.bak-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S'))
    backup.write_text(text, encoding='utf-8')

    if 'def self.speaker_summary' not in text:
        text = text.replace('  def self.message_summary', SPEAKER + '  def self.message_summary', 1)
        changes.append('补了 speaker_summary')

    if 'def self.message_event_summary' not in text:
        text = text.replace('  def self.message_summary', EVENT + '  def self.message_summary', 1)
        changes.append('补了 message_event_summary')

    if '"speaker" => speaker_summary' not in text:
        anchor = '      "text" => texts.join("\\n"),'
        if anchor in text:
            text = text.replace(
                anchor,
                anchor + '\n      "speaker" => speaker_summary,\n      "event" => message_event_summary,',
                1,
            )
            changes.append('message_summary 带上 speaker / event')
        else:
            changes.append('⚠️ 没找到 message_summary 的 text 行，speaker/event 需要手动加')

    if 'def self.poll_send_hotkey' not in text:
        anchor = '  def self.update\n    return if @in_update'
        if anchor in text:
            text = text.replace(anchor, HOTKEY + anchor, 1)
            changes.append('补了 poll_send_hotkey')
        else:
            changes.append('⚠️ 没找到实例 update，poll_send_hotkey 需要手动放')

    if 'process_command\n    poll_send_hotkey' not in text and 'poll_send_hotkey\n    write_snapshots' not in text:
        anchor = '    process_command\n'
        if anchor in text:
            text = text.replace(anchor, anchor + '    poll_send_hotkey\n', 1)
            changes.append('update 里加了 poll_send_hotkey')
        else:
            changes.append('⚠️ 没找到 process_command，热键调用需要手动加')

    if changes:
        path.write_text(text, encoding='utf-8')
    print(f'备份：{backup.name}')
    for change in changes or ['（三样都已在，无需改动）']:
        print('· ' + change)
    print()
    print('接下来：用上游的 scripts/patch_rvdata2_binary.py 把脚本打进游戏，然后重启游戏。')
    return changes


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    apply(pathlib.Path(sys.argv[1]))


if __name__ == '__main__':
    main()
