// Fictional demo data for the showcase recording. Nothing here comes from a real planner.
const TZ = '+05:30';
export const NOW = Date.parse(`2026-11-20T10:40:00${TZ}`); // Friday
const at = (day, hm) => Date.parse(`${day}T${hm}:00${TZ}`);
const T0 = Date.parse(`2026-11-02T09:00:00${TZ}`);
let order = 0;
const task = (id, title, o = {}) => ({
  id, title, raw: o.raw ?? title, notes: o.notes ?? '', priority: o.p ?? 2, minutes: o.min ?? 30,
  start: o.start ?? null, due: o.due ?? null, status: o.done ? 'done' : 'open', created: T0, order: order++,
  doneAt: o.done ? (o.doneAt ?? o.start ?? NOW - 86400000) : null, label: o.label ?? null, goal: o.goal ?? null, updatedAt: T0,
});

const G = { pod: 'gpodcast', grow: 'ggrow', v2: 'gappv2', run: 'grun', mentor: 'gmentor', flat: 'gflat' };

export const tasks = [
  // Launch the podcast
  task('tpod1', 'Write the episode 1 outline', { goal: G.pod, label: 'work', done: true, doneAt: at('2026-11-17', '11:00'), min: 45 }),
  task('tpod2', 'Design the cover art', { goal: G.pod, label: 'work', done: true, doneAt: at('2026-11-18', '16:00'), min: 60 }),
  task('tpod3', 'Book 3 guests', { goal: G.pod, label: 'work', p: 1, min: 30, start: at('2026-11-20', '12:00') }),
  task('tpod4', 'Record episode 1', { goal: G.pod, label: 'work', p: 2, min: 90, start: at('2026-11-20', '14:30') }),
  task('tpod5', 'Edit episode 1', { goal: G.pod, label: 'work', p: 2, min: 60 }),
  task('tpod6', 'Submit the feed to Spotify and Apple', { goal: G.pod, label: 'work', p: 2, min: 30, due: '2026-12-01' }),
  task('tgrow1', 'Cut a 60-second trailer', { goal: G.grow, label: 'work', p: 2, min: 45 }),
  task('tgrow2', 'Share the trailer in 3 communities', { goal: G.grow, label: 'work', p: 3, min: 30 }),
  // Ship v2 of the app
  task('tv1', 'Fix the onboarding crash', { goal: G.v2, label: 'work', p: 1, min: 60, start: at('2026-11-20', '10:30') }),
  task('tv2', 'Add crash reporting', { goal: G.v2, label: 'work', done: true, doneAt: at('2026-11-19', '15:00'), min: 60 }),
  task('tv3', 'Set up the beta feedback form', { goal: G.v2, label: 'work', done: true, doneAt: at('2026-11-19', '17:00'), min: 30 }),
  task('tv4', 'Write the v2 release notes', { goal: G.v2, label: 'work', p: 2, min: 45, start: at('2026-11-21', '11:00') }),
  task('tv5', 'Invite 50 beta testers', { goal: G.v2, label: 'work', p: 2, min: 30 }),
  task('tv6', 'Submit the build for review', { goal: G.v2, label: 'work', p: 1, min: 30, due: '2026-11-24' }),
  // Run a half marathon
  task('trun1', 'Buy running shoes', { goal: G.run, label: 'personal', done: true, doneAt: at('2026-11-05', '18:00'), min: 60 }),
  task('trun2', 'Register for the race', { goal: G.run, label: 'personal', p: 1, min: 15, due: '2026-11-25' }),
  task('trun3', 'Plan the race-week meals', { goal: G.run, label: 'personal', p: 3, min: 30 }),
  // Mentor two junior devs
  task('tm1', 'Review Alex’s first pull request', { goal: G.mentor, label: 'others', p: 2, min: 30, start: at('2026-11-20', '16:30') }),
  task('tm2', 'Pair with Jo on writing tests', { goal: G.mentor, label: 'others', p: 2, min: 60, start: at('2026-11-22', '11:00') }),
  task('tm3', 'Share a reading list', { goal: G.mentor, label: 'others', done: true, doneAt: at('2026-11-16', '10:00'), min: 15 }),
  // Moved into the new flat (archived)
  task('tf1', 'Book the movers', { goal: G.flat, label: 'personal', done: true, doneAt: at('2026-11-03', '10:00'), min: 30 }),
  task('tf2', 'Set up the internet', { goal: G.flat, label: 'personal', done: true, doneAt: at('2026-11-07', '12:00'), min: 30 }),
  // Off-goal
  task('to1', 'Renew car insurance', { label: 'personal', p: 1, min: 30, due: '2026-11-21' }),
  task('to2', 'Call the plumber', { label: 'personal', p: 2, min: 15, start: at('2026-11-20', '18:00') }),
  task('to3', 'Book a dentist appointment', { label: 'personal', p: 3, min: 15 }),
  task('to4', 'Send the rent', { label: 'personal', done: true, doneAt: at('2026-11-18', '09:30'), min: 15 }),
  // Training runs already done (a repeat's tasks are "<repeat id>.<day>")
  ...['2026-11-02', '2026-11-04', '2026-11-07', '2026-11-09', '2026-11-11', '2026-11-14', '2026-11-16', '2026-11-18'].map(d =>
    ({ ...task(`rrun.${d}`, 'Training run', { goal: G.run, label: 'personal', done: true, min: 45, start: at(d, '18:30') }), doneAt: at(d, '19:20') })),
];

const kr = (id, text, done = false, results) => ({ id, text, done, ...(results ? { results } : {}) });
const goal = (id, title, o) => ({
  id, title, section: o.section, results: o.results ?? [], parent: o.parent ?? null, parentKr: o.parentKr ?? null,
  by: o.by ?? null, status: o.status ?? 'active', plan: o.plan, created: T0, closedAt: o.closedAt ?? null, updatedAt: T0,
});
const wait = (id, title, done = false) => ({ id, title, done, created: at('2026-11-18', '10:00'), doneAt: done ? at('2026-11-19', '10:00') : null });

export const goals = [
  goal(G.pod, 'Launch the podcast', {
    section: 'work', by: '2026-12-15',
    results: [kr('kpod1', 'First 3 episodes recorded'), kr('kpod2', 'Live on Spotify and Apple'), kr('kpod3', '100 subscribers')],
    plan: {
      waits: [wait('wguests', 'Guests confirm a date')],
      links: [
        { from: 'tpod1', to: 'tpod4' }, { from: 'tpod3', to: 'wguests' }, { from: 'wguests', to: 'tpod4' },
        { from: 'tpod4', to: 'tpod5' }, { from: 'tpod5', to: 'kr:kpod1' }, { from: 'tpod2', to: 'tpod6' },
        { from: 'tpod5', to: 'tpod6' }, { from: 'tpod6', to: 'kr:kpod2' },
      ],
    },
  }),
  goal(G.grow, 'Grow to 100 subscribers', {
    section: 'work', parent: G.pod, parentKr: 'kpod3',
    results: [kr('kgrow1', 'Trailer posted')],
    plan: { waits: [], links: [{ from: 'tgrow1', to: 'tgrow2' }] },
  }),
  goal(G.v2, 'Ship v2 of the app', {
    section: 'work', by: '2026-12-31',
    results: [kr('kv1', 'Beta with 50 testers'), kr('kv2', '99.5% crash-free sessions')],
    plan: {
      waits: [wait('wreview', 'App Store review')],
      links: [
        { from: 'tv2', to: 'tv1' }, { from: 'tv1', to: 'tv6' }, { from: 'tv6', to: 'wreview' }, { from: 'wreview', to: 'tv5' },
        { from: 'tv3', to: 'tv5' }, { from: 'tv5', to: 'kr:kv1' }, { from: 'tv1', to: 'kr:kv2' },
      ],
    },
  }),
  goal(G.run, 'Run a half marathon', {
    section: 'personal', by: '2027-02-14',
    results: [kr('krun1', '20 training runs'), kr('krun2', 'Finish under 2:15')],
    plan: { waits: [], links: [{ from: 'trun1', to: 'rep:rrun' }, { from: 'rep:rrun', to: 'kr:krun1' }, { from: 'trun2', to: 'kr:krun2' }] },
  }),
  goal(G.mentor, 'Mentor two junior devs', {
    section: 'others', by: '2027-01-31',
    results: [kr('km1', 'Both ship a feature on their own')],
    plan: { waits: [], links: [{ from: 'tm3', to: 'tm1' }, { from: 'tm1', to: 'tm2' }] },
  }),
  goal(G.flat, 'Move into the new flat', {
    section: 'personal', status: 'achieved', closedAt: at('2026-11-08', '18:00'),
    results: [kr('kf1', 'Keys in hand', true), kr('kf2', 'Internet working', true)],
    plan: { waits: [], links: [{ from: 'tf1', to: 'tf2' }] },
  }),
];

export const repeats = [
  {
    id: 'rrun', title: 'Training run', notes: '', priority: 2, minutes: 45, label: 'personal', goal: G.run,
    rule: { freq: 'week', every: 1, days: [1, 3, 6], monthDay: null, until: null, times: 20, per: null },
    time: '18:30', from: '2026-11-02', made: '2026-11-19', raw: 'Run Mon, Wed and Sat at 6:30pm, 20 times', created: T0, updatedAt: T0,
  },
  {
    id: 'rgroc', title: 'Order groceries', notes: '', priority: 2, minutes: 15, label: 'personal', goal: null,
    rule: { freq: 'week', every: 1, days: [1, 4], monthDay: null, until: null, times: null, per: null },
    time: null, from: '2026-11-02', made: '2026-11-19', raw: 'order groceries every Monday and Thursday', created: T0, updatedAt: T0,
  },
];

export const dayPlans = [{
  day: '2026-11-20', at: at('2026-11-20', '09:05'), by: 'claude',
  focus: [
    { goal: G.v2, text: 'Onboarding crash fixed and the build in for review', tasks: ['tv1', 'tv6'] },
    { goal: G.pod, text: 'Guests booked and episode 1 recorded', tasks: ['tpod3', 'tpod4'] },
  ],
}];

/** localStorage contents for the app's local-only mode. */
export function storage(extra = {}) {
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  return {
    'ds.tasks.v1': JSON.stringify(byId),
    'ds.settings.v1': JSON.stringify({ goals, repeats, 'day-plans': dayPlans }),
    ...extra,
  };
}
