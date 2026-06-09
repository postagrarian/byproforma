import Image      from 'next/image'
import RandomIcon from '@/components/RandomIcon'

export default function HomeBPage() {
  return (
    <div className="relative min-h-screen bg-[#F7F6F2] px-12 py-10 overflow-hidden">

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

      {/* Main content block — vertically centered, left-aligned */}
      <div className="flex items-center min-h-screen">
        <div className="max-w-3xl w-full">
          <h1 className="font-aileron text-[5.5rem] font-bold leading-none tracking-tight">
            byProforma
          </h1>
          <div className="border-b-2 border-black mt-7 mb-6" />
          <p className="font-space-mono text-[2.5rem] font-bold leading-tight tracking-tight">
            Factor-Driven Portfolio
            <br />Optimization
          </p>
          <p className="font-plex-mono text-base text-gray-500 uppercase tracking-[0.2em] mt-5">
            Quantitative Asset Management &mdash; 2026
          </p>
        </div>
      </div>

      {/* Factor fingerprint — bottom left */}
      <div className="absolute bottom-10 left-12">
        <RandomIcon size={36} />
      </div>

    </div>
  )
}
