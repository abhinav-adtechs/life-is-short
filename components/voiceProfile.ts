'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskRepo } from '@/lib/repo/types';
import { EMPTY_VOICE, VOICE_KEY, normalizeVoice, type VoiceProfile } from '@/lib/voice';

type Fn = (p: VoiceProfile) => VoiceProfile;

/**
 * Your voice profile (lib/voice.ts), kept in your synced settings. Like your repeats, every change is a function of
 * the profile, laid over what's stored when it's saved: a chat learned on your phone and a word added on your laptop
 * both survive, and a save that fails stays pending for the next one. Read again whenever this tab comes back.
 */
export function useVoiceProfile(repo: TaskRepo, onError: (msg: string) => void) {
  const [profile, setProfile] = useState<VoiceProfile>(EMPTY_VOICE);
  const stored = useRef<VoiceProfile>(EMPTY_VOICE);
  const pending = useRef<Fn[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const err = useRef(onError);
  err.current = onError;

  const view = useCallback(() => pending.current.reduce((p, f) => f(p), stored.current), []);
  const show = useCallback(() => setProfile(view()), [view]);

  const enqueue = useCallback(<T,>(job: () => Promise<T>) => {
    const run = queue.current.then(job);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const read = useCallback(() => enqueue(async () => {
    try { stored.current = normalizeVoice(await repo.getSetting(VOICE_KEY)); } catch { /* keep what we have */ }
    show();
  }), [repo, enqueue, show]);

  const change = useCallback((fn: Fn) => {
    pending.current.push(fn);
    show();
    return enqueue(async () => {
      const fns = [...pending.current];
      if (!fns.length) return;
      let base = stored.current;
      try { base = normalizeVoice(await repo.getSetting(VOICE_KEY)); } catch { /* offline: build on what we have */ }
      const next = fns.reduce((p, f) => f(p), base);
      try {
        if (next !== base) await repo.setSetting(VOICE_KEY, next);
      } catch (e) {
        err.current(e instanceof Error ? e.message : 'Couldn’t save your voice settings. Trying again with your next change.');
        stored.current = base;
        show();
        return;
      }
      stored.current = next;
      pending.current = pending.current.slice(fns.length);
      show();
    });
  }, [repo, enqueue, show]);

  useEffect(() => {
    read();
    const vis = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [read]);

  return { profile, change };
}

export type VoiceApi = ReturnType<typeof useVoiceProfile>;
