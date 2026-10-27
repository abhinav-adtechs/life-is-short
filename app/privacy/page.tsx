import type { Metadata } from 'next';
import { Brand } from '@/components/Brand';

export const metadata: Metadata = {
  title: 'Privacy · Life is short',
  description: 'What Life is short stores, where, and who else sees it.',
};

/** Public privacy policy. Google's consent screen links here, so it must load without signing in. */
export default function PrivacyPage() {
  return (
    <main className="legal">
      <a className="legal-home" href="/" aria-label="Life is short, home"><Brand /></a>
      <h1>Privacy</h1>
      <p className="meta">Life is short · updated 27 October 2026</p>

      <p>
        Life is short is a personal day planner, run by its owner for their own use. There is no public sign-up:
        only accounts the owner adds can sign in, with a password or PIN plus an authenticator code.
      </p>

      <h2>What it stores</h2>
      <ul>
        <li>
          The tasks and notes you type or speak, your settings, and a history of your last 30 dump conversations (what
          you said and what came of it), in a Supabase database in Mumbai, India.
        </li>
        <li>A copy of the same, refreshed every night, in a second Supabase database in Singapore, kept only as a backup.</li>
        <li>Your email address and sign-in records, held by Supabase Auth.</li>
      </ul>
      <p>There are no ads, no analytics and no tracking. Nothing is sold or shared for marketing.</p>

      <h2>Google Calendar and Google Tasks</h2>
      <ul>
        <li>
          If you connect a Google account, the app reads events from the calendars you choose and your Google Tasks,
          from today through the next month, and shows them in your planner.
        </li>
        <li>
          Today the app only reads. If a later version adds things to Google for you, it will only create or change the
          items you ask it to.
        </li>
        <li>
          The access Google grants is encrypted (AES-256-GCM) before it is stored. The events and tasks it pulls are
          stored with your own tasks so they appear on all your devices.
        </li>
        <li>
          Google data is used only to show your schedule in the planner. It is not used for advertising, not sold, and
          not given to anyone except as described on this page.
        </li>
        <li>
          Disconnect an account any time in Settings → Google accounts. That revokes the app&rsquo;s access at Google and
          can remove the items it pulled. You can also revoke access at{' '}
          <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
        </li>
      </ul>

      <h2>AI sorting</h2>
      <p>
        When you dump something, what you typed or said in that conversation and the plan drafted so far, plus the
        titles of your open items (including ones pulled from Google), is sent to Google&rsquo;s Gemini API so it can
        sort the new items and avoid duplicates. Nothing else is sent. The app uses the Gemini API&rsquo;s free tier,
        under whose terms Google may use what it receives to improve its products. Without an AI key, the app sorts by
        keywords in your browser instead and sends nothing.
      </p>
      <p>
        Speaking uses your browser&rsquo;s own speech recognition. Where the browser can recognise speech on your
        device, the audio stays there; otherwise the browser sends it to its maker&rsquo;s speech service (Google for
        Chrome, Apple for Safari) to be transcribed. The app itself never receives or stores audio.
      </p>

      <h2>Sharing</h2>
      <p>
        If you share your planner, the people you invite see only what you choose, and you can stop sharing at any time.
        Invitations are emailed through Resend.
      </p>

      <h2>Services involved</h2>
      <ul>
        <li>Vercel hosts the app.</li>
        <li>Supabase stores your data and handles sign-in.</li>
        <li>Google provides Calendar and Tasks (if you connect them), the Gemini API, and the font this page uses.</li>
        <li>Resend sends sharing invitations, if you use sharing.</li>
        <li>GitHub Actions runs the nightly backup check. Its logs contain counts only, never task text or emails.</li>
      </ul>

      <h2>Keeping and deleting</h2>
      <p>
        Your tasks stay until you delete them. Deleted items leave the backup at its next nightly refresh. To have
        everything deleted, ask the owner, or open an issue at{' '}
        <a href="https://github.com/abhinav-adtechs/life-is-short/issues">github.com/abhinav-adtechs/life-is-short</a>.
      </p>
    </main>
  );
}
