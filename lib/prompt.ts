import type { Label } from './labels';
import { DOWL, addDays, pad, startOfDay, ymd } from './time';

/** An open task as the model sees it. `start` is "YYYY-MM-DD HH:MM" local, or null when in the backlog. */
export interface PromptTask {
  ref: string;
  title: string;
  priority: number;
  start: string | null;
  due: string | null;
  /** Label id, or null. */
  label?: string | null;
  /** How it repeats, for one of a repeat's tasks: "Every Mon and Thu · 7:00 AM". */
  repeats?: string;
}

/** A conversation in progress: what they said before, and the changes proposed so far, as {add, update}. */
export interface PromptDraft {
  earlier: string[];
  draft: { add: unknown[]; update: unknown[] };
}

const quote = (s: string, max = 20000) => ['"""', String(s).slice(0, max), '"""'];

/**
 * The prompt sent to the AI route. It answers {add: [...], update: [...], reply} so a dump can add tasks and change existing ones.
 * With `convo`, the answer is the whole draft revised by what they just said.
 */
export function buildPrompt(
  text: string, nowArg?: number | Date, open: PromptTask[] = [], hours = { start: 9 * 60, end: 21 * 60 }, labels: Label[] = [], convo?: PromptDraft,
): string {
  const now = nowArg != null ? new Date(nowArg) : new Date();
  const today = startOfDay(now);
  const days = Array.from({ length: 14 }, (_, i) => { const d = addDays(today, i); return `${DOWL[d.getDay()]} ${ymd(d)}`; });
  const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const list = open.length
    ? open.map(t => `${t.ref} | P${t.priority} | ${String(t.title).replace(/\s+/g, ' ').slice(0, 140)} | ${t.start || 'backlog'} | ${t.due ? 'due ' + t.due : '-'} | ${t.label || '-'}${t.repeats ? ` | repeats: ${t.repeats}` : ''}`).join('\n')
    : '(none yet)';
  const labelList = labels.map(l => `${l.id} = ${l.name}`).join(', ');
  return [
    'You are the planning assistant inside a personal day planner. Read what the user just said and update their task list.',
    `Right now it is ${DOWL[now.getDay()]} ${ymd(now)}, ${pad(now.getHours())}:${pad(now.getMinutes())} local time. Working hours are ${hm(hours.start)} to ${hm(hours.end)}.`,
    `Dates for the next 14 days: ${days.join(', ')}.`,
    labels.length ? `They sort tasks into these labels (id = name): ${labelList}.` : 'They have no labels.',
    '',
    'Their open tasks right now (ref | priority | task | scheduled | due | label), and how it repeats for a repeating one:',
    list,
    '',
    ...(convo ? [
      'Earlier in this conversation they said:',
      ...convo.earlier.flatMap(s => quote(s, 4000)),
      '',
      'You proposed these changes. Nothing is applied yet, and they may have edited the draft by hand. The draft as it stands:',
      JSON.stringify(convo.draft),
      '',
    ] : []),
    'What they just said:',
    ...quote(text),
    '',
    ...(convo ? [
      'They are changing the draft. Reply with the complete revised draft in the same format, not only what changed:',
      '- Keep every item they did not mention exactly as it is: same title, priority, minutes, date, time, deadline, notes, label, repeat and ref.',
      '- Change the items they mention, drop the ones they no longer want, and add anything new.',
      '- If they want to drop everything, reply with empty lists.',
      '',
    ] : []),
    'Work out what they mean. It may be a quick list, a spoken ramble, pasted notes or a mix of all three.',
    '- Pull out every concrete thing they need to do. Merge duplicates. Phrase each as a clear next action in their own words.',
    '- Keep titles short; put context (who, why, amounts, links, details) in notes.',
    '- If they refer to a task already on the list (they finished it, want it moved, changed its priority, added detail), put it in "update" with its ref instead of adding a duplicate.',
    '- Something they do again and again ("every Monday and Thursday", "daily", "each weekday", "every other week", "on the 1st of every month") is one task with a "repeat", not one task per day. The planner makes each one on its day.',
    '- Ignore chatter that is not a task.',
    '',
    'Reply with only a JSON object: {"add": [...], "update": [...], "reply": string}',
    'Each "add" item:',
    '{"title": string under 80 characters,',
    ' "priority": 1 if urgent, flagged as important, blocking someone, or due today or tomorrow; 3 if someday, maybe or nice-to-have; otherwise 2,',
    ' "minutes": realistic length as a multiple of 15 from 15 to 240 (quick message 15, call 30, meeting 60, focused work 90+),',
    ' "date": "YYYY-MM-DD" only if a day is stated or clearly implied, else null,',
    ' "time": "HH:MM" in 24-hour time only if a clock time or part of day is stated (morning 10:00, afternoon 15:00, evening 18:30, tonight 21:00), else null,',
    ' "deadline": true when the day is a due date ("by Friday", "before the 30th") rather than when to do it, else false,',
    ' "notes": extra detail worth keeping, else "",',
    labels.length
      ? ' "label": the id of the label the task belongs to, from their labels above. Pick the closest fit from what it is about; null only when none fits. A #tag naming a label picks that label: leave the tag out of the title,'
      : ' "label": null,',
    ' "repeat": null, unless it happens again and again. Then {"freq": "day", "week" or "month", "every": 1, or 2 for every other, 3 for every third, "days": for "week" the weekdays as ["mon", "thu"], else [], "monthday": for "month" the day of the month, else null}.',
    '   For a repeat, "date" is the first day it happens (null for the next day it falls on), "time" is when each one happens (null keeps each one in the backlog on its day), and the title leaves out the schedule ("Order groceries", not "Order groceries every Monday")}',
    'Each "update" item: {"ref": "T3"} plus only the fields that change, from the same fields above, and optionally "done": true to tick it off or "unschedule": true to move it back to the backlog.',
    'In an update, "repeat" makes the task repeat or changes how it repeats, and "stop_repeat": true stops a repeating one (this one stays). Moving one of a repeat\'s tasks moves only that one.',
    '"reply": one short, friendly sentence back to them in plain words about what you propose or changed, such as "Two new tasks, and I\'ll tick off the roadmap." Name tasks by title, never by ref. If something was unclear, say what you assumed.',
    'Never invent a day or time they did not give. A time with no day means today if that time is still ahead, otherwise tomorrow; for a repeat, leave the date null.',
    'A repeat, for "order groceries every Monday and Thursday": {"title":"Order groceries","priority":2,"minutes":15,"date":null,"time":null,"deadline":false,"notes":"","label":null,"repeat":{"freq":"week","every":1,"days":["mon","thu"],"monthday":null}}',
    `Example: {"add":[{"title":"Call the bank about the card","priority":1,"minutes":30,"date":"${ymd(addDays(today, 1))}","time":"11:00","deadline":false,"notes":"Ask about the blocked international transaction"}],"update":[{"ref":"T2","done":true}],"reply":"The bank call goes on tomorrow at 11, and one task is ticked off."}`,
  ].join('\n');
}
