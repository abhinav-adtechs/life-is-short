import { hasSupabase, supabase } from './supabase';
import type { AiResult, Via } from './capture';

/** Bearer token for our own API routes, so the server can check it's you. */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!hasSupabase()) return {};
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function postJson<T>(path: string, body: unknown, timeoutMs = 20000): Promise<{ status: number; data: T | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let data: T | null = null;
    try { data = await res.json() as T; } catch { data = null; }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the AI to change goals and their charts (lib/workflow.ts). Never throws: no key or a failure says so in `via`. */
export async function askWorkflow(prompt: string): Promise<{ result: { heard?: string; reply: string; ops: unknown[] } | null; via: Via }> {
  try {
    const { status, data } = await postJson<{ heard?: unknown; reply?: unknown; ops?: unknown; reason?: string }>('/api/workflow', { prompt }, 28000);
    if (status === 200 && data) {
      return { result: { reply: typeof data.reply === 'string' ? data.reply : '', ops: Array.isArray(data.ops) ? data.ops : [], ...(typeof data.heard === 'string' && data.heard ? { heard: data.heard } : {}) }, via: 'ai' };
    }
    return { result: null, via: data?.reason === 'no-key' ? 'no-key' : 'ai-error' };
  } catch {
    return { result: null, via: 'ai-error' };
  }
}

/** Ask the AI route to sort a dump. Never throws: a missing key or failure tells the caller to use the keyword parser. */
export async function sortDump(prompt: string): Promise<{ result: AiResult | null; via: Via }> {
  try {
    const { status, data } = await postJson<{ add?: unknown; update?: unknown; reply?: unknown; heard?: unknown; learn?: unknown; workflow?: unknown; reason?: string }>('/api/sort', { prompt }, 28000);
    if (status === 200 && data) {
      const result: AiResult = { add: Array.isArray(data.add) ? data.add : [], update: Array.isArray(data.update) ? data.update : [] };
      if (typeof data.reply === 'string') result.reply = data.reply;
      if (typeof data.heard === 'string') result.heard = data.heard;
      if (data.learn && typeof data.learn === 'object') result.learn = data.learn;
      if (Array.isArray(data.workflow)) result.workflow = data.workflow;
      return { result, via: 'ai' };
    }
    return { result: null, via: data?.reason === 'no-key' ? 'no-key' : 'ai-error' };
  } catch {
    return { result: null, via: 'ai-error' };
  }
}
