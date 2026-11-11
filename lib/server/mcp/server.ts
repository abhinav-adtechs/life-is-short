import 'server-only';
import { McpServer, type AuthInfo, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  PRIORITIES, TaskError, completeTask, createTask, deleteTask, getTask, listTasks, reopenTask, updateTask, type Ctx,
} from '../../mcp/tools';
import { zoneOr } from '../../mcp/when';
import { connectionRepo } from './db';

/*
 * The MCP server: seven tools over your tasks. A fresh one is made for every request (createMcpHandler in app/mcp),
 * bound to the connection whose token came with it, so nothing about one connection is kept for the next.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (what: string) => z.string().regex(DATE, 'a date like 2026-11-12').describe(what);
const when = (what: string) => z.string().min(10).max(40).describe(what);
const status = z.enum(['open', 'done']);
const priority = z.enum(PRIORITIES).describe('urgent, important or later (the app shows these as Urgent, Important, Later).');
const project = z.string().min(1).max(40);
const minutes = z.number().int().min(15).max(480).multipleOf(15).describe('How long it takes, in minutes: 15 to 480, in steps of 15.');
const id = z.string().min(1).max(64).describe('The task id, from list_tasks or create_task.');
/** A string or null. Bounded, so it renders as anyOf rather than a type array, which more clients read. */
const orNull = (what: string) => z.string().max(400).nullable().describe(what);

const summary = z.object({
  id: z.string(),
  title: z.string(),
  status,
  priority: z.enum(PRIORITIES),
  project: orNull('The task’s label (Work, Personal…), or null.'),
  due: orNull('Deadline, YYYY-MM-DD, or null.'),
  scheduled: orNull('When it’s on the calendar (RFC 3339, the user’s time zone), or null when it’s in the backlog.'),
  minutes: z.number(),
  updated: z.string().describe('Last changed (RFC 3339).'),
  source: z.enum(['google_calendar', 'google_tasks']).optional().describe('Pulled from Google: its title and time follow Google.'),
  repeating: z.literal(true).optional().describe('Made by a repeat; changing its title, priority, length, project or notes changes the ones to come.'),
});
const detail = summary.extend({
  notes: z.string(),
  original_text: z.string().optional().describe('What the user typed or said when they added it.'),
  created: z.string(),
  done_at: orNull('When it was ticked off (RFC 3339), or null.'),
  repeat: z.string().optional().describe('How often it repeats, in words.'),
});
const changed = detail.extend({ changed: z.boolean().describe('False when the task already looked like this, so nothing was written.') });

const TIME_NOTE = 'Times without an offset are read in the user’s time zone (list_tasks returns it).';

const INSTRUCTIONS = `Life is short is the user's own to-do planner. Each task is either in the backlog (no time) or on the calendar
(scheduled), can have a deadline (due), a priority (urgent, important or later) and a project, which the app calls a label
(Work, Personal, Helping others, or the user's own). The app shows the user one task to do now: the one on the calendar at this
minute, else the top of the backlog. Use list_tasks to find tasks and their ids before changing them; get_task has the notes.
Prefer complete_task over delete_task for anything the user did. Items from Google Calendar or Google Tasks are read-only apart
from their priority, project, notes and status. ${TIME_NOTE}`;

/** A tool's answer: compact JSON as text for any client, and the same object as structured content. */
const ok = (out: object): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out as Record<string, unknown> });
const fail = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

async function run(fn: () => Promise<object>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof TaskError) return fail(e.message);
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid token/.test(msg)) return fail('This connection has ended. Reconnect Life is short in your connector settings.');
    console.error('mcp tool failed:', msg);
    return fail('Life is short couldn’t reach its database just now. Try again in a moment.');
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function buildServer(auth: AuthInfo): McpServer {
  const c: Ctx = { repo: connectionRepo(auth.token), tz: zoneOr(auth.extra?.tz as string | undefined) };
  const server = new McpServer({ name: 'life-is-short', title: 'Life is short', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: 'List the user’s tasks. By default: open tasks, ranked as the app ranks its backlog (urgent first, then by due date). '
      + 'Filter by status, project, deadline, time on the calendar and words in the title or notes. Returns compact summaries '
      + '(ids, titles, status, priority, project, due date, scheduled time, last updated) and the user’s time zone and date today; '
      + 'use get_task for the notes. Google Calendar events are left out unless include_events is true. '
      + 'Paginated: when next_cursor isn’t null, call again with it as cursor.',
    inputSchema: z.object({
      status: z.enum(['open', 'done', 'any']).optional().describe('open (the default), done, or any.'),
      project: project.optional().describe('Only tasks with this label (name or id, e.g. "Work"); "none" for tasks without one.'),
      due_after: date('Only tasks due on or after this date (YYYY-MM-DD).').optional(),
      due_before: date('Only tasks due on or before this date (YYYY-MM-DD).').optional(),
      scheduled_after: when(`Only tasks on the calendar from this date (YYYY-MM-DD, from midnight) or date-time on. ${TIME_NOTE}`).optional(),
      scheduled_before: when(`Only tasks on the calendar up to this date (YYYY-MM-DD, through the end of that day) or date-time. ${TIME_NOTE}`).optional(),
      query: z.string().max(200).optional().describe('Words that must all appear in the title or notes, any case.'),
      include_events: z.boolean().optional().describe('Include meetings pulled from Google Calendar. Default false.'),
      limit: z.number().int().min(1).max(100).optional().describe('Page size, 1 to 100. Default 25.'),
      cursor: z.string().max(200).optional().describe('next_cursor from the previous page.'),
    }),
    outputSchema: z.object({
      tasks: z.array(summary),
      total: z.number().describe('How many tasks match, across all pages.'),
      next_cursor: orNull('Pass as cursor for the next page; null on the last page.'),
      today: z.string().describe('Today’s date in the user’s time zone.'),
      timezone: z.string().describe('The user’s IANA time zone.'),
    }),
    annotations: { title: 'List tasks', ...READ },
  }, async args => run(() => listTasks(c, args)));

  server.registerTool('get_task', {
    title: 'Get a task',
    description: 'One task by id, with everything the app keeps on it: notes, the words it was added with, when it was created '
      + 'and done, and its repeat. The app has notes but no subtasks.',
    inputSchema: z.object({ id }),
    outputSchema: detail,
    annotations: { title: 'Get a task', ...READ },
  }, async ({ id: tid }) => run(() => getTask(c, tid)));

  server.registerTool('create_task', {
    title: 'Create a task',
    description: 'Add a task. With a scheduled time it goes on the calendar; without one it waits in the backlog. A due date is a '
      + `deadline, separate from when it's scheduled. Defaults: priority important, 30 minutes, open, no project. ${TIME_NOTE}`,
    inputSchema: z.object({
      title: z.string().min(1).max(160).describe('Short title, as the user would write it.'),
      description: z.string().max(5000).optional().describe('Notes for the task.'),
      due: date('Deadline (YYYY-MM-DD).').nullable().optional(),
      priority: priority.optional(),
      project: project.nullable().optional().describe('A label name or id (e.g. "Work"). Labels are set up in the app; an unknown one is refused with the list.'),
      status: status.optional().describe('open (the default) or done, to log something already finished.'),
      scheduled: when(`When to put it on the calendar, e.g. 2026-11-12T15:00. ${TIME_NOTE}`).nullable().optional(),
      minutes: minutes.optional(),
    }),
    outputSchema: detail,
    annotations: { title: 'Create a task', ...WRITE, idempotentHint: false },
  }, async args => run(() => createTask(c, args)));

  server.registerTool('update_task', {
    title: 'Update a task',
    description: 'Change any fields of a task by id; fields left out stay as they are. Set scheduled to null to take it off the '
      + 'calendar (back to the backlog), due or project to null to clear them. Changing a repeating task’s title, priority, '
      + `length, project or notes changes the ones to come too. ${TIME_NOTE}`,
    inputSchema: z.object({
      id,
      title: z.string().min(1).max(160).optional(),
      description: z.string().max(5000).optional().describe('Replaces the notes.'),
      due: date('Deadline (YYYY-MM-DD), or null to clear it.').nullable().optional(),
      priority: priority.optional(),
      project: project.nullable().optional().describe('A label name or id, or null to clear it.'),
      status: status.optional(),
      scheduled: when(`New time on the calendar, or null for the backlog. ${TIME_NOTE}`).nullable().optional(),
      minutes: minutes.optional(),
    }),
    outputSchema: changed,
    annotations: { title: 'Update a task', ...WRITE, idempotentHint: true },
  }, async ({ id: tid, ...patch }) => run(() => updateTask(c, tid, patch)));

  server.registerTool('complete_task', {
    title: 'Complete a task',
    description: 'Tick a task off as done. Doing it again changes nothing.',
    inputSchema: z.object({ id }),
    outputSchema: changed,
    annotations: { title: 'Complete a task', ...WRITE, idempotentHint: true },
  }, async ({ id: tid }) => run(() => completeTask(c, tid)));

  server.registerTool('reopen_task', {
    title: 'Reopen a task',
    description: 'Mark a done task as open again. Doing it again changes nothing.',
    inputSchema: z.object({ id }),
    outputSchema: changed,
    annotations: { title: 'Reopen a task', ...WRITE, idempotentHint: true },
  }, async ({ id: tid }) => run(() => reopenTask(c, tid)));

  server.registerTool('delete_task', {
    title: 'Delete a task',
    description: 'Delete a task for good. There’s no undo from here, so confirm with the user first, and use complete_task for '
      + 'anything they did. Deleting one occurrence of a repeating task skips just that one. Google items can’t be deleted here.',
    inputSchema: z.object({ id }),
    outputSchema: z.object({ deleted: z.object({ id: z.string(), title: z.string() }) }),
    annotations: { title: 'Delete a task', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id: tid }) => run(() => deleteTask(c, tid)));

  return server;
}
