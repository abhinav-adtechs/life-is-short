'use client';

import { usePlanner } from './Planner';
import { CheckIcon, TrashIcon } from './icons';

/**
 * While a task is dragged, Done and the trash rise in the chat bar's place: drop it on one to tick it off or delete
 * it, with Undo either way. A done task's Done unticks it, as its ring does.
 */
export function DropTray() {
  const { drag, store } = usePlanner();
  const v = drag.view;
  if (!v) return null;
  const isDone = store.get(v.id)?.status === 'done';
  return (
    <div className="tray" aria-hidden="true">
      <div className={'tray-t' + (v.zone === 'done' ? ' over' : '')} data-drop="done"><CheckIcon size={16} />{isDone ? 'Not done' : 'Done'}</div>
      <div className={'tray-t trash' + (v.zone === 'trash' ? ' over' : '')} data-drop="trash"><TrashIcon size={16} />Delete</div>
    </div>
  );
}
