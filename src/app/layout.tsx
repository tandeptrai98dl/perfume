import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Perfume Store',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
