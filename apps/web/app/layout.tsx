import type { Metadata } from 'next';
import './style.css';

export const metadata: Metadata = {
  title: 'GIF Platform — local development',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
