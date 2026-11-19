import 'server-only';
import { McpServer, type AuthInfo, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  PRIORITIES, TaskError, completeTask, createTask, deleteTask, getTask, listGoals, listTasks, reopenTask, updateTask, type Ctx,
} from '../../mcp/tools';
import { zoneOr } from '../../mcp/when';
import { connectionRepo } from './db';

/*
 * The MCP server: eight tools over your tasks and goals. A fresh one is made for every request (createMcpHandler in app/mcp),
 * bound to the connection whose token came with it, so nothing about one connection is kept for the next.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (what: string) => z.string().regex(DATE, 'a date like 2026-11-12').describe(what);
const when = (what: string) => z.string().min(10).max(40).describe(what);
const status = z.enum(['open', 'done']);
const priority = z.enum(PRIORITIES).describe('urgent, important or later (the app shows these as Urgent, Important, Later).');
const project = z.string().min(1).max(40);
const goal = z.string().min(1).max(80);
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
  goal: orNull('The goal this task moves, by title, or null for off-goal work.'),
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

const INSTRUCTIONS = `Life is short is the user's own to-do planner, organised around a few goals: specific outcomes they are working
towards, each with what "done" means and often sub-goals under it (list_goals). Every task either moves one goal or is off-goal, which is fine as long as
the user knows. Each task is either in the backlog (no time) or on the calendar (scheduled), can have a deadline (due), a
priority (urgent, important or later), a goal, and a project, which the app calls a section (the user's own, like their
company, Personal or Helping others); a task on a goal takes the goal's section. The app shows the user one task to do now:
the one on the calendar at this minute, else the top of the backlog. When adding tasks, put each on the goal it directly
moves, if any. Use list_tasks to find tasks and their ids before changing them; get_task has the notes.
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
      goal: goal.optional().describe('Only tasks on this goal (its title, a key word of it, or its id); "none" for off-goal tasks.'),
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

  server.registerTool('list_goals', {
    title: 'List goals',
    description: 'The user’s goals, most important first, each followed by its sub-goals (OKR style: a goal can have sub-goals, '
      + 'a sub-goal can serve one of its parent’s key results, and key results can have key results under them). For each: what '
      + 'it is, its section, its target date, its parent, what has to be true for it to be done (done_when, with what’s ticked), '
      + 'how far along it is, how many tasks are open and done on it, and its flow chart: the steps in order of what depends on '
      + 'what, which are blocked, and the critical path. Plus how many open tasks are off-goal. Put a task on the most specific '
      + 'goal it moves. Goals and their charts are set in the app; this can’t change them.',
    inputSchema: z.object({ include_closed: z.boolean().optional().describe('Also list achieved and dropped goals. Default false.') }),
    outputSchema: z.object({
      goals: z.array(z.object({
        id: z.string(), title: z.string(), section: orNull('Its section, or null.'),
        status: z.enum(['active', 'achieved', 'dropped']), rank: z.number().nullable().describe('1 for the most important active top goal; null for sub-goals and closed ones.'),
        by: orNull('Target date, YYYY-MM-DD, or null.'),
        parent: orNull('The id of the goal this is a sub-goal of, or null for a top goal.'),
        parent_kr: orNull('The id of the parent’s key result (in its done_when) this sub-goal serves, or null.'),
        progress: z.number().nullable().describe('0 to 1, from its key results and sub-goals; null with neither.'),
        done_when: z.array(z.object({
          id: z.string(), text: z.string(), done: z.boolean().describe('Ticked, or everything under it is'),
          under: z.string().nullable().describe('The key result it sits under, or null at the top'),
        })).describe('Its key results, depth first.'),
        open_tasks: z.number(), done_tasks: z.number(),
        flow: z.object({
          steps: z.array(z.object({
            id: z.string(), kind: z.enum(['task', 'wait', 'goal', 'milestone']).describe('task: a task on the goal; wait: something outside the user’s control it waits on; goal: one of its sub-goals; milestone: one of its done-when lines'),
            title: z.string(), state: z.enum(['done', 'ready', 'blocked', 'reached', 'open']),
            minutes: z.number().optional(), needs: z.array(z.string()).optional().describe('Step ids that have to be done first'),
            critical: z.boolean().optional().describe('On the critical path: the chain with the most work left'),
            progress: z.number().optional().describe('For a sub-goal: how far along it is, 0 to 1'),
          })),
          arrows: z.array(z.object({ from: z.string(), to: z.string(), structure: z.literal(true).optional().describe('Drawn by the goal’s structure (a key result under another, a sub-goal for a key result), not by the user') })).describe('from has to be done before to can start'),
          critical_path: z.array(z.string()),
        }).describe('The goal’s flow chart, left to right from the goal: steps, what each needs first, and the critical path.'),
      })),
      off_goal_open_tasks: z.number().describe('Open tasks not on any active goal.'),
    }),
    annotations: { title: 'List goals', ...READ },
  }, async args => run(() => listGoals(c, args)));

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
      goal: goal.nullable().optional().describe('The goal it moves, by title or id (list_goals), or null for off-goal work. Its section becomes the project unless you give one.'),
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
      goal: goal.nullable().optional().describe('Put it on this goal (title or id), or null to make it off-goal.'),
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
