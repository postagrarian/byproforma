import Image from 'next/image'

export default function Header() {
  return (
    <header className="border-b border-black py-3 flex items-center">
      <Image
        src="/logo.png"
        alt="Proforma — Factor Replication Engine"
        height={48}
        width={240}
        className="object-contain object-left"
        priority
      />
    </header>
  )
}
