'use client'
import { useState }    from 'react'
import { useRouter }   from 'next/navigation'
import Image           from 'next/image'
import ReactMarkdown   from 'react-markdown'
import remarkGfm       from 'remark-gfm'

const AUTH_KEY = 'byproforma_auth'

export default function LoginClient({ methodology }: { methodology: string }) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const correct = process.env.NEXT_PUBLIC_APP_PASSWORD ?? ''
    if (password === correct && correct !== '') {
      localStorage.setItem(AUTH_KEY, '1')
      router.push('/')
    } else {
      setError('Incorrect password.')
      setPassword('')
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F6F2]">

      {/* Fixed logo header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#F7F6F2] border-b border-black">
        <div className="max-w-3xl mx-auto px-8 py-3">
          <Image
            src="/logo.png"
            alt="Proforma — Smart Beta Portfolio Builder"
            height={40}
            width={152}
            priority
            className="object-contain object-left"
          />
        </div>
      </header>

      {/* Scrollable body — padded below fixed header */}
      <main className="pt-24 pb-24 max-w-3xl mx-auto px-8">

        {/* Password section */}
        <section className="py-12 border-b border-black mb-16">
          <p className="font-plex-mono text-xs uppercase tracking-[0.2em] text-gray-400 mb-2">
            Smart Beta Portfolio Builder
          </p>
          <h1 className="font-space-mono text-2xl font-bold uppercase tracking-tight mb-8">
            byProforma
          </h1>
          <form onSubmit={handleSubmit} className="flex items-center gap-3">
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="Password"
              autoFocus
              className="border border-black px-3 py-2 font-plex-mono text-sm w-52 bg-transparent focus:outline-none focus:ring-1 focus:ring-black"
            />
            <button
              type="submit"
              className="border border-black px-4 py-2 font-plex-mono text-xs uppercase tracking-widest hover:bg-black hover:text-white transition-none"
            >
              Enter
            </button>
          </form>
          {error && (
            <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest mt-3">
              {error}
            </p>
          )}
        </section>

        {/* Methodology content */}
        <article className="methodology">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="font-space-mono text-xl font-bold uppercase tracking-tight border-b border-black pb-2 mb-6 mt-10 first:mt-0">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="font-space-mono text-sm font-bold uppercase tracking-widest border-b border-gray-300 pb-1 mb-4 mt-10">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="font-space-mono text-xs font-bold uppercase tracking-widest mb-3 mt-6 text-gray-700">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="font-plex-mono text-xs leading-relaxed mb-4 text-gray-800">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="font-plex-mono text-xs leading-relaxed mb-4 space-y-1 pl-4">
                  {children}
                </ul>
              ),
              li: ({ children }) => (
                <li className="before:content-['—'] before:mr-2 before:text-gray-400">
                  {children}
                </li>
              ),
              strong: ({ children }) => (
                <strong className="font-bold text-black">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="italic text-gray-700">{children}</em>
              ),
              pre: ({ children }) => (
                <pre className="bg-white border border-gray-200 px-4 py-3 font-plex-mono text-xs overflow-x-auto mb-4 leading-relaxed whitespace-pre">
                  {children}
                </pre>
              ),
              code: ({ children, className }) => {
                // Inside a pre (block) vs inline — check for language class or multiline
                const isBlock = !!className || String(children).includes('\n')
                return isBlock ? (
                  <code className="font-plex-mono text-xs">{children}</code>
                ) : (
                  <code className="font-plex-mono text-xs bg-gray-100 px-1 py-0.5">
                    {children}
                  </code>
                )
              },
              table: ({ children }) => (
                <div className="overflow-x-auto mb-6">
                  <table className="w-full font-plex-mono text-xs border-collapse">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="border-b border-black">{children}</thead>
              ),
              th: ({ children }) => (
                <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="py-1 pr-4 border-b border-gray-100 text-gray-700">
                  {children}
                </td>
              ),
              hr: () => (
                <hr className="border-0 border-t border-gray-200 my-8" />
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-black pl-4 my-4 font-plex-mono text-xs text-gray-600 italic">
                  {children}
                </blockquote>
              ),
            }}
          >
            {methodology}
          </ReactMarkdown>
        </article>

      </main>
    </div>
  )
}
