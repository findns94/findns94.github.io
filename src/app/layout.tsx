import type { Metadata } from 'next'
import { LanguageProvider } from '@/contexts/LanguageContext'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://findns.cc'),
  title: {
    default: 'Silver Bullet',
    template: '%s | Silver Bullet',
  },
  description: "Martin Zhao's Blog — Linux, Kernel, Tech, Research, and Life",
  keywords: ['Linux', 'Kernel', 'Technology', 'Programming', 'Open Source'],
  authors: [{ name: 'Martin Zhao' }],
  alternates: {
    types: {
      'application/rss+xml': '/feed.xml',
    },
  },
  openGraph: {
    type: 'website',
    title: 'Silver Bullet',
    description: "Martin Zhao's Blog — Linux, Kernel, Tech, Research, and Life",
    siteName: 'Silver Bullet',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
          integrity="sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <LanguageProvider>
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <Header />
            <main className="pb-16">
              {children}
            </main>
            <Footer />
          </div>
        </LanguageProvider>
      </body>
    </html>
  )
}
