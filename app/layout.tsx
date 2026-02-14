import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: {
    default: 'Bristlecone Technical Interaction',
    template: '%s',
  },
  description:
    'Technical interview and screening platform for evaluating job applicants with structured real-time interaction.',
  twitter: {
    creator: '@bristlecone',
    site: '@bristlecone',
    card: 'summary_large_image',
  },
  openGraph: {
    url: 'http://localhost:3000',
    siteName: 'Bristlecone Technical Interaction',
  },
  icons: {
    icon: {
      rel: 'icon',
      url: '/favicon.ico',
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#f2f4f7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body data-lk-theme="default">
        <Toaster />
        {children}
      </body>
    </html>
  );
}
