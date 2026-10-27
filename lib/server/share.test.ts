import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sendMail = vi.fn();
const verify = vi.fn();
const createTransport = vi.fn(() => ({ sendMail, verify }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { checkMailer, mailer, sendCode, sender, smtpOptions } = await import('./share');

const MAIL_ENV = ['SHARE_SMTP_USER', 'SHARE_SMTP_PASS', 'SHARE_SMTP_HOST', 'SHARE_SMTP_PORT', 'RESEND_API_KEY', 'SHARE_EMAIL_FROM'];
const saved: Record<string, string | undefined> = {};
const setEnv = (vars: Record<string, string>) => { for (const [k, v] of Object.entries(vars)) process.env[k] = v; };

beforeEach(() => { for (const k of MAIL_ENV) { saved[k] = process.env[k]; delete process.env[k]; } vi.clearAllMocks(); });
afterEach(() => { for (const k of MAIL_ENV) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } vi.unstubAllGlobals(); });

describe('which mail service sends the codes', () => {
  it('a mailbox login (Gmail) wins, then Resend, else none', () => {
    expect(mailer({})).toBeNull();
    expect(mailer({ RESEND_API_KEY: 'k', SHARE_EMAIL_FROM: 'a@b.co' })).toBe('resend');
    expect(mailer({ SHARE_SMTP_USER: 'me@gmail.com', SHARE_SMTP_PASS: 'app pass', RESEND_API_KEY: 'k', SHARE_EMAIL_FROM: 'a@b.co' })).toBe('smtp');
    // Half a login isn't a login.
    expect(mailer({ SHARE_SMTP_USER: 'me@gmail.com' })).toBeNull();
  });

  it('Gmail over TLS by default; 587 upgrades with STARTTLS; never plain text', () => {
    expect(smtpOptions({ SHARE_SMTP_USER: 'u', SHARE_SMTP_PASS: 'p' })).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, requireTLS: true, auth: { user: 'u', pass: 'p' } });
    expect(smtpOptions({ SHARE_SMTP_HOST: 'smtp.example.com', SHARE_SMTP_PORT: '587' })).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true });
  });

  it('the sender: SHARE_EMAIL_FROM with or without a name, else the mailbox login', () => {
    expect(sender({ SHARE_SMTP_USER: 'codes@gmail.com' })).toEqual({ name: 'Life is short', address: 'codes@gmail.com' });
    expect(sender({ SHARE_EMAIL_FROM: 'me@gmail.com', SHARE_SMTP_USER: 'x@gmail.com' })).toEqual({ name: 'Life is short', address: 'me@gmail.com' });
    expect(sender({ SHARE_EMAIL_FROM: '"My planner" <share@example.com>' })).toEqual({ name: 'My planner', address: 'share@example.com' });
    expect(sender({ SHARE_EMAIL_FROM: '<share@example.com>' })).toEqual({ name: 'Life is short', address: 'share@example.com' });
  });
});

describe('sending a code', () => {
  it('through Gmail, to a parsed address', async () => {
    setEnv({ SHARE_SMTP_USER: 'codes@gmail.com', SHARE_SMTP_PASS: 'abcd efgh ijkl mnop' });
    sendMail.mockResolvedValue({ messageId: 'x' });
    expect(await sendCode('viewer@example.com', '12345678')).toBe(true);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', secure: true }));
    const msg = sendMail.mock.calls[0][0];
    expect(msg).toMatchObject({ from: { name: 'Life is short', address: 'codes@gmail.com' }, to: { name: '', address: 'viewer@example.com' } });
    expect(msg.subject).toContain('12345678');
    expect(msg.text).toContain('12345678');
  });

  it('says so when the mail server refuses, without logging the login', async () => {
    setEnv({ SHARE_SMTP_USER: 'codes@gmail.com', SHARE_SMTP_PASS: 'secret-app-pass' });
    sendMail.mockRejectedValue(Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendCode('viewer@example.com', '12345678')).toBe(false);
    expect(log.mock.calls.flat().join(' ')).toContain('EAUTH 535');
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret-app-pass');
    log.mockRestore();
  });

  it('through Resend when there is no mailbox login', async () => {
    setEnv({ RESEND_API_KEY: 're_test', SHARE_EMAIL_FROM: 'Life is short <share@example.com>' });
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await sendCode('viewer@example.com', '12345678')).toBe(true);
    expect(createTransport).not.toHaveBeenCalled();
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ from: 'Life is short <share@example.com>', to: ['viewer@example.com'] });
  });

  it('never sends anything that isn’t a code', async () => {
    setEnv({ SHARE_SMTP_USER: 'codes@gmail.com', SHARE_SMTP_PASS: 'p' });
    expect(await sendCode('viewer@example.com', '<b>hi</b>')).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('the setup check in Settings', () => {
  it('logs in to the mailbox and tells a wrong password apart from an unreachable server', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await checkMailer()).toBe('ok');
    setEnv({ SHARE_SMTP_USER: 'codes@gmail.com', SHARE_SMTP_PASS: 'p' });
    verify.mockResolvedValueOnce(true);
    expect(await checkMailer()).toBe('ok');
    verify.mockRejectedValueOnce(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));
    expect(await checkMailer()).toBe('login-failed');
    verify.mockRejectedValueOnce(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    expect(await checkMailer()).toBe('unreachable');
    log.mockRestore();
  });
});
