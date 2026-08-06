'use client'

import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages } from '@/i18n/messages'

export function Footer() {
  const { language } = useLanguage()
  const t = getMessages(language)
  const year = new Date().getFullYear()

  return (
    <footer className="py-8 border-t border-gray-200 text-center text-sm text-gray-500">
      <nav className="flex flex-wrap justify-center gap-4 mb-4">
        <a href="/privacy" className="hover:text-blue-600 transition-colors">
          {t.footer.privacy}
        </a>
        <a href="/terms" className="hover:text-blue-600 transition-colors">
          {t.footer.terms}
        </a>
        <a href="/disclaimer" className="hover:text-blue-600 transition-colors">
          {t.footer.disclaimer}
        </a>
      </nav>
      <p>Martin Zhao &copy; {year}</p>
      <p className="mt-1">{t.footer.builtWith}</p>
    </footer>
  )
}
