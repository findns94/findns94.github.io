export type Language = 'en' | 'zh'

export interface Messages {
  siteName: string
  siteDescription: string
  nav: {
    home: string
    tags: string
    rss: string
  }
  footer: {
    builtWith: string
  }
  posts: {
    noPosts: string
    more: string
  }
  tags: {
    title: string
    noTags: string
    postCount: (n: number) => string
    tagPageTitle: (tag: string) => string
  }
}

const en: Messages = {
  siteName: 'Silver Bullet',
  siteDescription: "Martin Zhao's Blog — Tech, Research, and Life",
  nav: {
    home: 'Home',
    tags: 'Tags',
    rss: 'RSS',
  },
  footer: {
    builtWith: 'Built with Next.js',
  },
  posts: {
    noPosts: 'No posts yet',
    more: 'More posts',
  },
  tags: {
    title: 'Tags',
    noTags: 'No tags yet',
    postCount: (n: number) => `${n} post${n !== 1 ? 's' : ''}`,
    tagPageTitle: (tag: string) => `Tag: ${tag}`,
  },
}

const zh: Messages = {
  siteName: 'Silver Bullet',
  siteDescription: 'Martin Zhao 的博客 — 技术、科研与生活',
  nav: {
    home: '首页',
    tags: '标签',
    rss: 'RSS',
  },
  footer: {
    builtWith: '使用 Next.js 构建',
  },
  posts: {
    noPosts: '暂无文章',
    more: '更多文章',
  },
  tags: {
    title: '标签',
    noTags: '暂无标签',
    postCount: (n: number) => `${n} 篇文章`,
    tagPageTitle: (tag: string) => `标签：${tag}`,
  },
}

const messages: Record<Language, Messages> = { en, zh }

export function getMessages(lang: Language): Messages {
  return messages[lang]
}
