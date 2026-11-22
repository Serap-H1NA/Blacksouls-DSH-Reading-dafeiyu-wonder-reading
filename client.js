/**
 * 大肥鱼的不思议阅读 — Client half.
 *
 * 左侧栏一个羽毛入口，点开是阅读记录：一句话状态、一段最近的台词（带说话人）、
 * 一个输入框、三行竖排的动作，以及折叠起来的设置。
 *
 * 数据全部来自 Host 的 `/api/dafeiyu-wonder-reading`；面板只渲染，不自己判断对错。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-dafeiyu-wonder-reading',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dafeiyu-wonder-reading'
    const PANEL_ID = 'dafeiyu-wonder-reading'
    const ROUTE = '/api/dafeiyu-wonder-reading'

    const DICTS = {
      zh: {
        nav: '大肥鱼的不思议阅读',
        title: '大肥鱼的不思议阅读',
        online: '记录中',
        offline: '游戏未运行',
        unread: '待读',
        recorded: '已记录',
        placeholder: '想让我注意什么？（留空就按平时的样子讲）',
        send: "阅读文字喵~(●'◡'●)",
        shot: '欣赏插图ο(=•ω＜=)ρ⌒☆',
        report: '生成阅读报告☆*: .｡. o(≧▽≦)o .｡.:*☆',
        copy: '复制路径',
        copied: '已复制',
        settings: '设置',
        close: '收起',
        auto: '自动阅读',
        autoHint: '开着的话，每段读完会自动交给我——等于一张嘴一直开着，默认关。',
        widget: '随 DSH 启动悬浮窗',
        widgetHint: '一个贴在游戏窗口右边的置顶小条。',
        strongDock: '强吸附（跟着游戏窗口走）',
        strongDockHint: '关着：拖过一次悬浮窗，它就不再自己归位。打开：游戏窗口一动，它立刻贴回去。',
        reportTarget: '阅读报告交给',
        reportTargetAuto: '当前会话',
        reportTargetHint: '生成阅读报告时，任务发给这里选中的会话；默认交给当前会话。',
        showWidget: '唤起悬浮窗',
        widgetShown: '悬浮窗已启动',
        widgetAlready: '悬浮窗已经在跑了，看游戏窗口右边',
        reportDir: '阅读报告存放位置',
        reportDirHint: '留空时按「生成阅读报告」会提醒你先设置。',
        save: '保存',
        saved: '已保存',
        clearHistory: '清除阅读历史',
        clearHistoryHint: '清空记录文件（会先备份一份 .bak）。',
        clearConfirmTitle: '清除阅读历史？',
        clearConfirmBody: '记录文件会被清空，当前面板也会变成空。清空之前会先备份一份 dialogue-<时间>.bak.md/.jsonl。',
        confirm: '确定清除',
        cancel: '取消',
        cleared: '已清空',
        empty: '还没有读到对话 —— 在游戏里说句话，这里就会有记录。',
        loading: '正在读取…',
        unreachable: '连不上插件后台（可能刚启用，刷新一下页面）',
        transcript: '记录文件',
        noReportDir: '请设置阅读报告存放位置',
        noContent: '还没有可用来写报告的内容',
        minimized: '游戏窗口最小化时截不到图',
        noWindow: '没找到游戏窗口',
        noSession: '没找到可用的会话',
        sent: '已交给我',
        shotSent: '插图已发出',
        reportSent: '报告已交给我写',
        footer: '只读游戏状态文件，不按键、不碰存档',
        options: '选项',
      },
      en: {
        nav: "Dafeiyu's Wonder Reading",
        title: "Dafeiyu's Wonder Reading",
        online: 'Recording',
        offline: 'Game offline',
        unread: 'unread',
        recorded: 'recorded',
        placeholder: 'Anything I should notice? (optional)',
        send: "Read this~(●'◡'●)",
        shot: 'Admire the view ο(=•ω＜=)ρ⌒☆',
        report: 'Write a reading report ☆*: .｡. o(≧▽≦)o .｡.:*☆',
        copy: 'Copy path',
        copied: 'Copied',
        settings: 'Settings',
        close: 'Hide',
        auto: 'Read automatically',
        autoHint: 'On, every conversation is handed over by itself — a mouth that never closes. Off by default.',
        widget: 'Start the floating companion with DSH',
        widgetHint: 'A small always-on-top strip docked beside the game window.',
        strongDock: 'Strong docking (follow the game window)',
        strongDockHint: 'Off: once you drag the widget, it stops re-docking. On: it snaps back whenever the game window moves.',
        reportTarget: 'Deliver the report to',
        reportTargetAuto: 'Current session',
        reportTargetHint: 'The reading report is handed to the session picked here; the current one by default.',
        showWidget: 'Show the companion',
        widgetShown: 'Companion started',
        widgetAlready: 'It is already running — look beside the game window',
        reportDir: 'Report folder',
        reportDirHint: 'Left empty, the report button asks you to set it first.',
        save: 'Save',
        saved: 'Saved',
        clearHistory: 'Clear reading history',
        clearHistoryHint: 'Empties the record files (a .bak copy is kept first).',
        clearConfirmTitle: 'Clear the reading history?',
        clearConfirmBody: 'The record files will be emptied and this panel will go blank. A dialogue-<time>.bak copy is kept first.',
        confirm: 'Clear it',
        cancel: 'Cancel',
        cleared: 'Cleared',
        empty: 'Nothing read yet — say a word in game and it shows up here.',
        loading: 'Loading…',
        unreachable: 'Cannot reach the plugin backend (reload the page if it was just enabled)',
        transcript: 'Transcript',
        noReportDir: 'Set the report folder first',
        noContent: 'Nothing to report on yet',
        minimized: 'The game window is minimized, so there is nothing to capture',
        noWindow: 'The game window was not found',
        noSession: 'No usable session',
        sent: 'Handed over',
        shotSent: 'Screenshot sent',
        reportSent: 'Report requested',
        footer: 'Reads the game state files only; never presses keys or touches saves',
        options: 'Choices',
      },
    }

    const S = {
      page: {
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        padding: 'calc(30px + var(--dsh-frame-top-clearance, 0px)) 0 80px',
      },
      column: { maxWidth: '760px', margin: '0 auto', padding: '0 32px', display: 'flex', flexDirection: 'column' },
      headRow: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 },
      title: { fontSize: '22px', fontWeight: 650, margin: 0, letterSpacing: '0.01em' },
      statusRow: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '14px',
        marginTop: '12px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      dot: (on) => ({
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        display: 'inline-block',
        marginRight: '7px',
        background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)',
      }),
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '22px',
        padding: '18px 20px',
        marginTop: '20px',
      },
      textarea: {
        boxSizing: 'border-box',
        width: '100%',
        padding: '12px 14px',
        minHeight: '78px',
        resize: 'vertical',
        font: 'inherit',
        fontSize: '14px',
        lineHeight: '22px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '16px',
        outline: 'none',
      },
      actionStack: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' },
      actionRow: (disabled) => ({
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minHeight: '48px',
        padding: '0 18px',
        textAlign: 'left',
        font: 'inherit',
        fontSize: '13.5px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '16px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxSizing: 'border-box',
      }),
      toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginTop: '12px' },
      button: (quiet, disabled) => ({
        font: 'inherit',
        fontSize: '12.5px',
        height: '34px',
        padding: '0 14px',
        borderRadius: '12px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        border: '0.5px solid var(--dsw-alias-border-l2)',
        background: quiet ? 'transparent' : 'var(--dsw-alias-bg-layer-2)',
        color: quiet ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-primary)',
        boxSizing: 'border-box',
      }),
      note: (tone) => ({
        marginTop: '12px',
        fontSize: '12.5px',
        lineHeight: '20px',
        color: tone === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
      }),
      list: { marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '14px' },
      block: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '20px',
        padding: '16px 18px',
      },
      blockHead: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' },
      blockSeq: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      blockPlace: { fontSize: '13.5px', fontWeight: 600 },
      badge: (done) => ({
        marginLeft: 'auto',
        fontSize: '11px',
        lineHeight: '20px',
        padding: '0 8px',
        borderRadius: '10px',
        background: done ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
        color: done ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)',
        border: done ? 'none' : '0.5px solid var(--dsw-alias-border-l2)',
      }),
      lineRow: { display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '7px' },
      speaker: {
        flex: 'none',
        fontSize: '12px',
        lineHeight: '20px',
        maxWidth: '40%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        padding: '0 8px',
        borderRadius: '9px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      line: {
        margin: 0,
        minWidth: 0,
        fontSize: '14px',
        lineHeight: '23px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      choice: { marginTop: '5px', fontSize: '12.5px', lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' },
      field: {
        boxSizing: 'border-box',
        width: '100%',
        marginTop: '8px',
        padding: '10px 12px',
        font: 'inherit',
        fontSize: '13px',
        height: '42px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '13px',
        outline: 'none',
      },
      label: { fontSize: '13px', fontWeight: 600 },
      hint: { margin: '6px 0 0', fontSize: '12.5px', lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' },
      switchBtn: (on) => ({
        position: 'relative',
        width: '42px',
        height: '24px',
        flex: 'none',
        borderRadius: '12px',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
        transition: 'background .16s ease',
      }),
      switchKnob: (on) => ({
        position: 'absolute',
        top: '3px',
        left: on ? '21px' : '3px',
        width: '18px',
        height: '18px',
        borderRadius: '9px',
        background: '#fff',
        transition: 'left .16s ease',
      }),
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      },
      dialog: {
        width: 'min(440px, 100%)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '24px',
        padding: '22px 24px',
        boxShadow: '0 22px 56px rgba(0,0,0,0.38)',
      },
      dialogTitle: { margin: 0, fontSize: '15px', fontWeight: 650 },
      mono: {
        marginTop: '10px',
        fontFamily: 'var(--ds-font-family-code, ui-monospace, Menlo, Consolas, monospace)',
        fontSize: '11.5px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
        wordBreak: 'break-all',
      },
      footer: { marginTop: '24px', fontSize: '12px', lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' },
      sectionDivider: {
        marginTop: '18px',
        borderTop: '0.5px solid var(--dsw-alias-border-l1)',
        paddingTop: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
    }

    function FeatherMark({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
        h('path', { d: 'M24 4C15.4 5.6 8.6 13 6.8 22.4', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' }),
        h('path', {
          d: 'M24 4c1.9 5.9-1.1 12.7-6.4 16.5-1.9 1.4-3.9 2.2-5.9 2.6C12.3 16 16.6 7.9 24 4Z',
          stroke: 'currentColor',
          strokeWidth: '1.7',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M11.6 25.4 8.4 28.6', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' }),
      )
    }

    function makeTranslator(ctx) {
      const pick = () => {
        try {
          return ctx.locale.getSnapshot().active === 'en' ? 'en' : 'zh'
        } catch {
          return 'zh'
        }
      }
      const fallback = (key) => {
        const dict = DICTS[pick()] || DICTS.zh
        return dict[key] ?? DICTS.zh[key] ?? key
      }
      let bound
      try {
        bound = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : undefined
      } catch {
        bound = undefined
      }
      return (key) => {
        if (typeof bound === 'function') {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value.length > 0 && value !== key) return value
          } catch {
            /* fall through to the dictionary */
          }
        }
        return fallback(key)
      }
    }

    function clock(ms) {
      const date = new Date(ms)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    async function post(path, body) {
      const response = await fetch(`${ROUTE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return response.json()
    }

    function useSnapshot() {
      const [snapshot, setSnapshot] = React.useState(null)
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        let alive = true
        const load = () => {
          fetch(ROUTE, { cache: 'no-store' })
            .then((response) => response.json())
            .then((value) => {
              if (!alive) return
              setSnapshot(value)
              setError('')
            })
            .catch(() => {
              if (alive) setError('unreachable')
            })
        }
        load()
        const timer = setInterval(load, 2000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      return { snapshot, error, setSnapshot }
    }

    function reasonText(t, reason) {
      if (typeof reason !== 'string') return reason
      const map = {
        'no-report-dir': 'noReportDir',
        'no-content': 'noContent',
        'game-minimized': 'minimized',
        'no-game-window': 'noWindow',
        'no-session': 'noSession',
        'no-pending': 'noContent',
      }
      return map[reason] !== undefined ? t(map[reason]) : reason
    }

    function ConfirmDialog({ t, onCancel, onConfirm }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onCancel()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onCancel])
      return h(
        'div',
        { style: S.backdrop, role: 'dialog', 'aria-modal': 'true', onClick: onCancel },
        h(
          'div',
          { style: S.dialog, onClick: (event) => event.stopPropagation() },
          h('p', { style: S.dialogTitle }, t('clearConfirmTitle')),
          h('p', { style: S.hint }, t('clearConfirmBody')),
          h(
            'div',
            { style: { ...S.toolbar, justifyContent: 'flex-end' } },
            h('button', { type: 'button', style: S.button(true), onClick: onCancel }, t('cancel')),
            h(
              'button',
              {
                type: 'button',
                style: { ...S.button(false), borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
                onClick: onConfirm,
                autoFocus: true,
              },
              t('confirm'),
            ),
          ),
        ),
      )
    }

    function DialoguePanel({ t: translate }) {
      const t = typeof translate === 'function' ? translate : (key) => key
      const { snapshot, error, setSnapshot } = useSnapshot()
      const [note, setNote] = React.useState({ tone: '', text: '' })
      const [draft, setDraft] = React.useState('')
      const [reportDir, setReportDir] = React.useState('')
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const [copied, setCopied] = React.useState(false)
      const [sessions, setSessions] = React.useState([])

      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const value = await fetch(`${ROUTE}/sessions`, { cache: 'no-store' }).then((response) => response.json())
            if (alive && Array.isArray(value?.sessions)) setSessions(value.sessions)
          } catch {
            /* 面板轮询会再试 */
          }
        }
        load()
        const timer = setInterval(load, 8000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      const replace = (value) => {
        if (value && typeof value === 'object') setSnapshot((current) => ({ ...(current ?? {}), ...value }))
      }

      const refresh = async () => {
        try {
          replace(await fetch(ROUTE, { cache: 'no-store' }).then((response) => response.json()))
        } catch {
          /* the poll will retry */
        }
      }

      React.useEffect(() => {
        if (snapshot !== null && reportDir === '' && typeof snapshot.settings?.reportDir === 'string') {
          setReportDir(snapshot.settings.reportDir)
        }
      }, [snapshot])

      const applySettings = async (patch) => {
        try {
          const result = await post('/settings', patch)
          setSnapshot((current) => (current === null ? current : { ...current, settings: result.settings }))
          return true
        } catch {
          setNote({ tone: 'error', text: t('unreachable') })
          return false
        }
      }

      const runAction = async (action, label) => {
        try {
          const result = await post('/action', { action, note: action === 'send' ? draft.trim() : '' })
          if (result.ok === false) {
            setNote({ tone: 'error', text: reasonText(t, result.reason) })
          } else {
            if (action === 'send') setDraft('')
            setNote({ tone: '', text: label })
          }
          await refresh()
        } catch {
          setNote({ tone: 'error', text: t('unreachable') })
        }
      }

      const copyPath = async () => {
        const value = snapshot?.transcriptPath ?? ''
        if (value.length === 0) return
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setNote({ tone: 'error', text: value })
        }
      }

      const connection = snapshot?.connection ?? {}
      const settings = snapshot?.settings ?? {}
      const counts = snapshot?.counts ?? {}
      const blocks = Array.isArray(snapshot?.blocks) ? snapshot.blocks : []
      const online = connection.online === true
      const unread = counts.unread ?? 0

      return h(
        'div',
        { style: S.page },
        confirming
          ? h(ConfirmDialog, {
              t,
              onCancel: () => setConfirming(false),
              onConfirm: async () => {
                setConfirming(false)
                try {
                  const result = await post('/action', { action: 'clear-history' })
                  setNote({ tone: result.ok === false ? 'error' : '', text: result.ok === false ? reasonText(t, result.reason) : t('cleared') })
                  await refresh()
                } catch {
                  setNote({ tone: 'error', text: t('unreachable') })
                }
              },
            })
          : null,
        h(
          'div',
          { style: S.column },
          h(
            'div',
            { style: S.headRow },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex' } }, h(FeatherMark, { size: 24 })),
            h('h1', { style: S.title }, t('title')),
          ),
          h(
            'div',
            { style: { ...S.toolbar, marginTop: '14px' } },
            h(
              'button',
              {
                type: 'button',
                style: {
                  ...S.button(false),
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: 'var(--dsw-alias-label-primary)',
                  border: '1px solid var(--dsw-alias-brand-primary)',
                  height: '36px',
                  padding: '0 16px',
                  fontWeight: 700,
                },
                onClick: async () => {
                  try {
                    const result = await post('/action', { action: 'show-widget' })
                    if (result.ok === false) setNote({ tone: 'error', text: reasonText(t, result.reason) })
                    else setNote({ tone: '', text: result.already === true ? t('widgetAlready') : t('widgetShown') })
                  } catch {
                    setNote({ tone: 'error', text: t('unreachable') })
                  }
                },
              },
              '▶ ' + t('showWidget'),
            ),
          ),
          h(
            'div',
            { style: S.statusRow },
            h('span', null, h('span', { style: S.dot(online) }), online ? t('online') : t('offline')),
            connection.mapName ? h('span', null, connection.mapName) : null,
            h('span', null, `${t('unread')} ${unread}`),
            h('span', null, `${t('recorded')} ${counts.recorded ?? 0}`),
          ),

          error === 'unreachable' ? h('p', { style: S.note('error') }, t('unreachable')) : null,

          h(
            'div',
            { style: S.card },
            h('textarea', {
              value: draft,
              rows: 3,
              placeholder: t('placeholder'),
              'aria-label': t('placeholder'),
              style: S.textarea,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  runAction('send', t('sent'))
                }
              },
            }),
            h(
              'div',
              { style: S.actionStack },
              h('button', { type: 'button', style: S.actionRow(false), onClick: () => runAction('send', t('sent')) }, t('send')),
              h('button', { type: 'button', style: S.actionRow(false), onClick: () => runAction('shot', t('shotSent')) }, t('shot')),
              h('button', { type: 'button', style: S.actionRow(false), onClick: () => runAction('report', t('reportSent')) }, t('report')),
            ),
            h(
              'div',
              { style: S.toolbar },
              h('button', { type: 'button', style: S.button(true), onClick: copyPath }, copied ? t('copied') : t('copy')),
              h(
                'button',
                { type: 'button', style: S.button(true), onClick: () => setSettingsOpen(!settingsOpen) },
                settingsOpen ? t('close') : t('settings'),
              ),
            ),
            note.text.length > 0 ? h('p', { style: S.note(note.tone) }, note.text) : null,
            settingsOpen
              ? h(
                  'div',
                  { style: S.sectionDivider },
                  h('p', { style: S.label }, t('reportDir')),
                  h('input', {
                    value: reportDir,
                    placeholder: 'C:\\Users\\…\\阅读报告',
                    style: S.field,
                    onChange: (event) => setReportDir(event.target.value),
                  }),
                  h('p', { style: S.hint }, t('reportDirHint')),
                  h(
                    'div',
                    { style: S.toolbar },
                    h(
                      'button',
                      {
                        type: 'button',
                        style: S.button(false),
                        onClick: async () => {
                          if (await applySettings({ reportDir })) setNote({ tone: '', text: t('saved') })
                        },
                      },
                      t('save'),
                    ),
                  ),
                  h(
                    'div',
                    { style: { ...S.toolbar, marginTop: '18px' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'switch',
                        'aria-checked': settings.autoAnalyze === true,
                        'aria-label': t('auto'),
                        style: S.switchBtn(settings.autoAnalyze === true),
                        onClick: () => applySettings({ autoAnalyze: !(settings.autoAnalyze === true) }),
                      },
                      h('span', { style: S.switchKnob(settings.autoAnalyze === true) }),
                    ),
                    h('span', { style: S.label }, t('auto')),
                  ),
                  h('p', { style: S.hint }, t('autoHint')),
                  h(
                    'div',
                    { style: { ...S.toolbar, marginTop: '18px' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'switch',
                        'aria-checked': settings.widgetAutoStart === true,
                        'aria-label': t('widget'),
                        style: S.switchBtn(settings.widgetAutoStart === true),
                        onClick: () => applySettings({ widgetAutoStart: !(settings.widgetAutoStart === true) }),
                      },
                      h('span', { style: S.switchKnob(settings.widgetAutoStart === true) }),
                    ),
                    h('span', { style: S.label }, t('widget')),
                  ),
                  h('p', { style: S.hint }, t('widgetHint')),
                  h(
                    'div',
                    { style: { ...S.toolbar, marginTop: '18px' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'switch',
                        'aria-checked': settings.dockMode === 'strong',
                        'aria-label': t('strongDock'),
                        style: S.switchBtn(settings.dockMode === 'strong'),
                        onClick: () => applySettings({ dockMode: settings.dockMode === 'strong' ? 'normal' : 'strong' }),
                      },
                      h('span', { style: S.switchKnob(settings.dockMode === 'strong') }),
                    ),
                    h('span', { style: S.label }, t('strongDock')),
                  ),
                  h('p', { style: S.hint }, t('strongDockHint')),
                  h(
                    'div',
                    { style: { ...S.toolbar, marginTop: '18px' } },
                    h('span', { style: S.label }, t('reportTarget')),
                    h(
                      'select',
                      {
                        value: snapshot?.settings?.reportAgentId || sessions[0]?.id || '',
                        style: { ...S.field, width: '100%' },
                        onChange: (event) => applySettings({ reportAgentId: event.target.value }),
                      },
                      sessions.map((session) =>
                        h(
                          'option',
                          { key: session.id, value: session.id },
                          session.title && session.title.length > 0 ? session.title : session.id.slice(0, 8),
                        ),
                      ),
                    ),
                  ),
                  h('p', { style: S.hint }, t('reportTargetHint')),
                  h(
                    'div',
                    { style: { ...S.toolbar, marginTop: '20px' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        style: { ...S.button(true), color: 'var(--dsw-alias-state-error-primary)' },
                        onClick: () => setConfirming(true),
                      },
                      t('clearHistory'),
                    ),
                  ),
                  h('p', { style: S.hint }, t('clearHistoryHint')),
                  snapshot?.transcriptPath ? h('p', { style: S.mono }, `${t('transcript')}: ${snapshot.transcriptPath}`) : null,
                )
              : null,
          ),

          snapshot === null && error === ''
            ? h('p', { style: S.note('') }, t('loading'))
            : h(
                'div',
                { style: S.list },
                blocks.length === 0
                  ? h('p', { style: S.note('') }, t('empty'))
                  : blocks.map((block) => {
                      const done = Number(block.analyzedAt) > 0
                      return h(
                        'div',
                        { key: block.id, style: S.block },
                        h(
                          'div',
                          { style: S.blockHead },
                          h('span', { style: S.blockSeq }, `#${block.seq} · ${clock(block.at)}`),
                          h('span', { style: S.blockPlace }, `${block.mapName || ''} (${block.mapId ?? '?'})`),
                          h('span', { style: S.badge(done) }, done ? '✓' : '•'),
                        ),
                        block.lines.map((line, index) =>
                          h(
                            'div',
                            { key: `${block.id}-${index}`, style: { marginTop: '6px' } },
                            h(
                              'div',
                              { style: S.lineRow },
                              line.speaker
                                ? h('span', { style: S.speaker, title: line.speaker }, line.speaker)
                                : null,
                              h('p', { style: S.line }, line.text),
                            ),
                            Array.isArray(line.choices) && line.choices.length > 0
                              ? h('p', { style: S.choice }, `${t('options')}: ${line.choices.join(' / ')}`)
                              : null,
                          ),
                        ),
                      )
                    }),
              ),

          h('p', { style: S.footer }, t('footer')),
        ),
      )
    }

    function SidebarLauncher({ size = 16, active = false }) {
      return h(
        'span',
        { style: { display: 'inline-flex', color: active ? 'var(--dsw-alias-label-primary)' : 'inherit' } },
        h(FeatherMark, { size }),
      )
    }

    function apply(ctx) {
      const t = makeTranslator(ctx)
      ctx.effect(() => ctx.locale.register(NS, DICTS), 'dafeiyu-wonder-reading: dictionaries')

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, () => h(DialoguePanel, { t })),
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => t('nav'), locale: NS },
          (owner = {}) => h(SidebarLauncher, { size: owner.size ?? 16, active: owner.active === true }),
        ),
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
