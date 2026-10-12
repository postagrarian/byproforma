import Image         from 'next/image'
import LogoutButton  from './LogoutButton'

export default function Header() {
  return (
    <header className="border-b border-black">
      <div className="max-w-5xl mx-auto px-6 flex items-center justify-between py-3">
        <div className="flex items-center gap-4">
          <Image
            src="/logo.png"
            alt="Proforma — Factor Replication Engine"
            height={32}
            width={136}
            className="object-contain object-left"
            priority
          />
          <LogoutButton />
        </div>
        <span className="font-plex-mono text-[11px] text-gray-500 tracking-widest uppercase">
          Smart Beta Portfolio Builder
        </span>
      </div>
    </header>
  )
}
