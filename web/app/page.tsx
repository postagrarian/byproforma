import { readFileSync } from 'fs'
import { join }         from 'path'
import HomeClient       from './HomeClient'

export default function HomePage() {
  const methodology = readFileSync(
    join(process.cwd(), 'content', 'methodology.md'),
    'utf-8'
  )
  return <HomeClient methodology={methodology} />
}
