import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Google's OAuth review checks the home page (app/page.tsx) against the consent screen: the same app name, every
// scope explained, and the privacy policy linked, all without signing in. lib/server/google.ts holds the scopes
// (it's server-only, so it's read as text here).
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = read('app/page.tsx');

describe('home page', () => {
  it('explains every Google scope the app asks for', () => {
    const list = read('lib/server/google.ts').match(/SCOPES = \[([^\]]*)\]/)?.[1] ?? '';
    const scopes = [...list.matchAll(/'([^']+)'/g)].map(m => m[1].split('/').pop()!);
    expect(scopes).toContain('calendar.readonly');
    for (const scope of scopes) expect(page).toContain(scope);
  });

  it('names the app as the consent screen does and links the privacy policy', () => {
    expect(page).toContain(`title: 'Life is short'`);
    expect(page).toContain('href="/privacy"');
    expect(read('components/Auth.tsx')).not.toContain('Dump &amp; Slot');
  });
});
