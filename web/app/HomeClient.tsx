'use client'
import { useState }        from 'react'
import { useRouter }       from 'next/navigation'
import Image               from 'next/image'
import ReactMarkdown       from 'react-markdown'
import remarkGfm           from 'remark-gfm'
import LandingLayout       from '@/components/layout/LandingLayout'

const AUTH_KEY = 'byproforma_auth'

export default function HomeClient({ methodology }: { methodology: string }) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const correct = process.env.NEXT_PUBLIC_APP_PASSWORD ?? ''
    if (password === correct && correct !== '') {
      localStorage.setItem(AUTH_KEY, '1')
      router.push('/engine')
    } else {
      setError('Incorrect password.')
      setPassword('')
    }
  }

  return (
    <LandingLayout>

        {/* Password section */}
        <section className="py-12 border-b border-black mb-16">
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

        {/* Methodology content — split at {QUOTES} marker to inject quote boxes inline */}
        <article className="methodology">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
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
                <ul className="font-plex-mono text-xs leading-relaxed mb-4 space-y-1 pl-5 list-disc marker:text-gray-400">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="font-plex-mono text-xs leading-relaxed mb-4 space-y-1 pl-5 list-decimal marker:text-gray-500">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="font-plex-mono text-xs text-gray-800 pl-1">
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
                <blockquote className="border-l-4 border-black pl-5 my-6 font-space-mono text-sm text-black leading-relaxed">
                  {children}
                </blockquote>
              ),
            }}
          >
            {methodology.split('{QUOTES}')[0]}
          </ReactMarkdown>

          {/* Quote boxes — injected at {QUOTES} marker position */}
          <div className="grid grid-cols-1 gap-4 my-10 sm:grid-cols-2">
            {[
              {
                quote: "Markets are efficient until they aren't.",
                name:  "Eugene F. Fama",
                title: "University of Chicago",
                note:  "Nobel Prize in Economics, 2013",
                photo: "/fama-circle.png",
              },
              {
                quote: "Just run the data through the sorts and see what loads.",
                name:  "Kenneth R. French",
                title: "Dartmouth Tuck School of Business",
                note:  "Co-author, Fama-French Factor Models",
                photo: "/french-circle.png",
              },
            ].map(({ quote, name, title, note, photo }) => (
              <div key={name} className="border border-black p-5 flex flex-col justify-between gap-4">
                <div>
                  <span className="font-space-mono text-3xl text-gray-200 leading-none select-none">"</span>
                  <p className="font-space-mono text-sm leading-relaxed text-black -mt-2">{quote}</p>
                  <span className="font-space-mono text-3xl text-gray-200 leading-none select-none float-right">"</span>
                </div>
                <div className="border-t border-gray-200 pt-3 clear-both flex items-center gap-3">
                  <Image
                    src={photo}
                    alt={name}
                    width={40}
                    height={40}
                    className="rounded-full flex-shrink-0 grayscale"
                  />
                  <div>
                    <p className="font-space-mono text-xs font-bold uppercase tracking-widest">{name}</p>
                    <p className="font-plex-mono text-xs text-gray-500">{title}</p>
                    <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">{note}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
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
              <p className="font-plex-mono text-xs leading-relaxed mb-4 text-gray-800">{children}</p>
            ),
            strong: ({ children }) => <strong className="font-bold text-black">{children}</strong>,
            ul: ({ children }) => (
              <ul className="font-plex-mono text-xs leading-relaxed mb-4 space-y-1 pl-5 list-disc marker:text-gray-400">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="font-plex-mono text-xs leading-relaxed mb-4 space-y-1 pl-5 list-decimal marker:text-gray-500">{children}</ol>
            ),
            li: ({ children }) => (
              <li className="font-plex-mono text-xs text-gray-800 pl-1">{children}</li>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto mb-6">
                <table className="w-full font-plex-mono text-xs border-collapse">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="border-b border-black">{children}</thead>,
            th: ({ children }) => (
              <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">{children}</th>
            ),
            td: ({ children }) => (
              <td className="py-1 pr-4 border-b border-gray-100 text-gray-700">{children}</td>
            ),
            pre: ({ children }) => (
              <pre className="bg-white border border-gray-200 px-4 py-3 font-plex-mono text-xs overflow-x-auto mb-4 leading-relaxed whitespace-pre">{children}</pre>
            ),
            code: ({ children, className }) => {
              const isBlock = !!className || String(children).includes('\n')
              return isBlock
                ? <code className="font-plex-mono text-xs">{children}</code>
                : <code className="font-plex-mono text-xs bg-gray-100 px-1 py-0.5">{children}</code>
            },
            hr: () => <hr className="border-0 border-t border-gray-200 my-8" />,
          }}>
            {methodology.split('{QUOTES}')[1] ?? ''}
          </ReactMarkdown>
        </article>

    </LandingLayout>
  )
}
