/**
 * Reading what a speech recogniser hands back (SpeechRecognition, or the apps' native one behind it): the words it has
 * settled on, the guess it's still revising, and where it wasn't sure. Pure, so components/hooks.ts stays small.
 */

/** A stretch the recogniser settled on, and what else it thought it might have been. Sent on to the AI. */
export interface Doubt { said: string; or: string[] }

export type SRAlternative = { transcript: string };
export type SRResult = ArrayLike<SRAlternative> & { isFinal: boolean };

/** Words joined with exactly one space: some browsers start each result with a space and some don't. */
export const joinWords = (...parts: string[]) => parts.map(p => p.trim()).filter(Boolean).join(' ');

/** Lowercase words without punctuation, for comparing what was heard. Keeps marks, so Devanagari survives. */
export const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{M}\p{N}']+/u).map(w => w.replace(/^'+|'+$/g, '')).filter(Boolean);

const startsWith = (a: string[], b: string[]) => b.length > 0 && b.length <= a.length && b.every((w, i) => a[i] === w);

/** `text` without its first `n` words, keeping its own spelling and punctuation. */
function dropWords(text: string, n: number) {
  const toks = text.trim().split(/\s+/);
  let seen = 0, i = 0;
  while (i < toks.length && seen < n) { seen += wordsOf(toks[i]).length; i++; }
  return toks.slice(i).join(' ');
}

/** The recogniser's other guesses for a result, when they differ from its first. */
function others(r: SRResult, top: string, keep: number): string[] {
  const seen = new Set([wordsOf(top).join(' ')]);
  const out: string[] = [];
  for (let j = 1; j < Math.min(r.length, keep); j++) {
    const t = (r[j]?.transcript ?? '').trim();
    const k = wordsOf(t).join(' ');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.slice(0, 300));
  }
  return out;
}

/**
 * One session's results: finished words, the guess still in flux, and the doubts (finished stretches with other
 * guesses). Chrome on Android repeats itself with continuous recognition: a final result can hold the ones before it
 * ("call", "call the plumber") and its guess can start with words already settled. Those fold together, so nothing
 * you said shows twice.
 */
export function readResults(results: ArrayLike<SRResult>, keep = 3): { fin: string; int: string; doubts: Doubt[] } {
  const finals: { text: string; words: string[]; or: string[] }[] = [];
  const interim: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const text = (r?.[0]?.transcript ?? '').trim();
    if (!text) continue;
    if (!r.isFinal) { interim.push(text); continue; }
    const words = wordsOf(text);
    const last = finals.at(-1);
    const item = { text, words, or: others(r, text, keep) };
    // The same words again, and more: it's the earlier result, grown.
    if (last && words.length > last.words.length && startsWith(words, last.words)) { finals[finals.length - 1] = item; continue; }
    // A shorter repeat of what's settled. Short ones may be you saying it twice ("no, no").
    if (last && words.length >= 3 && startsWith(last.words, words)) continue;
    finals.push(item);
  }
  let int = joinWords(...interim);
  const last = finals.at(-1);
  if (last && int && startsWith(wordsOf(int), last.words)) int = dropWords(int, last.words.length);
  return {
    fin: joinWords(...finals.map(f => f.text)),
    int,
    doubts: finals.filter(f => f.or.length).map(f => ({ said: f.text.slice(0, 300), or: f.or })),
  };
}
