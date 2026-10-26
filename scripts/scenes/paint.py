"""A small painterly SVG toolkit for the window views: skies, lit cumulus, hills, tree lines, motion-blurred
foregrounds, rain, rainbows. Everything is deterministic for a given seed.

A scene is painted in layers (sky, glow, clouds, land, near, ...). Each layer becomes its own SVG file, so the
browser rasterises it once and the app moves it with CSS transforms instead of repainting the whole view."""
import math, random, re

W, H = 1440, 900


def f(v):
    return f'{v:.0f}' if abs(v - round(v)) < .05 else f'{v:.1f}'


def smooth(pts, close_to=None):
    """Catmull-Rom through pts as a cubic path; close_to closes it down to that y."""
    d = f'M{f(pts[0][0])} {f(pts[0][1])}'
    for i in range(len(pts) - 1):
        p0 = pts[i - 1] if i else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < len(pts) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f'C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}'
    if close_to is not None:
        d += f'V{f(close_to)}H{f(pts[0][0])}Z'
    return d


def ridge(seed, y, amp, n=9, w=W, pad=60):
    r = random.Random(seed)
    xs = [-pad + (w + 2 * pad) * i / (n - 1) for i in range(n)]
    return [(x, y + r.uniform(-amp, amp)) for x in xs]


def ridge_y(pts, x):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0); t = t * t * (3 - 2 * t)
            return y0 + (y1 - y0) * t
    return pts[-1][1]


def stops(st):
    return ''.join(f'<stop offset="{o}" stop-color="{c}"{"" if a == 1 else f" stop-opacity={chr(34)}{a}{chr(34)}"}></stop>' for o, c, a in [(s + (1,))[:3] for s in st])


class Scene:
    def __init__(self, uid, w=W, h=H):
        self.uid, self.w, self.h = uid, w, h
        self.defs, self.seen, self.k = {}, {}, 0
        self.layers, self.cur = {}, 'sky'

    def to(self, layer):
        """Paint into this layer from here on."""
        self.cur = layer
        return self

    def nid(self, name):
        self.k += 1
        return f'{self.uid}-{name}{self.k}'

    def defn(self, i, s):
        """Store a def; an identical one already stored is reused, so a cloud bank shares its filters."""
        key = s.replace(f'id="{i}"', 'id=""')
        if key in self.seen:
            return self.seen[key]
        self.seen[key] = i
        self.defs[i] = s
        return i

    def add(self, s):
        self.layers.setdefault(self.cur, []).append(s)

    # ---- paint servers and filters ----
    def lin(self, st, x2=0, y2=1):
        i = self.nid('l')
        i = self.defn(i, f'<linearGradient id="{i}" x1="0" y1="0" x2="{x2}" y2="{y2}">{stops(st)}</linearGradient>')
        return f'url(#{i})'

    def rad(self, cx, cy, r, st, fx=None, fy=None):
        i = self.nid('r')
        fo = f' fx="{f(fx)}" fy="{f(fy)}"' if fx is not None else ''
        i = self.defn(i, f'<radialGradient id="{i}" cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}"{fo} gradientUnits="userSpaceOnUse">{stops(st)}</radialGradient>')
        return f'url(#{i})'

    def blur(self, sx, sy=None):
        i = self.nid('b')
        sd = f'{sx}' if sy is None else f'{sx} {sy}'
        i = self.defn(i, f'<filter id="{i}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="{sd}"></feGaussianBlur></filter>')
        return f'url(#{i})'

    def brush(self, scale=30, freq=.02, seed=4, soft=1.4):
        i = self.nid('br')
        i = self.defn(i, f'<filter id="{i}" x="-25%" y="-35%" width="150%" height="170%"><feTurbulence type="fractalNoise" baseFrequency="{freq}" numOctaves="4" seed="{seed}"></feTurbulence><feDisplacementMap in="SourceGraphic" scale="{scale}" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap><feGaussianBlur stdDeviation="{soft}"></feGaussianBlur></filter>')
        return f'url(#{i})'

    # ---- elements ----
    def sky(self, st):
        self.add(f'<rect width="{self.w}" height="{self.h}" fill="{self.lin(st)}"></rect>')

    def glow(self, x, y, r, st):
        self.add(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}" fill="{self.rad(x, y, r, st)}"></circle>')

    def rays(self, x, y, angles, length, color, op=.18, width=.05, blur=14):
        polys = ''
        for a in angles:
            a1, a2 = math.radians(a - width * 57), math.radians(a + width * 57)
            polys += f'<polygon points="{f(x)},{f(y)} {f(x + math.cos(a1) * length)},{f(y + math.sin(a1) * length)} {f(x + math.cos(a2) * length)},{f(y + math.sin(a2) * length)}"></polygon>'
        self.add(f'<g fill="{color}" opacity="{op}" filter="{self.blur(blur)}">{polys}</g>')

    def cloud(self, seed, cx, cy, w, h, n, rmin, rmax, light, pal, base=None, scale=30):
        """Cumulus: a dome of puffs, shaded away from `light`, lit toward it, with a soft flat base."""
        r = random.Random(seed)
        puffs = []
        for _ in range(n):
            x = cx + r.uniform(-w / 2, w / 2)
            t = 1 - ((x - cx) / (w / 2)) ** 2
            y = cy - r.uniform(0, max(h * t, 4)) * r.uniform(.6, 1)
            rr = r.uniform(rmin, rmax) * (.55 + .45 * t)
            puffs.append((x, y, rr))
        lx, ly = light
        dx, dy = lx - cx, ly - cy
        dl = math.hypot(dx, dy) or 1
        ux, uy = dx / dl, dy / dl
        circ = lambda ps, ox=0, oy=0, k=1: ''.join(f'<circle cx="{f(x + ox)}" cy="{f(y + oy)}" r="{f(rr * k)}"></circle>' for x, y, rr in ps)
        body = self.rad(cx + ux * w * .3, cy + uy * h * .5, max(w, h) * .95, [(0, pal['lit']), (.45, pal['mid']), (1, pal['shade'])], fx=cx + ux * w * .45, fy=cy + uy * h * .6)
        lit = [p for p in puffs if (p[0] - cx) * ux + (p[1] - cy) * uy > -h * .15]
        base = base if base is not None else cy + rmax * .55
        mid = self.nid('m')
        self.defn(mid, f'<mask id="{mid}"><rect x="{f(cx - w)}" y="{f(cy - h * 3)}" width="{f(w * 2)}" height="{f(base - cy + h * 3)}" fill="#fff"></rect><rect x="{f(cx - w)}" y="{f(base)}" width="{f(w * 2)}" height="40" fill="{self.lin([(0, "#fff"), (1, "#000")])}"></rect></mask>')
        self.add(f'<g filter="{self.brush(scale, .02, seed % 9 + 1)}"><g mask="url(#{mid})">'
                 f'<g fill="{pal["deep"]}" opacity=".55" filter="{self.blur(10)}">{circ(puffs, -ux * 6, 16, 1.02)}</g>'
                 f'<g fill="{body}">{circ(puffs)}</g>'
                 f'<g fill="{pal["hi"]}" opacity=".75" filter="{self.blur(5)}">{circ(lit, ux * 10, uy * 10 - 4, .62)}</g></g></g>')

    def band(self, pts, fill, bottom=None, extra=''):
        self.add(f'<path d="{smooth(pts, bottom if bottom is not None else self.h + 10)}" fill="{fill}" {extra}></path>')

    def trees(self, seed, pts, x0, x1, dens, color, rim=None, light=(1, 0), size=(14, 28), poplar=.3):
        r = random.Random(seed)
        out, rims = [], []
        x = x0
        while x < x1:
            y = ridge_y(pts, x) + 2
            if r.random() < poplar:
                hgt = r.uniform(size[1] * 1.6, size[1] * 2.6); wd = hgt * .17
                out.append(f'<ellipse cx="{f(x)}" cy="{f(y - hgt / 2)}" rx="{f(wd)}" ry="{f(hgt / 2)}"></ellipse>')
                if rim: rims.append(f'<ellipse cx="{f(x + light[0] * wd * .45)}" cy="{f(y - hgt / 2)}" rx="{f(wd * .35)}" ry="{f(hgt / 2 - 3)}"></ellipse>')
                x += r.uniform(8, 16) / dens
            else:
                rr = r.uniform(*size); m = r.randint(2, 5)
                for j in range(m):
                    cx = x + j * rr * .6 + r.uniform(-3, 3); cy = y - rr * r.uniform(.55, 1.35)
                    out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(rr * r.uniform(.6, 1))}"></circle>')
                if rim: rims.append(f'<circle cx="{f(x + m * rr * .6 * (1 if light[0] > 0 else 0))}" cy="{f(y - rr)}" r="{f(rr * .5)}"></circle>')
                x += (m * rr * .6 + r.uniform(0, 30)) / dens
        rimg = f'<g fill="{rim}" opacity=".45" filter="{self.blur(4)}">{"".join(rims)}</g>' if rim else ''
        self.add(f'<g><g fill="{color}">{"".join(out)}</g>{rimg}</g>')

    def lone_trees(self, seed, spots, color, shade, light=(1, 0)):
        r = random.Random(seed); out = ''
        for x, y, s in spots:
            out += f'<rect x="{f(x - s * .06)}" y="{f(y - s * .55)}" width="{f(s * .12)}" height="{f(s * .55)}" fill="{shade}"></rect>'
            for j in range(5):
                cx = x + r.uniform(-s * .35, s * .35); cy = y - s * .75 + r.uniform(-s * .3, s * .2)
                out += f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(s * r.uniform(.28, .42))}" fill="{color}"></circle>'
            out += f'<circle cx="{f(x - light[0] * s * .2)}" cy="{f(y - s * .62)}" r="{f(s * .3)}" fill="{shade}" opacity=".55"></circle>'
            out += f'<ellipse cx="{f(x - light[0] * s * .5)}" cy="{f(y + 2)}" rx="{f(s * .5)}" ry="{f(s * .07)}" fill="{shade}" opacity=".35"></ellipse>'
        self.add(f'<g filter="{self.brush(6, .06, 3, .4)}">{out}</g>')

    def speckle(self, seed, n, x0, x1, y0, y1, colors, size=(1.5, 4), blurx=0, period=None):
        r = random.Random(seed)
        dots = ''
        for _ in range(n):
            x, y, rx, ry, c = r.uniform(x0, x1), r.uniform(y0, y1), r.uniform(*size) * (3 if blurx else 1), r.uniform(*size), r.choice(colors)
            for k in self.copies(period):
                dots += f'<ellipse cx="{f(x + k)}" cy="{f(y)}" rx="{f(rx)}" ry="{f(ry)}" fill="{c}"></ellipse>'
        flt = f' filter="{self.blur(blurx, 1)}"' if blurx else ''
        self.add(f'<g{flt}>{dots}</g>')

    @staticmethod
    def copies(period):
        """Offsets that make content repeat seamlessly every `period` across a layer twice that wide."""
        return [0] if period is None else [-period, 0, period, 2 * period]

    def streaks(self, seed, n, y0, y1, colors, w=(80, 260), hgt=(1.5, 4), blur=(24, 1.5), period=W):
        r = random.Random(seed)
        s = ''
        for _ in range(n):
            x, y, ww, hh, c = r.uniform(0, period), r.uniform(y0, y1), r.uniform(*w), r.uniform(*hgt), r.choice(colors)
            for k in self.copies(period):
                s += f'<rect x="{f(x + k)}" y="{f(y)}" width="{f(ww)}" height="{f(hh)}" rx="2" fill="{c}"></rect>'
        self.add(f'<g filter="{self.blur(*blur)}">{s}</g>')

    def hedge(self, seed, n, y0, y1, fill, blur=(60, 3), period=W, rr=(30, 70)):
        r = random.Random(seed)
        s = ''
        for _ in range(n):
            x, y, rad = r.uniform(0, period), r.uniform(y0, y1), r.uniform(*rr)
            for k in self.copies(period):
                s += f'<circle cx="{f(x + k)}" cy="{f(y)}" r="{f(rad)}"></circle>'
        self.add(f'<g filter="{self.blur(*blur)}"><g fill="{fill}">{s}</g><rect x="-400" y="{f(y1)}" width="{3 * period + 800}" height="{self.h}" fill="{fill}"></rect></g>')

    def rainbow(self, cx, cy, r, width=34, op=.42):
        cols = ['#FF4B3E', '#FF9A2E', '#FFE04A', '#5BD16A', '#3FA9F5', '#5B5BE0', '#9B5BE0']
        mid = self.nid('rb')
        self.defn(mid, f'<mask id="{mid}"><rect width="{self.w}" height="{self.h}" fill="{self.lin([(0, "#000"), (.18, "#fff"), (.82, "#fff"), (1, "#000")], x2=1, y2=0)}"></rect></mask>')
        arcs = ''.join(f'<path d="M{f(cx - r + i * width / 7)} {f(cy)}A{f(r - i * width / 7)} {f(r - i * width / 7)} 0 0 1 {f(cx + r - i * width / 7)} {f(cy)}" stroke="{c}" stroke-width="{f(width / 7 + 1)}" fill="none"></path>' for i, c in enumerate(cols))
        self.add(f'<g opacity="{op}" mask="url(#{mid})" filter="{self.blur(3)}">{arcs}</g>')

    def stars(self, seed, n, y1, color='#fff', twinkle='twinkle'):
        """Stars; about a third go on the twinkle layer, which the app fades in and out."""
        r = random.Random(seed)
        still, tw = '', ''
        for _ in range(n):
            star = f'<circle cx="{f(r.uniform(0, self.w))}" cy="{f(r.uniform(0, y1) * r.uniform(.3, 1))}" r="{r.choice([.7, .9, 1.1, 1.4, 1.8])}"></circle>'
            if r.random() < .3: tw += star
            else: still += star
        self.add(f'<g fill="{color}">{still}</g>')
        layer = self.cur
        self.to(twinkle).add(f'<g fill="{color}">{tw}</g>')
        self.to(layer)

    # ---- output ----
    def files(self):
        """{layer: svg text}. Each file carries only the defs it uses."""
        out = {}
        for name, body in self.layers.items():
            text = ''.join(body)
            used, todo = set(), set(re.findall(r'url\(#([^)]+)\)', text))
            while todo:
                i = todo.pop()
                if i in used or i not in self.defs: continue
                used.add(i)
                todo |= set(re.findall(r'url\(#([^)]+)\)', self.defs[i]))
            defs = ''.join(d for i, d in self.defs.items() if i in used)
            # The near layer is two views wide and loops; clouds get a margin either side to drift into.
            x, w = (0, self.w * 2) if name == 'near' else (-self.w // 10, self.w * 6 // 5) if name == 'clouds' else (0, self.w)
            out[name] = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} 0 {w} {self.h}" width="{w}" height="{self.h}" preserveAspectRatio="none">'
                         f'<defs>{defs}</defs>{text}</svg>\n')
        return out


def drops(seed, n, w=W, h=H, big=(5, 14)):
    """Raindrops on the glass: a refracted body, a dark rim, a highlight; some with trails."""
    r = random.Random(seed)
    out = ['<defs><radialGradient id="dr-b" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".55"></stop><stop offset=".55" stop-color="#fff" stop-opacity=".08"></stop><stop offset="1" stop-color="#0d2a1a" stop-opacity=".35"></stop></radialGradient></defs>']
    for _ in range(n):
        x, y, s = r.uniform(0, w), r.uniform(0, h), r.choice([r.uniform(1.5, 4)] * 3 + [r.uniform(*big)])
        if s > 6 and r.random() < .5:
            out.append(f'<path d="M{f(x)} {f(y - s * 6)}Q{f(x + r.uniform(-3, 3))} {f(y - s * 3)} {f(x)} {f(y)}" stroke="#fff" stroke-opacity=".16" stroke-width="{f(s * .7)}" stroke-linecap="round" fill="none"></path>')
        out.append(f'<ellipse cx="{f(x)}" cy="{f(y)}" rx="{f(s)}" ry="{f(s * 1.12)}" fill="url(#dr-b)"></ellipse><circle cx="{f(x - s * .3)}" cy="{f(y - s * .35)}" r="{f(max(.6, s * .22))}" fill="#fff" fill-opacity=".85"></circle>')
    return ''.join(out)
