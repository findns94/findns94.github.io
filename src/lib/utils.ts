import dayjs from 'dayjs'

// Convert a (possibly multi-word) tag to a URL-safe kebab-case slug.
// e.g. "Machine Learning" -> "machine-learning", "The Witcher 3" -> "the-witcher-3"
// Kept here (rather than posts.ts) because it is imported by client components.
export function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 'MMM D, YYYY' => e.g. 'May 7, 2023'. Avoids dayjs 'll' token, which requires
// the optional localizedFormat plugin and otherwise renders literally as 'll'.
export function formatDate(date: string | Date): string {
  return dayjs(date).format('MMM D, YYYY')
}

// 'YYYY年M月D日' => e.g. '2026年7月15日'
export function formatDateZh(date: string | Date): string {
  const d = dayjs(date)
  return `${d.year()}年${d.month() + 1}月${d.date()}日`
}
