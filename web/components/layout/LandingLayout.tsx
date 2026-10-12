import Image       from 'next/image'
import LandingNav  from './LandingNav'

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Top header — logo + horizontal nav, full width */}
      <header className="border-b border-black">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between py-3">
          <a href="/" className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Proforma"
              height={32}
              width={136}
              priority
              className="object-contain object-left"
            />
          </a>
          <LandingNav />
        </div>
      </header>
      {/* Scrollable content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  )
}
