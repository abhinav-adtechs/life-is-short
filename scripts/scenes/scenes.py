"""The six window views, painted in layers. Run `python3 scripts/scenes/scenes.py` from the repo root to write
public/scenes/<scene>/<layer>.svg. lib/scenes.ts lists the layers each scene has and how the app moves them:

  sky      static: sky, sun, far things            twinkle  stars that fade in and out
  glow     the sun's glow and rays, breathing        clouds   drifting slowly
  land     static: hills, fields, trees              float    balloons, bobbing
  blink    a light that blinks                       near     the passing foreground, twice as wide, looping
  wires    telegraph wires, dipping                  drops    rain on the glass
"""
import os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from paint import Scene, ridge, ridge_y, smooth, drops, W, H


def meadow():
    s = Scene('m')
    L = (1500, -300)
    s.to('sky').sky([(0, '#1A5BCB'), (.3, '#3C88E4'), (.52, '#86C0F0'), (.62, '#C8E5F4'), (.67, '#E9F4EC')])
    s.to('glow').glow(1440, -60, 700, [(0, '#FFFFFF', .7), (.4, '#E6F3FF', .25), (1, '#E6F3FF', 0)])
    mid = dict(lit='#FFFFFF', mid='#F1F5FC', shade='#AEBEE2', deep='#7E92C8', hi='#FFFFFF')
    far = dict(lit='#F6FAFF', mid='#E3ECF8', shade='#B9CAE6', deep='#9CB0D8', hi='#FFFFFF')
    s.to('clouds')
    s.cloud(3, 1220, 566, 380, 60, 20, 16, 36, L, far, base=572, scale=22)
    s.cloud(5, 640, 580, 300, 44, 16, 14, 28, L, far, base=584, scale=18)
    s.cloud(7, 150, 520, 420, 330, 60, 40, 90, L, mid, base=548)
    s.cloud(9, 1330, 470, 360, 280, 50, 34, 78, L, mid, base=500)
    s.cloud(11, 1090, 160, 200, 40, 14, 14, 28, L, mid, base=168, scale=20)
    s.to('land')
    hz = ridge(21, 600, 14, 10)
    s.band([(x, y - 28) for x, y in ridge(22, 600, 26, 8)], s.lin([(0, '#7FAFB6'), (1, '#9CC6B4')]), extra='opacity=".9"')
    s.band(hz, s.lin([(0, '#8BCB5A'), (1, '#5DB447')]))
    # patchwork: a rapeseed band, a dark field, a pale one, each following the land
    for i, (dy, amp, col) in enumerate([(9, 5, '#F2D43A'), (17, 6, '#58AC42'), (28, 8, '#A6D766'), (42, 10, '#3E9A39'), (60, 12, '#93CF5B')]):
        s.band([(x, y + dy) for x, y in ridge(30 + i, 600, amp, 8)], col)
    s.trees(41, hz, -20, 1460, 1.1, '#2A6A36', rim='#B4EB7E', light=(1, -1), size=(13, 24))
    s.lone_trees(5, [(260, 660, 46), (930, 668, 38), (1340, 652, 34)], '#2F7A37', '#1F5527', light=(1, -1))
    # a red barn on the far side
    s.add('<g transform="translate(560 612)"><rect x="0" y="-14" width="26" height="14" fill="#F4EEE2"></rect><path d="M-3 -13 L13 -26 L29 -13Z" fill="#C8402E"></path><rect x="9" y="-8" width="6" height="8" fill="#7A2A20"></rect></g>')
    s.band(ridge(50, 700, 10, 7), s.lin([(0, '#45A63F'), (1, '#2E7F31')]))
    s.to('near')
    s.speckle(60, 220, 0, W, 712, 820, ['#E8432E', '#E8432E', '#FFFFFF', '#FFE14A'], size=(1.4, 3.2), blurx=10, period=W)
    s.streaks(61, 35, 712, 800, ['#7BD06A', '#CFF29A', '#2C7B30'], blur=(22, 1.5))
    s.hedge(62, 75, 806, 860, s.lin([(0, '#2E6B2C'), (1, '#173D19')]))
    s.to('wires').add(WIRES.format(c='#1D2A3A', a=.45, b=.32))
    return s


WIRES = '<g fill="none" stroke="{c}" stroke-linecap="round"><path d="M-20 40C400 104 1000 104 1460 26" stroke-width="1.6" opacity="{a}"></path><path d="M-20 56C400 120 1000 120 1460 42" stroke-width="1.2" opacity="{b}"></path></g>'


def amber():
    s = Scene('a')
    SX, SY = 1060, 586
    L = (SX, SY)
    s.to('sky').sky([(0, '#27296E'), (.28, '#5E3F93'), (.45, '#C9608C'), (.56, '#FF8752'), (.62, '#FFC066'), (.66, '#FFE29A')])
    s.to('glow')
    s.glow(SX, SY, 640, [(0, '#FFF6DA'), (.06, '#FFE6A6', .95), (.25, '#FFB862', .5), (1, '#FF8A50', 0)])
    s.rays(SX, SY, [200, 214, 228, 243, 258, 272, 287, 301, 316, 331], 1300, '#FFD9A0', op=.18)
    lit = dict(lit='#FFE7AE', mid='#F59A7C', shade='#B5679A', deep='#5B3F86', hi='#FFF1C8')
    s.to('clouds')
    s.cloud(13, 240, 300, 520, 150, 46, 30, 70, L, lit, base=320)
    s.cloud(17, 1260, 250, 380, 110, 36, 24, 56, L, lit, base=270)
    s.cloud(19, 760, 470, 300, 40, 18, 12, 26, L, lit, base=474, scale=16)
    s.cloud(23, 120, 520, 260, 34, 14, 10, 22, L, lit, base=524, scale=14)
    s.to('land')
    s.add(f'<ellipse cx="{SX}" cy="{SY}" rx="300" ry="5" fill="#FFF4D0" opacity=".7" filter="{s.blur(3)}"></ellipse>')
    s.add(f'<circle cx="{SX}" cy="{SY}" r="40" fill="#FFF8E6"></circle>')
    hz = ridge(31, 604, 6, 10)
    s.band([(x, y - 22) for x, y in ridge(32, 604, 18, 8)], s.lin([(0, '#9A5E8E'), (1, '#C27A86')]))
    s.trees(43, hz, -20, 1460, 1.25, '#3B2034', rim='#FFB25C', light=(1, 0), size=(14, 26), poplar=.35)
    s.band(hz, s.lin([(0, '#F7B357'), (.4, '#E58A3E'), (1, '#B65A2C')]))
    furrows = ''.join(f'<line x1="{SX + (i - 16) * 5}" y1="608" x2="{SX + (i - 16) * 170}" y2="900"></line>' for i in range(33))
    s.add(f'<g stroke="#FFE0A0" stroke-opacity=".22" stroke-width="2">{furrows}</g>')
    s.add(f'<ellipse cx="{SX}" cy="640" rx="520" ry="40" fill="#FFE2A2" opacity=".35" filter="{s.blur(18)}"></ellipse>')
    s.band(ridge(51, 712, 8, 7), s.lin([(0, '#9A4B2E'), (1, '#5C2A22')]))
    s.to('near')
    s.streaks(63, 40, 716, 800, ['#FFC779', '#F09A4E', '#7A3A2A'], blur=(24, 1.5))
    s.hedge(64, 75, 806, 860, s.lin([(0, '#3A1E22'), (1, '#1C0F13')]))
    s.to('wires').add(WIRES.format(c='#2A1430', a=.5, b=.35))
    return s


def night():
    s = Scene('n')
    L = (900, 700)
    s.to('sky').sky([(0, '#0B1036'), (.26, '#1E2466'), (.44, '#43358A'), (.55, '#9A4E8E'), (.61, '#E0738A'), (.655, '#F7A57A')])
    s.stars(5, 170, 420)
    s.glow(1160, 150, 220, [(0, '#FFF3D2', .45), (1, '#FFF3D2', 0)])
    # a crescent moon: a disc with a bite taken out
    mid = s.nid('mn')
    s.defn(mid, f'<mask id="{mid}"><circle cx="1160" cy="150" r="30" fill="#fff"></circle><circle cx="1176" cy="140" r="27" fill="#000"></circle></mask>')
    s.add(f'<circle cx="1160" cy="150" r="30" fill="#FFF0CC" mask="url(#{mid})"></circle>')
    pal = dict(lit='#F6A08C', mid='#7A4B8E', shade='#3A2E6E', deep='#1E1B4A', hi='#FFC2A0')
    s.to('clouds')
    s.cloud(29, 300, 470, 620, 40, 26, 14, 30, L, pal, base=478, scale=14)
    s.cloud(31, 1180, 500, 520, 34, 22, 12, 26, L, pal, base=506, scale=14)
    s.cloud(33, 720, 380, 400, 26, 16, 10, 20, L, pal, base=386, scale=12)
    s.to('land')
    hz = ridge(35, 604, 8, 10)
    s.band([(x, y - 26) for x, y in ridge(36, 604, 22, 8)], s.lin([(0, '#4A3A7E'), (1, '#5C4683')]))
    s.band(hz, s.lin([(0, '#22204E'), (1, '#141436')]))
    # a far town on the plain below the horizon
    r = random.Random(7)
    lights = ''
    for _ in range(80):
        x = r.uniform(60, 1380)
        lights += f'<circle cx="{x:.0f}" cy="{ridge_y(hz, x) + r.uniform(4, 16):.0f}" r="{r.choice([1, 1.2, 1.6])}"></circle>'
    s.add(f'<g fill="#FFD48A" opacity=".85">{lights}</g>')
    s.trees(45, hz, -20, 1460, 1.0, '#0F0F2A', rim='#8E5C9A', light=(0, -1), size=(13, 24), poplar=.3)
    # a farmhouse with lit windows and a lamp's glow
    s.add(f'<g transform="translate(410 640)"><ellipse cx="20" cy="-10" rx="80" ry="40" fill="#FFB85C" opacity=".22" filter="{s.blur(16)}"></ellipse><rect x="0" y="-26" width="46" height="26" fill="#1A1838"></rect><path d="M-6 -24 L23 -46 L52 -24Z" fill="#141230"></path><rect x="7" y="-18" width="8" height="8" fill="#FFC861"></rect><rect x="30" y="-18" width="8" height="8" fill="#FFB247"></rect><rect x="38" y="-56" width="6" height="16" fill="#141230"></rect></g>')
    s.lone_trees(9, [(492, 640, 34)], '#121230', '#0A0A20', light=(-1, 0))
    s.band(ridge(52, 690, 10, 7), s.lin([(0, '#181838'), (1, '#0C0C22')]))
    s.to('near')
    s.streaks(66, 25, 700, 790, ['#3A3670', '#5A4A8A'], blur=(24, 1.5))
    s.hedge(67, 75, 806, 860, '#07071A')
    s.to('wires').add(WIRES.format(c='#05051A', a=.6, b=.45))
    return s


def rain():
    """After the rain: the storm leaves to the left, the sun comes out on the right, a rainbow over wet hills."""
    s = Scene('r')
    L = (1380, 40)
    s.to('sky').sky([(0, '#3D7FD8'), (.35, '#7DB3EC'), (.58, '#C9E2F1'), (.68, '#E8F2EA')])
    s.rainbow(300, 720, 340, width=48, op=.55)
    s.to('glow').glow(1390, 36, 620, [(0, '#FFFBEA', .85), (.35, '#FFF2C8', .3), (1, '#FFF2C8', 0)])
    slate = dict(lit='#B9C3D3', mid='#8592AA', shade='#5C6982', deep='#3E4A62', hi='#D6DDE8')
    white = dict(lit='#FFFFFF', mid='#EAF0F8', shade='#9FB0CE', deep='#7486AE', hi='#FFFFFF')
    s.to('clouds')
    s.add(f'<ellipse cx="60" cy="40" rx="620" ry="250" fill="#6A7891" opacity=".8" filter="{s.blur(46)}"></ellipse>')
    s.cloud(91, 170, 230, 640, 190, 48, 36, 80, L, slate, base=262, scale=34)
    s.cloud(93, 470, 100, 520, 100, 30, 28, 58, L, slate, base=120, scale=30)
    s.cloud(71, 1170, 380, 420, 130, 34, 24, 52, L, white, base=400, scale=22)
    s.cloud(73, 400, 560, 340, 44, 18, 12, 24, L, dict(lit='#DDE5EF', mid='#BAC6D8', shade='#8C9AB4', deep='#6E7C98', hi='#F4F7FB'), base=566, scale=14)
    s.cloud(75, 900, 520, 260, 36, 14, 10, 22, L, white, base=526, scale=14)
    s.to('land')
    hz = ridge(75, 616, 12, 10)
    s.band([(x, y - 34) for x, y in ridge(76, 616, 30, 8)], s.lin([(0, '#6FA7A0'), (1, '#8CBCA6')]))
    s.band(hz, s.lin([(0, '#7FD15A'), (1, '#46A843')]))
    for i, (dy, amp, col) in enumerate([(12, 6, '#A9E06A'), (28, 8, '#3F9A3B'), (50, 10, '#8ED35C'), (80, 12, '#2F8A36'), (120, 14, '#59B248')]):
        s.band([(x, y + dy) for x, y in ridge(80 + i, 616, amp, 8)], col)
    s.trees(85, hz, -20, 1460, 1.1, '#24622F', rim='#C8F48C', light=(1, -1), size=(12, 22), poplar=.25)
    # a lane winding down the hill, still wet and catching the light
    s.add(f'<path d="M900 626C870 666 760 690 780 740 800 790 960 820 900 910" fill="none" stroke="#D8E6C4" stroke-width="9" stroke-linecap="round" opacity=".55" filter="{s.blur(1.2)}"></path>')
    s.lone_trees(12, [(250, 720, 64), (1210, 700, 52)], '#2E7A35', '#1C5226', light=(1, -1))
    s.band(ridge(88, 800, 14, 7), s.lin([(0, '#3E9A39'), (1, '#256F2C')]))
    s.speckle(89, 260, 0, W, 806, 900, ['#FFFFFF', '#FFE14A', '#F2F7FF', '#FFB8C8'], size=(1.6, 3.4))
    s.to('drops').add(drops(11, 220))
    return s


def balloon():
    s = Scene('h')
    L = (200, -200)
    s.to('sky').sky([(0, '#1559C8'), (.28, '#3A88E4'), (.5, '#86C0F0'), (.64, '#CFE6F4'), (.7, '#E4F0F2')])
    ground(s)   # far below and static, so it goes with the sky; the clouds drift over it
    s.to('glow').glow(160, -40, 600, [(0, '#FFFFFF', .7), (.4, '#EAF4FF', .25), (1, '#EAF4FF', 0)])
    pal = dict(lit='#FFFFFF', mid='#F1F5FC', shade='#B4C3E2', deep='#8A9CCB', hi='#FFFFFF')
    s.to('clouds')
    for i, (cx, cy, w, h) in enumerate([(240, 560, 300, 60), (760, 600, 360, 50), (1240, 540, 280, 70), (520, 690, 220, 40), (1080, 700, 300, 50)]):
        s.cloud(100 + i, cx, cy, w, h, 22, 16, 40, L, pal, base=cy + 8, scale=20)
    s.to('float')
    s.add(balloon_at(1130, 300, 1.6, ['#E8382E', '#FFD23A'] * 3))
    s.add(balloon_at(260, 380, 1.0, ['#1E6FD8', '#FFFFFF', '#1E6FD8', '#FFFFFF', '#1E6FD8']))
    s.add(balloon_at(1300, 470, .6, ['#2DB37A', '#FF8A3D'] * 2))
    s.add(balloon_at(560, 470, .45, ['#8A4FD8', '#FFC2E0'] * 2))
    return s


def ground(s):
    """Patchwork farmland seen from above at an angle: rows of fields that widen toward us, a river, tiny trees."""
    r = random.Random(17)
    y_top, y_bot = 600, 920
    out = []
    rows = 9
    cols = ['#6FBF4A', '#8FD15A', '#4FA03E', '#C9D96A', '#E8D06A', '#7BAE48', '#A6C95C', '#5E9E44', '#D8C27A']
    for i in range(rows):
        t0, t1 = (i / rows) ** 1.7, ((i + 1) / rows) ** 1.7
        y0, y1 = y_top + (y_bot - y_top) * t0, y_top + (y_bot - y_top) * t1
        n = 9 - i // 2
        xs = sorted([-200] + [r.uniform(-100, W + 100) for _ in range(n)] + [W + 200])
        for a, b in zip(xs, xs[1:]):
            skew = (a - W / 2) * .18 * (1 - t1)
            skew2 = (b - W / 2) * .18 * (1 - t1)
            out.append(f'<path d="M{a + skew:.0f} {y0:.0f}L{b + skew2:.0f} {y0:.0f}L{b:.0f} {y1:.0f}L{a:.0f} {y1:.0f}Z" fill="{r.choice(cols)}" stroke="#3E6E32" stroke-opacity=".55" stroke-width="{1 + 2 * t1:.1f}"></path>')
    trees = ''
    for _ in range(260):
        ty = r.uniform(y_top + 10, y_bot)
        trees += f'<circle cx="{r.uniform(0, W):.0f}" cy="{ty:.0f}" r="{1 + (ty - y_top) / 110:.1f}" fill="#2E6A30" opacity=".7"></circle>'
    river = smooth([(-40, 700), (300, 660), (520, 690), (700, 640), (900, 650), (1100, 610), (1480, 620)])
    village = ''.join(f'<rect x="{r.uniform(980, 1080):.0f}" y="{r.uniform(628, 650):.0f}" width="5" height="4" fill="{r.choice(["#F4ECE0", "#E8DCCB"])}"></rect><rect x="{r.uniform(980, 1080):.0f}" y="{r.uniform(628, 650):.0f}" width="5" height="3" fill="#C8553A"></rect>' for _ in range(16))
    s.add(f'<g>{"".join(out)}{trees}<path d="{river}" fill="none" stroke="#BFE3F2" stroke-width="7" stroke-linecap="round" opacity=".9"></path><path d="{river}" fill="none" stroke="#E8F7FF" stroke-width="2" opacity=".8"></path>{village}</g>')
    s.add(f'<rect y="560" width="{W}" height="140" fill="{s.lin([(0, "#DDEEF5"), (1, "#DDEEF5", 0)])}"></rect>')


def balloon_at(x, y, sc, stripes):
    """A distant hot-air balloon: an envelope of coloured gores and a little basket."""
    g = ''
    n = len(stripes)
    for i, c in enumerate(stripes):
        a0, a1 = -1 + 2 * i / n, -1 + 2 * (i + 1) / n
        g += f'<path d="M{x + a0 * 4 * sc:.1f} {y + 34 * sc:.1f}C{x + a0 * 30 * sc:.1f} {y + 18 * sc:.1f} {x + a0 * 34 * sc:.1f} {y - 22 * sc:.1f} {x:.1f} {y - 30 * sc:.1f}C{x + a1 * 34 * sc:.1f} {y - 22 * sc:.1f} {x + a1 * 30 * sc:.1f} {y + 18 * sc:.1f} {x + a1 * 4 * sc:.1f} {y + 34 * sc:.1f}Z" fill="{c}"></path>'
    g += f'<path d="M{x - 4 * sc:.1f} {y + 34 * sc:.1f}L{x - 3 * sc:.1f} {y + 42 * sc:.1f}M{x + 4 * sc:.1f} {y + 34 * sc:.1f}L{x + 3 * sc:.1f} {y + 42 * sc:.1f}" stroke="#5A3A24" stroke-width="{max(.6, sc * .8):.1f}"></path><rect x="{x - 3.5 * sc:.1f}" y="{y + 42 * sc:.1f}" width="{7 * sc:.1f}" height="{5 * sc:.1f}" rx="{sc:.1f}" fill="#8A5A34"></rect>'
    g += f'<ellipse cx="{x - 10 * sc:.1f}" cy="{y - 8 * sc:.1f}" rx="{8 * sc:.1f}" ry="{18 * sc:.1f}" fill="#fff" opacity=".22"></ellipse>'
    return f'<g>{g}</g>'


def above():
    """Above the clouds at sunrise: a sea of cloud lit pink and gold, the wing tip in the corner."""
    s = Scene('p')
    SX, SY = 1060, 520
    L = (SX, SY)
    s.to('sky').sky([(0, '#14307E'), (.22, '#3B57AE'), (.4, '#9C7CC0'), (.5, '#F08FA0'), (.56, '#FFB47A'), (.6, '#FFE0A0')])
    s.add(f'<ellipse cx="{SX}" cy="{SY}" rx="520" ry="5" fill="#FFF6D8" opacity=".8" filter="{s.blur(2)}"></ellipse>')
    s.add(f'<circle cx="{SX}" cy="{SY - 4}" r="34" fill="#FFF8E8"></circle>')
    s.add(f'<rect y="{SY + 6}" width="{W}" height="{H}" fill="{s.lin([(0, "#E6A9B6"), (1, "#8C78B4")])}"></rect>')
    s.to('glow')
    s.glow(SX, SY, 600, [(0, '#FFF8E2'), (.05, '#FFEAB0', .95), (.25, '#FFC27A', .45), (1, '#FF9A7A', 0)])
    s.rays(SX, SY, [196, 212, 228, 244, 260, 276, 292, 308, 324, 340], 760, '#FFE2B0', op=.11, blur=14)
    # rows of lit cloud tops, bigger as they come closer
    far = dict(lit='#FFD9B0', mid='#E7A6B4', shade='#9E86B8', deep='#6A6098', hi='#FFF0D0')
    near = dict(lit='#FFE7C4', mid='#F2B3B8', shade='#A88EC4', deep='#6E62A0', hi='#FFF4DE')
    r = random.Random(5)
    s.to('clouds')
    k = 0
    for row, (y, wmin, wmax, hgt, pal) in enumerate([(SY + 24, 140, 220, 18, far), (SY + 64, 180, 280, 30, far), (SY + 128, 240, 360, 48, near), (SY + 222, 320, 460, 70, near), (SY + 336, 400, 560, 90, near)]):
        x = -160 + r.uniform(0, 80)
        while x < W + 160:
            w = r.uniform(wmin, wmax); k += 1
            s.cloud(200 + k, x + w / 2, y, w, hgt, int(10 + w / 18), hgt * .4, hgt * 1.0, L, pal, base=y + hgt * .5, scale=16 + row * 4)
            x += w * .78
    # the wing tip, sliding in from the lower left
    s.to('land')
    wing = s.lin([(0, '#F2F4F8'), (.5, '#C9CFD9'), (1, '#7F889B')], x2=.4, y2=1)
    s.add(f'<g><path d="M-100 880L380 600L452 610L170 980L-100 980Z" fill="{wing}"></path>'
          f'<path d="M-100 880L380 600L392 610L-80 900Z" fill="#FFFFFF" opacity=".6"></path>'
          f'<path d="M380 600L452 610L468 528L448 524Z" fill="#AEB6C4"></path>'
          f'<path d="M130 930L380 646" stroke="#8C95A8" stroke-width="2" opacity=".5"></path></g>')
    s.to('blink').add(f'<circle cx="458" cy="540" r="26" fill="#FF3B3B" opacity=".4" filter="{s.blur(7)}"></circle><circle cx="458" cy="540" r="5.5" fill="#FF3B3B"></circle>')
    return s


SCENES = {'meadow': meadow, 'amber': amber, 'night': night, 'rain': rain, 'balloon': balloon, 'above': above}

if __name__ == '__main__':
    root = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'scenes')
    only = sys.argv[1:] or list(SCENES)
    for name in only:
        d = os.path.join(root, name)
        os.makedirs(d, exist_ok=True)
        for old in os.listdir(d):
            os.remove(os.path.join(d, old))
        for layer, text in SCENES[name]().files().items():
            with open(os.path.join(d, layer + '.svg'), 'w') as fh:
                fh.write(text)
        print(name, sorted((n, os.path.getsize(os.path.join(d, n))) for n in os.listdir(d)))
