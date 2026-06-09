import Image      from 'next/image'
import RandomIcon from '@/components/RandomIcon'

export default function HomeBPage() {
  return (
    <div className="relative min-h-screen bg-[#F7F6F2] overflow-hidden">

      {/* Logo — top left anchor */}
      <div className="absolute top-10 left-12">
        <Image
          src="/logo-4.png"
          alt="Proforma Investment Management"
          width={160}
          height={36}
          priority
          className="object-contain"
        />
      </div>

      {/* Main content — vertically centered */}
      <div className="flex flex-col justify-center min-h-screen">

        {/* Title block — centered, right-aligned text */}
        <div className="max-w-2xl mx-auto w-full px-8 mb-10">
          <h1 className="font-aileron text-[3.25rem] font-bold leading-[1.1] tracking-tight text-right">
            Factor-Driven<br />Portfolio Optimization
          </h1>
        </div>

        {/* Full-width 1px rule */}
        <div className="w-full border-t border-black/25" />

        {/* Subtitle block */}
        <div className="max-w-2xl mx-auto w-full px-8 mt-8">
          <p className="font-aileron text-xl font-semibold text-right tracking-tight">
            byProforma
          </p>
          <p className="font-plex-mono text-[0.65rem] uppercase tracking-[0.22em] text-gray-400 text-right mt-3">
            Systematic, Fundamental Investing &mdash; 2026
          </p>
        </div>

      </div>

      {/* Factor icon — bottom left */}
      <div className="absolute bottom-10 left-12">
        <RandomIcon size={30} />
      </div>

    </div>
  )
}
