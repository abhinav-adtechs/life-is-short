'use client';

import { useRef } from 'react';
import { usePlanner } from './Planner';
import { useTrap } from './hooks';
import { XIcon } from './icons';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { Analytics } from './Analytics';
import { SharingSection } from './SharingSection';

const TITLES = { analytics: 'Analytics', share: 'Share', settings: 'Settings', edit: 'Edit task' };

/**
 * Analytics, Share, Settings and the task editor. On a laptop they slide in from the right over the planner, below
 * the header; on a phone they rise as a sheet. Esc or the scrim closes them.
 */
export function Panel() {
  const { wide, editorId, store, sheet, closeSheet, closeEditor } = usePlanner();
  const editing = editorId ? store.get(editorId) : undefined;
  const kind = editing ? 'edit' : sheet;
  if (!kind) return null;
  const close = editing ? closeEditor : closeSheet;
  return (
    <>
      <div className={'scrim' + (wide ? ' below-top' : '')} onClick={close} />
      <Frame key={kind + (editing?.id ?? '')} kind={kind} wide={wide} onClose={close}>
        {editing ? <Editor key={editing.id} task={editing} onClose={closeEditor} />
          : <div className="side-b">{kind === 'analytics' ? <Analytics /> : kind === 'share' ? <SharingSection /> : <Settings />}</div>}
      </Frame>
    </>
  );
}

function Frame({ kind, wide, onClose, children }: { kind: keyof typeof TITLES; wide: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useTrap(ref);
  return (
    <aside ref={ref} className={(wide ? 'side' : 'sheet') + (kind === 'edit' ? ' edit' : '')} role="dialog" aria-modal="true" aria-labelledby="panel-h" tabIndex={-1}>
      {!wide && <div className="grab" aria-hidden="true" />}
      <div className="side-h">
        <h2 id="panel-h">{TITLES[kind]}</h2>
        <span className="spacer" />
        {wide && <span className="kbd">esc</span>}
        <button type="button" className={'ib' + (wide ? '' : ' bare touch')} aria-label="Close" onClick={onClose}><XIcon size={wide ? 14 : 16} /></button>
      </div>
      {children}
    </aside>
  );
}
