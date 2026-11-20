import { describe, expect, it, vi } from 'vitest';
import type { TaskRepo } from '../../repo/types';

vi.mock('server-only', () => ({}));
const settings: Record<string, unknown> = {};
const rows: Record<string, unknown>[] = [];
const repo: TaskRepo = {
  kind: 'supabase',
  async list() { return rows as never; },
  async put() { throw new Error('read only here'); },
  async remove() { throw new Error('read only here'); },
  subscribe() { return () => undefined; },
  async getSetting<T>(k: string) { return (settings[k] ?? null) as T | null; },
  async setSetting() { throw new Error('read only here'); },
};
vi.mock('./db', () => ({ connectionRepo: () => repo }));

const { InMemoryTransport } = await import('@modelcontextprotocol/server');
const { buildServer } = await import('./server');

/** A client for the real server, over an in-memory pair: initialize, then one request at a time. */
async function connect() {
  const [client, server] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  client.onmessage = m => { const r = m as Record<string, unknown>; if (typeof r.id === 'number') waiting.get(r.id)?.(r); };
  await buildServer({ token: 'test', clientId: 'test', scopes: [], extra: { tz: 'Asia/Kolkata' } }).connect(server);
  await client.start();
  let n = 0;
  const call = (method: string, params: unknown) => new Promise<Record<string, unknown>>(done => {
    const id = ++n;
    waiting.set(id, done);
    void client.send({ jsonrpc: '2.0', id, method, params } as never);
  });
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);
  return call;
}

const G = (id: string, title: string, parent: string | null, extra: Record<string, unknown> = {}) => ({
  id, title, section: null, results: [], by: null, status: 'active', created: 1, closedAt: null, updatedAt: 1, ...(parent ? { parent } : {}), ...extra,
});
const T = (id: string, goal: string) => ({ id, title: id, raw: '', notes: '', priority: 2, minutes: 30, start: null, due: null, status: 'open', created: 1, order: 1, doneAt: null, goal, updatedAt: 1 });

describe('the MCP server', () => {
  settings.goals = [
    G('ground', 'Close the round', null), G('gang', 'Reach out to 20 angels', 'ground'),
    G('gfund', 'Fund North', 'gang', { plan: { links: [{ from: 'tmemo', to: 'tcall' }], waits: [] } }), G('gra', 'Raiser A', 'gang'),
  ];
  rows.push(T('tmemo', 'gfund'), T('tcall', 'gfund'), T('tangid', 'gang'));

  it('offers delete_goal as its own tool, and repeats on create_task and update_task', async () => {
    const call = await connect();
    const list = await call('tools/list', {});
    type Tool = { name: string; inputSchema: { properties: Record<string, Record<string, unknown>> }; annotations?: Record<string, unknown> };
    const tools = (list.result as { tools: Tool[] }).tools;
    const del = tools.find(t => t.name === 'delete_goal')!;
    expect(del.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(Object.keys(del.inputSchema.properties).sort()).toEqual(['goal', 'with_tasks']);
    for (const name of ['create_task', 'update_task']) {
      const repeat = JSON.stringify(tools.find(t => t.name === name)!.inputSchema.properties.repeat);
      expect(repeat, name).toContain('"time"');
      expect(repeat, name).toContain('"freq"');
    }
    expect(tools).toHaveLength(11);
  });

  it('offers get_goal a depth, and its answer at any depth fits the schema it advertises', async () => {
    const call = await connect();
    const list = await call('tools/list', {});
    const tool = (list.result as { tools: { name: string; inputSchema: { properties: Record<string, unknown> }; outputSchema: Record<string, unknown> }[] }).tools.find(t => t.name === 'get_goal')!;
    expect(tool.inputSchema.properties.depth).toMatchObject({ type: 'integer', minimum: 1, maximum: 5 });
    expect(JSON.stringify(tool.outputSchema)).toContain('$ref');
    for (const depth of [undefined, 1, 2, 3, 5]) {
      const res = await call('tools/call', { name: 'get_goal', arguments: { goal: 'ground', ...(depth ? { depth } : {}) } });
      const out = res.result as { isError?: boolean; content: { text: string }[]; structuredContent: { flow: { steps: { id: string; flow?: { steps: { id: string; flow?: { arrows: unknown[] } }[] } }[] } } };
      expect(res.error, JSON.stringify(res.error)).toBeUndefined();
      expect(out.isError, out.content?.[0]?.text).toBeFalsy();
      const ang = out.structuredContent.flow.steps.find(s => s.id === 'goal:gang')!;
      if (!depth || depth === 1) expect(ang.flow).toBeUndefined();
      else expect(ang.flow!.steps.map(s => s.id).sort()).toEqual(['goal:gfund', 'goal:gra', 'tangid']);
      if (depth && depth >= 3) expect(ang.flow!.steps.find(s => s.id === 'goal:gfund')!.flow!.arrows).toEqual([{ from: 'tmemo', to: 'tcall' }]);
    }
    // Out of range is refused by the schema, with a message.
    const bad = await call('tools/call', { name: 'get_goal', arguments: { goal: 'ground', depth: 9 } });
    expect(JSON.stringify(bad)).toMatch(/depth/);
  });
});
