import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EntityDetailClient } from './EntityDetailClient'

const TYPE_SLUG_MAP: Record<string, string> = {
  creature: 'creature',
  bird_beast: 'bird-beast',
  water: 'water',
  mineral: 'mineral',
  plant: 'plant',
  polity: 'polity',
  deity: 'deity',
  person: 'person',
  omen: 'omen',
  sacrifice: 'sacrifice',
  mountain: 'mountain',
  direction: 'direction',
  quantity: 'quantity',
  concept: 'concept',
  identity: 'identity',
}

function getAllEntitySlugs(): { type: string; name: string }[] {
  try {
    const root = join(process.cwd(), 'public/shanhaijin/data.json')
    const data = JSON.parse(readFileSync(root, 'utf8'))
    const slugs: { type: string; name: string }[] = []
    for (const e of data.entities || []) {
      const typeSlug = TYPE_SLUG_MAP[e.typeKey]
      if (typeSlug && e.canonical) {
        slugs.push({ type: typeSlug, name: encodeURIComponent(e.canonical) })
      }
    }
    return slugs
  } catch {
    return []
  }
}

export function generateStaticParams() {
  return getAllEntitySlugs()
}

export default function EntityDetailPage({ params }: { params: { type: string; name: string } }) {
  const typeKey = params.type.replace(/-/g, '_')
  const rawName = decodeURIComponent(params.name)
  return <EntityDetailClient typeKey={typeKey} rawName={rawName} />
}
