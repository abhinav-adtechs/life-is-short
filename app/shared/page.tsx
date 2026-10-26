import type { Metadata } from 'next';
import SharedPlanner from '@/components/SharedPlanner';

export const metadata: Metadata = {
  title: 'Shared planner · Life is short',
  robots: { index: false, follow: false },
};

/** A planner shared with you, view only. The link's secret is in the hash, so it never reaches the server's logs. */
export default function SharedPage() {
  return <SharedPlanner />;
}
