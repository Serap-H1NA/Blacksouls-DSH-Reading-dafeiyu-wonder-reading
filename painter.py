"""悬浮窗的绘制层：所有像素由 Pillow 合成，再整张推给 Windows（逐像素透明）。

tk 只负责事件与排版，画面不再由它画——这样圆角、细条、文字边缘才会有真正的
抗锯齿，也不会在改变大小时闪。
"""

from __future__ import annotations

import ctypes

from PIL import Image, ImageChops, ImageDraw, ImageFont

# -- 颜色（与 widget.py 保持一致）------------------------------------------
CARD = '#191d25'
CARD_SOFT = '#222834'
CARD_HOVER = '#2b3341'
FG = '#e8eaee'
FG_DIM = '#8b93a3'
ACCENT = '#d8b878'
DANGER = '#e8756b'

_FONT_DIR = 'C:/Windows/Fonts'
_REGULAR = f'{_FONT_DIR}/msyh.ttc'
_BOLD = f'{_FONT_DIR}/msyhbd.ttc'


def _font(px: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(_BOLD if bold else _REGULAR, px)
    except OSError:
        return ImageFont.load_default()


_SYMBOL_FONT = f'{_FONT_DIR}/seguisym.ttf'


_MISSING = None


def _has_glyph(font, char: str) -> bool:
    """拿一个未分配码位的字形当参照：跟它长得一样就说明字库里没有这个字。"""
    global _MISSING
    try:
        if _MISSING is None:
            _MISSING = bytes(font.getmask('\uffff'))
        if char.isspace():
            return True
        return bytes(font.getmask(char)) != _MISSING
    except Exception:
        return True


def draw_mixed(draw: ImageDraw.ImageDraw, xy: tuple, text: str, px: int, color: str,
               bold: bool = False) -> None:
    """逐字画：雅黑没有的字自动换成符号字体，避免出现方块。"""
    main = _font(px, bold)
    symbol = None
    x, y = xy
    for char in text:
        font = main
        if not _has_glyph(main, char):
            if symbol is None:
                try:
                    symbol = ImageFont.truetype(_SYMBOL_FONT, px)
                except OSError:
                    symbol = main
            font = symbol
        draw.text((x, y), char, font=font, fill=_rgba(color), anchor='lm')
        x += font.getlength(char)


# -- 形状 ------------------------------------------------------------------
def _rounded_mask(width: int, height: int, radius: int, side: str = 'both') -> Image.Image:
    """圆角遮罩。side: both / left（左边直）/ right（右边直）。"""
    scale = 3
    big = Image.new('L', (width * scale, height * scale), 0)
    draw = ImageDraw.Draw(big)
    draw.rounded_rectangle(
        [0, 0, width * scale - 1, height * scale - 1],
        radius=max(0, radius * scale),
        fill=255,
    )
    if side == 'left':
        draw.rectangle([0, 0, radius * scale, height * scale - 1], fill=255)
    elif side == 'right':
        draw.rectangle([width * scale - 1 - radius * scale, 0, width * scale - 1, height * scale - 1], fill=255)
    return big.resize((width, height), Image.LANCZOS)


_SHAPE_CACHE: dict = {}


def card_shape(width: int, height: int, radius: int, side: str, color: str = CARD) -> Image.Image:
    """一张带 alpha 的卡片底：直/圆由 side 决定（结果缓存，超采样很贵）。"""
    key = ('shape', width, height, radius, side, color)
    cached = _SHAPE_CACHE.get(key)
    if cached is not None:
        return cached.copy()
    mask = _rounded_mask(width, height, radius, side)
    fill = Image.new('RGBA', (width, height), _rgba(color))
    fill.putalpha(mask)
    _SHAPE_CACHE[key] = fill
    return fill.copy()


def _rgba(color: str) -> tuple:
    color = color.lstrip('#')
    if len(color) == 3:
        color = ''.join(ch * 2 for ch in color)
    return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


# -- 细条（收起态）---------------------------------------------------------
def bar(width: int, height: int, side: str) -> Image.Image:
    """收起后的竖线：形状 + 金线 + 中部握把，整张按 4 倍超采样再缩回来。

    ImageDraw 本身不做抗锯齿，直接画 1x 的话金线边缘全是台阶——所以整张放大画、
    再一次 LANCZOS 缩回去。
    """
    scale = 4
    big = Image.new('RGBA', (width * scale, height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    radius = max(6, min(width // 2, 16)) * scale
    draw.rounded_rectangle([0, 0, width * scale - 1, height * scale - 1],
                           radius=radius, fill=_rgba(CARD))
    if side == 'left':
        draw.rectangle([0, 0, radius, height * scale - 1], fill=_rgba(CARD))
    else:
        draw.rectangle([width * scale - 1 - radius, 0, width * scale - 1,
                        height * scale - 1], fill=_rgba(CARD))
    center = (width // 2) * scale
    draw.rounded_rectangle(
        [center - 2 * scale, 14 * scale, center + 2 * scale, (height - 14) * scale],
        radius=2 * scale, fill=_rgba(ACCENT),
    )
    middle = (height // 2) * scale
    draw.rounded_rectangle(
        [center - 6 * scale, middle - 42 * scale, center + 6 * scale, middle + 42 * scale],
        radius=6 * scale, fill=_rgba(ACCENT),
    )
    return big.resize((width, height), Image.LANCZOS)


# -- 文字 ------------------------------------------------------------------
def draw_text(layer: Image.Image, xy: tuple, text: str, px: int, color: str,
              width: int | None = None, lines: int = 1, bold: bool = False,
              anchor: str = 'la') -> None:
    draw = ImageDraw.Draw(layer)
    font = _font(px, bold)
    if width is None:
        draw.text(xy, text, font=font, fill=_rgba(color), anchor=anchor)
        return
    # 逐字折行（中文没有空格可断）
    rows: list[str] = []
    current = ''
    for char in text:
        if char == '\n':
            rows.append(current)
            current = ''
            continue
        if font.getlength(current + char) > width - 2:
            rows.append(current)
            current = char
        else:
            current += char
    rows.append(current)
    clipped = rows[:lines]
    if len(rows) > lines and clipped:
        last = clipped[-1]
        while last and font.getlength(last + '…') > width - 2:
            last = last[:-1]
        clipped[-1] = last + '…'
    x, y = xy
    for index, row in enumerate(clipped):
        draw.text((x, y + index * int(px * 1.45)), row, font=font, fill=_rgba(color), anchor=anchor)


# -- 整窗合成 --------------------------------------------------------------
def compose(width: int, height: int, state: dict) -> Image.Image:
    """把当前状态画成一张 RGBA 图。state 由 widget 提供。"""
    if state.get('collapsed'):
        return bar(width, height, state.get('side', 'left'))

    layer = card_shape(width, height, state.get('radius', 24), state.get('side', 'left'))
    rects = state.get('rects', {})
    texts = state.get('texts', {})
    colors = state.get('colors', {})

    status = rects.get('status')
    if status:
        draw_mixed(ImageDraw.Draw(layer), (status[0], status[1] + 13), texts.get('status', ''),
                   15, colors.get('status', FG_DIM))

    speaker = rects.get('speaker')
    if speaker and texts.get('speaker'):
        draw_text(layer, (speaker[0], speaker[1] + 2), texts['speaker'],
                  15, ACCENT, bold=True)

    line = rects.get('line')
    if line and texts.get('line'):
        draw_text(layer, (line[0], line[1]), texts['line'],
                  16, colors.get('line', FG), width=line[2], lines=3)

    for index, rect in enumerate(rects.get('buttons', [])):
        hovered = state.get('hover') == index
        enabled = state.get('enabled', True)
        block = Image.new('RGBA', (rect[2], rect[3]), (0, 0, 0, 0))
        block.alpha_composite(card_shape(rect[2], rect[3], 18,
                                         'both', CARD_HOVER if hovered else CARD_SOFT))
        layer.alpha_composite(block, (rect[0], rect[1]))
        label = texts.get('buttons', [''])[index] if index < len(texts.get('buttons', [])) else ''
        color = FG if enabled else FG_DIM
        if index == 2 and not state.get('report_ready', True):
            color = FG_DIM
        available = rect[2] - 36
        draw = ImageDraw.Draw(layer)
        size = 16
        font = _font(size)
        if font.getlength(label) <= available:
            draw_mixed(draw, (rect[0] + 18, rect[1] + rect[3] / 2), label, size, color)
        else:
            # 一行放不下就折两行（比一味缩小好读）
            size = 14
            font = _font(size)
            split = None
            best_score = -1
            for index in range(1, len(label)):
                first, second = label[:index], label[index:]
                if font.getlength(first) > available or font.getlength(second) > available:
                    continue
                # 优先在装饰性的符号/空格后面断行，读起来自然
                bonus = 2 if second[0] in ' ☆*·' else 0
                balance = abs(font.getlength(first) - font.getlength(second))
                score = bonus * 1000 - balance
                if score > best_score:
                    best_score = score
                    split = (first, second)
            if split:
                middle = rect[1] + rect[3] / 2
                draw_mixed(draw, (rect[0] + 18, middle - 9), split[0], size, color)
                draw_mixed(draw, (rect[0] + 18, middle + 9), split[1], size, color)
            else:
                while size > 11 and _font(size).getlength(label) > available:
                    size -= 1
                draw_mixed(draw, (rect[0] + 18, rect[1] + rect[3] / 2), label, size, color)

    dock = rects.get('dock')
    if dock:
        chip = Image.new('RGBA', (dock[2], dock[3]), (0, 0, 0, 0))
        chip.alpha_composite(card_shape(dock[2], dock[3], 10, 'both', '#2f3745'))
        layer.alpha_composite(chip, (dock[0], dock[1]))
        dock_label = (texts.get('dock') or '吸附')
        draw_text(layer, (dock[0] + dock[2] / 2, dock[1] + dock[3] / 2), dock_label, 12, FG, anchor='mm')

    hide = rects.get('hide')
    if hide:
        draw_text(layer, (hide[0] + hide[2] / 2, hide[1] + hide[3] / 2), '—', 15, FG_DIM, anchor='mm')
    quit_rect = rects.get('quit')
    if quit_rect:
        draw_text(layer, (quit_rect[0] + quit_rect[2] / 2, quit_rect[1] + quit_rect[3] / 2),
                  '×', 26, DANGER, anchor='mm')
    return layer


# -- 推给 Windows ----------------------------------------------------------
class _BLENDFUNCTION(ctypes.Structure):
    _fields_ = [
        ('BlendOp', ctypes.c_ubyte),
        ('BlendFlags', ctypes.c_ubyte),
        ('SourceConstantAlpha', ctypes.c_ubyte),
        ('AlphaFormat', ctypes.c_ubyte),
    ]


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ('biSize', ctypes.c_uint32), ('biWidth', ctypes.c_int32), ('biHeight', ctypes.c_int32),
        ('biPlanes', ctypes.c_uint16), ('biBitCount', ctypes.c_uint16),
        ('biCompression', ctypes.c_uint32), ('biSizeImage', ctypes.c_uint32),
        ('biXPelsPerMeter', ctypes.c_int32), ('biYPelsPerMeter', ctypes.c_int32),
        ('biClrUsed', ctypes.c_uint32), ('biClrImportant', ctypes.c_uint32),
    ]


class _BITMAPINFO(ctypes.Structure):
    _fields_ = [('bmiHeader', _BITMAPINFOHEADER), ('bmiColors', ctypes.c_uint32 * 3)]


user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

user32.GetDC.restype = ctypes.c_void_p
user32.GetDC.argtypes = [ctypes.c_void_p]
user32.ReleaseDC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
gdi32.CreateCompatibleDC.restype = ctypes.c_void_p
gdi32.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
gdi32.DeleteDC.argtypes = [ctypes.c_void_p]
gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
gdi32.SelectObject.restype = ctypes.c_void_p
gdi32.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
gdi32.CreateDIBSection.restype = ctypes.c_void_p
gdi32.CreateDIBSection.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint,
                                   ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.c_uint]
user32.UpdateLayeredWindow.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                                       ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                                       ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
user32.UpdateLayeredWindow.restype = ctypes.c_bool


def push(hwnd: int, image: Image.Image, x: int, y: int) -> None:
    """把 RGBA 图整张推给窗口（逐像素 alpha）。"""
    image = image.convert('RGBA')
    width, height = image.size
    # 完全透明的像素会被系统判成「可穿透」，点击就落不到这扇窗上。
    # 把 alpha=0 抬到 1（0.4% 不透明度，肉眼无感），命中测试就回到我们这边。
    alpha = image.getchannel('A').point(lambda value: 1 if value == 0 else value)
    premultiplied = ImageChops.multiply(image.convert('RGB'), Image.merge('RGB', (alpha, alpha, alpha)))
    merged = Image.merge('RGBA', (*premultiplied.split(), alpha))
    data = merged.tobytes('raw', 'BGRA')

    screen = user32.GetDC(None)
    mem = gdi32.CreateCompatibleDC(screen)
    info = _BITMAPINFO()
    info.bmiHeader.biSize = ctypes.sizeof(_BITMAPINFOHEADER)
    info.bmiHeader.biWidth = width
    info.bmiHeader.biHeight = -height
    info.bmiHeader.biPlanes = 1
    info.bmiHeader.biBitCount = 32
    info.bmiHeader.biCompression = 0
    bits = ctypes.c_void_p()
    bitmap = gdi32.CreateDIBSection(mem, ctypes.byref(info), 0, ctypes.byref(bits), None, 0)
    if not bitmap:
        gdi32.DeleteDC(mem)
        user32.ReleaseDC(None, screen)
        return
    ctypes.memmove(bits, data, len(data))
    old = gdi32.SelectObject(mem, bitmap)

    size = ctypes.c_int * 2
    point_src = (ctypes.c_long * 2)(0, 0)
    point_dst = (ctypes.c_long * 2)(x, y)
    blend = _BLENDFUNCTION(0, 0, 255, 1)   # AC_SRC_OVER / AC_SRC_ALPHA
    user32.UpdateLayeredWindow(
        ctypes.c_void_p(hwnd), ctypes.c_void_p(screen),
        ctypes.byref(point_dst), ctypes.byref(size(width, height)),
        ctypes.c_void_p(mem), ctypes.byref(point_src), 0,
        ctypes.byref(blend), 0x2,
    )
    gdi32.SelectObject(mem, old)
    gdi32.DeleteObject(ctypes.c_void_p(bitmap))
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(None, screen)
