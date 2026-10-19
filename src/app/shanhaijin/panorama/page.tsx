'use client'

import { useEffect, useState } from 'react'
import { ShanhaijinPanorama } from '@/components/ShanhaijinPanorama'
import type { MapData } from '@/lib/shanhaijin-map'
import './panorama.css'

const DATA_URL = '/shanhaijin/data.json'

export default function Page() {
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<MapData>
      })
      .then((d) => {
        if (alive) setData(d)
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
        <ShanhaijinPanorama data={data} />
      </div>
    </div>
  )
}
