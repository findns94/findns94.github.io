import { EntityTypeClient } from './EntityTypeClient'

export function generateStaticParams() {
  return [
    { type: 'creature' },
    { type: 'bird-beast' },
    { type: 'water' },
    { type: 'mineral' },
    { type: 'plant' },
    { type: 'polity' },
    { type: 'deity' },
    { type: 'person' },
    { type: 'omen' },
    { type: 'sacrifice' },
    { type: 'mountain' },
    { type: 'direction' },
    { type: 'quantity' },
    { type: 'concept' },
    { type: 'identity' },
  ]
}

export default function EntityTypePage({ params }: { params: { type: string } }) {
  return <EntityTypeClient typeKey={params.type.replace(/-/g, '_')} />
}
