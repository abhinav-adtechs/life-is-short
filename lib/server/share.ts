import 'server-only';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { deviceLabel, isCode } from '../share';

/**
 * The viewer side of sharing. Viewers have no database account: every call goes through these routes,
 * which prove to the database that they're this app's server with SHARE_SERVER_KEY (the database keeps
 * only its sha256; supabase/migrations/0005). The viewer's session token lives in an HttpOnly cookie.
 */

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const key = () => process.env.SHARE_SERVER_KEY || '';

type Env = Record<string, string | undefined>;

export const shareConfigured = () => Boolean(url() && anon() && key().length >= 32);

/**
 * How codes go out: through a mailbox over SMTP (Gmail with an app password, no domain needed) when
 * SHARE_SMTP_USER and SHARE_SMTP_PASS are set, otherwise through Resend (a domain you've verified there).
 */
export function mailer(env: Env = process.env): 'smtp' | 'resend' | null {
  if (env.SHARE_SMTP_USER && env.SHARE_SMTP_PASS) return 'smtp';
  if (env.RESEND_API_KEY && env.SHARE_EMAIL_FROM) return 'resend';
  return null;
}
export const emailConfigured = () => mailer() != null;
/** Without an email service, development prints codes to the server log instead. */
export const canSendCodes = () => emailConfigured() || process.env.NODE_ENV !== 'production';

export const notConfigured = () => Response.json({ reason: 'not-configured' }, { status: 503 });

/** Call a viewer function as this server. */
export async function shareRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const sb = createClient(url(), anon(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc(fn, { p_key: key(), ...args });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Whether the database holds this server's key: 'ok', 'no-key' or 'wrong-key'. */
export const pingDatabase = () => shareRpc<string>('share_ping', {});

export const device = (req: Request) => deviceLabel(req.headers.get('user-agent'));

export async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? b as Partial<T> : {};
  } catch {
    return {};
  }
}

/* ---------- the viewer's session cookie ---------- */

// __Host- pins it to this exact origin over HTTPS. Plain http (local development) can't use the prefix.
// Behind a proxy that ends TLS, the request itself may say http; the proxy's header says what the browser used.
const secure = (req: Request) => new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
const cookieName = (req: Request) => (secure(req) ? '__Host-lis-view' : 'lis-view');

export function sessionToken(req: Request): string | null {
  const name = cookieName(req);
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()) || null;
  }
  return null;
}

export function sessionCookie(req: Request, token: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${cookieName(req)}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`;
}

export const clearCookie = (req: Request) => `${cookieName(req)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`;

/* ---------- the code email ---------- */

/** The email with the code. Plain and short, so it reads well anywhere. */
export function codeEmail(code: string) {
  const subject = `${code} is your code for a shared planner`;
  const text = `Your code to see the planner shared with you:\n\n${code}\n\nIt works for 10 minutes. If you didn’t ask for it, you can ignore this email.\n\nLife is short`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#0F0F10">`
    + `<p>Your code to see the planner shared with you:</p>`
    + `<p style="font-size:30px;font-weight:600;letter-spacing:.2em;margin:18px 0">${code}</p>`
    + `<p style="color:#6B6B70">It works for 10 minutes. If you didn’t ask for it, you can ignore this email.</p>`
    + `<p style="color:#6B6B70">Life is short</p></div>`;
  return { subject, text, html };
}

/** Who the code comes from: SHARE_EMAIL_FROM ("Name <address>" or a bare address), else the SMTP login. */
export function sender(env: Env = process.env): { name: string; address: string } {
  const raw = (env.SHARE_EMAIL_FROM || env.SHARE_SMTP_USER || '').trim();
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(raw);
  return { name: (m?.[1] || '').replace(/^"|"$/g, '').trim() || 'Life is short', address: (m ? m[2] : raw).trim() };
}

/** Gmail unless SHARE_SMTP_HOST says otherwise: TLS on 465, or STARTTLS on 587. Never plain text. */
export function smtpOptions(env: Env = process.env) {
  const port = Number(env.SHARE_SMTP_PORT) || 465;
  return {
    host: env.SHARE_SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user: env.SHARE_SMTP_USER || '', pass: env.SHARE_SMTP_PASS || '' },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };
}

/** What a failed send says, without the mail or the login. */
const why = (e: unknown) => {
  const x = e as { code?: string; responseCode?: number; message?: string };
  return [x.code, x.responseCode, (x.message || String(e)).split('\n')[0].slice(0, 160)].filter(Boolean).join(' ');
};

/** For Settings → Sharing: can the server log in to the mailbox? Resend can't be checked without sending. */
export async function checkMailer(): Promise<'ok' | 'login-failed' | 'unreachable'> {
  if (mailer() !== 'smtp') return 'ok';
  try {
    await nodemailer.createTransport(smtpOptions()).verify();
    return 'ok';
  } catch (e) {
    console.error('sharing: SMTP check failed:', why(e));
    return (e as { code?: string }).code === 'EAUTH' ? 'login-failed' : 'unreachable';
  }
}

/** Send a code. Returns whether it went. */
export async function sendCode(to: string, code: string): Promise<boolean> {
  if (!isCode(code)) return false;
  const via = mailer();
  if (!via) {
    if (process.env.NODE_ENV === 'production') return false;
    console.info(`[sharing] no email service set up; the code for ${to} is ${code}`);
    return true;
  }
  const mail = codeEmail(code);
  const from = sender();
  try {
    if (via === 'smtp') {
      // The recipient goes in as a parsed address, so no header parsing happens on it.
      await nodemailer.createTransport(smtpOptions()).sendMail({ from, to: { name: '', address: to }, ...mail });
      return true;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${from.name} <${from.address}>`, to: [to], ...mail }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error('sharing: the email service said', res.status);
    return res.ok;
  } catch (e) {
    console.error('sharing: could not send a code:', why(e));
    return false;
  }
}
