'use client'

import { useLanguage } from '@/contexts/LanguageContext'

/*
 * ABOUT PAGE — PERSONAL INFO PLACEHOLDERS
 *
 * Search for [[...]] markers to find every field you need to fill in.
 * Replace each [[PLACEHOLDER: ...]] with your real information.
 *
 * Writing suggestions:
 * - Keep the "Who I Am" section to 2-3 short paragraphs. AdSense reviewers
 *   look for a real, identifiable person behind the site.
 * - Mention your professional background and WHY you write — this builds
 *   the "expertise" signal AdSense values.
 * - A photo is optional but helps. If you add one, place it at the top.
 */

export function AboutPage() {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  if (isZh) {
    return (
      <div className="prose prose-gray max-w-none">
        <h1>关于我</h1>

        {/* [[PLACEHOLDER: 你可以在这里放一张头像。如果需要，可以用 <img src="/images/avatar.jpg" alt="头像" className="w-24 h-24 rounded-full mb-4" />]] */}

        <h2>我是谁</h2>
        <p>
          我是一名在软件开发行业工作6年的软件工程师，专注于 Linux 内核和系统编程。
        </p>

        <h2>这个博客</h2>
        <p>
          Silver Bullet 是我记录技术学习、科研思考与生活感悟的地方。这里主要涵盖 Linux 内核、系统编程、开源技术，偶尔也会涉及投资理财与日常生活。
        </p>

        <h2>专业背景</h2>
        <p>
          我有6年的后端开发经验，熟悉 C语言 和 Linux 系统编程。曾参与贡献过 OpenResty/lkp 等开源项目。
        </p>

        <h2>联系方式</h2>
        <p>
          如果你有任何问题、合作意向或建议，欢迎通过以下方式联系我：
        </p>
        <ul>
          <li>邮箱：<a href="mailto:findns94@gmail.com">findns94@gmail.com</a></li>
          <li>GitHub：<a href="https://github.com/findns94" target="_blank" rel="noopener noreferrer">findns94</a></li>
        </ul>
      </div>
    )
  }

  return (
    <div className="prose prose-gray max-w-none">
      <h1>About</h1>

      {/* [[PLACEHOLDER: Optional headshot here. If you add one: <img src="/images/avatar.jpg" alt="Portrait" className="w-24 h-24 rounded-full mb-4" />]] */}

      <h2>Who I Am</h2>
      <p>
        I&apos;m a software engineer with 6 years of experience in software development,
        focused on Linux kernel and systems programming.
      </p>

      <h2>This Blog</h2>
      <p>
        Silver Bullet is where I write about tech learning, research, and life.
        The core topics are Linux kernel, systems programming, and open source —
        with the occasional dive into personal finance and daily life.
      </p>

      <h2>Background</h2>
      <p>
        I have 6 years of backend development experience, familiar with C language
        and Linux systems programming. I&apos;ve contributed to open-source projects
        such as OpenResty/lkp.
      </p>

      <h2>Get in Touch</h2>
      <p>
        If you have questions, collaboration ideas, or feedback, reach out:
      </p>
      <ul>
        <li>Email: <a href="mailto:findns94@gmail.com">findns94@gmail.com</a></li>
        <li>GitHub: <a href="https://github.com/findns94" target="_blank" rel="noopener noreferrer">findns94</a></li>
      </ul>
    </div>
  )
}
