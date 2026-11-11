'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { dayWord, fmtAgo } from '@/lib/format';
import { usePlanner } from './Planner';

interface Connection { id: string; clientName: string; redirectHost: string; createdAt: number; lastUsedAt: number | null; expiresAt: number }
interface Connections { keySet: boolean; connections: Connection[] }

/**
 * Settings → Claude: the address to paste into Claude's connector settings, every live connection and when it was
 * last used, and Disconnect. The list comes from mcp_connections (supabase/migrations/0009).
 */
export function ClaudeSection() {
  const { toast } = usePlanner();
  const [list, setList] = useState<Connections | null>(null);
  const [failed, setFailed] = useState<'migration' | 'error' | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/mcp`;

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('mcp_connections');
    if (error) { setFailed(/function|schema cache/i.test(error.message) ? 'migration' : 'error'); return; }
    setFailed(null);
    setList(data as Connections | null);
  }, []);

  useEffect(() => {
    load();
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [load]);

  const copy = () => {
    const done = navigator.clipboard?.writeText(url);
    if (!done) { toast('Couldn’t copy. Select the address and copy it.'); return; }
    done.then(() => toast('Address copied'), () => toast('Couldn’t copy. Select the address and copy it.'));
  };

  const disconnect = async (c: Connection) => {
    setConfirm(null);
    const { data } = await supabase().rpc('mcp_disconnect', { p_id: c.id });
    toast(data === 'ok' ? `Disconnected ${c.clientName}. Its access ended just now.` : 'Couldn’t disconnect. Try again.');
    load();
  };

  const now = Date.now();
  return (
    <section id="set-claude" className="set-sec" aria-labelledby="set-claude-h">
      <div className="set-h"><h3 id="set-claude-h">Claude</h3><span className="muted sm">a custom connector</span></div>
      <p className="note">
        Let Claude read and change your tasks: in claude.ai, open Settings → Connectors → Add custom connector and paste this address.
        Claude sends you back here to sign in and allow it.
      </p>
      <div className="sh-link">
        <input readOnly aria-label="Connector address" value={url} onFocus={e => e.currentTarget.select()} />
        <button type="button" className="btn pri sm" onClick={copy}>Copy</button>
      </div>
      {failed === 'migration' && <p className="warnbox" role="alert">Connecting Claude needs the database update in supabase/migrations/0009_connectors.sql. Run it in the Supabase SQL editor.</p>}
      {failed === 'error' && <p className="warnbox" role="alert">Couldn’t load your connections. <button type="button" className="link" onClick={load}>Try again</button></p>}
      {list && !list.keySet && <p className="warnbox" role="status">The database doesn’t know the server’s key yet, so Claude can’t connect. Run private.set_mcp_key_hash in the SQL editor (docs/setup.md).</p>}
      {list && list.connections.length === 0 && <p className="note">Nothing is connected.</p>}
      {list?.connections.map(c => (
        <div key={c.id} className="sh-card">
          <div className="sh-h">
            <div className="who">
              <b>{c.clientName}</b>
              <span>
                Connected {dayWord(c.createdAt, now)}{c.redirectHost ? ` from ${c.redirectHost}` : ''}
                {' · '}{c.lastUsedAt ? `last used ${fmtAgo(c.lastUsedAt, now)}` : 'not used yet'}
              </span>
            </div>
          </div>
          <div className="acct-f">
            {confirm === c.id ? (
              <>
                <span>Disconnect {c.clientName}? It loses access straight away.</span>
                <button type="button" className="btn sec sm" onClick={() => disconnect(c)}>Disconnect</button>
                <button type="button" className="link" onClick={() => setConfirm(null)}>Cancel</button>
              </>
            ) : (
              <button type="button" className="link armed" onClick={() => setConfirm(c.id)}>Disconnect</button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
