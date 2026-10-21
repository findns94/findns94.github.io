/**
 * 《山海经》实体标注 —— 纯函数层（无 React / 无 DOM）。
 *
 * 扫描章节原文，按典名匹配已知实体，把文本切分为「普通文本」与「实体引用」
 * 两类片段，供 EntityAnnotator 组件渲染为带 tooltip 的跳转链接。
 *
 * 匹配策略：最长优先（longest match first）。例如「太行之山」与「歸山」
 * 同时存在时，优先命中更长的典名，避免短名截断长名。
 */

export interface AnnotatedSegment {
  text: string
  entity?: {
    canonical: string
    typeKey: string
    display: string
  }
}

/**
 * 扫描文本并按典名匹配实体。
 *
 * @param text        章节原文（纯文本，不含 〖〗 标记）
 * @param entityNames 实体典名列表（来自 public/shanhaijing/entity-names.json）
 * @returns 按原文顺序排列的片段数组；带 `entity` 的片段应渲染为链接
 */
export function annotateText(text: string, entityNames: Array<{ canonical: string; typeKey: string; display: string }>): AnnotatedSegment[] {
  // Sort by length descending (longest match first)
  const sorted = [...entityNames].sort((a, b) => b.canonical.length - a.canonical.length)
  const segments: AnnotatedSegment[] = []
  let pos = 0

  while (pos < text.length) {
    let matched = false
    for (const name of sorted) {
      if (text.startsWith(name.canonical, pos)) {
        segments.push({ text: name.canonical, entity: name })
        pos += name.canonical.length
        matched = true
        break
      }
    }
    if (!matched) {
      // Accumulate plain text until next match
      let end = pos + 1
      while (end < text.length) {
        let found = false
        for (const name of sorted) {
          if (text.startsWith(name.canonical, end)) { found = true; break }
        }
        if (found) break
        end++
      }
      segments.push({ text: text.slice(pos, end) })
      pos = end
    }
  }
  return segments
}
