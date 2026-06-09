import Image          from 'next/image'
import IndustrialMark from '@/components/IndustrialMark'

export default function HomeBPage() {
  return (
    <div className="relative min-h-screen bg-[#F7F6F2] overflow-hidden">

      {/* Logo — top left anchor */}
      <div className="absolute top-10 left-12">
        <Image
          src="/logo-4.png"
          alt="Proforma Investment Management"
          width={220}
          height={49}
          priority
          className="object-contain"
        />
      </div>

      {/* Main content — vertically centered */}
      <div className="flex flex-col justify-center min-h-screen">

        {/* Title block — left-aligned */}
        <div className="px-12 mb-10">
          <h1 className="font-aileron text-[2rem] font-bold leading-none tracking-tight whitespace-nowrap">
            Factor-Driven Portfolio Optimization
          </h1>
        </div>

        {/* Full-width 1px rule */}
        <div className="w-full border-t border-black/25" />

        {/* Subtitle block */}
        <div className="px-12 mt-8">
          <p className="font-aileron text-[0.75rem] uppercase tracking-[0.18em] text-gray-400 mt-3">
            Systematic, Fundamental Investing &mdash; 2026
          </p>
        </div>

      </div>

      {/* Factor icon — bottom left */}
      <div className="absolute bottom-10 left-12">
        <IndustrialMark size={42} />
      </div>

    </div>
  )
}
