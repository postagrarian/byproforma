import type { Metadata } from 'next'
import { Space_Mono, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  title: 'byProforma',
  description: 'Factor Replication Engine',
  icons: { icon: '/favicon.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceMono.variable} ${ibmPlexMono.variable}`}>
      <body className="antialiased bg-[#F7F6F2] text-black">
        {children}
      </body>
    </html>
  )
}
