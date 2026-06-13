import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'A-Biz LINE Bot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
