import { ShanhaijingMap } from '@/components/ShanhaijingMap'
import './shanhaijing-map.css'

export const metadata = {
  title: '山海经 · 山形聚焦',
  description:
    '《山海经》山形聚焦交互视图 —— 一次只看一座山，以及它与前一座、后一座的方位与里程。',
}

export default function Page() {
  return (
    // 逃逸根布局的 max-w-3xl 限宽
    <div className="full-bleed">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <ShanhaijingMap />
      </div>
    </div>
  )
}
