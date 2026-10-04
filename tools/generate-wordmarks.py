"""Original local arcade wordmarks. Standard library only; no external font."""
from pathlib import Path
from html import escape

FONT = {
    'A': ['01110','11011','11011','11111','11011','11011','11011'],
    'B': ['11110','11011','11011','11110','11011','11011','11110'],
    'C': ['01111','11000','11000','11000','11000','11000','01111'],
    'D': ['11110','11011','11011','11011','11011','11011','11110'],
    'E': ['11111','11000','11000','11110','11000','11000','11111'],
    'G': ['01111','11000','11000','11011','11011','11011','01110'],
    'H': ['11011','11011','11011','11111','11011','11011','11011'],
    'I': ['11111','01110','01110','01110','01110','01110','11111'],
    'Ï': ['01010','00000','11111','01110','01110','01110','01110','01110','11111'],
    'L': ['11000','11000','11000','11000','11000','11000','11111'],
    'N': ['11011','11111','11111','11111','11011','11011','11011'],
    'O': ['01110','11011','11011','11011','11011','11011','01110'],
    'R': ['11110','11011','11011','11110','11100','11010','11011'],
    'T': ['11111','01110','01110','01110','01110','01110','01110'],
    'U': ['11011','11011','11011','11011','11011','11011','01110'],
    'V': ['11011','11011','11011','11011','11011','01110','00100'],
    '!': ['01110','01110','01110','01110','01110','00000','01110'],
}


def wordmark(text, filename, colors, label):
    cell = 3
    x = 0
    tiles = []
    for char in text:
        if char == ' ':
            x += 3 * cell
            continue
        glyph = FONT[char]
        offset = 7 - len(glyph)
        for row, pixels in enumerate(glyph):
            # Stepped italic, so diagonals still follow a true pixel grid.
            italic = (6 - row - offset) // 2
            for col, filled in enumerate(pixels):
                if filled == '1':
                    tiles.append((x + col * cell + italic, (row + offset) * cell))
        x += 6 * cell
    d = ' '.join(f'M{px},{py}h{cell}v{cell}h-{cell}z' for px, py in tiles)
    w, h = x + 21, 48
    light, mid, low, edge = colors
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w*3}" height="{h*3}" viewBox="0 0 {w} {h}" shape-rendering="crispEdges" role="img" aria-label="{escape(label)}">
<title>{escape(label)}</title>
<defs>
 <path id="letters" d="{d}"/>
 <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{light}"/><stop offset=".36" stop-color="{light}"/><stop offset=".37" stop-color="{mid}"/><stop offset=".68" stop-color="{mid}"/><stop offset=".69" stop-color="{low}"/><stop offset="1" stop-color="{low}"/></linearGradient>
 <pattern id="dots" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="{light}" opacity=".32"/></pattern>
 <clipPath id="shape"><use href="#letters"/></clipPath>
</defs>
<g transform="translate(8 12)" stroke-linejoin="miter">
 <use href="#letters" transform="translate(3 5)" fill="#111723" stroke="{edge}" stroke-width="5"/>
 <use href="#letters" transform="translate(3 5)" fill="#173441" stroke="#0b1220" stroke-width="3"/>
 <use href="#letters" transform="translate(2 3)" fill="{low}" stroke="#0b1220" stroke-width="3"/>
 <use href="#letters" fill="#fff7d7" stroke="#fff7d7" stroke-width="4"/>
 <use href="#letters" fill="#111723" stroke="#111723" stroke-width="2"/>
 <use href="#letters" fill="url(#face)"/>
 <g clip-path="url(#shape)"><rect x="-1" y="13" width="{w}" height="10" fill="url(#dots)"/><rect x="-1" y="2" width="{w}" height="1" fill="#fffce8" opacity=".8"/></g>
</g>
</svg>'''
    Path(__file__).resolve().parent.parent.joinpath('assets', filename).write_text(svg)


if __name__ == '__main__':
    wordmark('BLUE NIGHT', 'blue-night-logo.svg', ('#edfaff', '#58dcf2', '#1886be', '#76eef2'), 'Blue Night')
    wordmark('VICTOIRE !', 'victory.svg', ('#f3ffb7', '#a5ef24', '#26932c', '#b6ff4a'), 'Victoire !')
    wordmark('AÏE !', 'defeat.svg', ('#fff0b4', '#ffb847', '#db6040', '#ffd385'), 'Aïe !')
