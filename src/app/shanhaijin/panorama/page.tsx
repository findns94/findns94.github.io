'use client'

import { useEffect, useState } from 'react'
import { ShanhaijinPanorama } from '@/components/ShanhaijinPanorama'
import type { PrecomputedPanoramaLayout } from '@/components/ShanhaijinPanorama'
import type { MapData } from '@/lib/shanhaijin-map'
import './panorama.css'

const DATA_URL = '/shanhaijin/panorama-data.json'
const LAYOUT_URL = '/shanhaijin/panorama-layout.json'

export default function Page() {
  const [data, setData] = useState<MapData | null>(null)
  const [layout, setLayout] = useState<PrecomputedPanoramaLayout | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(DATA_URL)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status))
          return r.json() as Promise<MapData>
        }),
      // 预计算布局缺失时组件回退到运行时 layoutChain，故这里容错为 null
      fetch(LAYOUT_URL)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status))
          return r.json() as Promise<PrecomputedPanoramaLayout>
        })
        .catch(() => null),
    ])
      .then(([d, l]) => {
        if (alive) {
          setData(d)
          setLayout(l)
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="full-bleed">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="sh-panorama">
            <p className="muted">Failed to load: {error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="full-bleed">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="sh-panorama">
            <p className="muted">Loading…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="full-bleed">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <ShanhaijinPanorama data={data} layout={layout} />
      </div>
    </div>
  )
}
