"""悬浮阅读条：贴着游戏窗口的一条竖卡，收起后变成一条细线。

画面由 painter.py 用 Pillow 合成成一张 RGBA，再用 UpdateLayeredWindow 整张推给
Windows（真·逐像素透明，圆角是抗锯齿的）；tk 只保留事件与排版。

关键：分层窗口默认按 alpha 判定点击，透明处会穿透。我们在窗口过程里把
WM_NCHITTEST 一律回成 HTCLIENT，让整扇窗接管鼠标。
"""

from __future__ import annotations

import ctypes
import json
import os
import sys
import time
import tkinter as tk
from pathlib import Path

import painter

WIDTH = 288
HEIGHT = 560
MIN_HEIGHT = 460
BAR_W = 32
RADIUS = 24
VERTICAL_OFFSET = -28
TEXT_X = 28
TEXT_W = 244

SEND_LABEL = "阅读文字喵~(●'◡'●)"
SHOT_LABEL = '欣赏插图ο(=•ω＜=)ρ⌒☆'
REPORT_LABEL = '生成阅读报告☆*: .｡. o(≧▽≦)o .｡.:*☆'

user32 = ctypes.windll.user32
user32.GetAncestor.restype = ctypes.c_void_p
user32.GetAncestor.argtypes = [ctypes.c_void_p, ctypes.c_uint]
user32.IsWindow.argtypes = [ctypes.c_void_p]
user32.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
user32.IsWindowVisible.argtypes = [ctypes.c_void_p]
user32.IsIconic.argtypes = [ctypes.c_void_p]
user32.GetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int]
user32.GetWindowLongW.restype = ctypes.c_int32
user32.SetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int32]
user32.SetWindowLongPtrW.restype = ctypes.c_void_p
user32.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
user32.CallWindowProcW.restype = ctypes.c_ssize_t
user32.CallWindowProcW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint,
                                   ctypes.c_size_t, ctypes.c_ssize_t]
user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
user32.EnumWindows.argtypes = [ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p),
                               ctypes.c_void_p]
user32.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, ctypes.c_int, ctypes.c_uint]

try:
    ctypes.windll.winmm.timeBeginPeriod(1)
except Exception:
    pass

WM_NCHITTEST = 0x0084
HTCLIENT = 1
GWL_EXSTYLE = -20
GWLP_WNDPROC = -4
WS_EX_LAYERED = 0x00080000


class _RECT(ctypes.Structure):
    _fields_ = [('left', ctypes.c_long), ('top', ctypes.c_long),
                ('right', ctypes.c_long), ('bottom', ctypes.c_long)]


class _POINT(ctypes.Structure):
    _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]


_ENUM = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
_WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_void_p, ctypes.c_uint,
                              ctypes.c_size_t, ctypes.c_ssize_t)


def find_game_window() -> int:
    found = []

    def callback(hwnd, _param):
        if not user32.IsWindowVisible(ctypes.c_void_p(hwnd)):
            return True
        buffer = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(ctypes.c_void_p(hwnd), buffer, 256)
        if buffer.value.startswith('BLACK SOULS'):
            found.append(int(hwnd))
            return False
        return True

    user32.EnumWindows(_ENUM(callback), None)
    return found[0] if found else 0


def client_box(hwnd: int):
    if not hwnd:
        return None
    rect = _RECT()
    if not user32.GetClientRect(ctypes.c_void_p(hwnd), ctypes.byref(rect)):
        return None
    point = _POINT(0, 0)
    if not user32.ClientToScreen(ctypes.c_void_p(hwnd), ctypes.byref(point)):
        return None
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    if width <= 0 or height <= 0 or point.x < -1000:
        return None
    return (point.x, point.y, point.x + width, point.y + height)


user32.GetClientRect.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
user32.ClientToScreen.argtypes = [ctypes.c_void_p, ctypes.c_void_p]


def ease(current: int, target: int, factor: float = 0.4) -> int:
    delta = target - current
    if delta == 0:
        return target
    step = int(delta * factor)
    if step == 0:
        step = 1 if delta > 0 else -1
    return current + step


WORDS = {
    'zh': {
        'waiting': '○ 等待游戏…',
        'recording': '● 记录中',
        'notRunning': '○ 游戏未运行',
        'pending': '待发 {n}',
        'empty': '还没有读到对话',
        'dock': '吸附',
        'send': SEND_LABEL,
        'shot': SHOT_LABEL,
        'report': REPORT_LABEL,
    },
    'en': {
        'waiting': '○ waiting for game…',
        'recording': '● recording',
        'notRunning': '○ game not running',
        'pending': '{n} queued',
        'empty': 'nothing read yet',
        'dock': 'Dock',
        'send': "Read it~(●'◡'●)",
        'shot': 'Admire the view ο(=•ω＜=)ρ⌒☆',
        'report': 'Write a report ☆*: .｡. o(≧▽≦)o .｡.:*☆',
    },
}


class Widget:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.panel_path = data_dir / 'panel.json'
        self.command_path = data_dir / 'command.json'
        self.panel: dict = {}
        self.panel_stamp = 0.0

        self.collapsed = False
        self.card_side = 'left'
        self.height = HEIGHT
        self.width = WIDTH
        self.docked = True
        self.hover = -1
        self.enabled = False
        self.swap = None
        self.target = None
        self.animating = False
        self.game_hwnd = 0
        self.hidden_by_minimize = False
        self.last_unread = -1
        self.flash_until = 0.0
        self.last_box = None
        self.render_sig = None
        self.cached_image = None
        self.old_proc = None

        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.configure(bg=painter.CARD)
        self.root.geometry(f'{WIDTH}x{HEIGHT}+200+200')
        self.root.minsize(1, 1)
        self.root.update_idletasks()
        self._make_layered()

        self.buttons = []
        for index, action in enumerate(('send', 'shot', 'report')):
            canvas = tk.Canvas(self.root, highlightthickness=0, bd=0, bg=painter.CARD)
            canvas.bind('<Button-1>', lambda _e, a=action: self._invoke(a), add='+')
            canvas.bind('<Enter>', lambda _e, i=index: self._set_hover(i))
            canvas.bind('<Leave>', lambda _e: self._set_hover(-1))
            self.buttons.append(canvas)

        self.dock_btn = self._chip(lambda: self.dock_now())
        self.hide_btn = self._chip(lambda: self.collapse())
        self.quit_btn = self._chip(lambda: self.quit())

        # 注意 add='+'：<Button-1> 与 <ButtonPress-1> 是同一序列，直接 bind 会把按钮自己的
        # 点击绑定覆盖掉（点不到、拖不动的元凶）
        for widget in (self.root, *self.buttons, self.dock_btn, self.hide_btn, self.quit_btn):
            widget.bind('<ButtonPress-1>', self._drag_start, add='+')
            widget.bind('<B1-Motion>', self._drag_move, add='+')
        # 「点一下展开」只绑在根窗口：绑到按钮上会和按钮自己的命令打架
        # （点「—」→ collapse，再被 _on_click 立刻 restore 回来）
        self.root.bind('<Button-1>', self._on_click, add='+')

        self._drag_origin = None
        self._window_origin = None
        self.rects: dict = {}
        self._layout_rects()
        self.root.after(40, self.tick)
        self.root.after(200, self.follow_game)

    # -- 窗口 -----------------------------------------------------------
    def _chip(self, command) -> tk.Canvas:
        canvas = tk.Canvas(self.root, highlightthickness=0, bd=0, bg=painter.CARD,
                           cursor='hand2')
        canvas.bind('<Button-1>', lambda _e: command(), add='+')
        return canvas

    def hwnd(self) -> int:
        return user32.GetAncestor(ctypes.c_void_p(self.root.winfo_id()), 2) or 0

    def _make_layered(self) -> None:
        hwnd = self.hwnd()
        if not hwnd:
            return
        style = user32.GetWindowLongW(ctypes.c_void_p(hwnd), GWL_EXSTYLE)
        user32.SetWindowLongW(ctypes.c_void_p(hwnd), GWL_EXSTYLE, style | WS_EX_LAYERED)

    def _window_pos(self) -> tuple:
        rect = _RECT()
        hwnd = self.hwnd()
        if hwnd and user32.GetWindowRect(ctypes.c_void_p(hwnd), ctypes.byref(rect)):
            return int(rect.left), int(rect.top)
        return self.root.winfo_x(), self.root.winfo_y()

    # -- 布局 -----------------------------------------------------------
    def _layout_rects(self) -> None:
        margin = 28
        status_h = 28
        speaker_h = 30
        action_h = 60
        action_gap = 14
        footer_h = 36
        text_h = max(112, self.height - margin * 2 - status_h - speaker_h
                     - 3 * action_h - 2 * action_gap - footer_h - 3 * 30)
        blocks = status_h + speaker_h + text_h + 3 * action_h + 2 * action_gap + footer_h
        gap = max(12, int((self.height - margin * 2 - blocks) / 3))

        y = margin
        self.rects['status'] = (TEXT_X, y, TEXT_W, status_h)
        y += status_h + gap
        self.rects['speaker'] = (TEXT_X, y, TEXT_W, speaker_h)
        self.rects['line'] = (TEXT_X, y + speaker_h + 2, TEXT_W, max(64, text_h - speaker_h - 2))
        y += text_h + gap
        buttons = []
        for _ in range(3):
            buttons.append((TEXT_X - 4, y, TEXT_W + 4, action_h))
            y += action_h + action_gap
        self.rects['buttons'] = buttons

        footer_center = self.height - 47
        self.rects['dock'] = (TEXT_X - 4, footer_center - 14, 48, 28)
        self.rects['hide'] = (WIDTH - 98, footer_center - 14, 30, 28)
        self.rects['quit'] = (WIDTH - 60, footer_center - 21, 42, 42)

        self._place(self.buttons, buttons)
        self._place([self.dock_btn, self.hide_btn, self.quit_btn],
                    [self.rects['dock'], self.rects['hide'], self.rects['quit']])

    @staticmethod
    def _place(widgets, rects) -> None:
        for widget, rect in zip(widgets, rects):
            widget.place(x=rect[0], y=rect[1], width=rect[2], height=rect[3])

    # -- 画面 -----------------------------------------------------------
    def _words(self) -> dict:
        """界面语言：面板把自己的语言写进设置，这里跟着切。"""
        locale = str((self.panel.get('settings') or {}).get('locale') or 'zh')
        return WORDS.get(locale, WORDS['zh'])

    def _state(self) -> dict:
        counts = self.panel.get('counts', {}) or {}
        unread = int(counts.get('unread') or 0)
        online = bool((self.panel.get('connection') or {}).get('online'))
        last = self.panel.get('lastLine') or ''
        settings = self.panel.get('settings') or {}

        if time.time() < self.flash_until:
            self.last_unread = unread
        if unread > self.last_unread:
            self.flash_until = time.time() + 0.9
        self.last_unread = unread

        words = self._words()
        if self.hidden_by_minimize:
            status = words['notRunning']
        elif online:
            status = words['recording']
        else:
            status = words['waiting']
        if unread:
            status += ' · ' + words['pending'].format(n=unread)
        if time.time() < self.flash_until:
            status += ' ✦'

        speaker = self.panel.get('lastSpeaker') or ''
        return {
            'collapsed': self.collapsed,
            'side': self.card_side,
            'radius': RADIUS,
            'rects': self.rects,
            'hover': self.hover,
            'enabled': self.enabled,
            'report_ready': bool(settings.get('reportDir')),
            'texts': {
                'status': status,
                'speaker': speaker,
                'line': last or words['empty'],
                'buttons': [words['send'], words['shot'], words['report']],
                'dock': words['dock'],
            },
            'colors': {
                'status': painter.ACCENT if online else painter.FG_DIM,
                'line': painter.FG if last else painter.FG_DIM,
            },
        }

    def render(self, width: int | None = None, x: int | None = None, y: int | None = None) -> None:
        width = width or (BAR_W if self.collapsed else WIDTH)
        hwnd = self.hwnd()
        if not hwnd:
            return
        px, py = (self._window_pos() if x is None or y is None else (x, y))
        state = self._state()
        signature = (width, self.height, self.card_side, state['hover'], state['collapsed'],
                     state['texts']['status'], state['texts']['speaker'], state['texts']['line'],
                     state['colors']['status'], state['colors']['line'],
                     state['enabled'], state['report_ready'])
        if signature != self.render_sig or self.cached_image is None:
            self.render_sig = signature
            self.cached_image = painter.compose(width, self.height, state)
        painter.push(hwnd, self.cached_image, px, py)
        self.width = width

    def tick(self) -> None:
        try:
            self._poll_panel()
            self.render()
        finally:
            self.root.after(400, self.tick)

    def _poll_panel(self) -> None:
        try:
            stamp = self.panel_path.stat().st_mtime
        except OSError:
            return
        if stamp == self.panel_stamp:
            return
        self.panel_stamp = stamp
        try:
            self.panel = json.loads(self.panel_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return
        self.enabled = True

    # -- 吸附 -----------------------------------------------------------
    def follow_game(self) -> None:
        strong = str((self.panel.get('settings') or {}).get('dockMode') or 'normal') == 'strong'
        interval = 16 if self.collapsed else (120 if strong else 200)
        hwnd = self.game_hwnd if user32.IsWindow(ctypes.c_void_p(self.game_hwnd)) else find_game_window()
        self.game_hwnd = hwnd
        minimized = bool(hwnd) and bool(user32.IsIconic(ctypes.c_void_p(hwnd)))
        if minimized != self.hidden_by_minimize:
            self.hidden_by_minimize = minimized
            if minimized:
                self.root.withdraw()
            else:
                self.root.deiconify()

        box = client_box(hwnd) if hwnd and not minimized else None
        if box:
            left, top, right, bottom = box
            moved = self.last_box is not None and box[:2] != self.last_box
            self.last_box = box[:2]
            if strong and moved:
                self.docked = True

            y = max(0, top + VERTICAL_OFFSET)
            height = max(MIN_HEIGHT, bottom - y)
            screen_w = self.root.winfo_screenwidth()
            margin = 64 if self.card_side == 'right' else 4
            fits_right = right + WIDTH <= screen_w - margin
            side = 'left' if fits_right else 'right'
            visible = BAR_W if self.collapsed else WIDTH
            target_x = right if fits_right else max(0, left - visible)
            if height != self.height:
                self.height = height
                self._layout_rects()
                self.render_sig = None

            if self.docked:
                if self.collapsed:
                    self._collapsed_step(side, target_x, y, moved)
                else:
                    if side != self.card_side:
                        self.card_side = side
                        self.render_sig = None
                    self.set_target(target_x, y, WIDTH)
        self.root.after(interval, self.follow_game)

    def set_target(self, x: int, y: int, width: int) -> None:
        self.target = (x, y, width)
        if not self.animating:
            self.animating = True
            self.root.after(1, self._animate)

    def _animate(self) -> None:
        if self.target is None:
            self.animating = False
            return
        tx, ty, tw = self.target
        x, y = self._window_pos()
        width = self.width
        if abs(tx - x) <= 1 and abs(ty - y) <= 1 and abs(tw - width) <= 1:
            self.render(tw, tx, ty)
            self.animating = False
            return
        nx = tx if abs(tx - x) <= 1 else ease(x, tx)
        ny = ty if abs(ty - y) <= 1 else ease(y, ty)
        nw = tw if abs(tw - width) <= 1 else ease(width, tw, 0.45)
        self.render(nw, nx, ny)
        self.root.after(16, self._animate)

    def _collapsed_step(self, side: str, target_x: int, target_y: int, moving: bool) -> None:
        if self.swap is not None:
            self.swap['frame'] += 1
            progress = min(1.0, self.swap['frame'] / self.swap['total'])
            eased = 1 - (1 - progress) ** 3
            nx = int(self.swap['from'] + (target_x - self.swap['from']) * eased)
            self.render(BAR_W, nx, target_y)
            if progress >= 1.0:
                self.card_side = side
                self.swap = None
                self._zorder(False)
                self.render_sig = None
            return
        if side != self.card_side:
            if moving:
                self.card_side = side
                self.render(BAR_W, target_x, target_y)
            else:
                self._zorder(True)
                self.swap = {'from': self._window_pos()[0], 'frame': 0, 'total': 44}
            return
        x, y = self._window_pos()
        if (x, y) != (target_x, target_y) or self.width != BAR_W:
            self.render(BAR_W, target_x, target_y)

    def _zorder(self, behind: bool) -> None:
        hwnd = self.hwnd()
        if not hwnd:
            return
        flags = 0x0001 | 0x0002 | 0x0010
        anchor = self.game_hwnd if behind and self.game_hwnd else -1
        user32.SetWindowPos(ctypes.c_void_p(hwnd), ctypes.c_void_p(anchor), 0, 0, 0, 0, flags)

    # -- 收起 / 展开 -----------------------------------------------------
    def collapse(self) -> None:
        if self.collapsed:
            return
        self.collapsed = True
        self.swap = None
        for widget in (*self.buttons, self.dock_btn, self.hide_btn, self.quit_btn):
            widget.place_forget()
        box = client_box(self.game_hwnd)
        x, y = self._window_pos()
        target = x
        if box:
            target = box[0] - BAR_W if self.card_side == 'right' else box[2]
        self.set_target(target, y, BAR_W)

    def restore(self) -> None:
        if not self.collapsed:
            return
        self.collapsed = False
        self.swap = None
        self._layout_rects()
        box = client_box(self.game_hwnd)
        x, y = self._window_pos()
        target = x
        if box:
            target = box[0] - WIDTH if self.card_side == 'right' else box[2]
        self.set_target(target, y, WIDTH)

    def dock_now(self) -> None:
        self.docked = True
        self.last_box = None
        box = client_box(self.game_hwnd)
        if box:
            y = max(0, box[1] + VERTICAL_OFFSET)
            visible = BAR_W if self.collapsed else WIDTH
            x = box[2] if box[2] + WIDTH <= self.root.winfo_screenwidth() - 4 else max(0, box[0] - visible)
            self.set_target(x, y, visible)

    # -- 交互 -----------------------------------------------------------
    def _set_hover(self, index: int) -> None:
        if self.hover == index:
            return
        self.hover = index
        self.render()

    def _on_click(self, event) -> None:
        # 绑定在 root 上会对所有子控件生效（toplevel 在它们的 bindtags 里），
        # 所以只认「点在卡片本体上」这一种。
        if event.widget is not self.root:
            return
        if self.collapsed:
            self.restore()

    def _invoke(self, action: str) -> None:
        if self.collapsed:
            self.restore()
            return
        payload = json.dumps({'action': action, 'at': int(time.time() * 1000)}, ensure_ascii=False)
        try:
            temp = self.command_path.with_suffix('.tmp')
            temp.write_text(payload, encoding='utf-8')
            os.replace(temp, self.command_path)
        except OSError:
            return

    def _drag_start(self, event) -> None:
        if self.collapsed:
            return
        self._drag_origin = (event.x_root, event.y_root)
        self._window_origin = self._window_pos()

    def _drag_move(self, event) -> None:
        if self.collapsed or self._drag_origin is None:
            return
        dx = event.x_root - self._drag_origin[0]
        dy = event.y_root - self._drag_origin[1]
        if abs(dx) + abs(dy) < 3:
            return
        self.docked = False
        self.animating = False
        self.target = None
        self.render(WIDTH, self._window_origin[0] + dx, self._window_origin[1] + dy)

    def quit(self) -> None:
        try:
            ctypes.windll.winmm.timeEndPeriod(1)
        except Exception:
            pass
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    Widget(data_dir).run()


if __name__ == '__main__':
    main()
