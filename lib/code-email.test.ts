import { describe, expect, it } from 'vitest';
import { codeEmail } from './code-email';

const visible = (html: string) => html
  .replace(/<head>[\s\S]*?<\/head>/, '')
  .replace(/<div style="display:none[\s\S]*?<\/div>/, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ');

describe('the sign-in code email', () => {
  const mail = codeEmail('48213907');

  it('leads with the code, so it shows in the notification', () => {
    expect(mail.subject).toBe('48213907 is your code for a shared planner');
  });

  it('shows the code in two groups but reads as one number, to copy or autofill', () => {
    expect(mail.html).toContain('>4821</span><span');
    expect(mail.html).toContain('>3907</span>');
    expect(visible(mail.html)).toContain('48213907');
    expect(mail.text).toContain('\n48213907\n');
  });

  it('says how long it lasts and what to do if it wasn’t you, in both versions', () => {
    for (const body of [visible(mail.html), mail.text]) {
      expect(body).toContain('10 minutes');
      expect(body).toContain('Didn’t ask for this?');
    }
  });

  it('loads nothing from anywhere: no fonts, images or links that could track an open', () => {
    expect(mail.html).not.toMatch(/https?:|src=|href=|@import|url\(/i);
  });

  it('has a dark version in the app’s own colours', () => {
    expect(mail.html).toContain('prefers-color-scheme:dark');
    expect(mail.html).toContain('#0B0B0C');
    expect(mail.html).toContain('#FF6A33');
  });

  it('only ever puts digits in the page', () => {
    const odd = codeEmail('12<b>34</b>5678');
    expect(odd.html).not.toContain('<b>');
    expect(odd.subject).toBe('12345678 is your code for a shared planner');
  });
});
