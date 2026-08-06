'use client'

import { useLanguage } from '@/contexts/LanguageContext'

/*
 * TERMS OF USE
 *
 * Sets the rules for using your site. Not strictly mandatory for AdSense,
 * but recommended — it rounds out your legal footprint and signals that
 * the site is professionally run.
 *
 * The main thing reviewers look for: a clear disclaimer that content is
 * "for informational purposes only" and that you're not liable for damages
 * from relying on it.
 */

export function TermsPage() {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  if (isZh) {
    return (
      <div className="prose prose-gray max-w-none">
        <h1>使用条款</h1>
        <p className="text-sm text-gray-500">最后更新：2026年8月6日</p>

        <p>
          访问或使用 Silver Bullet（以下简称「本网站」），即表示您同意以下使用条款。如果您不同意，请停止使用本网站。
        </p>

        <h2>1. 内容用途</h2>
        <p>
          本网站提供的内容仅供一般信息和教育目的。所有内容按「原样」提供，不作任何明示或暗示的保证。
        </p>
        {/* <p>
          [[PLACEHOLDER: 根据你的博客内容补充。例如：「本站涉及的技术教程和投资观点仅代表作者个人意见，不构成专业建议。请自行判断并承担风险。」]]
        </p> */}

        <h2>2. 知识产权</h2>
        <p>
          本网站上的内容（包括但不限于文章、图片、代码）遵循CC BY 4.0 署名许可协议，允许在注明来源的情况下使用，代码示例通常可在 MIT 许可下使用。
        </p>

        <h2>3. 用户行为</h2>
        <p>您同意不会：</p>
        <ul>
          <li>以任何可能损害本网站的方式使用它；</li>
          <li>尝试未经授权访问本网站或其服务器；</li>
          <li>使用本网站传播恶意软件或进行非法活动。</li>
        </ul>

        <h2>4. 外部链接</h2>
        <p>
          本网站可能包含指向第三方网站的链接。我们对这些外部网站的内容或隐私实践不承担责任。
        </p>

        <h2>5. 责任限制</h2>
        <p>
          在任何情况下，本网站及其作者对因使用或无法使用本网站内容而导致的任何直接、间接、附带或后果性损害不承担责任。
        </p>

        <h2>6. 条款变更</h2>
        <p>
          我们可能随时修改这些条款。变更将在本页发布后生效。继续使用本网站即表示您接受修改后的条款。
        </p>

        <h2>7. 联系方式</h2>
        <p>
          如对这些条款有疑问，请通过 <a href="mailto:findns94@gmail.com">findns94@gmail.com</a> 联系我们。
        </p>
      </div>
    )
  }

  return (
    <div className="prose prose-gray max-w-none">
      <h1>Terms of Use</h1>
      <p className="text-sm text-gray-500">Last updated: August 6, 2026</p>

      <p>
        By accessing or using Silver Bullet (the &ldquo;Site&rdquo;), you agree to these Terms of Use. If you do not agree, please discontinue use of the Site.
      </p>

      <h2>1. Purpose of Content</h2>
      <p>
        The content on this Site is provided for general informational and educational purposes only. All content is provided &ldquo;as is&rdquo; without any warranties, express or implied.
      </p>

      <h2>2. Intellectual Property</h2>
      <p>
        Content on this Site (including but not limited to articles, images, and code) is licensed under the CC BY 4.0 Attribution License, which allows use with proper attribution. Code samples are typically available under the MIT license.
      </p>

      <h2>3. User Conduct</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Site in any way that may damage or impair it;</li>
        <li>Attempt to gain unauthorized access to the Site or its servers;</li>
        <li>Use the Site to distribute malware or conduct illegal activities.</li>
      </ul>

      <h2>4. External Links</h2>
      <p>
        This Site may contain links to third-party websites. We are not responsible for the content or privacy practices of those external sites.
      </p>

      <h2>5. Limitation of Liability</h2>
      <p>
        In no event shall the Site or its author be liable for any direct, indirect, incidental, or consequential damages arising from your use of, or inability to use, the content on this Site.
      </p>

      <h2>6. Changes to Terms</h2>
      <p>
        We may modify these terms at any time. Changes take effect upon posting on this page. Continued use of the Site constitutes acceptance of the modified terms.
      </p>

      <h2>7. Contact</h2>
      <p>
        If you have questions about these terms, contact us at <a href="mailto:findns94@gmail.com">findns94@gmail.com</a>.
      </p>
    </div>
  )
}
