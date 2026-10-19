import { KnowledgeGraph } from '@/components/KnowledgeGraph'
import './graph.css'

export const metadata = {
  title: '山海经 · 知识图谱',
  description:
    '《山海经》知识图谱 —— 山、异兽、物产、水系之间的产出、栖息、功效、相邻与连接关系可视化。',
}

export default function Page() {
  return (
    // 逃逸根布局的 max-w-3xl 限宽
    <div className="full-bleed">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <KnowledgeGraph />
      </div>
    </div>
  )
}
