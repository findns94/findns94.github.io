'use client'

import { useLanguage } from '@/contexts/LanguageContext'

/*
 * PRIVACY POLICY — MANDATORY FOR ADSENSE
 *
 * This is the most important legal page for your AdSense application.
 * Google's reviewers will read it. It MUST accurately describe:
 *   1. What data you collect
 *   2. That you use Google AdSense (third-party ad vendor)
 *   3. That AdSense uses cookies to serve ads
 *   4. How users can opt out of personalized advertising
 *
 * Fill in the [[PLACEHOLDER]] fields with your actual details.
 * Update the "Last Updated" date whenever you make changes.
 */

export function PrivacyPage() {
  const { language } = useLanguage()
  const isZh = language === 'zh'

  if (isZh) {
    return (
      <div className="prose prose-gray max-w-none">
        <h1>隐私政策</h1>
        <p className="text-sm text-gray-500">最后更新：2026年8月6日</p>

        <p>
          本隐私政策说明 Silver Bullet 团队（以下简称「我们」）在您访问 Silver Bullet（以下简称「本网站」）时，如何收集、使用和保护您的信息。
        </p>

        <h2>1. 我们收集的信息</h2>
        <p>本网站可能通过以下方式收集信息：</p>
        <ul>
          <li>
            <strong>自动收集的信息：</strong>当您访问本网站时，我们可能自动收集某些信息，包括但不限于您的 IP 地址、浏览器类型、操作系统、访问时间、浏览的页面以及引荐来源网址。
          </li>
          {/* <li>
            <strong>Cookie 和类似技术：</strong>本网站使用 Cookie 和类似技术来增强您的浏览体验、分析网站流量并投放广告（见下文「广告」部分）。
          </li> */}
        </ul>
        {/* <p>
          [[PLACEHOLDER: 如果你使用了 Google Analytics 或其他分析工具，在此补充说明。例如：「我们使用 Google Analytics 来收集匿名的使用统计数据，例如页面浏览量和访问者地理位置。」]]
        </p> */}

        {/* <h2>2. 广告</h2>
        <p>
          本网站使用 Google AdSense 来投放广告。Google AdSense 是一家第三方广告服务商，它使用 Cookie 来根据您之前的访问记录在本网站上向您展示个性化广告。
        </p>
        <p>
          Google 及其合作伙伴可能会使用以下 Cookie 来投放广告：
        </p>
        <ul>
          <li><strong>Cookie NID 和 IDE：</strong>用于在非个性化广告中限制广告展示频率，并在个性化广告中选择相关广告。</li>
          <li><strong>Cookie DSID 和 ID：</strong>用于在多个网站上识别已登录的 Google 用户，以便展示个性化广告（如适用）。</li>
        </ul>
        <p>
          这些 Cookie 不会直接识别您的个人身份（例如您的姓名或邮箱地址），但会识别您的浏览器和设备。
        </p> */}

        {/* <h2>3. 如何选择退出个性化广告</h2>
        <p>您可以通过以下方式控制广告的展示方式：</p>
        <ul>
          <li>访问 <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">adssettings.google.com</a> 管理您的 Google 广告设置。</li>
          <li>访问 <a href="https://www.aboutads.info" target="_blank" rel="noopener noreferrer">aboutads.info</a> 选择退出参与公司的个性化广告。</li>
          <li>在浏览器中配置 Cookie 设置，阻止第三方 Cookie。</li>
        </ul> */}

        <h2>2. 我们如何使用您的信息</h2>
        <p>我们使用收集的信息来：</p>
        <ul>
          <li>运营和维护本网站；</li>
          <li>分析网站流量以改进内容和技术性能；</li>
          {/* <li>投放和优化广告展示。</li> */}
        </ul>

        <h2>3. 第三方服务提供商</h2>
        <p>我们可能使用以下第三方服务提供商，它们可能访问您的部分信息：</p>
        <ul>
          {/* <li><strong>Google AdSense：</strong>广告投放。请参阅 <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google 隐私政策</a> 和 <a href="https://support.google.com/adspolicy/answer/54818" target="_blank" rel="noopener noreferrer">Google 广告政策</a>。</li> */}
          <li>GitHub Pages：网站托管。请参阅 <a href='https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement' target='_blank' rel='noopener noreferrer'>GitHub 隐私声明</a>。</li>
          <li>Cloudflare：内容分发网络（CDN）和安全防护。请参阅 <a href='https://www.cloudflare.com/privacypolicy/' target='_blank' rel='noopener noreferrer'>Cloudflare 隐私政策</a>。</li>
          {/* <li>[[PLACEHOLDER: 如果你使用了 Google Analytics：「Google Analytics：流量分析。数据在 Google Analytics 中匿名化处理。」]]</li> */}
        </ul>

        <h2>4. 数据安全</h2>
        <p>
          我们采取合理的措施保护您的信息，但请注意，互联网上的电子传输并非 100% 安全，我们无法保证绝对安全。
        </p>

        {/* <h2>5. 儿童隐私</h2>
        <p>
          本网站不面向 13 岁以下（或相应司法管辖区的法定年龄）的儿童。如果我们发现无意中收集了儿童的个人信息，将尽快删除。
        </p> */}

        <h2>5. 本政策的变更</h2>
        <p>
          我们可能不时更新本隐私政策。变更将在本页发布，并更新「最后更新」日期。
        </p>

        <h2>6. 联系我们</h2>
        <p>
          如果您对本隐私政策有任何疑问，请通过以下方式联系我们：
        </p>
        <ul>
          <li>邮箱：<a href="mailto:findns94@gmail.com">findns94@gmail.com</a></li>
          <li>或访问我们的<a href="/contact">联系页面</a>。</li>
        </ul>
      </div>
    )
  }

  return (
    <div className="prose prose-gray max-w-none">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: August 6, 2026</p>

      <p>
        This Privacy Policy explains how the Silver Bullet team (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collect, use, and protect your information when you visit Silver Bullet (the &ldquo;Site&rdquo;).
      </p>

      <h2>1. Information We Collect</h2>
      <p>The Site may collect information in the following ways:</p>
      <ul>
        <li>
          <strong>Automatically Collected Information:</strong> When you visit the Site, we may automatically collect certain information, including but not limited to your IP address, browser type, operating system, access times, pages viewed, and the referring URL.
        </li>
        {/* <li>
          <strong>Cookies and Similar Technologies:</strong> The Site uses cookies and similar technologies to enhance your browsing experience, analyze site traffic, and serve advertisements (see the Advertising section below).
        </li> */}
      </ul>

      {/* <h2>2. Advertising</h2>
      <p>
        This Site uses Google AdSense to serve advertisements. Google AdSense is a third-party advertising service that uses cookies to show you personalized ads based on your prior visits to this Site and other websites.
      </p>
      <p>
        Google and its partners may use the following cookies to serve ads:
      </p>
      <ul>
        <li><strong>NID and IDE cookies:</strong> Used to limit the frequency of ads shown in non-personalized advertising, and to select relevant ads in personalized advertising.</li>
        <li><strong>DSID and ID cookies:</strong> Used to identify logged-in Google users across multiple websites to serve personalized ads (where applicable).</li>
      </ul>
      <p>
        These cookies do not directly identify you personally (such as your name or email address), but they do identify your browser and device.
      </p> */}

      {/* <h2>3. How to Opt Out of Personalized Advertising</h2>
      <p>You can control how ads are shown to you through the following:</p>
      <ul>
        <li>Visit <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">adssettings.google.com</a> to manage your Google ad settings.</li>
        <li>Visit <a href="https://www.aboutads.info" target="_blank" rel="noopener noreferrer">aboutads.info</a> to opt out of personalized ads from participating companies.</li>
        <li>Configure your browser&apos;s cookie settings to block third-party cookies.</li>
      </ul> */}

      <h2>2. How We Use Your Information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Operate and maintain the Site;</li>
        <li>Analyze site traffic to improve content and technical performance;</li>
        {/* <li>Serve and optimize advertisements.</li> */}
      </ul>

      <h2>3. Third-Party Service Providers</h2>
      <p>We may use the following third-party service providers who may access some of your information:</p>
      <ul>
        {/* <li><strong>Google AdSense:</strong> For serving advertisements. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google&apos;s Privacy Policy</a> and <a href="https://support.google.com/adspolicy/answer/54818" target="_blank" rel="noopener noreferrer">Google Ads Policy</a>.</li> */}
        <li>GitHub Pages: for site hosting. See the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noopener noreferrer">GitHub Privacy Statement</a>.</li>
        <li>Cloudflare: for content delivery network (CDN) and security protection. See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare&apos;s Privacy Policy</a>.</li>
      </ul>

      <h2>4. Data Security</h2>
      <p>
        We take reasonable measures to protect your information, but please be aware that no method of electronic transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
      </p>

      {/* <h2>5. Children&apos;s Privacy</h2>
      <p>
        The Site is not directed at children under 13 years of age (or the applicable age of consent in your jurisdiction). If we become aware that we have inadvertently collected personal information from a child, we will delete it promptly.
      </p> */}

      <h2>5. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated &ldquo;Last updated&rdquo; date.
      </p>

      <h2>6. Contact Us</h2>
      <p>
        If you have any questions about this Privacy Policy, please contact us:
      </p>
      <ul>
        <li>Email: <a href="mailto:findns94@gmail.com">findns94@gmail.com</a></li>
        <li>Or visit our <a href="/contact">Contact page</a>.</li>
      </ul>
    </div>
  )
}
