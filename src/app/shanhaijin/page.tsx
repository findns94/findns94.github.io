import { ShanhaijingPage } from '@/components/ShanhaijingPage'
import { CHAPTERS } from '@/lib/shanhaijing-data'

export const metadata = {
  title: '山海经知识图谱',
  description:
    '《山海经》结构化知识图谱 — 18 篇、447 山、26 山系、97,358 里。底本为维基文库郭璞注本。',
}

export default function Page() {
  return <ShanhaijingPage chapters={CHAPTERS} />
}
