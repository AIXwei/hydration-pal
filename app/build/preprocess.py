# -*- coding: utf-8 -*-
"""
素材预处理：
1. 杯子.png(白底) -> cup.png  抠掉白底(floodfill 四角+杯内空气)，杯壁/沙/草保留
2. water_back.png -> water_crop.png  裁掉顶部留白，水面波浪线落在图顶
产物为 ASCII 命名，前端只引用产物，不直接引用中文名素材。
"""
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))

def knockout_white():
    src = os.path.join(BASE, "杯子.png")
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    # 种子：四角(外部白) + 杯内空气区(让杯内也透明，水猫透出)
    seeds = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3),
             (w // 2, 300), (w // 2, 420), (w // 2, 200)]
    for s in seeds:
        ImageDraw.floodfill(img, s, (255, 255, 255, 0), thresh=42)
    out = os.path.join(BASE, "cup.png")
    img.save(out)
    # 验证四角 + 中心 alpha
    px = img.load()
    print("cup.png saved", img.size)
    for name, p in [("角", (8, 8)), ("杯内上", (w // 2, 320)), ("中心", (w // 2, 512))]:
        print("  ", name, p, "RGBA=", px[p[0], p[1]])

def crop_water():
    src = os.path.join(BASE, "water_back.png")
    water = Image.open(src).convert("RGBA")
    w, h = water.size
    bb = alpha_bbox(water, 30)      # 水块实际范围
    left, right = bb[0], bb[2]      # 左右裁到水块边(去透明留白, 保证铺满贴壁)
    top = 205                       # 顶部固定裁: 去掉上方浮泡, 保留水面波浪
    bottom = min(h, 950)
    crop = water.crop((left, top, right, bottom))
    out = os.path.join(BASE, "water_crop.png")
    crop.save(out)
    print("water_crop.png saved", crop.size, "L=%d R=%d top=%d" % (left, right, top))

def alpha_bbox(img, th=40):
    """按 alpha 阈值求主体 bbox(避开边缘羽化)。返回 (l,t,r,b)。"""
    px = img.load()
    w, h = img.size
    minx, miny, maxx, maxy = w, h, 0, 0
    found = False
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if px[x, y][3] > th:
                found = True
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if not found:
        return (0, 0, w, h)
    return (minx, miny, maxx + 1, maxy + 1)

def detect_ring(crop):
    """泳圈粉色像素(限定下半,避开腮红)重心 + 水平跨度(圈外径宽)。
    返回 (cx, cy, ring_width)，crop 内坐标。"""
    px = crop.load()
    w, h = crop.size
    minx, maxx = w, 0
    sx = sy = n = 0
    for y in range(int(h * 0.40), h, 2):
        for x in range(0, w, 2):
            r, g, b, a = px[x, y]
            if a > 60 and r > 185 and (r - g) > 35 and (r - b) > 12:
                sx += x; sy += y; n += 1
                if x < minx: minx = x
                if x > maxx: maxx = x
    if n == 0:
        return w / 2.0, h * 0.7, w * 0.6
    return sx / float(n), sy / float(n), float(maxx - minx)

def normalize_cats():
    """三只猫归一化：按【泳圈宽度】统一缩放(视觉一致的正确基准) -> 按泳圈中心对齐贴同一画布。
    以 cat_1(用户认可的大小)为基准圈宽，cat_2/3 放大到同圈宽。
    产物 cat_1s/2s/3s.png 尺寸一致、三猫圈等大、泳圈中心固定在 (RCX_C, RCY_C)。"""
    CAT1_BODY_H = 560.0   # cat_1 主体高(维持其原大小)
    CW, CH = 1200, 1300   # 统一画布(留足 cat_3 举手/爱心空间)
    RCX_C, RCY_C = 600.0, 780.0  # 泳圈中心在画布的固定落点
    try:
        RES = Image.Resampling.LANCZOS
    except AttributeError:
        RES = Image.LANCZOS
    # 先采集三猫的裁剪图与泳圈信息
    data = {}
    for i in (1, 2, 3):
        img = Image.open(os.path.join(BASE, "cat_%d.png" % i)).convert("RGBA")
        crop = img.crop(alpha_bbox(img, 40))
        rcx, rcy, rw = detect_ring(crop)
        data[i] = (crop, rcx, rcy, rw)
    # 基准：cat_1 保持"主体高 560"的大小，其圈宽即目标圈宽
    crop1, _, _, rw1 = data[1]
    s1 = CAT1_BODY_H / float(crop1.size[1])
    TARGET_RING = rw1 * s1
    for i in (1, 2, 3):
        crop, rcx, rcy, rw = data[i]
        s = TARGET_RING / rw          # 按圈宽统一
        sw = max(1, round(crop.size[0] * s))
        sh = max(1, round(crop.size[1] * s))
        scaled = crop.resize((sw, sh), RES)
        canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        px_off = round(RCX_C - rcx * s)
        py_off = round(RCY_C - rcy * s)
        canvas.paste(scaled, (px_off, py_off), scaled)
        canvas.save(os.path.join(BASE, "cat_%ds.png" % i))
        print("cat_%ds.png" % i, canvas.size,
              "s=%.3f ringW=%.0f bodyH=%.0f" % (s, rw * s, crop.size[1] * s))

def process_new_assets():
    """抠掉 new/ 目录下四张 RGB 素材的白底，保存为 RGBA PNG。
    glass_back 已是 RGBA 不处理。"""
    new_dir = os.path.join(BASE, "new")
    # thresh=12：比 cups.png(42) 更保守，防止抠掉浅蓝水色/沙色
    # glass_front 需要额外内部种子（玻璃壁是封闭轮廓，四角 fill 无法进入内部）
    configs = {
        "glass_front.png": {
            "thresh": 12,
            "extra_seeds": [(768, 200), (768, 400), (768, 600), (768, 800),
                            (300, 500), (1200, 500)],  # 玻璃内部白底
        },
        "ground.png":     {"thresh": 12, "extra_seeds": []},
        "water_back.png": {"thresh": 12, "extra_seeds": []},
        "water_front.png":{"thresh": 12, "extra_seeds": []},
    }
    for fname, cfg in configs.items():
        src = os.path.join(new_dir, fname)
        img = Image.open(src).convert("RGBA")
        w, h = img.size
        seeds = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)] + cfg["extra_seeds"]
        for s in seeds:
            ImageDraw.floodfill(img, s, (255, 255, 255, 0), thresh=cfg["thresh"])
        img.save(src)
        px = img.load()
        interior = px[768, 400][3]  # 应该透明(0)
        print("processed %s thresh=%d interior_alpha=%d" % (fname, cfg["thresh"], interior))

if __name__ == "__main__":
    knockout_white()
    normalize_cats()
    process_new_assets()
    print("done")
