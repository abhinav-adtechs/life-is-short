import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fromRow, toRow } from '../../repo/supabase';
import type { TaskRepo } from '../../repo/types';
import { serverKey } from './config';
import { sha256hex } from './oauth';

/*
 * The MCP server's way into the database: the connection functions in supabase/migrations/0009, which answer only
 * this server (MCP_SERVER_KEY) and only for a live access token. Nothing here can read a task without both.
 */

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let client: SupabaseClient | null = null;
const sb = () => (client ??= createClient(url(), anon(), { auth: { persistSession: false, autoRefreshToken: false } }));

/** Call a connection function as this server. */
export async function mcpRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, { p_key: serverKey(), ...args });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Call one of your functions with your session, as the consent screen does. The server's key goes along too. */
export async function userRpc<T>(accessToken: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const asYou = createClient(url(), anon(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await asYou.rpc(fn, { p_key: serverKey(), ...args });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/**
 * The planner's TaskRepo (lib/repo/types.ts) for one connection: the same rows and row mapping as the Supabase
 * adapter (lib/repo/supabase.ts), through the connection functions instead of the table.
 */
export function connectionRepo(accessToken: string): TaskRepo {
  const t = sha256hex(accessToken);
  return {
    kind: 'supabase',
    async list() {
      const rows = await mcpRpc<Parameters<typeof fromRow>[0][]>('mcp_list', { p_access_sha256: t });
      return rows.map(fromRow);
    },
    async put(tasks) {
      // The database fills in whose they are.
      for (let i = 0; i < tasks.length; i += 100) {
        await mcpRpc('mcp_put', { p_access_sha256: t, p_rows: tasks.slice(i, i + 100).map(x => toRow(x, '')) });
      }
    },
    async remove(ids) {
      for (let i = 0; i < ids.length; i += 100) await mcpRpc('mcp_remove', { p_access_sha256: t, p_ids: ids.slice(i, i + 100) });
    },
    subscribe() { return () => undefined; },
    async getSetting<T>(key: string) {
      return (await mcpRpc<T | null>('mcp_setting', { p_access_sha256: t, p_name: key })) ?? null;
    },
    async setSetting(key, value) {
      await mcpRpc('mcp_set_setting', { p_access_sha256: t, p_name: key, p_value: value });
    },
  };
}
