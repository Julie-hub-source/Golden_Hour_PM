import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';

// Every page reads Supabase (account, notifications), so nothing is prerendered.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pulse',
  description: 'Early warning for project delivery: where each project is heading and what to fix first.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
