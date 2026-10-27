import type { Metadata, Viewport } from 'next';
import { Mark } from '@/components/Brand';
import { CalendarIcon, CheckIcon, MicIcon } from '@/components/icons';
import './home.css';

/**
 * The public front door. Google's OAuth review needs a home page that names the app, says what it does and why it
 * asks for Google data, and links the privacy policy, all without signing in. The planner itself lives at /app.
 */

const REPO = 'https://github.com/abhinav-adtechs/life-is-short';

export const metadata: Metadata = {
  title: 'Life is short',
  description: 'Life is short is a day planner. Say what’s on your mind: it turns it into tasks, slots them around your Google Calendar and shows you the one thing to do now.',
  // Google Search Console's HTML-tag check, which proves you own this site (docs/go-live.md).
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
};

// The browser bar takes the wall's colour.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1F5E58' },
    { media: '(prefers-color-scheme: dark)', color: '#0E2826' },
  ],
};

/** Summer meadow (public/scenes/meadow), back to front. The clouds drift, the light breathes, the near fields pass. */
const LAYERS = ['sky', 'glow', 'clouds', 'land', 'near', 'wires'];

const BIRD = 'M1 5C4 2 8 2.4 12 8 16 2.4 20 2 23 5';

/** Each flock: where it flies, and per bird [left px, top px, width px, delay s]. */
const FLOCKS = [
  { cls: 'f1', birds: [[0, 8, 22, 0], [26, 0, 16, -0.9], [44, 13, 14, -1.7]] },
  { cls: 'f2', birds: [[0, 0, 12, -0.4], [16, 6, 10, -1.2]] },
  { cls: 'f3', birds: [[0, 6, 15, -0.2], [19, 0, 11, -1.4], [32, 9, 10, -2.1], [47, 4, 9, -0.8]] },
];

/** Dust in the light: [left %, bottom %, size px, delay s, duration s]. */
const MOTES = [
  [12, 18, 3, -3, 40], [22, 30, 2, -14, 46], [35, 12, 2, -25, 40], [48, 24, 3, -8, 52], [61, 16, 2, -31, 40],
  [72, 34, 2, -19, 44], [84, 20, 3, -11, 40], [92, 10, 2, -36, 50], [6, 8, 2, -22, 48], [55, 6, 2, -5, 42],
];

function View() {
  return (
    <div className="view" aria-hidden="true">
      <div className="stage">{LAYERS.map(l => <i key={l} className={'layer ' + l} />)}</div>
      <div className="flocks">
        {FLOCKS.map(f => (
          <div key={f.cls} className={'flock ' + f.cls}>
            {f.birds.map(([x, y, w, d], i) => (
              <i key={i} style={{ left: x, top: y, width: w, animationDelay: `${d}s` }}>
                <svg viewBox="0 0 24 12"><path d={BIRD} style={{ animationDelay: `${d * 0.4}s` }} /></svg>
              </i>
            ))}
          </div>
        ))}
      </div>
      <div className="motes">
        {MOTES.map(([x, y, s, d, t], i) => (
          <i key={i} style={{ left: `${x}%`, bottom: `${y}%`, width: s, height: s, animationDelay: `${d}s`, animationDuration: `${t}s` }} />
        ))}
      </div>
      <div className="shade" />
      <div className="glass" />
    </div>
  );
}

/** The Now screen, printed as a train ticket. */
function Ticket() {
  return (
    // The shadow sits on a wrapper: the notches are a mask, and a mask would cut the shadow off too.
    <div className="tk in" style={{ animationDelay: '.2s' }}>
      <figure className="ticket" role="img"
        aria-label="An example of the Now screen: call the plumber, 9:00 to 9:30, with Done and Schedule buttons. Next: landing page copy, due Friday.">
        <div className="thead"><span>Today · single</span><span>Seat 1A</span></div>
        <div className="perf" />
        <p className="label">Now · 9:00–9:30</p>
        <p className="ttl">Call the plumber</p>
        <p className="meta"><i className="dot" />Urgent · 30 min</p>
        <div className="acts"><span className="tb pri"><CheckIcon size={12} />Done</span><span className="tb">Schedule</span></div>
        <div className="perf" />
        <p className="label">Next</p>
        <p className="next">Landing page copy <span>due Fri</span></p>
        <span className="stamp">Valid<br />today</span>
      </figure>
    </div>
  );
}

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <View />
        <header className="top">
          <a className="brand" href="/"><Mark />Life is short</a>
          <nav aria-label="Main">
            <a className="hide-sm" href="#how">How it works</a>
            <a className="hide-sm" href="#google">Google data</a>
            <a className="hide-sm" href="/privacy">Privacy</a>
            <a className="pill" href="/app">Sign in</a>
          </nav>
        </header>
        <div className="lede">
          <div className="copy">
            <p className="eyebrow in">A day planner · Window seat</p>
            <h1 className="in" style={{ animationDelay: '.06s' }}>Life is short.<br />Look outside.</h1>
            <p className="lead in" style={{ animationDelay: '.12s' }}>
              Life is short is a day planner that does the organising for you. Say what’s on your mind: it turns it into
              tasks, slots them around your Google Calendar and shows you the one thing to do now. The rest of the day
              is for the view.
            </p>
            <div className="ctas in" style={{ animationDelay: '.18s' }}>
              <a className="cta pri" href="/app">Open the planner <span aria-hidden="true">→</span></a>
              <a className="cta alt" href="#how">How it works</a>
            </div>
          </div>
          <Ticket />
        </div>
      </section>

      <main>
        <section className="part" id="how" aria-labelledby="how-h">
          <p className="kicker">How it works</p>
          <h2 id="how-h">Dump it. Slot it. Do it.</h2>
          <p className="sub">
            You get about four thousand weeks. Most to-do apps want you to spend them organising: projects, tags,
            reviews, a list that only grows. Life is short has one box to dump things into, and one answer on the screen.
          </p>
          <ol className="steps">
            <li className="card">
              <p className="num">01 · Dump</p>
              <h3>Say what’s on your mind.</h3>
              <p>Type in the bar or tap the mic and just talk: a word, a list or a thirty-second ramble. The AI pulls out every task, gives it a priority and a length, and works out the dates.</p>
              <div className="ill dump" aria-hidden="true">
                <div className="bar"><span>Finished the roadmap. Call the plumber tomorrow at 9, landing page copy is due Friday…</span><b><MicIcon size={18} /></b></div>
                <div className="chips">
                  <span><em>+</em>Call the plumber · Tue 9:00</span>
                  <span><em>+</em>Landing page copy · due Fri</span>
                  <span className="done"><em><CheckIcon size={10} /></em>Roadmap draft</span>
                </div>
              </div>
            </li>
            <li className="card">
              <p className="num">02 · Slot</p>
              <h3>It lands in the right place.</h3>
              <p>Said a day or a time? It goes on your calendar, around the meetings you already have. Said a deadline, or nothing? It waits in a backlog, already ranked: Urgent, Important, Later.</p>
              <div className="ill slot" aria-hidden="true">
                <div className="hr"><span>8</span></div>
                <div className="hr"><span>9</span></div>
                <div className="hr"><span>10</span></div>
                <div className="hr"><span>11</span></div>
                <div className="ev g" style={{ top: '12.5%', height: '12.5%' }}>Standup <small>Google</small></div>
                <div className="ev t" style={{ top: '25%', height: '12.5%' }}>Call the plumber</div>
                <div className="ev free" style={{ top: '50%', height: '25%' }}>Next free gap</div>
              </div>
            </li>
            <li className="card">
              <p className="num">03 · Do</p>
              <h3>One thing on the screen.</h3>
              <p><b>Now</b> is the task on your calendar this minute, or the most important thing in your backlog. Mark it done, or schedule it into the next free gap. Slipped past something? It goes back on top of your backlog.</p>
              <ul className="ill do" aria-hidden="true">
                <li className="done"><em><CheckIcon size={10} /></em><s>Roadmap draft</s></li>
                <li className="now"><em />Call the plumber<span>Now</span></li>
                <li className="missed"><em />Book a haircut<span>Back to backlog</span></li>
              </ul>
            </li>
          </ol>
        </section>

        <section className="part" id="google" aria-labelledby="google-h">
          <p className="kicker">Google Calendar and Google Tasks</p>
          <h2 id="google-h">Your Google Calendar, read-only.</h2>
          <p className="sub">
            Connecting Google is optional. If you do, Life is short shows your events and Google Tasks on the same
            calendar as your own tasks, so it can slot them around what you already have. Here is everything it asks
            Google for, and why.
          </p>
          <div className="panel">
            <div className="thead"><span>Google access</span><span>Read-only</span></div>
            <div className="perf" />
            <div className="cols">
              <div>
                <h3>What it reads</h3>
                <ul className="scopes">
                  <li>
                    <p className="scope"><CalendarIcon size={16} />See your calendar events <code>calendar.readonly</code></p>
                    <p>Events from the calendars you choose, today through the next month, so your tasks fit around your meetings. A meeting on two of your accounts shows once.</p>
                  </li>
                  <li>
                    <p className="scope"><CheckIcon size={14} />See your Google Tasks <code>tasks.readonly</code></p>
                    <p>Your task lists, so everything you have to do is in one place. You can turn this off per account.</p>
                  </li>
                  <li>
                    <p className="scope"><span className="at" aria-hidden="true">@</span>Your email address <code>openid · email</code></p>
                    <p>To tell your connected accounts apart. You can connect up to five, personal and work alike.</p>
                  </li>
                </ul>
              </div>
              <div>
                <h3>What it never does</h3>
                <ul className="rules never">
                  <li>It never creates, changes or deletes anything in your Google account.</li>
                  <li>Your Google data is never used for advertising, never sold, and never shared beyond the services that run the app.</li>
                </ul>
                <h3>How it’s kept</h3>
                <ul className="rules kept">
                  <li>The access Google grants is encrypted (AES-256-GCM) before it is stored.</li>
                  <li>Disconnect any time in Settings → Google accounts, or at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</li>
                </ul>
                <p className="fine">
                  To sort what you dump, the titles of your open items, Google ones included, are sent to Google’s
                  Gemini API. The privacy policy covers this and every other service involved.
                </p>
              </div>
            </div>
            <div className="perf" />
            <a className="cta pri" href="/privacy">Read the privacy policy <span aria-hidden="true">→</span></a>
          </div>
        </section>

        <section className="part" id="private" aria-labelledby="private-h">
          <p className="kicker">Private by design</p>
          <h2 id="private-h">A map of your life, locked like one.</h2>
          <ul className="tiles">
            <li><p className="num">Invite only</p><p>There’s no public sign-up. Life is short runs as its owner’s private copy, and only accounts the owner adds can sign in.</p></li>
            <li><p className="num">PIN + authenticator</p><p>A password once per device, then a PIN and an authenticator code each day. Five wrong PINs sign every device out.</p></li>
            <li><p className="num">Checked by the database</p><p>Row-level security returns nothing unless this session passed both checks in the last 24 hours.</p></li>
            <li><p className="num">No ads, no tracking</p><p>No analytics and nothing sold. A nightly backup in a second region keeps your list safe.</p></li>
          </ul>
          <p className="sub">
            Life is short is open source. Want one for yourself? <a href={REPO}>Run your own copy</a>.
          </p>
        </section>
      </main>

      <footer className="foot">
        <p className="word"><Mark size={40} />Life is short.</p>
        <p className="tag">Dump it. Slot it. Do it.</p>
        <nav aria-label="Footer">
          <a href="/app">Open the planner</a>
          <a href="/privacy">Privacy policy</a>
          <a href={REPO}>Source on GitHub</a>
          <a href={`${REPO}/issues`}>Contact</a>
        </nav>
      </footer>
    </div>
  );
}
