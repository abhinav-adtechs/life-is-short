/**
 * The sign-in code email for people you share with, in the app's own look: the Now block's ember dot and
 * tight title, the soft surface, quiet secondary text, light and dark (app/globals.css, Neutral theme).
 * No remote fonts or images, so it shows at once, nothing is blocked, and nothing can track an open.
 * Built from tables and inline styles, which is what email apps reliably show.
 */

const LIGHT = { bg: '#FFFFFF', ink: '#0F0F10', muted: '#6B6B70', hair: '#EDEDEF', soft: '#F4F4F5', accent: '#F04A0C' };
const DARK = { bg: '#0B0B0C', ink: '#F2F2F3', muted: '#8E8E93', hair: '#1F1F22', soft: '#18181B', accent: '#FF6A33' };
const FONT = `'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

/** Inline type, spelled out property by property: some email apps drop the `font` shorthand. */
const type = (size: number, weight: number, line: number | string, color: string, extra = '') =>
  `font-family:${FONT};font-size:${size}px;font-weight:${weight};line-height:${line};color:${color};${extra}`;

// Keeps the body text out of the inbox preview line after the preheader.
const SPACER = '&#847;&zwnj;&nbsp;'.repeat(40);

export function codeEmail(code: string) {
  const digits = code.replace(/\D/g, '');
  // Shown as two groups of four for reading; the text underneath stays one number to copy or autofill.
  const groups = digits.length === 8 ? [digits.slice(0, 4), digits.slice(4)] : [digits];
  const subject = `${digits} is your code for a shared planner`;
  const preheader = 'It works for 10 minutes. Type it on the page where you asked for it.';
  const L = LIGHT;

  const text = [
    'Your code to see the planner someone shared with you:',
    '',
    digits,
    '',
    'It works for 10 minutes. Type it on the page where you asked for it.',
    '',
    'Didn’t ask for this? You can ignore this email. Nobody sees anything without the code, and it stops working on its own.',
    '',
    'Life is short. Dump it. Slot it. Do it.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your code</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
@media (prefers-color-scheme:dark){
.lis-bg{background:${DARK.bg}!important}
.lis-ink{color:${DARK.ink}!important}
.lis-muted{color:${DARK.muted}!important}
.lis-soft{background:${DARK.soft}!important}
.lis-hair{border-top-color:${DARK.hair}!important}
.lis-dot{background:${DARK.accent}!important}
}
@media (max-width:520px){
.lis-pad{padding:36px 22px 40px!important}
.lis-code{font-size:30px!important}
}
</style>
</head>
<body class="lis-bg" style="margin:0;padding:0;background:${L.bg}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${preheader}${SPACER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="lis-bg" bgcolor="${L.bg}" style="background:${L.bg}">
<tr><td align="center" class="lis-pad" style="padding:56px 24px 56px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px">
<tr><td class="lis-muted" style="${type(13, 500, 1, L.muted)}"><span class="lis-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${L.accent};vertical-align:middle;margin:0 8px 2px 0"></span>Life is short</td></tr>
<tr><td class="lis-ink" style="padding-top:22px;${type(30, 600, 1.15, L.ink, 'letter-spacing:-0.03em;')}">Your code</td></tr>
<tr><td class="lis-muted" style="padding-top:12px;${type(14, 500, 1.45, L.muted)}">To see the planner someone shared with you. It works for 10&nbsp;minutes.</td></tr>
<tr><td style="padding-top:28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" class="lis-soft" bgcolor="${L.soft}" style="background:${L.soft};border-radius:16px;padding:28px 16px">${groups
    .map((g, i) => `<span class="lis-ink lis-code" style="${type(36, 600, 1, L.ink, `letter-spacing:0.12em;font-variant-numeric:tabular-nums;white-space:nowrap;${i ? 'padding-left:18px;' : ''}`)}">${g}</span>`)
    .join('')}</td>
</tr></table>
</td></tr>
<tr><td align="center" class="lis-muted" style="padding-top:14px;${type(13, 400, 1.5, L.muted)}">Type it on the page where you asked for it.</td></tr>
<tr><td style="padding-top:40px"><div class="lis-hair" style="border-top:1px solid ${L.hair};height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>
<tr><td class="lis-muted" style="padding-top:20px;${type(13, 400, 1.55, L.muted)}">Didn’t ask for this? You can ignore this email. Nobody sees anything without the code, and it stops working on its own.</td></tr>
<tr><td class="lis-ink" style="padding-top:28px;${type(14, 600, 1.5, L.ink, 'letter-spacing:-0.01em;')}">Life is short.<br><span class="lis-muted" style="font-weight:500;color:${L.muted}">Dump it. Slot it. Do it.</span></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
