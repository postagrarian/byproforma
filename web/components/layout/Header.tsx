import Image         from 'next/image'
import LogoutButton  from './LogoutButton'

export default function Header() {
  return (
    <header className="border-b border-black py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Proforma — Factor Replication Engine"
          height={44}
          width={188}
          className="object-contain object-left"
          priority
        />
        <LogoutButton />
      </div>
      <span className="font-plex-mono text-xs text-gray-500 tracking-widest uppercase">
        Smart Beta Portfolio Builder
      </span>
    </header>
  )
}
