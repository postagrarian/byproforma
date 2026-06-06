import { readFileSync } from 'fs'
import { join }         from 'path'
import LoginClient      from './LoginClient'

export default function LoginPage() {
  const methodology = readFileSync(
    join(process.cwd(), 'content', 'methodology.md'),
    'utf-8'
  )
  return <LoginClient methodology={methodology} />
}
