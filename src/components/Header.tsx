'use client'

import Link from 'next/link'
import { LanguageToggle } from './LanguageToggle'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages } from '@/i18n/messages'

export function Header() {
  const { language } = useLanguage()
  const t = getMessages(language)

  return (
    <header className="py-8 border-b border-gray-200 mb-8">
      <div className="flex items-center justify-between">
        <a href="/" className="text-2xl font-bold text-gray-900 no-underline hover:text-blue-600 transition-colors">
          Silver Bullet
        </a>
        <LanguageToggle />
      </div>
      <nav className="mt-3 flex gap-6 text-sm text-gray-600">
        <a href="/" className="hover:text-blue-600 transition-colors">{t.nav.home}</a>
        <a href="/about" className="hover:text-blue-600 transition-colors">{t.nav.about}</a>
        <a href="/contact" className="hover:text-blue-600 transition-colors">{t.nav.contact}</a>
        <a href="/tags" className="hover:text-blue-600 transition-colors">{t.nav.tags}</a>
        <a href="/feed.xml" className="hover:text-blue-600 transition-colors">{t.nav.rss}</a>
      </nav>
    </header>
  )
}
