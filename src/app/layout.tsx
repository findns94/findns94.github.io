import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Silver Bullet',
    template: '%s | Silver Bullet',
  },
  description: 'Martin Zhao 的个人博客 — 技术、科研与生活',
  alternates: {
    types: {
      'application/rss+xml': '/feed.xml',
    },
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
          integrity="sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <header className="py-8 border-b border-gray-200 mb-8">
            <a href="/" className="text-2xl font-bold text-gray-900 no-underline hover:text-blue-600 transition-colors">
              Silver Bullet
            </a>
            <nav className="mt-3 flex gap-6 text-sm text-gray-600">
              <a href="/" className="hover:text-blue-600 transition-colors">首页</a>
              <a href="/tags" className="hover:text-blue-600 transition-colors">标签</a>
              <a href="/feed.xml" className="hover:text-blue-600 transition-colors">RSS</a>
            </nav>
          </header>
          <main className="pb-16">
            {children}
          </main>
          <footer className="py-8 border-t border-gray-200 text-center text-sm text-gray-500">
            <p>Martin Zhao &copy; {new Date().getFullYear()}</p>
            <p className="mt-1">Built with Next.js</p>
          </footer>
        </div>
      </body>
    </html>
  )
}
