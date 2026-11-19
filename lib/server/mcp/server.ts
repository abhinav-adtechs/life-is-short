import 'server-only';
import { McpServer, type AuthInfo, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  PRIORITIES, TaskError, changeGoals, completeTask, createTask, deleteTask, getGoal, getTask, listGoals, listTasks, reopenTask, updateTask, type Ctx,
} from '../../mcp/tools';
import { zoneOr } from '../../mcp/when';
import { connectionRepo } from './db';

/*
 * The MCP server: ten tools over your tasks, your goals and their flow charts. A fresh one is made for every request (createMcpHandler in app/mcp),
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

/** A goal as list_goals, get_goal and change_goals describe it. */
const goalSchema = z.object({
        id: z.string(), title: z.string(), section: orNull('Its section, or null.'),
        status: z.enum(['active', 'achieved', 'dropped']), rank: z.number().int().min(1).max(1000).nullable().describe('1 for the most important active top goal; null for sub-goals and closed ones.'),
        by: orNull('Target date, YYYY-MM-DD, or null.'),
        parent: orNull('The id of the goal this is a sub-goal of, or null for a top goal.'),
        parent_kr: orNull('The id of the parent’s key result (in its done_when) this sub-goal serves, or null.'),
        progress: z.number().min(0).max(1).nullable().describe('0 to 1, from its key results and sub-goals; null with neither.'),
        done_when: z.array(z.object({
          id: z.string(), text: z.string(), done: z.boolean().describe('Ticked, or everything under it is'),
          under: z.string().max(100).nullable().describe('The key result it sits under, or null at the top'),
        })).describe('Its key results, depth first.'),
        open_tasks: z.number(), done_tasks: z.number(),
        flow: z.object({
          steps: z.array(z.object({
            id: z.string(), kind: z.enum(['task', 'wait', 'goal', 'milestone']).describe('task: a task on the goal; wait: something outside the user’s control it waits on; goal: one of its sub-goals; milestone: one of its done-when lines'),
            title: z.string(), state: z.enum(['done', 'ready', 'blocked', 'reached', 'open']),
            minutes: z.number().optional(), needs: z.array(z.string()).optional().describe('Step ids that have to be done first'),
            critical: z.boolean().optional().describe('On the critical path: the chain with the most work left'),
            progress: z.number().optional().describe('For a sub-goal: how far along it is, 0 to 1'),
            repeats: z.string().optional().describe('For a repeating task, the whole series as one step: how it repeats and when it ends, e.g. "Every Mon, Wed and Fri, 20 times"'),
            times_done: z.number().optional().describe('For a repeating task: how many of it are done'),
          })),
          arrows: z.array(z.object({ from: z.string(), to: z.string(), structure: z.literal(true).optional().describe('Drawn by the goal’s structure (a key result under another, a sub-goal for a key result), not by the user') })).describe('from has to be done before to can start'),
          critical_path: z.array(z.string()),
        }).describe('The goal’s flow chart, left to right from the goal: steps, what each needs first, and the critical path.'),
      });

const TIME_NOTE = 'Times without an offset are read in the user’s time zone (list_tasks returns it).';

const INSTRUCTIONS = `Life is short is the user's own to-do planner, organised around a few goals: specific outcomes they are working
towards, each with what "done" means and often sub-goals under it (list_goals). Every task either moves one goal or is off-goal, which is fine as long as
the user knows. Each task is either in the backlog (no time) or on the calendar (scheduled), can have a deadline (due), a
priority (urgent, important or later), a goal, and a project, which the app calls a section (the user's own, like their
company, Personal or Helping others); a task on a goal takes the goal's section. The app shows the user one task to do now:
the one on the calendar at this minute, else the top of the backlog. When adding tasks, put each on the goal it directly
moves, if any. Use list_tasks to find tasks and their ids before changing them; get_task has the notes.
Each goal has a flow chart: its steps (tasks, things it waits on, sub-goals and its key results as milestones) and arrows
saying what has to be done before what. To plan or change how a goal gets done, read it with get_goal and change it with
change_goals, using the step ids get_goal shows; in one call you can add goals, sub-goals, key results, steps, waiting steps
and arrows, and move, reorder, rename, close or delete any of them (move_goal puts a goal under another, or back to the top). Say what you're about to change before you change a goal's structure, and ask before deleting anything.
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
  const server = new McpServer({ name: 'life-is-short', title: 'Life is short', version: '0.2.0' }, { instructions: INSTRUCTIONS });

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
      + 'goal it moves. To change goals or their charts, use change_goals; get_goal shows one goal in full.',
    inputSchema: z.object({ include_closed: z.boolean().optional().describe('Also list achieved and dropped goals. Default false.') }),
    outputSchema: z.object({
      goals: z.array(goalSchema),
      off_goal_open_tasks: z.number().describe('Open tasks not on any active goal.'),
    }),
    annotations: { title: 'List goals', ...READ },
  }, async args => run(() => listGoals(c, args)));

  server.registerTool('get_goal', {
    title: 'Get a goal and its chart',
    description: 'One goal in full, by id or title: what list_goals shows for it (key results, progress, its flow chart with '
      + 'every step’s id, state and what it needs first, and the critical path), plus the chart as a Mermaid flowchart you can '
      + 'draw for the user, and what happened to the chart lately. Read it before changing the goal with change_goals: the step '
      + 'ids here are what change_goals takes.',
    inputSchema: z.object({
      goal: goal.describe('The goal’s id (from list_goals) or title.'),
      history: z.number().int().min(0).max(50).optional().describe('How many recent history lines to include. Default 15.'),
    }),
    outputSchema: goalSchema.extend({
      mermaid: z.string().describe('The chart as a Mermaid flowchart (left to right).'),
      history: z.array(z.object({ at: z.string(), what: z.string() })).describe('What happened to the chart, oldest first.'),
    }),
    annotations: { title: 'Get a goal and its chart', ...READ },
  }, async args => run(() => getGoal(c, args)));

  const ref = (what: string) => z.string().min(1).max(200).describe(what);
  const STEP = 'A step: a task id, a waiting step id (w…), a key result ("kr:<id>"), a repeating task ("rep:<id>"), a sub-goal ("goal:<id>"), '
    + 'its title, or the key you gave something added earlier in this call.';
  const op = z.object({
    op: z.enum([
      'add_goal', 'edit_goal', 'move_goal', 'delete_goal', 'add_result', 'edit_result', 'move_result', 'remove_result',
      'add_step', 'add_wait', 'link', 'unlink', 'edit_step', 'remove_step', 'move_step',
    ]).describe('What to do; the fields each one uses are in the tool description.'),
    goal: ref('The goal it’s on (id or title, or the key of a goal added earlier in this call). Defaults to the call’s goal.').optional(),
    ref: ref(STEP).optional(),
    from: ref(`For link/unlink: the step that has to be done first. ${STEP}`).optional(),
    to: ref('For link/unlink: the step that waits for it.').optional(),
    title: z.string().min(1).max(160).describe('A goal’s, step’s or waiting step’s title: short, without the schedule.').optional(),
    text: z.string().min(1).max(120).describe('A key result’s text: what has to be true, e.g. "Term sheet signed".').optional(),
    under: ref('For add_result and move_result: the key result it goes under; for move_result, null (or "none") moves it to the top.').nullable().optional(),
    parent: ref('For add_goal and move_goal: the goal it’s a sub-goal of; for move_goal, null (or "none") makes it a top goal.').nullable().optional(),
    for_result: ref('For add_goal and move_goal with a parent: the parent’s key result this sub-goal serves; null for the parent as a whole.').nullable().optional(),
    section: z.string().min(1).max(40).nullable().describe('For add_goal, edit_goal and move_goal to the top: a top goal’s section (a label name, e.g. "Work"), or null for none. A sub-goal is always in its top goal’s section.').optional(),
    rank: z.number().int().min(1).max(1000).describe('For move_goal, add_goal and move_result: its place among the open goals (or key results) beside it, 1 first. A top goal’s rank is its priority.').optional(),
    results: z.array(z.string().min(1).max(120)).max(8).describe('For add_goal: its key results, as texts.').optional(),
    by: orNull('For add_goal/edit_goal: YYYY-MM-DD to get it done by, or null for none.').optional(),
    after: ref('For add_step, move_step and move_goal: the step it follows on the chart it goes onto (an arrow from that step to this one).').optional(),
    before: ref('For add_step: the step it leads to.').optional(),
    beside: ref('For add_step: a step it runs alongside (same arrows in and out).').optional(),
    holds: ref('For add_wait: the step it holds up.').optional(),
    minutes: minutes.optional(),
    priority: priority.optional(),
    done: z.boolean().describe('For edit_step/edit_result: tick it off (true) or reopen it (false). For a waiting step, true means it came through.').optional(),
    delete: z.boolean().describe('For remove_step: delete the task outright instead of taking it off the goal, or a sub-goal instead of dropping it. Only when the user says delete.').optional(),
    with_tasks: z.boolean().describe('For delete_goal: delete its open tasks too and stop its repeating tasks, instead of making them off-goal. Only when the user says so.').optional(),
    status: z.enum(['active', 'achieved', 'dropped']).describe('For edit_goal.').optional(),
    repeat: z.object({
      freq: z.enum(['day', 'week', 'month']), every: z.number().int().min(1).max(52).optional(),
      days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(), monthday: z.number().int().min(1).max(31).nullable().optional(),
      until: orNull('YYYY-MM-DD it stops after').optional(), times: z.number().int().min(1).max(999).nullable().optional().describe('How many times in all'),
      per: z.number().int().min(1).max(7).nullable().optional().describe('How many times a week (or month)'),
    }).describe('For add_step: makes it a repeating task. For edit_step on a repeating task ("rep:<id>"): changes how it repeats.').optional(),
    key: z.string().min(1).max(40).describe('A name for what this adds, so later operations in the same call can refer to it.').optional(),
  });

  server.registerTool('change_goals', {
    title: 'Change goals and their charts',
    description: 'Build or change the user’s goals and their flow charts, the way the app’s own chart builder does, in one call '
      + 'of up to 40 operations applied in order (add something before linking it). An arrow from A to B means B can only start '
      + 'once A is done; steps without arrows between them run in parallel. Operations:\n'
      + '- add_goal {title, results, by, section, parent, for_result, rank, key}: a goal, or a sub-goal under parent (serving one of its key results)\n'
      + '- edit_goal {goal, title, by, section, status}: rename it, change its date or a top goal’s section; status achieved, dropped, or active to bring it back\n'
      + '- move_goal {goal, parent, for_result, rank, after}: move an existing goal, with everything under it, under another goal (for one of its key results, or for it as a whole with for_result null), or to the top with parent null; rank reorders it among the goals beside it\n'
      + '- delete_goal {goal, with_tasks}: delete a goal and its sub-goals for good (status dropped keeps them). Its open tasks go off-goal, or with with_tasks are deleted and its repeating tasks stop; done tasks stay. Ask first.\n'
      + '- add_result {goal, text, under, key}: a key result ("done when"), optionally under another\n'
      + '- edit_result {ref, text, done}; move_result {ref, under, rank}: under another key result of the same goal, or to the top with under null; remove_result {ref}: with what’s under it\n'
      + '- add_step {goal, title, minutes, priority, after, before, beside, repeat, key}: a new task on the goal\n'
      + '- add_wait {goal, title, holds, key}: something outside the user’s control the plan waits on (a reply, a signature)\n'
      + '- link {from, to}; unlink {from, to}\n'
      + '- edit_step {ref, title, minutes, priority, done, repeat}: rename, resize, tick off or reopen any step; repeat changes how a repeating task repeats\n'
      + '- remove_step {ref, delete}: take a step off the chart (a task goes off the goal, delete true deletes it; a sub-goal is dropped, delete true deletes it)\n'
      + '- move_step {ref, goal, after}: put an existing task, repeating task, waiting step or sub-goal on this goal\n'
      + 'Use the ids get_goal and list_goals show, or titles. Returns what changed, what was skipped and why, and the goals it '
      + 'touched with their charts. The open app shows the change when its window next comes to the front.',
    inputSchema: z.object({
      goal: goal.describe('The goal operations without their own "goal" are about (id or title).').optional(),
      ops: z.array(op).min(1).max(40),
    }),
    outputSchema: z.object({
      changed: z.array(z.string()).describe('What changed, one line each.'),
      skipped: z.array(z.string()).describe('What couldn’t be done, and why.'),
      goals: z.array(goalSchema).describe('The goals it touched, with their charts as they are now.'),
    }),
    annotations: { title: 'Change goals and their charts', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async args => run(() => changeGoals(c, args)));

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
