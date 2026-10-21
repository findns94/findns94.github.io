'use client'

import Link from 'next/link'
import { useLanguage } from '@/contexts/LanguageContext'
import { getMessages } from '@/i18n/messages'
import { STATS, ENTITY_TYPE_COUNTS, type ChapterMeta, type Division } from '@/lib/shanhaijing-data'

const DIVISION_LABEL: Record<Division, { en: string; zh: string }> = {
  山经: { en: 'Classic of Mountains', zh: '五藏山经' },
  海经: { en: 'Classic of Seas', zh: '海经' },
  附录: { en: 'Appendix', zh: '附录' },
}

const ENTITY_TYPE_ORDER = [
  'creature', 'mineral', 'water', 'plant', 'mountain', 'polity',
  'bird_beast', 'person', 'deity', 'omen', 'sacrifice',
  'quantity', 'direction', 'concept', 'identity',
] as const

function typeSlug(typeKey: string): string {
  return typeKey.replace(/_/g, '-')
}

export function ShanhaijingPage({ chapters }: { chapters: ChapterMeta[] }) {
  const { language } = useLanguage()
  const zh = language === 'zh'
  const t = getMessages(language)

  const groups = (['山经', '海经', '附录'] as Division[]).map((d) => ({
    division: d,
    label: DIVISION_LABEL[d],
    items: chapters.filter((c) => c.division === d),
  }))

  return (
    <div>
      <header className="mb-10 border-b border-gray-200 pb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">
          {zh ? '山海经知识图谱' : 'The Classic of Mountains and Seas'}
        </h1>
        <p className="text-gray-600 leading-relaxed max-w-3xl">
          {zh
            ? '用结构化方式重读《山海经》：把「东三百里曰某山」的方位链、异兽形态与物产分布，变成可查询、可探索的知识网络。'
            : 'Reading the Shanhaijing structurally — turning directional chains, creature morphology and resource distributions into a queryable knowledge network.'}
        </p>
      </header>

      {/* 搜索入口 */}
      <section className="mb-10">
        <form action="/shanhaijing/search/" method="get" className="flex gap-2">
          <input
            type="text"
            name="q"
            placeholder={zh ? '搜索山名、异兽、物产...' : 'Search mountains, creatures, products...'}
            autoComplete="off"
            className="flex-1 border border-gray-300 rounded px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="px-5 py-2.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            {zh ? '搜索' : 'Search'}
          </button>
        </form>
      </section>

      {/* 入口卡片 */}
      <section className="mb-12 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { href: '/shanhaijing/panorama/', zh: '山系全景图', en: 'Panorama' },
          { href: '/shanhaijing/entities/creature/', zh: '异兽谱', en: 'Creatures' },
          { href: '/shanhaijing/entities/mineral/', zh: '物产志', en: 'Products' },
          { href: '/shanhaijing/graph/', zh: '知识图谱', en: 'Knowledge Graph' },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex flex-col items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-5 no-underline transition-colors hover:border-blue-400 hover:bg-blue-50"
          >
            <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">
              {zh ? card.zh : card.en}
            </span>
            <span className="text-xs text-gray-400">
              {zh ? card.en : card.zh}
            </span>
          </Link>
        ))}
      </section>

      <section className="mb-12">
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: zh ? '篇目' : 'Chapters', value: STATS.chapters },
            { label: zh ? '山数' : 'Mountains', value: STATS.mountains },
            { label: zh ? '山系' : 'Chains', value: STATS.chains },
            { label: zh ? '里程（里）' : 'Distance (li)', value: STATS.li.toLocaleString() },
            { label: zh ? '字数' : 'Characters', value: STATS.chars.toLocaleString() },
          ].map((s) => (
            <div key={s.label} className="border border-gray-200 rounded p-4">
              <dt className="text-xs text-gray-500 mb-1">{s.label}</dt>
              <dd className="text-2xl font-semibold text-gray-900 tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 山形聚焦入口：一次只看一座山的方位与里程 */}
      <section className="mb-12">
        <Link
          href="/shanhaijing/map/"
          className="group flex items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 p-5 no-underline transition-colors hover:border-blue-300 hover:bg-blue-100"
        >
          <div>
            <h2 className="mb-1 text-lg font-semibold text-gray-900">
              {t.shanhaijing.map.title}
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {t.shanhaijing.map.subtitle}
            </p>
          </div>
          <span className="shrink-0 text-blue-600 transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </section>

      {/* 实体总览入口 */}
      <section className="mb-12">
        <Link
          href="/shanhaijing/entities/"
          className="group flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5 no-underline transition-colors hover:border-emerald-300 hover:bg-emerald-100"
        >
          <div>
            <h2 className="mb-1 text-lg font-semibold text-gray-900">
              {t.shanhaijing.entities.title}
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {zh
                ? '异兽、草木、物产、方国、神祇、祭礼 —— 按类型浏览全书实体，查看出没山系、栖息物产与原文摘录。'
                : 'Browse all entities by type — creatures, plants, products, polities, deities, sacrifices — with mountain sightings, relations, and original passages.'}
            </p>
          </div>
          <span className="shrink-0 text-emerald-600 transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </section>

      {/* 实体类型入口卡片 */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          {zh ? '实体类型' : 'Entity Types'}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {ENTITY_TYPE_ORDER.map((typeKey) => {
            const count = ENTITY_TYPE_COUNTS[typeKey] ?? 0
            const typeLabel = t.shanhaijing.entities.types[typeKey as keyof typeof t.shanhaijing.entities.types] ?? typeKey
            return (
              <Link
                key={typeKey}
                href={`/shanhaijing/entities/${typeSlug(typeKey)}/`}
                className="group flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white p-4 no-underline transition-colors hover:border-emerald-400 hover:bg-emerald-50"
              >
                <span className="text-sm font-medium text-gray-700 group-hover:text-emerald-700">
                  {typeLabel}
                </span>
                <span className="text-xs text-emerald-600 font-medium">
                  {count} {zh ? '条' : 'entities'}
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.division} className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            {zh ? g.label.zh : g.label.en}
            <span className="ml-2 text-sm font-normal text-gray-500">
              {zh ? g.label.en : g.label.zh}
            </span>
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {g.items.map((c) => (
              <li key={c.num}>
                <Link
                  href={`/shanhaijing/chapters/${c.num}`}
                  className="flex items-baseline gap-3 px-3 py-2 rounded border border-gray-200 hover:border-blue-400 hover:text-blue-600 transition-colors no-underline text-gray-700"
                >
                  <span className="text-xs text-gray-400 tabular-nums">{c.num}</span>
                  <span className="font-medium">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-12 border-t border-gray-200 pt-6 text-sm text-gray-500 leading-relaxed">
        <p>
          {zh ? '底本：' : 'Source: '}
          <a
            href="https://zh.wikisource.org/wiki/%E5%B1%B1%E6%B5%B7%E7%B6%93"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {zh ? '维基文库《山海經》' : 'Wikisource 山海經'}
          </a>
          {zh
            ? '（公有领域，郭璞注本）。郭璞注仅南山经、西山经、海内东经三篇存留，其余各篇无注。'
            : ' (public domain, Guo Pu annotated edition). Guo Pu’s commentary survives only in three chapters.'}
        </p>
      </section>
    </div>
  )
}
