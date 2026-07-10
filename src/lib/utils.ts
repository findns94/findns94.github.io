import dayjs from 'dayjs'

export function formatDate(date: string | Date): string {
  return dayjs(date).format('ll')
}

export function formatDateZh(date: string | Date): string {
  return dayjs(date).format('YYYY 年 M 月 D 日')
}
