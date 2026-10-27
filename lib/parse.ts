import type { ParsedItem, Priority } from './model';
import { labelNamed, type Label } from './labels';
import { DAY_MS, addDays, minsOf, pad, startOfDay, ymd } from './time';

const WEEKDAYS: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WD = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun';
const MO = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const STRIP: RegExp[] = [
  /!{2,}/g,
  /\b(?:urgent(?:ly)?|asap|critical|top priority|high priority|low priority|no rush|someday|some day|eventually|whenever|p[123])\b/gi,
  /\b(?:for\s+)?(?:about\s+|~)?\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi,
  /\b(?:for\s+)?(?:half an hour|an hour|one hour)\b/gi,
  /\b(?:(?:by|before|due(?:\s+on)?|on|until|this|next)\s+)?(?:day after tomorrow|tomorrow|tmrw|tmr|today|tonight|eod|end of (?:the )?day|(?:this\s+|in the\s+)?(?:morning|afternoon|evening)|noon|midday)\b/gi,
  new RegExp(`\\b(?:(?:by|before|due(?:\\s+on)?|on|until|this|next)\\s+)?(?:${WD})\\b`, 'gi'),
  /(?:\b(?:at|by|before|from)\s+|@\s*)?\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi,
  /(?:\bat\s+|@\s*)\d{1,2}(?::\d{2})?\b/gi,
  new RegExp(`\\b(?:(?:on|by|before|due)\\s+)?(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MO})[a-z]*\\b`, 'gi'),
  /\b(?:(?:on|by|before|due)\s+)?(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
  /\b(?:on|by|before|due)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/gi,
];

const TAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

/** Keyword fallback when the AI route can't sort the dump. One item per line or `;`. A #tag naming one of `labels` picks it. */
export function localParse(text: string, nowArg?: number | Date, labels: Label[] = []): ParsedItem[] {
  const now = nowArg != null ? new Date(nowArg) : new Date();
  const today = startOfDay(now);
  return String(text).split(/\n+|;\s*/).map(s => s.trim()).filter(Boolean).map(whole => {
    let label: string | null = null;
    const part = whole.replace(TAG, (m, pre: string, tag: string) => {
      const l = labelNamed(labels, tag);
      if (!l) return m;
      label ??= l.id;
      return pre;
    }).trim() || whole;
    const low = part.toLowerCase();
    let priority: Priority = 2;
    if (/\b(?:urgent(?:ly)?|asap|critical|top priority|high priority|p1|immediately)\b|!{2,}/.test(low)) priority = 1;
    else if (/\b(?:someday|some day|eventually|whenever|low priority|no rush|p3)\b/.test(low)) priority = 3;

    let minutes = 30;
    let m: RegExpMatchArray | null;
    if ((m = low.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/))) minutes = /^h/.test(m[2]) ? parseFloat(m[1]) * 60 : parseFloat(m[1]);
    else if (/\bhalf an hour\b/.test(low)) minutes = 30;
    else if (/\b(?:an|one) hour\b/.test(low)) minutes = 60;

    let date: Date | null = null;
    if (/\bday after tomorrow\b/.test(low)) date = addDays(today, 2);
    else if (/\b(?:tomorrow|tmrw|tmr)\b/.test(low)) date = addDays(today, 1);
    else if (/\b(?:today|tonight|eod|end of (?:the )?day|this (?:morning|afternoon|evening))\b/.test(low)) date = today;
    else if ((m = low.match(new RegExp(`\\b(next|this)?\\s*(${WD})\\b`)))) {
      let diff = (WEEKDAYS[m[2]] - today.getDay() + 7) % 7;
      if (diff === 0 && m[1] === 'next') diff = 7;
      date = addDays(today, diff);
    } else if ((m = low.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MO})[a-z]*\\b`)))
            || (m = low.match(/\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/))) {
      const dayNum = +(/\d/.test(m[1]) ? m[1] : m[2]);
      const mon = MONTHS[(/\d/.test(m[1]) ? m[2] : m[1]).slice(0, 3)];
      let d = new Date(today.getFullYear(), mon, dayNum);
      if (d < today) d = new Date(today.getFullYear() + 1, mon, dayNum);
      date = d;
    } else if ((m = low.match(/\b(?:on|by|before|due)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/))) {
      let d = new Date(today.getFullYear(), today.getMonth(), +m[1]);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, +m[1]);
      date = d;
    }

    let time: number | null = null;
    if ((m = low.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/))) { const h = (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0); time = h * 60 + (+m[2] || 0); }
    else if ((m = low.match(/(?:\bat|@)\s*(\d{1,2})(?::(\d{2}))?\b/)) || (m = low.match(/\b(\d{1,2}):(\d{2})\b/))) {
      let h = +m[1]; if (h >= 1 && h < 8) h += 12; if (h < 24) time = h * 60 + (+m[2] || 0);
    }
    else if (/\b(?:noon|midday)\b/.test(low)) time = 12 * 60;
    else if (/\btonight\b/.test(low)) time = 21 * 60;
    else if (/\bmorning\b/.test(low)) time = 10 * 60;
    else if (/\bafternoon\b/.test(low)) time = 15 * 60;
    else if (/\bevening\b/.test(low)) time = 18 * 60 + 30;

    const deadline = new RegExp(`\\b(?:by|before|due|until)\\s+(?:the\\s+)?(?:eod|end of|today|tonight|tomorrow|tmrw|day after|next|this|${WD}|\\d{1,2}(?:st|nd|rd|th)|${MO})`).test(low) || /\beod\b/.test(low);
    if (deadline && !date) date = today;
    if (!deadline && time != null && !date) date = time > minsOf(now) ? today : addDays(today, 1);
    if (deadline && date && (date.getTime() - today.getTime()) / DAY_MS <= 1) priority = 1;

    let title = part;
    for (const re of STRIP) title = title.replace(re, ' ');
    title = title.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '').trim();
    title = title.replace(/\s+(?:and|at|on|by|for|to)$/i, '').trim();
    if (title.length < 3) title = part.trim();
    title = title.charAt(0).toUpperCase() + title.slice(1);

    return {
      title, priority, minutes,
      date: date ? ymd(date) : null,
      time: time != null && !deadline ? `${pad(Math.floor(time / 60))}:${pad(time % 60)}` : null,
      deadline, notes: '', label,
    };
  });
}
