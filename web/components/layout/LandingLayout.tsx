import Image       from 'next/image'
import LandingNav  from './LandingNav'

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      {/* Fixed logo + nav — top-left, not full-width */}
      <div className="fixed top-0 left-0 z-50 px-8 pt-6">
        <Image
          src="/logo.png"
          alt="Proforma"
          height={56}
          width={239}
          priority
          className="object-contain object-left"
        />
        <LandingNav />
      </div>
      {/* Scrollable content — padded to clear logo + nav */}
      <main className="pt-52 pb-24 max-w-3xl mx-auto px-8">
        {children}
      </main>
    </div>
  )
}
