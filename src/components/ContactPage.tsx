'use client'

import { useLanguage } from '@/contexts/LanguageContext'

/*
 * CONTACT PAGE
 *
 * AdSense reviewers sometimes verify that a site operator can be reached.
 * A real, working contact method is a strong trust signal.
 *
 * Writing suggestions:
 * - At minimum, provide a working email address.
 * - Social links (GitHub, LinkedIn) add credibility.
 * - A response-time expectation ("I reply within 48 hours") is a nice touch
 *   and shows the site is actively maintained.
 */

export function ContactPage() {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  if (isZh) {
    return (
      <div className="prose prose-gray max-w-none">
        <h1>联系我</h1>

        <p>
          欢迎通过以下方式与我取得联系。无论是技术讨论、合作意向、内容反馈，还是单纯想打个招呼，都欢迎。
        </p>

        <h2>首选方式</h2>
        <ul>
          <li>
            邮箱：<a href="mailto:findns94@gmail.com">findns94@gmail.com</a>
            <br />
          </li>
        </ul>

        <h2>社交媒体</h2>
        <ul>
          <li>
            GitHub：<a href="https://github.com/findns94" target="_blank" rel="noopener noreferrer">github.com/findns94</a>
          </li>
        </ul>
      </div>
    )
  }

  return (
    <div className="prose prose-gray max-w-none">
      <h1>Contact</h1>

      <p>
        Feel free to reach out through any of the channels below — whether it&apos;s
        a technical question, collaboration idea, content feedback, or just to say hi.
      </p>

      <h2>Preferred</h2>
      <ul>
        <li>
          Email: <a href="mailto:findns94@gmail.com">findns94@gmail.com</a>
        </li>
      </ul>

      <h2>Social</h2>
      <ul>
        <li>
          GitHub: <a href="https://github.com/findns94" target="_blank" rel="noopener noreferrer">github.com/findns94</a>
        </li>
      </ul>
    </div>
  )
}
