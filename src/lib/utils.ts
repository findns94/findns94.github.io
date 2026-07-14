import dayjs from 'dayjs'

// 'MMM D, YYYY' => e.g. 'May 7, 2023'. Avoids dayjs 'll' token, which requires
// the optional localizedFormat plugin and otherwise renders literally as 'll'.
export function formatDate(date: string | Date): string {
  return dayjs(date).format('MMM D, YYYY')
}
