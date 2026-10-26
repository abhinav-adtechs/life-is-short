import { postJson } from './api';
import { supabase } from './supabase';
import { normalizeScope, type Scope, type SharedData, type ShareList, type RequestStatus } from './share';

/** Your side of sharing: the share_* functions in supabase/migrations/0005, as this signed-in session. */

const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T | null> => {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T | null;
};

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export async function loadShares(): Promise<ShareList | null> {
  const list = await rpc<ShareList>('share_list');
  if (!list) return null;
  return { ...list, shares: list.shares.map(s => ({ ...s, scope: normalizeScope(s.scope) })) };
}

export const createShare = (a: { email: string; name: string; scope: Scope; days: number | null }) =>
  rpc<{ id?: string; link?: string; error?: string }>('share_create', { p_email: a.email.trim(), p_name: a.name.trim(), p_scope: a.scope, p_days: a.days, p_tz: zone() });

/** Keys left out stay as they are; `days: null` is no end. */
export const updateShare = (id: string, patch: { name?: string; scope?: Scope; days?: number | null; endSessions?: boolean }) =>
  rpc<string>('share_update', { p_id: id, p_patch: patch });

export const revokeShare = (id: string) => rpc<string>('share_revoke', { p_id: id });
export const deleteShare = (id: string) => rpc<string>('share_delete', { p_id: id });
export const decideRequest = (id: string, status: RequestStatus) => rpc<string>('share_decide', { p_id: id, p_status: status });
export const previewShare = (id: string) => rpc<SharedData>('share_preview', { p_id: id });

/** Suggestions waiting for you. Never throws: the badge just stays as it was. */
export async function pendingCount(): Promise<number | null> {
  try { return (await rpc<number>('share_inbox')) ?? 0; } catch { return null; }
}

/** What's missing on the server before anyone can sign in, or null when it's all set. */
export async function sharingProblem(): Promise<string | null> {
  try {
    const { status, data } = await postJson<{ problem?: string | null }>('/api/share/status', {});
    return status === 200 ? data?.problem ?? null : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
