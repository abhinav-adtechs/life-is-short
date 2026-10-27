/** Parse the model's reply, tolerating a stray code fence. `reply` is the one line it says back to you. */
export function parseReply(text: string | undefined): { add: unknown[]; update: unknown[]; reply?: string } | null {
  if (!text) return null;
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(body) as unknown;
    if (Array.isArray(v)) return { add: v, update: [] };
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const reply = typeof o.reply === 'string' ? o.reply.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    return { add: Array.isArray(o.add) ? o.add : [], update: Array.isArray(o.update) ? o.update : [], ...(reply ? { reply } : {}) };
  } catch {
    return null;
  }
}
