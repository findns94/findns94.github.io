/**
 * 《山海经》知识图谱 —— 服务端数据访问层。
 *
 * ⚠️ 本模块使用 `fs`，**只能被 server component 引用**。
 * client component 请改用 `src/lib/shanhaijing-data.ts`（纯数据，无 fs）。
 *
 * 数据来源：`public/shanhaijin/chapters/`（维基文库本，PD-old，郭璞注本）
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.join(process.cwd(), 'public', 'shanhaijin', 'chapters')

/**
 * 读经文纯文本（去郭璞注、去编者按）。
 * 返回 null 表示篇目或文件不存在。
 */
export function readChapterText(num: string, name: string, division: string): string | null {
  const p = path.join(ROOT, division, `${num}_${name}.txt`)
  try {
    return fs.readFileSync(p, 'utf-8')
  } catch {
    return null
  }
}
