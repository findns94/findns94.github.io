import { getAllTags } from '@/lib/posts'
import { TagsList } from '@/components/TagsList'

export const metadata = {
  title: 'Tags',
}

export default function TagsPage() {
  const tags = getAllTags()

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Tags</h1>
      <TagsList tags={tags} />
    </div>
  )
}
