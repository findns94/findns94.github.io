import type { TranslationBlock } from './types'
import ch00 from './chapter-00'
import ch01 from './chapter-01'
import ch02 from './chapter-02'
import ch03 from './chapter-03'
import ch04 from './chapter-04'
import ch05 from './chapter-05'
import ch06 from './chapter-06'
import ch07 from './chapter-07'
import ch08 from './chapter-08'
import ch09 from './chapter-09'
import ch10 from './chapter-10'
import ch11 from './chapter-11'
import ch12 from './chapter-12'
import ch13 from './chapter-13'
import ch14 from './chapter-14'
import ch15 from './chapter-15'
import ch16 from './chapter-16'
import ch17 from './chapter-17'
import ch18 from './chapter-18'

export type { TranslationBlock }

export const TRANSLATIONS: Record<string, TranslationBlock[]> = {
  '00': ch00,
  '01': ch01,
  '02': ch02,
  '03': ch03,
  '04': ch04,
  '05': ch05,
  '06': ch06,
  '07': ch07,
  '08': ch08,
  '09': ch09,
  '10': ch10,
  '11': ch11,
  '12': ch12,
  '13': ch13,
  '14': ch14,
  '15': ch15,
  '16': ch16,
  '17': ch17,
  '18': ch18,
}
