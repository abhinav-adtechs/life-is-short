"""The Life is short logo: a train window onto the summer meadow (the default view), with the sun, a cloud and a bird.

Run `python3 scripts/brand/logo.py` from the repo root. It writes two cuts:
  public/brand/logo.svg         rounded, clear corners: the app's brand mark, and app/icon.svg (the favicon)
  public/brand/logo-square.svg  full square: for icons that the platform rounds or crops itself
The PNGs next to them (and app/apple-icon.png, app/favicon.ico, app/opengraph-image.png) are rendered from these
two files; scripts/brand/README.md lists the sizes.
"""
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')


def art(inset):
    """The view through the window, drawn on a 432 grid and fitted inside the frame."""
    x0, x1 = inset, 512 - inset
    w = x1 - x0
    sx = lambda u: x0 + u * w / 432
    sy = lambda v: x0 + v * w / 432
    s = w / 432
    p = lambda *pts: ' '.join(f'{sx(x):.1f} {sy(y):.1f}' for x, y in pts)
    back = f'M{p((-10, 250))}C{p((60, 222), (120, 214), (190, 226))}C{p((260, 238), (330, 208), (442, 218))}V{sy(300):.1f}H{sx(-10):.1f}Z'
    hill = f'M{p((-10, 262))}C{p((70, 232), (150, 226), (226, 244))}S{p((370, 262), (442, 236))}V{sy(442):.1f}H{sx(-10):.1f}Z'
    seed = f'M{p((-10, 276))}C{p((70, 250), (150, 244), (226, 262))}S{p((370, 280), (442, 254))}V{sy(268):.1f}C{p((370, 294), (300, 282), (226, 272))}S{p((70, 262), (-10, 290))}Z'
    front = f'M{p((-10, 330))}C{p((110, 306), (250, 312), (442, 338))}V{sy(442):.1f}H{sx(-10):.1f}Z'
    puffs = [(78, 178, 24), (112, 158, 36), (152, 146, 42), (192, 162, 32), (222, 178, 22)]
    cloud = lambda dy=0, k=1: ''.join(f'<circle cx="{sx(cx):.1f}" cy="{sy(cy + dy):.1f}" r="{r * s * k:.1f}"/>' for cx, cy, r in puffs)
    base = lambda dy=0: f'<rect x="{sx(58):.1f}" y="{sy(170 + dy):.1f}" width="{184 * s:.1f}" height="{30 * s:.1f}" rx="{15 * s:.1f}"/>'
    bird = f'M{p((246, 104))}c{8*s:.1f} {-8*s:.1f} {16*s:.1f} {-7*s:.1f} {22*s:.1f} {4*s:.1f}c{6*s:.1f} {-11*s:.1f} {14*s:.1f} {-12*s:.1f} {22*s:.1f} {-4*s:.1f}'
    glare = f'M{p((250, -10), (310, -10), (120, 450), (60, 450))}Z'
    return (f'<g clip-path="url(#win)">'
            f'<rect x="{x0}" y="{x0}" width="{w}" height="{w}" fill="url(#sky)"/>'
            f'<circle cx="{sx(318):.1f}" cy="{sy(150):.1f}" r="{160 * s:.1f}" fill="url(#glow)"/>'
            f'<circle cx="{sx(318):.1f}" cy="{sy(150):.1f}" r="{42 * s:.1f}" fill="#FFF7DA"/>'
            f'<g fill="#B9CCEB">{cloud(10, 1.02)}{base(10)}</g><g fill="#FFFFFF">{cloud()}{base()}</g>'
            f'<path d="{back}" fill="#8EC3B0"/><path d="{hill}" fill="url(#hill)"/><path d="{seed}" fill="#F2D43A"/><path d="{front}" fill="url(#field)"/>'
            f'<path d="{bird}" fill="none" stroke="#173055" stroke-width="{7 * s:.1f}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{glare}" fill="#FFFFFF" opacity=".09"/>'
            f'<rect x="{x0}" y="{x0}" width="{w}" height="{60 * s:.1f}" fill="url(#lip)"/></g>')


def svg(square):
    outer_r, inset, r_in = (0, 44, 84) if square else (112, 34, 82)
    side = 512 - 2 * inset
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<title>Life is short</title>
<defs>
<linearGradient id="frame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6EFDF"/><stop offset="1" stop-color="#E2D6BC"/></linearGradient>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A5BCB"/><stop offset=".45" stop-color="#4E98E8"/><stop offset=".62" stop-color="#A9D3F2"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".75"/><stop offset=".45" stop-color="#FFF4D0" stop-opacity=".25"/><stop offset="1" stop-color="#FFF4D0" stop-opacity="0"/></radialGradient>
<linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8BCB5A"/><stop offset="1" stop-color="#5DB447"/></linearGradient>
<linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#45A63F"/><stop offset="1" stop-color="#2E7F31"/></linearGradient>
<linearGradient id="lip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A1E3C" stop-opacity=".28"/><stop offset="1" stop-color="#0A1E3C" stop-opacity="0"/></linearGradient>
<clipPath id="win"><rect x="{inset}" y="{inset}" width="{side}" height="{side}" rx="{r_in}"/></clipPath>
</defs>
<rect width="512" height="512" rx="{outer_r}" fill="url(#frame)"/>
{art(inset)}
<rect x="{inset}" y="{inset}" width="{side}" height="{side}" rx="{r_in}" fill="none" stroke="#C8BB9E" stroke-width="4"/>
</svg>
'''


if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'public', 'brand'), exist_ok=True)
    for path, text in [('public/brand/logo.svg', svg(False)), ('app/icon.svg', svg(False)), ('public/brand/logo-square.svg', svg(True))]:
        with open(os.path.join(ROOT, path), 'w') as fh:
            fh.write(text)
        print(path, len(text))
