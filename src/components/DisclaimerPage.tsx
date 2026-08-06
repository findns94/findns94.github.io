'use client'

import { useLanguage } from '@/contexts/LanguageContext'

/*
 * DISCLAIMER — AD / AFFILIATE DISCLOSURE
 *
 * This page covers two things AdSense and the FTC care about:
 *   1. Advertising disclosure — you show ads (Google AdSense) and may earn
 *      from clicks/impressions.
 *   2. Affiliate links — if you link to products and earn a commission.
 *
 * FTC (US) requires clear disclosure of material connections.
 * AdSense requires you don't encourage clicks ("Click my ads!").
 *
 * Customize the affiliate section based on whether you actually use them.
 */

export function DisclaimerPage() {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  if (isZh) {
    return (
      <div className="prose prose-gray max-w-none">
        <h1>免责声明</h1>
        <p className="text-sm text-gray-500">最后更新：2026年8月6日</p>

        {/* <h2>广告披露</h2>
        <p>
          本网站使用 Google AdSense 投放广告。当您点击广告时，我们可能获得收入。广告内容由 Google 根据您的浏览历史和兴趣自动选择，我们无法完全控制展示的具体广告。
        </p>
        <p>
          根据美国联邦贸易委员会（FTC）指南，我们在此明确披露本网站包含广告，广告可能产生收入。这不会影响本站提供的内容客观性。
        </p> */}

        <h2>联盟营销 / 推广链接</h2>
        <ul>
          <li>
            本网站目前不包含任何联盟营销链接。所有产品推荐均为作者个人意见，无任何商业赞助。
          </li>
        </ul>

        <h2>内容准确性</h2>
        <p>
          本站内容基于作者的个人经验和研究，我们努力确保信息准确，但不保证内容的完整性、准确性或时效性。技术教程可能存在过时或不适用于您的情况的风险。任何因依赖本站内容而产生的风险由您自行承担。
        </p>

        <h2>投资与财务内容</h2>
        <p>
          本站涉及的投资、理财、房地产等内容仅为作者个人观点，不构成任何投资建议。投资有风险，入市需谨慎。请咨询持牌专业人士后再做出财务决策。
        </p>

        <h2>外部链接</h2>
        <p>
          本网站可能包含指向外部网站的链接。我们对这些外部网站的内容、隐私政策或实践不承担责任。链接不构成对相关内容或服务的认可。
        </p>

        <h2>联系方式</h2>
        <p>
          如对本免责声明有疑问，请通过 <a href="mailto:findns94@gmail.com">findns94@gmail.com</a> 联系我们。
        </p>
      </div>
    )
  }

  return (
    <div className="prose prose-gray max-w-none">
      <h1>Disclaimer</h1>
      <p className="text-sm text-gray-500">Last updated: August 6, 2026</p>

      {/* <h2>Advertising Disclosure</h2>
      <p>
        This Site uses Google AdSense to serve advertisements. We may earn revenue when you click on ads. Ad content is selected automatically by Google based on your browsing history and interests, and we do not have full control over which specific ads are displayed.
      </p>
      <p>
        In accordance with Federal Trade Commission (FTC) guidelines, we disclose that this Site contains advertisements that may generate revenue. This does not affect the objectivity of the content provided on this Site.
      </p> */}

      <h2>Affiliate Links</h2>
      <ul>
        <li>
          This Site currently does not contain any affiliate marketing links. All product recommendations are the author&apos;s personal opinions with no commercial sponsorship.
        </li>
      </ul>

      <h2>Content Accuracy</h2>
      <p>
        Content on this Site is based on the author&apos;s personal experience and research. We strive for accuracy, but we do not guarantee the completeness, accuracy, or timeliness of the information. Technical tutorials may become outdated or may not apply to your specific situation. Any risk arising from reliance on this content is your own.
      </p>

      <h2>Financial and Investment Content</h2>
      <p>
        Any investment, finance, or real estate content on this Site represents the author&apos;s personal opinions and does not constitute financial advice. All investments carry risk. Please consult a licensed professional before making financial decisions.
      </p>

      <h2>External Links</h2>
      <p>
        This Site may contain links to external websites. We are not responsible for the content, privacy policies, or practices of those external sites. A link does not constitute an endorsement of the content or services provided.
      </p>

      <h2>Contact</h2>
      <p>
        If you have questions about this disclaimer, contact us at <a href="mailto:findns94@gmail.com">findns94@gmail.com</a>.
      </p>
    </div>
  )
}
