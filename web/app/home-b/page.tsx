import Image          from 'next/image'
import IndustrialMark from '@/components/IndustrialMark'

export default function HomeBPage() {
  return (
    <div className="surface-noise relative min-h-screen flex items-center justify-center px-10 sm:px-16 py-8 overflow-hidden">
      <Image
        src="https://images.pexels.com/photos/19073569/pexels-photo-19073569/free-photo-of-construction-building-in-black-and-white.jpeg"
        alt=""
        fill
        className="object-cover"
        priority
      />

      {/* Document — 8×10 aspect ratio, z-[2] above noise */}
      <div className="relative z-[2] w-full max-w-[560px] aspect-[4/5] bg-[#F7F6F2] overflow-hidden flex flex-col">

        {/* Logo — top left */}
        <div className="absolute top-10 left-10">
          <Image
            src="/logo-4.png"
            alt="Proforma Investment Management"
            width={220}
            height={49}
            priority
            className="object-contain"
          />
        </div>

        {/* Main content — vertically centered within document */}
        <div className="flex flex-col justify-center flex-1 px-10">

          <div className="mb-8">
            <h1 className="font-aileron text-[1.375rem] font-bold leading-none tracking-tight whitespace-nowrap">
              Factor-Driven Portfolio Optimization
            </h1>
          </div>

          <div className="w-full border-t border-black/20" />

          <div className="mt-7">
            <p className="font-aileron text-[0.75rem] uppercase tracking-[0.18em] text-gray-400">
              Investing in light of market realities.
            </p>
            <p className="font-aileron text-[0.75rem] uppercase tracking-[0.18em] text-gray-400 mt-1">
              2026
            </p>
          </div>

        </div>

        {/* Industrial mark — bottom left */}
        <div className="absolute bottom-10 left-10">
          <IndustrialMark size={42} />
        </div>

      </div>
    </div>
  )
}
