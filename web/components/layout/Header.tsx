import Image from 'next/image'

export default function Header() {
  return (
    <header className="border-b border-black py-3 flex items-center justify-between">
      <Image
        src="/logo.png"
        alt="Proforma — Factor Replication Engine"
        height={44}
        width={168}
        className="object-contain object-left"
        priority
      />
      <span className="font-plex-mono text-xs text-gray-500 tracking-widest uppercase">
        Smart Beta Portfolio Builder
      </span>
    </header>
  )
}
