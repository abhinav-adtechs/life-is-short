/**
 * Parse the model's reply, tolerating a stray code fence. `reply` is the one line it says back to you, `heard` what it
 * took a dictation to mean, and `learn` what it suggests remembering about how you talk (checked by lib/voice.ts).
 */
export function parseReply(text: string | undefined): { add: unknown[]; update: unknown[]; reply?: string; heard?: string; learn?: unknown } | null {
  if (!text) return null;
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(body) as unknown;
    if (Array.isArray(v)) return { add: v, update: [] };
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const reply = typeof o.reply === 'string' ? o.reply.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    const heard = typeof o.heard === 'string' ? o.heard.replace(/\s+/g, ' ').trim().slice(0, 4000) : '';
    const learn = o.learn && typeof o.learn === 'object' && !Array.isArray(o.learn) ? o.learn : null;
    return {
      add: Array.isArray(o.add) ? o.add : [], update: Array.isArray(o.update) ? o.update : [],
      ...(reply ? { reply } : {}), ...(heard ? { heard } : {}), ...(learn ? { learn } : {}),
    };
  } catch {
    return null;
  }
}
