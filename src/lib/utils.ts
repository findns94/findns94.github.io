import dayjs from 'dayjs'

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
