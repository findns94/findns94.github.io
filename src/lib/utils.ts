import dayjs from 'dayjs'

export function formatDate(date: string | Date): string {
  return dayjs(date).format('ll')
}
