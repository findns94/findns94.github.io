import { ChapterReader } from '@/components/ChapterReader'
import { CHAPTERS, getChapterMeta } from '@/lib/shanhaijing-data'
import { readChapterText } from '@/lib/shanhaijing'

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ slug: c.num }))
}

export default function ChapterPage({ params }: { params: { slug: string } }) {
  const chapter = getChapterMeta(params.slug)

  if (!chapter) {
    return (
      <div className="text-gray-600">
        <p>未找到该篇目。</p>
      </div>
    )
  }

  const text = readChapterText(chapter.num, chapter.name, chapter.division)

  if (!text) {
    return (
      <div className="text-gray-600">
        <p>未找到该篇目的经文文本。</p>
      </div>
    )
  }

  return <ChapterReader num={chapter.num} name={chapter.name} text={text} />
}
