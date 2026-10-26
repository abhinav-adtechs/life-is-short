'use client';

import { useRef, useState } from 'react';
import { normalizeImport } from '@/lib/importer';
import { hasSupabase, supabase } from '@/lib/supabase';
import { usePlanner } from './Planner';
import { useTrap } from './Editor';
import { XIcon } from './icons';
import { GoogleSection } from './GoogleSection';

type Theme = 'system' | 'light' | 'dark';
const readTheme = (): Theme => { try { const t = localStorage.getItem('ds.theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } };
function applyTheme(t: Theme) {
  try { if (t === 'system') localStorage.removeItem('ds.theme'); else localStorage.setItem('ds.theme', t); } catch { /* per-device only */ }
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}

export function Settings({ onClose }: { onClose: () => void }) {
  const { repo, email, store, toast, wide } = usePlanner();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [pw, setPw] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useTrap(sheet);

  const importFile = async (f: File) => {
    try {
      const list = normalizeImport(JSON.parse(await f.text()));
      if (!list.length) { toast('No tasks found in that file.'); return; }
      const before = store.write(list);
      const added = [...before.values()].filter(v => v == null).length;
      toast(`Imported ${list.length} tasks · ${added} new, ${list.length - added} updated`, () => store.restore(before));
      onClose();
    } catch {
      toast('That file isn’t a tasks export.');
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast('Use at least 8 characters.'); return; }
    const { error } = await supabase().auth.updateUser({ password: pw });
    toast(error ? error.message : 'Password updated');
    if (!error) { setPw(''); setPwOpen(false); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={sheet} className={'sheet set' + (wide ? ' dialog' : '')} role="dialog" aria-modal="true" aria-labelledby="set-h" tabIndex={-1}>
        <div className="stop">
          <span className="eyebrow" id="set-h">Settings</span>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}><XIcon size={18} /></button>
        </div>

        <h3 style={{ marginTop: 4 }}>Appearance</h3>
        <div className="seg full" role="radiogroup" aria-label="Theme" style={{ marginTop: 10 }}>
          {(['system', 'light', 'dark'] as Theme[]).map(t => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''}
              onClick={() => { setTheme(t); applyTheme(t); }}>
              {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>

        <GoogleSection />

        <h3>Your tasks</h3>
        <p className="muted">{repo.kind === 'supabase' ? 'Synced to your account across devices.' : 'Saved in this browser only. Add Supabase keys to sync between devices.'}</p>
        <div className="sacts">
          <button type="button" className="btn sec" onClick={() => file.current?.click()}>Import from a file</button>
          <input ref={file} type="file" accept="application/json,.json" hidden
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
        </div>

        {hasSupabase() && (
          <>
            <h3>Account</h3>
            <p>{email}</p>
            {pwOpen ? (
              <form onSubmit={changePassword} autoComplete="off">
                <div className="fld"><label htmlFor="new-pw">New password</label>
                  <input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
                <div className="sacts"><button type="submit" className="btn pri">Save password</button>
                  <button type="button" className="btn sec" onClick={() => setPwOpen(false)}>Cancel</button></div>
              </form>
            ) : (
              <div className="sacts">
                <button type="button" className="btn sec" onClick={() => setPwOpen(true)}>Change password</button>
                <button type="button" className="btn sec" onClick={() => supabase().auth.signOut()}>Sign out</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
