/**
 * 大肥鱼的不思议阅读 — Host half.
 *
 * 游戏里的桥接器（`rgss/BlackSoulsBridge.rb`，已注入副本的 `Data/Scripts.rvdata2`）
 * 每 6 帧把当前状态写成 `<gameDir>/BridgeRuntime/state/state-*.json`，里面有
 * 场景、地图、`$game_message` 的台词，以及 `speaker`（说话人，从游戏的名字窗读出来的）。
 *
 * 这一半做四件事：
 *   1. 轮询快照，把连续的台词折成一段「阅读记录」，写入 dialogue.md / dialogue.jsonl；
 *   2. 有人按「阅读文字」时，用 `agent.followup()` 把记录交给当前会话；
 *   3. 有人按「欣赏插图」时，抓一张游戏窗口的图，和图一起交过去；
 *   4. 有人按「生成阅读报告」时，交给 agent 写成一份报告文件。
 *
 * 它从不按键、不替人做决定；记录免费，交给模型的那一步永远由人按。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** HTTP route the Client panel can read (the floating widget uses files instead). */
export const ROUTE_PREFIX = '/api/dafeiyu-wonder-reading'

/**
 * Bumped whenever the Host half's observable behaviour changes. It travels in
 * `GET /api/…` so a running Host can be asked which module generation it
 * actually loaded — an edited file on disk is not evidence by itself.
 */
export const BUILD = '11'

const PANEL_BLOCKS = 30
const HISTORY_BLOCKS = 200
const MAX_LINE_CHARS = 240
const MAX_MESSAGE_CHARS = 2600
/** The floating widget reads this and writes commands beside it. */
const PANEL_FILE = 'panel.json'
const COMMAND_FILE = 'command.json'
/** The in-game F9 hook writes this; the plugin consumes it. */
const SEND_TOKEN = 'send.token'

/** 地图事件图形 → 阅读时的类别（实测确认，别凭图名猜）。 */
const EVENT_KINDS = {
  '死体・血・サイン#2': '血迹',
  '死体・血・サイン#0': '尸体',
  '死体・血・サイン#1': '告示牌',
}

export const DEFAULTS = {
  gameDir: '',
  dataDir: path.join(os.homedir(), 'Documents', 'deepseek-harness', 'default-workspace', '阅读记录'),
  /** Where a finished reading report is written. Empty = not configured yet. */
  reportDir: '',
  /** '1' or '2' — only used to name report files (BS2-…). Empty = infer from gameDir. */
  gameGeneration: '',
  enabled: true,
  /**
   * Off by default: an automatic hand-over spends a turn (and tokens) for every
   * conversation the player reads. Recording itself is free.
   */
  autoAnalyze: false,
  /** Floating-window docking: normal = stop sticking once dragged; strong = follow the game window. */
  dockMode: 'normal',
  /** 三个按钮（阅读/插图/报告）都交给哪个会话；空 = 侧栏最上面那个。 */
  targetAgentId: '',
  /** 面板用的界面语言（zh / en）；悬浮窗跟着它切词表。 */
  locale: '',
  /** Start the floating companion (widget.py) together with DSH. */
  widgetAutoStart: true,
  pollMs: 250,
  staleMs: 5000,
  idleCloseMs: 2000,
  analysisIdleMs: 5000,
  analysisCooldownSeconds: 90,
  maxAnalysisPerHour: 20,
  requireMapScene: true,
  /** 「XXX 逃跑了」这类战斗提示不是读到的文字，默认不进记录。 */
  ignoreFleeLines: true,
  maxLinesPerBlock: 40,
}

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

/**
 * VX Ace escapes (`\C[6]`, `\N[1]`, `\.`, `\{`) are instructions to the message
 * window, not words. Drop them and normalise the ideographic spaces BS2 uses
 * for indentation, so the stored line reads like the screen does.
 */
export function normalizeText(raw) {
  if (typeof raw !== 'string') return ''
  let text = raw
  text = text.replace(/\\([A-Za-z]+)\[([^\]]*)\]/g, '')
  text = text.replace(/\\[.!|><^{}$\\]/g, '')
  text = text.replace(/[\u3000]/g, ' ')
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim()
}

export function normalizeChoices(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((choice) => (typeof choice === 'string' ? normalizeText(choice) : '')).filter((choice) => choice.length > 0)
}

/** The bridge reports `speaker` as a plain string, or null for narration. */
function normalizeSpeaker(raw) {
  if (typeof raw !== 'string') return ''
  const name = raw.replace(/[\r\n\t]+/g, ' ').trim()
  return name.length > 120 ? name.slice(0, 120) : name
}

function normalizeEventName(raw) {
  if (typeof raw !== 'string') return ''
  const name = raw.replace(/[\r\n\t]+/g, ' ').trim()
  return name.length > 80 ? name.slice(0, 80) : name
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function clockOf(ms, withDate = false) {
  const date = new Date(ms)
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  if (!withDate) return clock
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`
}

function stampOf(ms = Date.now()) {
  const date = new Date(ms)
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`
}

function isRootSession(agent) {
  const header = agent?.session?.header
  if (header === undefined || header === null) return true
  return header.parent === undefined && header.parentSession === undefined
}

function shorten(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(1, limit - 1))}…`
}

// ---------------------------------------------------------------------------
// settings / persistence
// ---------------------------------------------------------------------------

function coerceNumber(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, file)
    return true
  } catch {
    return false
  }
}

/** Last `maxBytes` of a file, decoded as UTF-8, first partial line dropped. */
function readFileTail(file, maxBytes) {
  let handle
  try {
    const stat = fs.statSync(file)
    const start = Math.max(0, stat.size - maxBytes)
    const buffer = Buffer.alloc(stat.size - start)
    handle = fs.openSync(file, 'r')
    fs.readSync(handle, buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1)
  } catch {
    return ''
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle)
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * Grab the game window with PrintWindow and save a PNG. Works even when the
 * window is covered by another one, and returns '' when the game is minimized
 * or not running — the caller turns that into a visible failure.
 */
const CAPTURE_SCRIPT = `
Add-Type -AssemblyName System.Drawing
if (-not ('DfyCapture' -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DfyCapture {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
}
$target = Get-Process | Where-Object { $_.MainWindowTitle -like '*BLACK SOULS*' } | Select-Object -First 1
if (-not $target) { Write-Output 'NO-WINDOW'; exit 0 }
$handle = $target.MainWindowHandle
if ([DfyCapture]::IsIconic($handle)) { Write-Output 'MINIMIZED'; exit 0 }
$rect = New-Object DfyCapture+RECT
[void][DfyCapture]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { Write-Output 'BAD-RECT'; exit 0 }
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
[void][DfyCapture]::PrintWindow($handle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()
$bitmap.Save('__OUT__', [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output 'OK'
`

// ---------------------------------------------------------------------------
// recorder
// ---------------------------------------------------------------------------

export class DialogueRecorder {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.logger = ctx?.logger
    this.settings = this.resolveSettings(config)
    this.dataDir = this.settings.dataDir
    this.transcriptPath = path.join(this.dataDir, 'dialogue.md')
    this.jsonlPath = path.join(this.dataDir, 'dialogue.jsonl')
    this.runtimePath = path.join(this.dataDir, 'runtime.json')
    this.settingsPath = path.join(this.dataDir, 'settings.json')
    this.panelPath = path.join(this.dataDir, PANEL_FILE)
    this.commandPath = path.join(this.dataDir, COMMAND_FILE)
    this.shotsDir = path.join(this.dataDir, 'shots')
    /** 手动事件标注：{"6#15": "告示牌"}，见 loadEventLabels()。 */
    /** 地图事件的图形缓存（地图快照只含附近事件、会轮转，这里把它攒起来）。 */
    this.eventGraphics = {}
    this.eventGraphicsDirty = false
    this.eventLabels = {}
    this.eventLabelsMtime = null

    this.cursor = null
    this.lastFileAt = 0
    this.lastDialogueAt = 0
    this.open = null
    this.pending = []
    this.history = []
    this.sequence = 0
    this.deliveryTimes = []
    this.lastAnalysisAt = 0
    this.analyzed = {}
    this.activity = new Map()
    this.activitySequence = 0
    this.lastSnapshot = null
    this.lastSnapshotAt = 0
    this.lastError = ''
    this.dropped = 0
    this.stopped = false
    this.timer = undefined
    this.stopInbox = undefined
    this.stopCreated = undefined
    this.lastPanelJson = ''
    this.widget = undefined
    /** Set by `apply` once the optional Services are injected. */
    this.getAgents = undefined
    this.getAttachments = undefined
    /** 当前地图的事件表缓存：文件名 / 地图 id / id→事件。 */
    this.mapCache = { file: "", mapId: null, events: new Map() }
  }

  resolveSettings(config) {
    const merged = { ...DEFAULTS }
    for (const [key, value] of Object.entries(config ?? {})) {
      if (value === undefined || value === null) continue
      if (key in merged) merged[key] = value
    }
    merged.gameDir = String(merged.gameDir || DEFAULTS.gameDir)
    merged.dataDir = String(merged.dataDir || DEFAULTS.dataDir)
    merged.reportDir = typeof merged.reportDir === 'string' ? merged.reportDir.trim() : ''
    merged.enabled = merged.enabled !== false
    merged.autoAnalyze = merged.autoAnalyze !== false
    merged.requireMapScene = merged.requireMapScene !== false
    merged.ignoreFleeLines = merged.ignoreFleeLines !== false
    merged.widgetAutoStart = merged.widgetAutoStart !== false
    merged.dockMode = merged.dockMode === 'strong' ? 'strong' : 'normal'
    merged.targetAgentId = String(merged.targetAgentId ?? merged.reportAgentId ?? '').trim()
    merged.locale = merged.locale === 'en' ? 'en' : (merged.locale === 'zh' ? 'zh' : '')
    merged.pollMs = coerceNumber(merged.pollMs, DEFAULTS.pollMs, 100, 5000)
    merged.staleMs = coerceNumber(merged.staleMs, DEFAULTS.staleMs, 1000, 60000)
    merged.idleCloseMs = coerceNumber(merged.idleCloseMs, DEFAULTS.idleCloseMs, 500, 30000)
    merged.analysisIdleMs = coerceNumber(merged.analysisIdleMs, DEFAULTS.analysisIdleMs, 0, 300000)
    merged.analysisCooldownSeconds = coerceNumber(merged.analysisCooldownSeconds, DEFAULTS.analysisCooldownSeconds, 0, 86400)
    merged.maxAnalysisPerHour = coerceNumber(merged.maxAnalysisPerHour, DEFAULTS.maxAnalysisPerHour, 1, 200)
    merged.maxLinesPerBlock = coerceNumber(merged.maxLinesPerBlock, DEFAULTS.maxLinesPerBlock, 1, 500)
    return merged
  }

  // -- lifecycle -----------------------------------------------------------

  start() {
    this.load()
    this.stopInbox = this.subscribeActivity()
    this.timer = setInterval(() => this.tick(), this.settings.pollMs)
    if (typeof this.timer?.unref === 'function') this.timer.unref()
    this.info(`watching ${this.stateDirectory()}`)
    this.startWidget()
  }

  stop() {
    this.stopped = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    try {
      this.stopInbox?.()
    } catch {
      /* listener already gone */
    }
    this.stopInbox = undefined
    try {
      this.stopCreated?.()
    } catch {
      /* listener already gone */
    }
    this.stopCreated = undefined
    this.stopWidget()
  }

  /** The widget writes its pid there, so we can tell whether one is already up. */
  widgetRunning() {
    try {
      const pid = Number(fs.readFileSync(path.join(this.dataDir, 'widget.pid'), 'utf8').trim())
      if (!Number.isFinite(pid) || pid <= 0) return false
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** Launch the floating companion (Windows only, best effort). */
  showWidget(force = false) {
    if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' }
    if (!force && this.widgetRunning()) return { ok: true, already: true }
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'widget.py')
    if (!fs.existsSync(script)) return { ok: false, reason: 'widget-missing' }
    const python = process.env.DAFEIYU_PYTHON || 'pythonw'
    try {
      const child = spawn(python, [script, this.settings.dataDir], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: path.dirname(script),
      })
      child.on('error', (error) => this.warn(`widget not started: ${error.message}`))
      child.unref()
      this.widget = child
      this.info(`widget started (${python} ${path.basename(script)})`)
      return { ok: true }
    } catch (error) {
      this.warn(`widget not started: ${message(error)}`)
      return { ok: false, reason: message(error) }
    }
  }

  startWidget() {
    if (!this.settings.widgetAutoStart) return
    this.showWidget(false)
  }

  stopWidget() {
    const pid = this.widget?.pid
    this.widget = undefined
    if (typeof pid !== 'number' || process.platform !== 'win32') return
    try {
      process.kill(pid)
    } catch {
      /* the widget already exited on its own */
    }
  }

  subscribeActivity() {
    try {
      this.stopCreated = this.ctx?.on?.('agent/created', ({ agent } = {}) => {
        try {
          this.track(agent)
        } catch {
          /* tracking is best effort */
        }
      })
    } catch {
      this.stopCreated = undefined
    }
    try {
      return this.ctx?.on?.('agent/inbox/inserted', (payload = {}) => {
        try {
          const { agent, message } = payload
          if (!agent || message?.source?.kind !== 'user') return
          this.track(agent)
          const entry = this.activity.get(agent.id)
          if (entry !== undefined) {
            entry.spoken = true
            entry.lastSeq = ++this.activitySequence
          }
        } catch {
          /* bookkeeping must never break dispatch */
        }
      })
    } catch {
      return undefined
    }
  }

  track(agent) {
    if (!agent || typeof agent.id !== 'string') return
    const existing = this.activity.get(agent.id)
    if (existing !== undefined && existing.agent === agent) return
    this.activity.set(agent.id, { agent, spoken: false, lastSeq: 0 })
  }

  // -- persistence ---------------------------------------------------------

  load() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true })
    } catch (error) {
      this.warn(`cannot create ${this.dataDir}: ${message(error)}`)
      return
    }
    const overrides = readJsonFile(this.settingsPath, null)
    if (overrides !== null && typeof overrides === 'object') {
      if (typeof overrides.autoAnalyze === 'boolean') this.settings.autoAnalyze = overrides.autoAnalyze
      if (typeof overrides.enabled === 'boolean') this.settings.enabled = overrides.enabled
      if (typeof overrides.reportDir === 'string') this.settings.reportDir = overrides.reportDir.trim()
      if (typeof overrides.widgetAutoStart === 'boolean') this.settings.widgetAutoStart = overrides.widgetAutoStart
      if (overrides.dockMode === 'strong' || overrides.dockMode === 'normal') this.settings.dockMode = overrides.dockMode
      const target = overrides.targetAgentId ?? overrides.reportAgentId
      if (typeof target === 'string') this.settings.targetAgentId = target.trim()
      if (overrides.locale === 'en' || overrides.locale === 'zh') this.settings.locale = overrides.locale
    }
    const runtime = readJsonFile(this.runtimePath, null)
    if (runtime !== null && typeof runtime === 'object') {
      if (typeof runtime.lastAnalysisAt === 'number') this.lastAnalysisAt = runtime.lastAnalysisAt
      if (runtime.analyzed !== null && typeof runtime.analyzed === 'object') this.analyzed = runtime.analyzed
    }
    const tail = readFileTail(this.jsonlPath, 262144)
    for (const line of tail.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let record
      try {
        record = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (!record || typeof record !== 'object' || record.type !== 'block') continue
      const block = this.reviveBlock(record)
      if (block === null) continue
      this.history.push(block)
      if (block.seq > this.sequence) this.sequence = block.seq
    }
    while (this.history.length > HISTORY_BLOCKS) this.history.shift()
  }

  reviveBlock(record) {
    const lines = Array.isArray(record.lines)
      ? record.lines
          .filter((line) => line && typeof line.text === 'string')
          .map((line) => ({
            text: line.text,
            speaker: normalizeSpeaker(line.speaker),
            choices: normalizeChoices(line.choices),
            at: Number(line.at) || 0,
            battle: line.battle === true,
            eventName: normalizeEventName(line.eventName),
            eventKind: normalizeEventName(line.eventKind),
          }))
      : []
    if (lines.length === 0) return null
    // 老记录只存了事件名（EV068），读回来时用当前地图补一下类别。
    for (const line of lines) {
      if (!line.eventName) continue
      const id = Number(String(line.eventName).replace(/\D+/g, ''))
      if (id <= 0) continue
      const kind = this.eventKind(record.mapId ?? null, id)
      // 以当前这张表为准：映射改过之后，旧记录也跟着纠正。
      if (kind) line.eventKind = kind
    }
    const last = lines[lines.length - 1]
    return {
      id: typeof record.id === 'string' ? record.id : randomUUID(),
      seq: Number(record.seq) || 0,
      at: Number(record.at) || 0,
      mapId: record.mapId ?? null,
      mapName: typeof record.mapName === 'string' ? record.mapName : '',
      scene: typeof record.scene === 'string' ? record.scene : '',
      lines,
      lastSpeaker: last.speaker,
      lastText: last.text,
      analyzedAt: Number(record.analyzedAt) || 0,
    }
  }

  saveSettings() {
    writeJsonFile(this.settingsPath, {
      autoAnalyze: this.settings.autoAnalyze,
      enabled: this.settings.enabled,
      reportDir: this.settings.reportDir,
      widgetAutoStart: this.settings.widgetAutoStart,
      dockMode: this.settings.dockMode,
      targetAgentId: this.settings.targetAgentId,
      locale: this.settings.locale,
    })
  }

  saveRuntime() {
    const ids = Object.keys(this.analyzed)
    if (ids.length > 400) {
      for (const id of ids.slice(0, ids.length - 400)) delete this.analyzed[id]
    }
    writeJsonFile(this.runtimePath, {
      lastAnalysisAt: this.lastAnalysisAt,
      analyzed: this.analyzed,
    })
  }

  /** Speakers are named per line; a block header only names one when it is uniform. */
  blockSpeaker(block) {
    const names = new Set(block.lines.map((line) => line.speaker).filter((name) => name.length > 0))
    if (names.size !== 1) return ''
    return [...names][0]
  }

  appendTranscript(block) {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true })
      if (!fs.existsSync(this.transcriptPath)) {
        fs.writeFileSync(
          this.transcriptPath,
          '# 阅读记录 · BLACK SOULS II\n\n'
            + '> 由「大肥鱼的不思议阅读」自动写入；每段阅读一条，按时间顺序追加。\n'
            + '> 每句台词一行，前面是说话人（旁白没有名字）；`> 选项：` 是当时出现的选项。\n',
          'utf8',
        )
      }
      const speaker = this.blockSpeaker(block)
      const header = `\n## #${block.seq} · ${clockOf(block.at, true)} · ${block.mapName || '未知地图'}（map ${block.mapId ?? '?'}）${speaker ? ` · ${speaker}` : ''}\n`
      const body = block.lines
        .map((line) => {
          const choice = line.choices.length > 0 ? `\n  > 选项：${line.choices.join(' / ')}` : ''
          const who = line.speaker.length > 0 ? `${line.speaker}：` : line.battle === true ? '[战斗] ' : line.eventKind ? `〔${line.eventKind}〕` : line.eventName ? `〔事件 ${line.eventName}〕` : ''
          return `- ${who}${line.text.replace(/\n/g, '\n  ')}${choice}`
        })
        .join('\n')
      fs.appendFileSync(this.transcriptPath, `${header}${body}\n`, 'utf8')
      fs.appendFileSync(this.jsonlPath, `${JSON.stringify({ type: 'block', ...block, lastText: undefined, lastSpeaker: undefined, analyzedAt: undefined })}\n`, 'utf8')
      return true
    } catch (error) {
      this.warn(`cannot write transcript: ${message(error)}`)
      return false
    }
  }

  // -- polling -------------------------------------------------------------

  tick() {
    if (this.stopped) return
    try {
      this.poll()
    } catch (error) {
      this.warn(`poll failed: ${message(error)}`)
    }
    try {
      if (this.open !== null && Date.now() - this.lastSnapshotAt > this.settings.idleCloseMs) {
        this.closeBlock('idle')
      }
    } catch (error) {
      this.warn(`idle close failed: ${message(error)}`)
    }
    try {
      this.flush(false)
    } catch (error) {
      this.warn(`flush failed: ${message(error)}`)
    }
    try {
      this.pollSendToken()
    } catch (error) {
      this.warn(`send token failed: ${message(error)}`)
    }
    try {
      this.consumeCommand()
    } catch (error) {
      this.warn(`command failed: ${message(error)}`)
    }
    try {
      this.writePanel()
    } catch (error) {
      this.warn(`panel write failed: ${message(error)}`)
    }
  }

  /** 地图事件的名字都很笼统（EV068），但「图形」能分出 尸体/血迹/告示牌。 */
  mapEventFor(mapId, eventId) {
    const directory = path.join(this.settings.gameDir, 'BridgeRuntime', 'map')
    let names
    try {
      names = fs.readdirSync(directory).filter((name) => name.startsWith('map-') && name.endsWith('.json')).sort()
    } catch {
      return undefined
    }
    if (names.length === 0) return undefined
    const newest = names[names.length - 1]
    if (newest !== this.mapCache.file) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(directory, newest), 'utf8'))
        const events = new Map()
        for (const event of parsed?.events ?? []) {
          const id = Number(event?.id)
          events.set(id, event)
          if (id) {
            const graphic = `${String(event?.character_name ?? '')}#${Number(event?.character_index ?? 0)}`
            const slot = `${Number(parsed?.map_id)}#${id}`
            if (this.eventGraphics[slot] !== graphic) {
              this.eventGraphics[slot] = graphic
              this.eventGraphicsDirty = true
            }
          }
        }
        this.mapCache = { file: newest, mapId: Number(parsed?.map_id), events }
      } catch {
        return undefined
      }
    }
    if (Number(this.mapCache.mapId) !== Number(mapId)) return undefined
    return this.mapCache.events.get(Number(eventId))
  }

  /**
   * 图形 → 类别。BS2 用同一张图放三样东西；编号靠实测确认，不靠猜：
   *   2 = 血迹（用户 2026-11-21 实测两处都是 2 号）
   *   0 = 尸体（同一地图 EV044「………」，暂按尸体处理）
   *   1 = 告示牌（只剩它没验过）
   * 新发现直接改这张表；未列出的编号退回「事件:EVxxx」，不瞎标。
   */
  graphicsCachePath() {
    return path.join(this.settings.dataDir, 'map-events.json')
  }

  loadEventGraphics() {
    if (this.eventGraphicsLoaded) return
    this.eventGraphicsLoaded = true
    try {
      const parsed = JSON.parse(fs.readFileSync(this.graphicsCachePath(), 'utf8'))
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') this.eventGraphics[key] = value
        }
      }
    } catch {
      // 首次运行没有缓存文件，正常
    }
  }

  saveEventGraphics() {
    if (!this.eventGraphicsDirty) return
    this.eventGraphicsDirty = false
    try {
      fs.writeFileSync(this.graphicsCachePath(), JSON.stringify(this.eventGraphics, null, 2), 'utf8')
    } catch {
      // 写不进去不影响记录
    }
  }

  /**
   * 手动标注表：`<dataDir>/event-labels.json`，形如 {"6#15": "告示牌"}。
   * 游戏里有整类事件根本没有图形——告示牌画在地砖上、事件本身是隐形的，
   * 所以从数据上分不出来，只能由人标一次，之后自动套用。
   */
  loadEventLabels() {
    const file = path.join(this.settings.dataDir, 'event-labels.json')
    try {
      const stat = fs.statSync(file)
      if (this.eventLabelsMtime === stat.mtimeMs) return
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const labels = {}
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && value.trim()) labels[key.trim()] = value.trim()
        }
      }
      this.eventLabels = labels
      this.eventLabelsMtime = stat.mtimeMs
    } catch {
      // 不存在或坏掉都当作「没有标注」，不影响记录
    }
  }

  eventKind(mapId, eventId) {
    if (!mapId || !eventId) return ''
    this.loadEventLabels()
    const labelled = this.eventLabels[`${Number(mapId)}#${Number(eventId)}`]
    if (labelled) return labelled
    this.loadEventGraphics()
    const event = this.mapEventFor(mapId, eventId)
    let graphic = ''
    if (event !== undefined) {
      graphic = `${String(event.character_name ?? '')}#${Number(event.character_index ?? 0)}`
    } else {
      graphic = this.eventGraphics[`${Number(mapId)}#${Number(eventId)}`] ?? ''
    }
    this.saveEventGraphics()
    if (!graphic) return ''
    return EVENT_KINDS[graphic] ?? ''
  }

  stateDirectory() {
    return path.join(this.settings.gameDir, 'BridgeRuntime', 'state')
  }

  poll() {
    if (!this.settings.enabled) return
    const directory = this.stateDirectory()
    let names
    try {
      names = fs.readdirSync(directory).filter((name) => name.startsWith('state-') && name.endsWith('.json')).sort()
    } catch {
      this.lastFileAt = 0
      return
    }
    if (names.length === 0) {
      this.lastFileAt = 0
      return
    }
    const newest = names[names.length - 1]
    if (this.cursor !== null && newest < this.cursor) {
      // The newest snapshot sorts BEFORE the cursor: the file the cursor named
      // is gone (rotated away) or was never one of the game's own snapshots.
      // Comparing names blindly would leave this recorder deaf to every later
      // snapshot, so resynchronise on what actually exists.
      this.cursor = null
      this.info(`resynchronised on ${newest}`)
    }
    const fresh = this.cursor === null ? names.slice(-1) : names.filter((name) => name > this.cursor)
    if (fresh.length === 0) return
    this.cursor = fresh[fresh.length - 1]
    this.lastFileAt = Date.now()
    for (const name of fresh) {
      let state
      try {
        state = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
      } catch {
        continue
      }
      this.lastSnapshot = state
      this.lastSnapshotAt = Date.now()
      this.ingest(state)
    }
  }

  ingest(state) {
    const now = Date.now()
    const updatedAt = Number(state?.updated_at) * 1000
    if (!Number.isFinite(updatedAt) || now - updatedAt > this.settings.staleMs) return

    const sceneName = String(state?.scene?.name ?? '')
    const map = state?.map ?? null
    const text = normalizeText(state?.message?.text)
    const speaker = normalizeSpeaker(state?.message?.speaker)
    const choices = normalizeChoices(state?.message?.choices)
    const inBattle = state?.battle?.active === true
    // 「XXX 逃跑了」这类战斗提示不是读到的文字，默认挡掉（配置里可以关）。
    if (inBattle && this.settings.ignoreFleeLines && text.length > 0 && /逃跑|逃走了|逃げ/.test(text)) return

    if (this.settings.requireMapScene && sceneName !== 'Scene_Map') {
      if (this.open !== null) this.closeBlock('scene')
      return
    }
    if (text.length === 0) {
      if (this.open !== null) this.closeBlock('message-cleared')
      return
    }
    const mapId = map?.id ?? null
    if (this.open !== null && (this.open.mapId !== mapId || this.open.scene !== sceneName)) {
      this.closeBlock('map-changed')
    }
    if (this.open === null) {
      this.open = {
        id: randomUUID(),
        seq: this.sequence + 1,
        at: updatedAt,
        mapId,
        mapName: typeof map?.display_name === 'string' ? map.display_name.trim() : '',
        scene: sceneName,
        lines: [],
        lastSpeaker: '',
        lastText: '',
        analyzedAt: 0,
      }
    }
    // The speaker is part of the identity of a line: 甲说「……」和 乙说「……」
    // 是两句话，不能因为文字一样就被吞掉第二句。
    if (speaker === this.open.lastSpeaker && text === this.open.lastText) return
    this.open.lastSpeaker = speaker
    this.open.lastText = text
    const eventName = normalizeEventName(state?.message?.event?.name)
    const eventId = Number(state?.message?.event?.id) || 0
    this.open.lines.push({
      text,
      speaker,
      choices,
      at: updatedAt,
      battle: inBattle,
      eventName,
      eventKind: this.eventKind(mapId, eventId),
    })
    this.lastDialogueAt = now
    if (this.open.lines.length >= this.settings.maxLinesPerBlock) this.closeBlock('block-full')
  }

  closeBlock(reason) {
    const block = this.open
    this.open = null
    this.lastDialogueAt = Date.now()
    if (block === null || block.lines.length === 0) return
    delete block.lastText
    delete block.lastSpeaker
    this.sequence = Math.max(this.sequence, block.seq)
    this.history.push(block)
    while (this.history.length > HISTORY_BLOCKS) this.history.shift()
    this.pending.push(block)
    while (this.pending.length > 40) {
      const dropped = this.pending.shift()
      this.dropped += 1
      if (dropped !== undefined) this.analyzed[dropped.id] = 0
    }
    this.appendTranscript(block)
    this.info(`recorded block #${block.seq} (${block.lines.length} lines, ${reason})`)
  }

  // -- F9 / widget commands ------------------------------------------------

  /** The in-game F9 hook drops this token; consuming it is the send action. */
  pollSendToken() {
    const file = path.join(this.settings.gameDir, 'BridgeRuntime', SEND_TOKEN)
    let exists = false
    try {
      exists = fs.existsSync(file)
    } catch {
      return
    }
    if (!exists) return
    try {
      fs.unlinkSync(file)
    } catch {
      /* another consumer got it first */
    }
    this.info('F9 send requested in game')
    void this.action('send', {}).catch((error) => this.warn(`F9 send failed: ${message(error)}`))
  }

  /** The floating widget writes command.json; nothing else may. */
  consumeCommand() {
    let raw
    try {
      raw = fs.readFileSync(this.commandPath, 'utf8')
    } catch {
      return
    }
    try {
      fs.unlinkSync(this.commandPath)
    } catch {
      /* consumed elsewhere */
    }
    let command
    try {
      command = JSON.parse(raw)
    } catch {
      return
    }
    const action = typeof command?.action === 'string' ? command.action : ''
    if (action.length === 0) return
    this.info(`widget command: ${action}`)
    void this.action(action, command).catch((error) => this.warn(`widget command failed: ${message(error)}`))
  }

  writePanel() {
    const payload = {
      ok: true,
      build: BUILD,
      updatedAt: Date.now(),
      connection: this.connection(),
      counts: {
        pending: this.pending.length,
        unread: this.unreadBlocks().length,
        recorded: this.history.length,
      },
      settings: {
        autoAnalyze: this.settings.autoAnalyze,
        reportDir: this.settings.reportDir,
        dockMode: this.settings.dockMode,
        targetAgentId: this.settings.targetAgentId,
        locale: this.settings.locale,
        lastReport: this.lastReport,
      },
      lastLine: this.lastSpokenLine(),
      lastSpeaker: this.lastSpokenSpeaker(),
      error: this.lastError,
    }
    const signature = JSON.stringify({ ...payload, updatedAt: 0 })
    const now = Date.now()
    // The floating widget treats panel.json as a heartbeat, so it is refreshed
    // even when nothing changed — 2s is cheap for a file this size.
    if (signature === this.lastPanelJson && now - (this.lastPanelWrittenAt ?? 0) < 2000) return
    this.lastPanelJson = signature
    this.lastPanelWrittenAt = now
    payload.updatedAt = now
    writeJsonFile(this.panelPath, payload)
  }

  lastSpokenLine() {
    const block = this.open ?? this.history[this.history.length - 1]
    if (block === undefined || block === null || !Array.isArray(block.lines) || block.lines.length === 0) return ''
    return shorten(block.lines[block.lines.length - 1].text.replace(/\n/g, ' '), 60)
  }

  lastSpokenSpeaker() {
    const block = this.open ?? this.history[this.history.length - 1]
    if (block === undefined || block === null || !Array.isArray(block.lines) || block.lines.length === 0) return ''
    return block.lines[block.lines.length - 1].speaker ?? ''
  }

  // -- analysis ------------------------------------------------------------

  activeAgent() {
    // A Service read through the context throws unless it was injected, so the
    // registry arrives through `ctx.inject(['agents'], …)` in `apply` and this
    // method only ever reads the already-injected handle.
    const service = typeof this.getAgents === 'function' ? this.getAgents() : undefined
    if (service === undefined || service === null || typeof service.list !== 'function') return undefined
    let live
    try {
      live = service.list()
    } catch {
      return undefined
    }
    if (!Array.isArray(live) || live.length === 0) return undefined
    const roots = live.filter((agent) => agent && typeof agent.id === 'string' && isRootSession(agent))
    const pool = roots.length > 0 ? roots : live
    let best
    let bestSeq = -1
    for (const agent of pool) {
      const entry = this.activity.get(agent.id)
      if (entry === undefined || !entry.spoken) continue
      if (entry.lastSeq > bestSeq) {
        bestSeq = entry.lastSeq
        best = agent
      }
    }
    if (best !== undefined) return best
    return pool[pool.length - 1]
  }

  canSpeak(force) {
    const now = Date.now()
    this.deliveryTimes = this.deliveryTimes.filter((time) => now - time < 3600000)
    // 手动按键永远放行（每次都是一轮、你自己按的）；上限只挡自动分析。
    if (!force && this.deliveryTimes.length >= this.settings.maxAnalysisPerHour) return 'hourly-limit'
    if (force) return undefined
    if (!this.settings.autoAnalyze) return 'auto-off'
    if (now - this.lastDialogueAt < this.settings.analysisIdleMs) return 'waiting'
    if (now - this.lastAnalysisAt < this.settings.analysisCooldownSeconds * 1000) return 'cooldown'
    return undefined
  }

  /** Queue everything nobody has read yet, so a manual ask is never empty-handed. */
  queueUnread() {
    if (this.pending.length > 0) return
    for (const block of this.unreadBlocks().slice(-6)) this.pending.push(block)
  }

  takeUnread() {
    const batch = this.pending.length > 0 ? this.pending.splice(0, this.pending.length) : this.unreadBlocks().slice(-6)
    return batch
  }

  markDelivered(batch, now) {
    for (const block of batch) {
      block.analyzedAt = now
      this.analyzed[block.id] = now
    }
    this.lastAnalysisAt = now
    this.deliveryTimes.push(now)
    this.saveRuntime()
  }

  flush(force, note = '') {
    if (this.stopped) return { delivered: false, reason: 'stopped' }
    if (this.pending.length === 0) return { delivered: false, reason: 'no-pending' }
    const refusal = this.canSpeak(force)
    if (refusal !== undefined) return { delivered: false, reason: refusal }
    const agent = this.targetAgent()
    if (agent === undefined) return { delivered: false, reason: 'no-session' }
    const batch = this.pending.splice(0, this.pending.length)
    const now = Date.now()
    try {
      agent.followup(this.buildMessage(batch, note))
    } catch (error) {
      this.pending.unshift(...batch)
      this.warn(`followup failed: ${message(error)}`)
      return { delivered: false, reason: `followup-failed: ${message(error)}` }
    }
    this.markDelivered(batch, now)
    this.info(`handed ${batch.length} block(s) to agent ${agent.id}`)
    return { delivered: true, blocks: batch.length, agent: agent.id }
  }

  /** Shared line rendering: speaker before the words, choices after them. */
  renderLines(block, lineBudget, budget) {
    const out = []
    const lines = block.lines.slice(0, lineBudget)
    lines.forEach((line, index) => {
      if (budget.left <= 0) return
      const who = line.speaker.length > 0 ? `[${line.speaker}] ` : line.battle === true ? '[战斗] ' : line.eventKind ? `[${line.eventKind}] ` : line.eventName ? `[事件:${line.eventName}] ` : ''
      const choice = line.choices.length > 0 ? `（选项：${line.choices.join(' / ')}）` : ''
      const shownText = shorten(line.text, Math.min(MAX_LINE_CHARS, budget.left))
      budget.left -= shownText.length
      out.push(`  ${index + 1}. ${who}${shownText}${choice}`)
    })
    if (block.lines.length > lines.length) out.push(`  …还有 ${block.lines.length - lines.length} 句`)
    return out
  }

  buildMessage(blocks, note = '') {
    const asked = typeof note === 'string' ? note.trim() : ''
    const shown = blocks.slice(-4)
    const omittedBlocks = blocks.length - shown.length
    const lineCount = blocks.reduce((total, block) => total + block.lines.length, 0)
    const first = blocks[0]
    const last = blocks[blocks.length - 1]
    const head = `【BLACK SOULS II · 阅读记录】${blocks.length} 段、共 ${lineCount} 句`
    const where = `地点：${last.mapName || '未知地图'}（map ${last.mapId ?? '?'}）· 时间：${clockOf(first.at)}–${clockOf(last.at)}`
    const body = []
    if (omittedBlocks > 0) body.push(`（先省略较早的 ${omittedBlocks} 段，完整记录见文件）`)
    const budget = { left: asked.length > 0 ? MAX_MESSAGE_CHARS - 1200 : MAX_MESSAGE_CHARS - 700 }
    shown.forEach((block, index) => {
      body.push(shown.length > 1 ? `第 ${index + 1} 段（${clockOf(block.at)}）：` : '台词：')
      body.push(...this.renderLines(block, 10, budget))
    })
    if (budget.left <= 0) body.push('（台词太多，只列了前一部分；其余都在文件里）')
    const tail = [`完整记录：${this.transcriptPath}（第 #${first.seq} 条起）`]
    if (asked.length > 0) {
      tail.unshift(`用户的话：${asked}`)
      tail.push('按用户这句话回应；不要再自动读别的段落，也不要操作游戏。')
    } else {
      tail.push('请按你平时的样子讲自己的理解：说话的是谁、这段在讲什么、有没有值得留意的伏笔或典故。三五句就够，不要复述原文；也不要替我操作游戏。')
      tail.push('前两种方括号是来源：[血迹]/[尸体]/[告示牌] 是碰了地上的东西读到的文字（来自地图事件图形，不是说话人）；[战斗] 是战斗提示，可略过。没有方括号前缀的行才是真没有说话人的旁白。')
    }
    return {
      id: `dafeiyu-reading-${randomUUID()}`,
      role: 'user',
      content: [{ type: 'text', text: [head, where, '', ...body, '', ...tail].join('\n') }],
      source: { kind: 'plugin:dafeiyu-wonder-reading' },
    }
  }

  /** BS2 / BS1, read off the copy's folder name unless it is configured. */
  gameGeneration() {
    const configured = String(this.settings.gameGeneration ?? '').trim()
    if (/^[0-9]+$/.test(configured)) return configured
    return path.basename(this.settings.gameDir).toLowerCase().includes('2') ? '2' : '1'
  }

  /**
   * `BS2-大肥鱼的不思议报告+20261121.md`, then `-2`, `-3` … when the same day
   * already has one: the plugin only names the file, the agent writes it, so a
   * name that silently overwrote yesterday's reading would be a bad surprise.
   */
  reportTarget() {
    const date = stampOf().slice(0, 8)
    const base = `BS${this.gameGeneration()}-大肥鱼的不思议报告+${date}`
    let candidate = path.join(this.settings.reportDir, `${base}.txt`)
    let index = 2
    while (fs.existsSync(candidate) && index < 100) {
      candidate = path.join(this.settings.reportDir, `${base}-${index}.txt`)
      index += 1
    }
    return candidate
  }

  /** A reading report: same dialogue, but the point is a written file. */
  buildReportMessage(blocks) {
    const target = this.reportTarget()
    const lines = []
    const budget = { left: MAX_MESSAGE_CHARS - 700 }
    for (const block of blocks.slice(-6)) {
      lines.push(`\n${clockOf(block.at, true)} · ${block.mapName || '未知地图'}`)
      lines.push(...this.renderLines(block, 12, budget))
    }
    const text = [
      '【BLACK SOULS II · 阅读报告】有人按下了「生成阅读报告」。',
      `报告写到：${target}`,
      '用你平时读故事的口吻写：发生了什么、谁说了什么、你怎么理解它，别复述原文，也别替我操作游戏。',
      '写成纯 txt：不要 #、**、[]() 这类符号，标题单独占一行，分段用空行。',
      '写完用 write 工具存成上面那个路径（目录不在就先建），然后只回一句「写好了：<路径>」。',
      '',
      ...lines,
    ].join('\n')
    return {
      id: `dafeiyu-report-${randomUUID()}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin:dafeiyu-wonder-reading' },
    }
  }

  // -- capture -------------------------------------------------------------

  captureGameWindow() {
    const file = path.join(this.shotsDir, `shot-${stampOf()}-${Date.now() % 1000}.png`)
    try {
      fs.mkdirSync(this.shotsDir, { recursive: true })
    } catch {
      return { ok: false, reason: 'no-shots-dir' }
    }
    const script = CAPTURE_SCRIPT.replace('__OUT__', file.replace(/'/g, "''"))
    let result
    try {
      result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        timeout: 20000,
        windowsHide: true,
        encoding: 'utf8',
      })
    } catch (error) {
      return { ok: false, reason: `capture-failed: ${message(error)}` }
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    if (output.includes('MINIMIZED')) return { ok: false, reason: 'game-minimized' }
    if (output.includes('NO-WINDOW')) return { ok: false, reason: 'no-game-window' }
    if (!fs.existsSync(file)) return { ok: false, reason: `capture-failed: ${output.slice(0, 200)}` }
    return { ok: true, file }
  }

  /** Attach the PNG as a real image when the attachments Service accepts it. */
  async attachImage(file) {
    const service = typeof this.getAttachments === 'function' ? this.getAttachments() : undefined
    if (service === undefined || service === null || typeof service.saveImage !== 'function') return undefined
    let bytes
    try {
      bytes = fs.readFileSync(file)
    } catch {
      return undefined
    }
    const name = path.basename(file)
    const attempts = [{ data: bytes, mediaType: 'image/png', name }, { bytes, mediaType: 'image/png', name }]
    for (const input of attempts) {
      try {
        const ref = await service.saveImage(input)
        if (ref && typeof ref === 'object' && typeof ref.attachmentId === 'string') return ref
      } catch {
        /* try the next shape */
      }
    }
    return undefined
  }

  // -- actions -------------------------------------------------------------

  async action(name, payload = {}) {
    if (name === 'send' || name === 'analyze-now') {
      this.queueUnread()
      const note = typeof payload?.note === 'string' ? payload.note.trim().slice(0, 600) : ''
      return { ok: true, ...this.flush(true, name === 'send' ? note : '') }
    }
    if (name === 'shot') return this.actionShot(payload)
    if (name === 'report') return this.actionReport()
    if (name === 'show-widget') return this.showWidget(payload?.force === true)
    if (name === 'clear-history') return this.clearHistory()
    if (name === 'clear-pending') {
      const count = this.pending.length
      for (const block of this.pending) this.analyzed[block.id] = 0
      this.pending = []
      return { ok: true, cleared: count }
    }
    return { ok: false, error: `unknown action ${JSON.stringify(name)}` }
  }

  async actionShot(payload = {}) {
    const capture = this.captureGameWindow()
    if (capture.ok !== true) return { ok: false, reason: capture.reason }
    const agent = this.targetAgent()
    if (agent === undefined) return { ok: false, reason: 'no-session', file: capture.file }
    this.queueUnread()
    const batch = this.takeUnread()
    const note = typeof payload?.note === 'string' ? payload.note.trim().slice(0, 600) : ''
    const attachment = await this.attachImage(capture.file)
    const head = batch.length > 0
      ? `【BLACK SOULS II · 插图 + 阅读记录】有人按下了「欣赏插图」。截图：${capture.file}`
      : `【BLACK SOULS II · 插图】有人按下了「欣赏插图」。截图：${capture.file}`
    const text = [
      head,
      note.length > 0 ? `用户的话：${note}` : '',
      batch.length > 0 ? '同一时刻读到的台词：' : '',
      ...batch.slice(-2).flatMap((block) => this.renderLines(block, 8, { left: 600 })),
      attachment === undefined ? `（图没附上，直接读这个文件：${capture.file}）` : '',
      '看看这张图，用你平时的样子讲两句：画面里是谁、在哪、这一幕让你想到什么。不要复述台词。',
    ].filter((line) => line.length > 0).join('\n')
    const content = [{ type: 'text', text }]
    if (attachment !== undefined) content.push({ type: 'image', attachment })
    try {
      agent.followup({
        id: `dafeiyu-shot-${randomUUID()}`,
        role: 'user',
        content,
        source: { kind: 'plugin:dafeiyu-wonder-reading' },
      })
    } catch (error) {
      return { ok: false, reason: `followup-failed: ${message(error)}` }
    }
    this.markDelivered(batch, Date.now())
    return { ok: true, delivered: true, file: capture.file, blocks: batch.length, attached: attachment !== undefined }
  }

  /** 交给指定的会话；没指定就用侧栏列表最上面的那个。 */
  targetAgent() {
    const wanted = String(this.settings.targetAgentId || '').trim() || (this.sessionOptions()[0]?.id ?? '')
    if (wanted.length > 0) {
      const service = typeof this.getAgents === 'function' ? this.getAgents() : undefined
      if (service && typeof service.get === 'function') {
        try {
          const found = service.get(wanted)
          if (found !== undefined && found !== null) return found
        } catch {
          // 会话可能已经关掉，退回默认
        }
      }
    }
    return this.activeAgent()
  }

  /** 可选的会话列表（面板里的「报告交给谁」）。 */
  sessionOptions() {
    const service = typeof this.getAgents === 'function' ? this.getAgents() : undefined
    if (!service || typeof service.list !== 'function') return []
    let live = []
    try {
      live = service.list()
    } catch {
      return []
    }
    const titles = typeof this.getSessionTitle === 'function' ? this.getSessionTitle() : undefined
    const byId = new Map()
    for (const agent of live) {
      if (agent && typeof agent.id === 'string') byId.set(agent.id, agent)
    }

    // 侧栏顺序：工作区按注册顺序，工作区里的会话按 sessionIds 顺序。
    const ordered = []
    const registry = typeof this.getWorkspaceRegistry === 'function' ? this.getWorkspaceRegistry() : undefined
    if (registry && typeof registry.list === 'function') {
      try {
        for (const workspace of registry.list()) {
          for (const id of workspace?.sessionIds ?? []) {
            if (byId.has(id) && !ordered.includes(id)) ordered.push(id)
          }
        }
      } catch {
        // 拿不到就按注册顺序
      }
    }
    for (const agent of live) {
      if (typeof agent.id === 'string' && !ordered.includes(agent.id)) ordered.push(agent.id)
    }

    return ordered.map((id) => {
      const agent = byId.get(id)
      let title = ''
      try {
        const snapshot = titles && agent?.session ? titles.get(agent.session) : undefined
        title = typeof snapshot?.title === 'string' ? snapshot.title : ''
      } catch {
        title = ''
      }
      return { id, title }
    })
  }

  async actionReport() {
    if (this.settings.reportDir.length === 0) return { ok: false, reason: 'no-report-dir' }
    const agent = this.targetAgent()
    if (agent === undefined) return { ok: false, reason: 'no-session' }
    // A report is usually asked for *after* reading, when nothing is unread any
    // more — so fall back to the most recent blocks instead of refusing.
    let batch = this.takeUnread()
    if (batch.length === 0) batch = this.history.slice(-4)
    if (batch.length === 0) return { ok: false, reason: 'no-content' }
    try {
      agent.followup(this.buildReportMessage(batch))
    } catch (error) {
      this.pending.unshift(...batch)
      return { ok: false, reason: `followup-failed: ${message(error)}` }
    }
    this.markDelivered(batch, Date.now())
    this.lastReport = { at: Date.now(), blocks: batch.length }
    return { ok: true, delivered: true, blocks: batch.length }
  }

  /** Clear the record files (a copy is kept first), and the in-memory view. */
  clearHistory() {
    const stamp = stampOf()
    const kept = []
    try {
      fs.mkdirSync(this.dataDir, { recursive: true })
      for (const [file, suffix] of [[this.transcriptPath, 'md'], [this.jsonlPath, 'jsonl']]) {
        if (!fs.existsSync(file)) continue
        const backup = path.join(this.dataDir, `dialogue-${stamp}.bak.${suffix}`)
        fs.copyFileSync(file, backup)
        fs.writeFileSync(file, '', 'utf8')
        kept.push(backup)
      }
    } catch (error) {
      return { ok: false, reason: `clear-failed: ${message(error)}` }
    }
    this.history = []
    this.pending = []
    this.analyzed = {}
    this.sequence = 0
    this.cursor = null
    this.lastReport = undefined
    this.saveRuntime()
    this.info(`cleared history (backups: ${kept.length})`)
    return { ok: true, cleared: true, backups: kept }
  }

  // -- panel API -----------------------------------------------------------

  connection() {
    const now = Date.now()
    const snapshot = this.lastSnapshot ?? {}
    return {
      online: this.lastFileAt > 0 && now - this.lastFileAt < this.settings.staleMs,
      sinceMs: this.lastFileAt > 0 ? now - this.lastFileAt : null,
      gameDir: this.settings.gameDir,
      stateDir: this.stateDirectory(),
      scene: snapshot?.scene?.name ?? null,
      mapId: snapshot?.map?.id ?? null,
      mapName: snapshot?.map?.display_name ?? null,
      player: snapshot?.player ?? null,
    }
  }

  snapshotPanel() {
    const blocks = this.history.slice(-PANEL_BLOCKS).reverse().map((block) => ({
      id: block.id,
      seq: block.seq,
      at: block.at,
      mapId: block.mapId,
      mapName: block.mapName,
      lines: block.lines.map((line) => ({ text: line.text, speaker: line.speaker, choices: line.choices, battle: line.battle === true, eventName: line.eventName, eventKind: line.eventKind })),
      analyzedAt: this.analyzed[block.id] || block.analyzedAt || 0,
    }))
    return {
      ok: true,
      build: BUILD,
      settings: {
        enabled: this.settings.enabled,
        autoAnalyze: this.settings.autoAnalyze,
        reportDir: this.settings.reportDir,
        widgetAutoStart: this.settings.widgetAutoStart,
        dockMode: this.settings.dockMode,
        targetAgentId: this.settings.targetAgentId,
        locale: this.settings.locale,
        analysisIdleMs: this.settings.analysisIdleMs,
        analysisCooldownSeconds: this.settings.analysisCooldownSeconds,
      },
      connection: this.connection(),
      counts: {
        pending: this.pending.length,
        unread: this.unreadBlocks().length,
        recorded: this.history.length,
        analyzed: Object.keys(this.analyzed).length,
        dropped: this.dropped,
        lastAnalysisAt: this.lastAnalysisAt,
      },
      blocks,
      transcriptPath: this.transcriptPath,
      dataDir: this.dataDir,
      error: this.lastError,
    }
  }

  updateSettings(patch) {
    const applied = {}
    if (patch !== null && typeof patch === 'object') {
      if (typeof patch.autoAnalyze === 'boolean') {
        this.settings.autoAnalyze = patch.autoAnalyze
        applied.autoAnalyze = patch.autoAnalyze
      }
      if (typeof patch.enabled === 'boolean') {
        this.settings.enabled = patch.enabled
        applied.enabled = patch.enabled
      }
      if (typeof patch.reportDir === 'string') {
        this.settings.reportDir = patch.reportDir.trim()
        applied.reportDir = this.settings.reportDir
      }
      if (typeof patch.widgetAutoStart === 'boolean') {
        this.settings.widgetAutoStart = patch.widgetAutoStart
        applied.widgetAutoStart = patch.widgetAutoStart
      }
      if (patch.dockMode === 'strong' || patch.dockMode === 'normal') {
        this.settings.dockMode = patch.dockMode
        applied.dockMode = patch.dockMode
      }
      const target = patch.targetAgentId ?? patch.reportAgentId
      if (typeof target === 'string') {
        this.settings.targetAgentId = target.trim()
        applied.targetAgentId = this.settings.targetAgentId
      }
      if (patch.locale === 'en' || patch.locale === 'zh') {
        this.settings.locale = patch.locale
        applied.locale = patch.locale
      }
    }
    if (Object.keys(applied).length > 0) this.saveSettings()
    return { ok: true, applied, settings: this.snapshotPanel().settings }
  }

  unreadBlocks() {
    return this.history.filter((block) => this.analyzed[block.id] === undefined)
  }

  // -- logging -------------------------------------------------------------

  info(text) {
    try {
      this.logger?.info?.(`dafeiyu-wonder-reading: ${text}`)
    } catch {
      /* logging must never fail a tick */
    }
  }

  warn(text) {
    this.lastError = `${clockOf(Date.now(), true)} ${text}`
    try {
      this.logger?.warn?.(`dafeiyu-wonder-reading: ${text}`)
    } catch {
      /* logging must never fail a tick */
    }
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  let recorder
  try {
    recorder = new DialogueRecorder(ctx, config)
  } catch (error) {
    ctx?.logger?.warn?.(`dafeiyu-wonder-reading: init failed: ${message(error)}`)
    return
  }

  ctx.effect(() => {
    recorder.start()
    return () => recorder.stop()
  }, 'dafeiyu-wonder-reading: recorder')

  // Optional dependencies. Reading `ctx.agents` without injecting it throws, so
  // each Service arrives through `ctx.inject([...])` and is read off the handle.
  ctx.inject(['agents'], (agentCtx) => {
    agentCtx.effect(() => {
      recorder.getAgents = () => agentCtx.agents
      return () => {
        recorder.getAgents = undefined
      }
    }, 'dafeiyu-wonder-reading: agents')
  })

  ctx.inject(['workspaceRegistry'], (workspaceCtx) => {
    workspaceCtx.effect(() => {
      recorder.getWorkspaceRegistry = () => workspaceCtx.workspaceRegistry
      return () => {
        recorder.getWorkspaceRegistry = undefined
      }
    }, 'dafeiyu-wonder-reading: workspaceRegistry')
  })

  ctx.inject(['sessionTitle'], (titleCtx) => {
    titleCtx.effect(() => {
      recorder.getSessionTitle = () => titleCtx.sessionTitle
      return () => {
        recorder.getSessionTitle = undefined
      }
    }, 'dafeiyu-wonder-reading: sessionTitle')
  })

  ctx.inject(['attachments'], (attachCtx) => {
    attachCtx.effect(() => {
      recorder.getAttachments = () => attachCtx.attachments
      return () => {
        recorder.getAttachments = undefined
      }
    }, 'dafeiyu-wonder-reading: attachments')
  })

  // The panel reads and toggles through this route (optional: headless hosts
  // have no webServer, and the recorder keeps working without it).
  ctx.inject(['webServer'], (webCtx) => {
    const handler = async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const send = (status, payload) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(payload))
        }
        try {
          if (req.method === 'GET') {
            if (url.pathname.endsWith('/sessions')) {
              send(200, { ok: true, sessions: recorder.sessionOptions() })
              return
            }
            send(200, recorder.snapshotPanel())
            return
          }
          if (req.method !== 'POST') {
            send(405, { ok: false, error: 'method not allowed' })
            return
          }
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          let body = {}
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          } catch {
            send(400, { ok: false, error: 'body must be JSON' })
            return
          }
          if (url.pathname.endsWith('/settings')) {
            send(200, recorder.updateSettings(body))
            return
          }
          if (url.pathname.endsWith('/action')) {
            send(200, await recorder.action(typeof body.action === 'string' ? body.action : '', body))
            return
          }
          send(404, { ok: false, error: 'unknown route' })
        } catch (error) {
          send(500, { ok: false, error: message(error) })
        }
    }
    // `exact` matches one path only, so the sub-routes the panel posts to need
    // their own registrations: an unmatched POST falls through to the index
    // route and answers 401 instead of ever reaching this handler.
    const routes = [ROUTE_PREFIX, `${ROUTE_PREFIX}/settings`, `${ROUTE_PREFIX}/action`, `${ROUTE_PREFIX}/sessions`]
    const disposers = routes.map((route) => webCtx.webServer.register({ kind: 'exact', path: route, handler }))
    webCtx.effect(() => () => {
      for (const dispose of disposers) dispose?.()
    }, 'dafeiyu-wonder-reading: route')
    recorder.info(`panel routes at ${routes.join(', ')}`)
  })
}
