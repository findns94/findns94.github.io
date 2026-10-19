/**
 * 《山海经》知识图谱 —— 纯数据层（无 fs / 无 Node API）。
 *
 * 本模块可被 client component 安全引用。
 * 需要读取经文文本时，用 `src/lib/shanhaijing.ts`（仅 server component 使用）。
 */

export type Division = '山经' | '海经' | '附录'

export interface ChapterMeta {
  /** 篇号，如 "01" */
  num: string
  /** 篇名，如 "南山经" */
  name: string
  /** 分部：山经 / 海经 / 附录 */
  division: Division
}

/** 18 篇 + 郭璞序，按原书顺序 */
export const CHAPTERS: ChapterMeta[] = [
  { num: '01', name: '南山经', division: '山经' },
  { num: '02', name: '西山经', division: '山经' },
  { num: '03', name: '北山经', division: '山经' },
  { num: '04', name: '东山经', division: '山经' },
  { num: '05', name: '中山经', division: '山经' },
  { num: '06', name: '海外南经', division: '海经' },
  { num: '07', name: '海外西经', division: '海经' },
  { num: '08', name: '海外北经', division: '海经' },
  { num: '09', name: '海外东经', division: '海经' },
  { num: '10', name: '海内南经', division: '海经' },
  { num: '11', name: '海内西经', division: '海经' },
  { num: '12', name: '海内北经', division: '海经' },
  { num: '13', name: '海内东经', division: '海经' },
  { num: '14', name: '大荒东经', division: '海经' },
  { num: '15', name: '大荒南经', division: '海经' },
  { num: '16', name: '大荒西经', division: '海经' },
  { num: '17', name: '大荒北经', division: '海经' },
  { num: '18', name: '海内经', division: '海经' },
  { num: '00', name: '郭璞序', division: '附录' },
]

/** 按篇号取篇目 */
export function getChapterMeta(num: string): ChapterMeta | undefined {
  return CHAPTERS.find((c) => c.num === num)
}

/**
 * 全书统计（已逐篇验证，见 doc/shanhaijin/origin/README.md）
 * 纯汉字 32,316 字；447 山 / 26 山系 / 97,358 里
 */
export const STATS = {
  chapters: 18,
  mountains: 447,
  chains: 26,
  li: 97358,
  chars: 32316,
} as const
