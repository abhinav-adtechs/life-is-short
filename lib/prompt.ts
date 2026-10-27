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
}

/** The prompt sent to the AI route. It answers {add: [...], update: [...]} so a dump can add tasks and change existing ones. */
export function buildPrompt(text: string, nowArg?: number | Date, open: PromptTask[] = [], hours = { start: 9 * 60, end: 21 * 60 }, labels: Label[] = []): string {
  const now = nowArg != null ? new Date(nowArg) : new Date();
  const today = startOfDay(now);
  const days = Array.from({ length: 14 }, (_, i) => { const d = addDays(today, i); return `${DOWL[d.getDay()]} ${ymd(d)}`; });
  const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const list = open.length
    ? open.map(t => `${t.ref} | P${t.priority} | ${String(t.title).replace(/\s+/g, ' ').slice(0, 140)} | ${t.start || 'backlog'} | ${t.due ? 'due ' + t.due : '-'} | ${t.label || '-'}`).join('\n')
    : '(none yet)';
  const labelList = labels.map(l => `${l.id} = ${l.name}`).join(', ');
  return [
    'You are the planning assistant inside a personal day planner. Read what the user just said and update their task list.',
    `Right now it is ${DOWL[now.getDay()]} ${ymd(now)}, ${pad(now.getHours())}:${pad(now.getMinutes())} local time. Working hours are ${hm(hours.start)} to ${hm(hours.end)}.`,
    `Dates for the next 14 days: ${days.join(', ')}.`,
    labels.length ? `They sort tasks into these labels (id = name): ${labelList}.` : 'They have no labels.',
    '',
    'Their open tasks right now (ref | priority | task | scheduled | due | label):',
    list,
    '',
    'What they just said:',
    '"""',
    String(text).slice(0, 20000),
    '"""',
    '',
    'Work out what they mean. It may be a quick list, a spoken ramble, pasted notes or a mix of all three.',
    '- Pull out every concrete thing they need to do. Merge repeats. Phrase each as a clear next action in their own words.',
    '- Keep titles short; put context (who, why, amounts, links, details) in notes.',
    '- If they refer to a task already on the list (they finished it, want it moved, changed its priority, added detail), put it in "update" with its ref instead of adding a duplicate.',
    '- Ignore chatter that is not a task.',
    '',
    'Reply with only a JSON object: {"add": [...], "update": [...]}',
    'Each "add" item:',
    '{"title": string under 80 characters,',
    ' "priority": 1 if urgent, flagged as important, blocking someone, or due today or tomorrow; 3 if someday, maybe or nice-to-have; otherwise 2,',
    ' "minutes": realistic length as a multiple of 15 from 15 to 240 (quick message 15, call 30, meeting 60, focused work 90+),',
    ' "date": "YYYY-MM-DD" only if a day is stated or clearly implied, else null,',
    ' "time": "HH:MM" in 24-hour time only if a clock time or part of day is stated (morning 10:00, afternoon 15:00, evening 18:30, tonight 21:00), else null,',
    ' "deadline": true when the day is a due date ("by Friday", "before the 30th") rather than when to do it, else false,',
    ' "notes": extra detail worth keeping, else "",',
    labels.length
      ? ' "label": the id of the label the task belongs to, from their labels above. Pick the closest fit from what it is about; null only when none fits. A #tag naming a label picks that label: leave the tag out of the title}'
      : ' "label": null}',
    'Each "update" item: {"ref": "T3"} plus only the fields that change, from the same fields above, and optionally "done": true to tick it off or "unschedule": true to move it back to the backlog.',
    'Never invent a day or time they did not give. A time with no day means today if that time is still ahead, otherwise tomorrow.',
    `Example: {"add":[{"title":"Call the bank about the card","priority":1,"minutes":30,"date":"${ymd(addDays(today, 1))}","time":"11:00","deadline":false,"notes":"Ask about the blocked international transaction"}],"update":[{"ref":"T2","done":true}]}`,
  ].join('\n');
}
