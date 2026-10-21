export type Language = 'en' | 'zh'

export interface Messages {
  siteName: string
  siteDescription: string
  nav: {
    home: string
    about: string
    contact: string
    tags: string
    rss: string
    shanhaijin: string
  }
  footer: {
    builtWith: string
    privacy: string
    terms: string
    disclaimer: string
  }
  posts: {
    noPosts: string
    more: string
    allPostsTitle: (count: number) => string
    page: string
    prev: string
    next: string
    prevAria: string
    nextAria: string
    pageAria: (n: number) => string
    jumpForward: string
    jumpBackward: string
    showing: (start: number, end: number, total: number) => string
  }
  tags: {
    title: string
    noTags: string
    postCount: (n: number) => string
    tagPageTitle: (tag: string) => string
  }
  // 山海经「山形聚焦」视图文案
  shanhaijin: {
    nav: {
      panorama: { en: string; zh: string }
      entities: { en: string; zh: string }
      search: { en: string; zh: string }
      graph: { en: string; zh: string }
      map: { en: string; zh: string }
    }
    search: {
      title: { en: string; zh: string }
      placeholder: { en: string; zh: string }
      results: { en: string; zh: string }
      noResults: { en: string; zh: string }
      noQuery: { en: string; zh: string }
      viewAll: { en: string; zh: string }
      all: { en: string; zh: string }
      mountains: { en: string; zh: string }
      creatures: { en: string; zh: string }
      products: { en: string; zh: string }
      groups: { en: string; zh: string }
      groupsCreature: { en: string; zh: string }
    }
    map: {
      title: string
      subtitle: string
      nav: { focus: string; overview: string }
      search: {
        placeholder: string
        mountain: string
        creature: string
        product: string
        all: string
        noMatch: string
        more: (n: number) => string
        /** 结果被截断时的提示 */
        truncated: string
        /** 搜索结果的类型标签（对应 CSS 类名 si-kind-山 / -异兽 / -物产） */
        kindMountain: string
        kindCreature: string
        kindProduct: string
        viewAll: { en: string; zh: string }
      }
      focus: {
        prev: string
        next: string
        firstLast: string
        boundary: string
        crossChain: string
        seq: (n: number) => string
        fromPrev: string
        toNext: string
        noLi: string
        li: string
        originalPn: string
        chain: string
      }
      detail: {
        creatures: string
        products: string
        original: string
        none: string
        notFound: string
        /** 三层置信度徽章（对应 CSS 类名 badge-confirmed / -inferred / -unknown） */
        confidence: { confirmed: string; inferred: string; unknown: string }
      }
      footer: {
        position: (i: number, total: number) => string
        chainPosition: (name: string, seq: number, total: number) => string
        prev: string
        next: string
        hint: string
      }
      loadError: (msg: string) => string
      loading: string
    }
    panorama: {
      title: string
      subtitle: string
      nav: { focus: string; overview: string }
      selectChain: string
      chainCount: string
      mountainCount: string
      totalLi: string
      li: string
      noCreatures: string
      creatures: string
      products: string
      productsCount: string
      selectMountain: string
      focusLink: string
      original: string
    }
    entities: {
      title: string
      types: {
        creature: string
        bird_beast: string
        water: string
        mineral: string
        plant: string
        polity: string
        deity: string
        person: string
        omen: string
        sacrifice: string
        quantity: string
        direction: string
        concept: string
        identity: string
        mountain: string
      }
      count: string
      mountains: string
      noMountains: string
      taxonomy: string
      level: string
      confidence: string
      relations: string
      originalText: string
      backToList: string
      produces: string
      inhabitedBy: string
      searchPlaceholder: string
      noMatch: string
      allTypes: string
      loading: string
      loadError: (msg: string) => string
    }
    graph: {
      title: string
      subtitle: string
      relations: string
      produces: string
      inhabits: string
      hasEfficacy: string
      adjacentTo: string
      distanceFrom: string
      waterConnect: string
      locatedAt: string
      inChain: string
      sacrificedAt: string
      descendsFrom: string
      aliasOf: string
      sameAs: string
      nodeCount: string
      edgeCount: string
      selectNode: string
      resetLayout: string
      zoomIn: string
      zoomOut: string
      connections: string
      degree: string
    }
    reader: {
      original: { en: string; zh: string }
      translation: { en: string; zh: string }
      sideBySide: { en: string; zh: string }
      single: { en: string; zh: string }
    }
  }
}

const en: Messages = {
  siteName: 'Silver Bullet',
  siteDescription: "Martin Zhao's Blog — Tech, Research, and Life",
  nav: {
    home: 'Home',
    about: 'About',
    contact: 'Contact',
    tags: 'Tags',
    rss: 'RSS',
    shanhaijin: ' Shanhaijing',
  },
  footer: {
    builtWith: 'Built with Next.js',
    privacy: 'Privacy Policy',
    terms: 'Terms of Use',
    disclaimer: 'Disclaimer',
  },
  posts: {
    noPosts: 'No posts yet',
    more: 'More posts',
    allPostsTitle: (count: number) => `All Posts (${count} posts)`,
    page: 'Page',
    prev: 'Previous',
    next: 'Next',
    prevAria: 'Go to previous page',
    nextAria: 'Go to next page',
    pageAria: (n: number) => `Go to page ${n}`,
    jumpForward: 'Jump forward 5 pages',
    jumpBackward: 'Jump backward 5 pages',
    showing: (start: number, end: number, total: number) => `Showing ${start}–${end} of ${total} posts`,
  },
  tags: {
    title: 'Tags',
    noTags: 'No tags yet',
    postCount: (n: number) => `${n} post${n !== 1 ? 's' : ''}`,
    tagPageTitle: (tag: string) => `Tag: ${tag}`,
  },
  shanhaijin: {
    nav: {
      panorama: { en: 'Panorama', zh: '山系全景' },
      entities: { en: 'Entities', zh: '实体总览' },
      search: { en: 'Search', zh: '搜索' },
      graph: { en: 'Knowledge Graph', zh: '知识图谱' },
      map: { en: 'Mountain Focus', zh: '山形聚焦' },
    },
    search: {
      title: { en: 'Search', zh: '搜索' },
      placeholder: { en: 'Search mountains, creatures, products...', zh: '搜索山名、异兽、物产...' },
      results: { en: 'results', zh: '条结果' },
      noResults: { en: 'No results found', zh: '未找到结果' },
      noQuery: { en: 'Enter a search term', zh: '请输入搜索词' },
      viewAll: { en: 'View all results', zh: '查看全部结果' },
      all: { en: 'All', zh: '全部' },
      mountains: { en: 'Mountains', zh: '山岳' },
      creatures: { en: 'Creatures', zh: '异兽' },
      products: { en: 'Products', zh: '物产' },
      groups: { en: 'Groups', zh: '山系' },
      groupsCreature: { en: 'Creature groups', zh: '异兽类' },
    },
    map: {
      title: 'Mountain Focus · Shanhaijing',
      subtitle:
        'One mountain at a time — and its bearing and distance to the mountains before and after it.',
      nav: { focus: 'Mountain Focus', overview: 'Full Map' },
      search: {
        placeholder: 'Search mountain / creature / product…',
        mountain: 'Mountain',
        creature: 'Creature',
        product: 'Product',
        all: 'All',
        noMatch: 'No matches',
        more: (n: number) => `… ${n} total, showing first 30`,
        truncated: '… too many matches, showing the first 30',
        kindMountain: 'Mt.',
        kindCreature: 'Creature',
        kindProduct: 'Product',
        viewAll: { en: 'View all results', zh: '查看全部结果' },
      },
      focus: {
        prev: '← Previous',
        next: 'Next →',
        firstLast: '(chain head/tail)',
        boundary: 'End of this mountain system',
        crossChain: 'crosses into another mountain system',
        seq: (n: number) => `Mountain ${n} in this chain`,
        fromPrev: '↩ from',
        toNext: '↪ to',
        noLi: 'No mileage recorded for this entry',
        li: 'Bearing',
        originalPn: 'Source passage',
        chain: 'Mountain system',
      },
      detail: {
        creatures: 'Creatures',
        products: 'Products',
        original: 'Original text',
        none: 'None',
        notFound: 'Not recorded',
        confidence: { confirmed: 'Confirmed', inferred: 'Inferred', unknown: 'Unknown' },
      },
      footer: {
        position: (i: number, total: number) => `Mountain ${i} / ${total}`,
        chainPosition: (name: string, seq: number, total: number) =>
          `${name} · ${seq} / ${total}`,
        prev: '← Previous mountain',
        next: 'Next mountain →',
        hint: '← / → arrow keys to switch',
      },
      loadError: (msg: string) => `Failed to load: ${msg}`,
      loading: 'Loading…',
    },
    panorama: {
      title: 'Mountain Range Panorama',
      subtitle: 'Select a chain to view its route',
      nav: { focus: 'Mountain Focus', overview: 'Full Map' },
      selectChain: 'Select chain',
      chainCount: 'chains',
      mountainCount: 'mountains',
      totalLi: 'Total',
      li: 'li',
      noCreatures: 'No creatures recorded',
      creatures: 'Creatures',
      products: 'Products',
      productsCount: 'types',
      selectMountain: 'Click a mountain node to see details',
      focusLink: 'View in Focus',
      original: 'Original text',
    },
    entities: {
      title: 'Entities',
      types: {
        creature: 'Creatures',
        bird_beast: 'Birds & Beasts',
        water: 'Waterways',
        mineral: 'Products',
        plant: 'Plants',
        polity: 'Polities',
        deity: 'Deities',
        person: 'Persons',
        omen: 'Omens',
        sacrifice: 'Sacrifices',
        quantity: 'Quantities',
        direction: 'Directions',
        concept: 'Concepts',
        identity: 'Identities',
        mountain: 'Mountains',
      },
      count: 'entities',
      mountains: 'Appears at',
      noMountains: 'No mountain records',
      taxonomy: 'Classification',
      level: 'Level',
      confidence: 'Confidence',
      relations: 'Relations',
      originalText: 'Original passages',
      backToList: 'Back to list',
      produces: 'Produces',
      inhabitedBy: 'Inhabited by',
      searchPlaceholder: 'Search entities…',
      noMatch: 'No matches',
      allTypes: 'All types',
      loading: 'Loading…',
      loadError: (msg: string) => `Failed to load: ${msg}`,
    },
    graph: {
      title: 'Knowledge Graph',
      subtitle: 'Entity relationships visualized',
      relations: 'Relation types',
      produces: 'Produces',
      inhabits: 'Inhabits',
      hasEfficacy: 'Has efficacy',
      adjacentTo: 'Adjacent to',
      distanceFrom: 'Distance from',
      waterConnect: 'Water connects',
      locatedAt: 'Located at',
      inChain: 'In chain',
      sacrificedAt: 'Sacrificed at',
      descendsFrom: 'Descends from',
      aliasOf: 'Alias of',
      sameAs: 'Same as',
      nodeCount: 'nodes',
      edgeCount: 'edges',
      selectNode: 'Click a node to see details',
      resetLayout: 'Reset layout',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      connections: 'Connections',
      degree: 'degree',
    },
    reader: {
      original: { en: 'Original', zh: '原文' },
      translation: { en: 'Translation', zh: '译文' },
      sideBySide: { en: 'Side by Side', zh: '对读' },
      single: { en: 'Single', zh: '单栏' },
    },
  },
}

const zh: Messages = {
  siteName: 'Silver Bullet',
  siteDescription: 'Martin Zhao 的博客 — 技术、科研与生活',
  nav: {
    home: '首页',
    about: '关于',
    contact: '联系',
    tags: '标签',
    rss: 'RSS',
    shanhaijin: '山海经',
  },
  footer: {
    builtWith: '使用 Next.js 构建',
    privacy: '隐私政策',
    terms: '使用条款',
    disclaimer: '免责声明',
  },
  posts: {
    noPosts: '暂无文章',
    more: '更多文章',
    allPostsTitle: (count: number) => `所有文章（共 ${count} 篇）`,
    page: '第',
    prev: '上一页',
    next: '下一页',
    prevAria: '跳转到上一页',
    nextAria: '跳转到下一页',
    pageAria: (n: number) => `跳转到第 ${n} 页`,
    jumpForward: '向前跳5页',
    jumpBackward: '向后跳5页',
    showing: (start: number, end: number, total: number) => `显示第 ${start}–${end} 篇，共 ${total} 篇`,
  },
  tags: {
    title: '标签',
    noTags: '暂无标签',
    postCount: (n: number) => `${n} 篇文章`,
    tagPageTitle: (tag: string) => `标签：${tag}`,
  },
  shanhaijin: {
    nav: {
      panorama: { en: 'Panorama', zh: '山系全景' },
      entities: { en: 'Entities', zh: '实体总览' },
      search: { en: 'Search', zh: '搜索' },
      graph: { en: 'Knowledge Graph', zh: '知识图谱' },
      map: { en: 'Mountain Focus', zh: '山形聚焦' },
    },
    search: {
      title: { en: 'Search', zh: '搜索' },
      placeholder: { en: 'Search mountains, creatures, products...', zh: '搜索山名、异兽、物产...' },
      results: { en: 'results', zh: '条结果' },
      noResults: { en: 'No results found', zh: '未找到结果' },
      noQuery: { en: 'Enter a search term', zh: '请输入搜索词' },
      viewAll: { en: 'View all results', zh: '查看全部结果' },
      all: { en: 'All', zh: '全部' },
      mountains: { en: 'Mountains', zh: '山岳' },
      creatures: { en: 'Creatures', zh: '异兽' },
      products: { en: 'Products', zh: '物产' },
      groups: { en: 'Groups', zh: '山系' },
      groupsCreature: { en: 'Creature groups', zh: '异兽类' },
    },
    map: {
      title: '山海经 · 山形聚焦',
      subtitle: '一次只看一座山 —— 以及它与前一座、后一座的方位与里程。',
      nav: { focus: '山形聚焦', overview: '全图总览' },
      search: {
        placeholder: '搜索山名 / 异兽 / 物产…',
        mountain: '山名',
        creature: '异兽',
        product: '物产',
        all: '全部',
        noMatch: '无匹配',
        more: (n: number) => `… 共 ${n} 条，仅显示前 30`,
        truncated: '… 结果过多，仅显示前 30 条',
        kindMountain: '山',
        kindCreature: '异兽',
        kindProduct: '物产',
        viewAll: { en: 'View all results', zh: '查看全部结果' },
      },
      focus: {
        prev: '← 前一座',
        next: '后一座 →',
        firstLast: '（山系首／末座）',
        boundary: '本条目处于山系边界',
        crossChain: '跨山系',
        seq: (n: number) => `山系内第 ${n} 座`,
        fromPrev: '↩ 自',
        toNext: '↪ 至',
        noLi: '本条目无里程',
        li: '里程',
        originalPn: '原文段落',
        chain: '山系',
      },
      detail: {
        creatures: '异兽',
        products: '物产',
        original: '原文',
        none: '无',
        notFound: '未收录',
        confidence: { confirmed: '可信', inferred: '未考', unknown: '待考' },
      },
      footer: {
        position: (i: number, total: number) => `第 ${i} / ${total} 座`,
        chainPosition: (name: string, seq: number, total: number) =>
          `${name} · ${seq} / ${total}`,
        prev: '← 前一座山',
        next: '后一座山 →',
        hint: '← / → 键切换',
      },
      loadError: (msg: string) => `加载失败：${msg}`,
      loading: '加载中…',
    },
    panorama: {
      title: '山系全景图',
      subtitle: '选择山系查看路线',
      nav: { focus: '山形聚焦', overview: '全图总览' },
      chainCount: '条山系',
      mountainCount: '座山',
      totalLi: '总里程',
      li: '里',
      noCreatures: '无异兽记录',
      creatures: '异兽',
      products: '物产',
      productsCount: '种',
      selectMountain: '点击山节点查看详情',
      focusLink: '聚焦查看',
      original: '原文',
      selectChain: '选择山系',
    },
    entities: {
      title: '实体总览',
      types: {
        creature: '异兽谱',
        bird_beast: '鸟兽谱',
        water: '水经略',
        mineral: '物产志',
        plant: '草木谱',
        polity: '方国志',
        deity: '神祇谱',
        person: '人物志',
        omen: '征兆志',
        sacrifice: '祭礼志',
        quantity: '数量',
        direction: '方位',
        concept: '概念',
        identity: '身份',
        mountain: '山系',
      },
      count: '条',
      mountains: '出现于',
      noMountains: '无山系记录',
      taxonomy: '分类',
      level: '层级',
      confidence: '置信度',
      relations: '关系',
      originalText: '原文摘录',
      backToList: '返回列表',
      produces: '出产',
      inhabitedBy: '栖息',
      searchPlaceholder: '搜索实体…',
      noMatch: '无匹配',
      allTypes: '全部类型',
      loading: '加载中…',
      loadError: (msg: string) => `加载失败：${msg}`,
    },
    graph: {
      title: '知识图谱',
      subtitle: '实体关系可视化',
      relations: '关系类型',
      produces: '产出',
      inhabits: '栖息',
      hasEfficacy: '功效',
      adjacentTo: '相邻',
      distanceFrom: '相距',
      waterConnect: '水系连接',
      locatedAt: '位于',
      inChain: '同链',
      sacrificedAt: '祭祀于',
      descendsFrom: '源自',
      aliasOf: '别名',
      sameAs: '同一',
      nodeCount: '个节点',
      edgeCount: '条边',
      selectNode: '点击节点查看详情',
      resetLayout: '重置布局',
      zoomIn: '放大',
      zoomOut: '缩小',
      connections: '连接',
      degree: '度',
    },
    reader: {
      original: { en: 'Original', zh: '原文' },
      translation: { en: 'Translation', zh: '译文' },
      sideBySide: { en: 'Side by Side', zh: '对读' },
      single: { en: 'Single', zh: '单栏' },
    },
  },
}

const messages: Record<Language, Messages> = { en, zh }

export function getMessages(lang: Language): Messages {
  return messages[lang]
}
