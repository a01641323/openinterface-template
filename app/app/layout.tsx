import config from '../../template.config.json';

export const metadata = { title: config.brandName };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
