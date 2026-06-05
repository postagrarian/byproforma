import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Allow the Railway API origin for server-side fetches
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default nextConfig
