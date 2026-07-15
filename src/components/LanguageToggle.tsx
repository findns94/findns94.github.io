'use client'

import { useLanguage } from '@/contexts/LanguageContext'

export function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage()

  return (
    <button
      onClick={toggleLanguage}
      className="px-3 py-1 text-sm font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer"
      aria-label={language === 'en' ? '切换到中文' : 'Switch to English'}
      title={language === 'en' ? '切换到中文' : 'Switch to English'}
    >
      {language === 'en' ? '中文' : 'EN'}
    </button>
  )
}
