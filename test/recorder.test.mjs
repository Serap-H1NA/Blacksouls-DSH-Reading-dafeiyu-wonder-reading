import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, normalizeText, ROUTE_PREFIX } from '../index.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsd-'))
const gameDir = path.join(root, 'game')
const dataDir = path.join(root, 'data')
const stateDir = path.join(gameDir, 'BridgeRuntime', 'state')
fs.mkdirSync(stateDir, { recursive: true })

let seq = 0
let frame = 100

function put(text, extra = {}) {
  frame += 6
  const state = {
    protocol: 'black-souls-bridge/1',
    updated_at: Date.now() / 1000,
    scene: { name: extra.scene ?? 'Scene_Map' },
    map: { id: 103, display_name: '休息处' },
    message: { busy: String(text ?? '').length > 0, text: text ?? '', speaker: extra.speaker ?? null, choices: extra.choices ?? [] },
    battle: extra.battle ?? { active: false },
    player: { x: 1, y: 2 },
  }
  const name = `state-1795240603-${String(30040).padStart(10, '0')}-${String(frame).padStart(12, '0')}-${String(seq++).padStart(6, '0')}.json`
  fs.writeFileSync(path.join(stateDir, name), JSON.stringify(state))
  return name
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let captured = null
let handler = null
let stopRecorder = null
const warns = []
const agents = []

const ctx = {
  logger: { info() {}, warn: (...args) => warns.push(args.join(' ')) },
  on: () => () => {},
  effect(fn, label) {
    const dispose = fn()
    if (String(label).includes('recorder')) stopRecorder = dispose
    return dispose
  },
  inject(deps, fn) {
    fn({
      effect: (factory) => factory(),
      agents: ctx.agents,
      webServer: {
        register(route) {
          handler = route.handler
          return () => {}
        },
      },
    })
  },
  agents: { list: () => agents },
}

apply(ctx, { gameDir, dataDir, pollMs: 50, staleMs: 60000, idleCloseMs: 300, analysisIdleMs: 0, widgetAutoStart: false })

// one conversation, three pages, polled live by the recorder's own timer
put('\\u3000第一句：\\C[6]会痛吗\\C[0]'.replace('\\u3000', '\u3000'))
await sleep(160)
put('第二句：{两个选择}')
await sleep(160)
put('第三句：结束', { choices: ['好', '不好'] })
await sleep(160)
put('') // player confirms past the last page: message window cleared
await sleep(500)

let state = await getState()
console.log('--- after conversation ---')
console.log('blocks:', state.blocks.length, '| pending:', state.counts.pending, '| recorded:', state.counts.recorded)
console.log('lines:', JSON.stringify(state.blocks[0]?.lines?.map((line) => line.text)))
console.log('choices:', JSON.stringify(state.blocks[0]?.lines?.[2]?.choices))
console.log('map:', state.blocks[0]?.mapName, state.blocks[0]?.mapId)

console.log('analyze without session:', JSON.stringify(await postAction('analyze-now')))

agents.push({
  id: 'session-1',
  session: { header: { id: 'session-1' } },
  followup(message) {
    captured = message
  },
})
console.log('analyze with session:', JSON.stringify(await postAction('analyze-now')))
console.log('role:', captured?.role, '| source:', JSON.stringify(captured?.source))
console.log('--- message ---')
console.log(captured?.content?.[0]?.text)

state = await getState()
console.log('after delivery -> pending:', state.counts.pending, '| analyzedAt set:', state.blocks[0]?.analyzedAt > 0)
console.log('second analyze:', JSON.stringify(await postAction('analyze-now')))

// auto-analysis must stay quiet while the switch is off
agents[0].followup = () => {
  throw new Error('must not be called while autoAnalyze is off')
}
console.log('switch off:', JSON.stringify(await postSettings({ autoAnalyze: false })))
put('第四句：又一段')
await sleep(160)
put('')
await sleep(500)
state = await getState()
console.log('pending with auto off:', state.counts.pending, '| autoAnalyze:', state.settings.autoAnalyze)
console.log('clear pending:', JSON.stringify(await postAction('clear-pending')))

// 4. the input box: a note travels with the record, and only then is a turn spent
let second = null
agents[0].followup = (message) => {
  second = message
}
put('第五句：留个话')
await sleep(160)
put('')
await sleep(500)
state = await getState()
console.log('unread after new block:', state.counts.unread)
console.log('send with note:', JSON.stringify(await postAction('send', { note: '这句「留个话」是不是在说别的？' })))
console.log('note reached the message:', second?.content?.[0]?.text?.includes('这句「留个话」是不是在说别的？') === true)
console.log('--- message with note ---')
console.log(second?.content?.[0]?.text)

// 5. 同文不同人：甲和乙各说一句「……」，第二句不能被当成重复吞掉
put('……', { speaker: '甲' })
await sleep(160)
put('……', { speaker: '乙' })
await sleep(160)
put('')
await sleep(500)
state = await getState()
const pair = state.blocks[0]
console.log('same text, two speakers:', JSON.stringify((pair?.lines ?? []).map((line) => [line.speaker, line.text])))
console.log('md has both names:', (() => {
  const md = fs.readFileSync(path.join(dataDir, 'dialogue.md'), 'utf8')
  return md.includes('甲：……') && md.includes('乙：……')
})())

// 6. 战斗提示：逃跑行被挡掉，其他战斗文字带 [战斗] 标记
put('敌人逃跑了', { battle: { active: true } })
await sleep(160)
put('「你也会死在这里」', { battle: { active: true }, speaker: '巴风特' })
await sleep(160)
put('')
await sleep(500)
state = await getState()
const battleBlock = state.blocks[0]
console.log('battle block:', JSON.stringify((battleBlock?.lines ?? []).map((line) => [line.speaker, line.battle, line.text])))
console.log('flee line filtered:', !fs.readFileSync(path.join(dataDir, 'dialogue.md'), 'utf8').includes('敌人逃跑了'))

console.log('--- transcript.md ---')
console.log(fs.readFileSync(path.join(dataDir, 'dialogue.md'), 'utf8'))
console.log('--- jsonl (first record) ---')
console.log(fs.readFileSync(path.join(dataDir, 'dialogue.jsonl'), 'utf8').split('\n')[0])
console.log('--- normalizeText ---')
console.log(JSON.stringify(normalizeText('\\{\\{\\C[6]NIGHTMARE SPIRIT DESTROYED\\C[0]\\}\\}')))
console.log('--- warnings ---')
console.log(warns.join('\n') || '(none)')

stopRecorder?.()
await sleep(120)
console.log('stopped cleanly')

async function getState() {
  const res = fakeRes()
  await handler({ method: 'GET', url: ROUTE_PREFIX }, res)
  return JSON.parse(res.body)
}

async function postAction(action, extra = {}) {
  const res = fakeRes()
  await handler(bodyReq(`${ROUTE_PREFIX}/action`, { action, ...extra }), res)
  return JSON.parse(res.body)
}

async function postSettings(patch) {
  const res = fakeRes()
  await handler(bodyReq(`${ROUTE_PREFIX}/settings`, patch), res)
  return JSON.parse(res.body)
}

function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body
    },
  }
}

function bodyReq(url, body) {
  return {
    method: 'POST',
    url,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

