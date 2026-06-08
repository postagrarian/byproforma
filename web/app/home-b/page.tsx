import Image from 'next/image'

export default function HomeBPage() {
  return (
    <div className="min-h-screen bg-[#F7F6F2] flex flex-col items-center justify-center px-8">
      <Image
        src="/logo-4.png"
        alt="Proforma Investment Management"
        width={640}
        height={142}
        priority
        className="object-contain"
      />
      <p className="mt-8 font-plex-mono text-sm tracking-[0.25em] uppercase text-gray-500">
        Systematic, fundamental, disciplined
      </p>
    </div>
  )
}
