import Image       from 'next/image'
import RandomIcon  from '@/components/RandomIcon'

export default function HomeBPage() {
  return (
    <div className="min-h-screen bg-[#F7F6F2] flex flex-col items-center justify-center gap-8 px-8">
      <Image
        src="/logo-4.png"
        alt="Proforma Investment Management"
        width={640}
        height={142}
        priority
        className="object-contain"
      />
      <RandomIcon size={56} />
    </div>
  )
}
