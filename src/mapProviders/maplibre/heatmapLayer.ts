import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl'
import type { Job } from '@/types/types'
import { getJobCoords } from '@/utils/geo'

const SOURCE_ID = 'job-heatmap-points'
const LAYER_ID = 'job-heatmap'

type PointFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point>

const buildFeatureCollection = (jobs: readonly Job[]): PointFeatureCollection => {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const job of jobs) {
    const coords = getJobCoords(job)
    if (!coords) continue
    // GeoJSON/MapLibre coordinates are [lng, lat]; app-domain coords are [lat, lng].
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [coords[1], coords[0]] }
    })
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Manages the density-heatmap layer, shown as an alternative to the
 * clustered marker view. Uses MapLibre's native GL `heatmap` layer type
 * (shader-based) rather than a canvas plugin, so -- unlike the old
 * `leaflet.heat` integration -- there's no separate "canvas support"
 * failure mode to special-case here; if the map itself renders, so does
 * this layer.
 *
 * The source/layer must be re-added after every style change (see
 * styleSwitcher.ts) since MapLibre's `setStyle` diffs them away -- `data`
 * is kept in this closure so `ensure` can always recreate them with the
 * latest jobs, regardless of when it's called.
 */
export const createHeatmapLayer = () => {
  let data: PointFeatureCollection = { type: 'FeatureCollection', features: [] }

  const ensure = (map: MaplibreMap): void => {
    if (map.getSource(SOURCE_ID)) return

    map.addSource(SOURCE_ID, { type: 'geojson', data })
    map.addLayer({
      id: LAYER_ID,
      type: 'heatmap',
      source: SOURCE_ID,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': 1.2,
        'heatmap-radius': 28,
        'heatmap-opacity': 0.75,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(59,130,246,0)',
          0.2,
          'rgba(59,130,246,0.5)',
          0.4,
          'rgba(16,185,129,0.6)',
          0.6,
          'rgba(245,158,11,0.7)',
          0.8,
          'rgba(239,68,68,0.8)',
          1,
          'rgba(220,38,38,0.9)'
        ]
      }
    })
  }

  /** Re-adds the source/layer (if missing) after a style change. */
  const onStyleLoad = (map: MaplibreMap): void => {
    ensure(map)
  }

  /**
   * Pushes `data` to the map however that's currently possible: if the
   * source already exists, `setData` is always safe regardless of
   * overall style-load status (it's a lightweight update to an existing
   * source, not a new one) -- gating *that* on `isStyleLoaded()` (which
   * fluctuates with unrelated in-flight style work like sprite/glyph
   * loading, not a one-way "ready" latch) risks silently dropping a real
   * update if it's called during a momentary `false` blip.
   * `isStyleLoaded()` only genuinely matters for the very first
   * `addSource`/`addLayer` call, which requires the style to exist at
   * all; if that hasn't happened yet either, `onStyleLoad` picks this up
   * using whatever `data` is current by then.
   */
  const update = (map: MaplibreMap, jobs: readonly Job[]): void => {
    data = buildFeatureCollection(jobs)

    const source = map.getSource<GeoJSONSource>(SOURCE_ID)
    if (source) {
      void source.setData(data)
    } else if (map.isStyleLoaded()) {
      ensure(map)
    }
  }

  const setVisible = (map: MaplibreMap, visible: boolean): void => {
    if (!map.getLayer(LAYER_ID)) return
    map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  }

  return { update, setVisible, onStyleLoad }
}
