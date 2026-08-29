import { Marker, type GeoJSONSource, type Map as MaplibreMap, type MapGeoJSONFeature } from 'maplibre-gl'
import type { Job } from '@/types/types'
import { getJobCoords, getJobId } from '@/utils/geo'
import { bindPopupUnlessMobile } from '@/mapProviders/maplibre/popup'

export interface ClusterLayerCallbacks {
  /** Builds the popup content shown when an individual pin (one or more jobs at the same location) is clicked. */
  buildPopupContent: (jobs: Job[]) => HTMLElement
  /** Called when an individual pin is clicked. */
  onMarkerClick: (jobs: Job[]) => void
}

const SOURCE_ID = 'job-markers'
const INVISIBLE_LAYER_ID = 'job-markers-tile-loader'
const CLUSTER_RADIUS = 50
const CLUSTER_MAX_ZOOM = 14
const HIGHLIGHT_CLASS = 'marker-highlighted'

type LocationKey = string
type PointFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point>

const clusterIconClass = (count: number): string => {
  if (count >= 30) return 'marker-cluster-large'
  if (count >= 10) return 'marker-cluster-medium'
  return 'marker-cluster-small'
}

const createPinElement = (count: number, highlighted: boolean): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'custom-marker'
  if (highlighted) el.classList.add(HIGHLIGHT_CLASS)
  el.innerHTML = `<div class="marker-pin">${count}</div>`
  return el
}

const createClusterElement = (count: number): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'marker-cluster-custom'
  el.innerHTML = `<div class="marker-cluster-inner ${clusterIconClass(count)}"><span>${count}</span></div>`
  return el
}

/**
 * Manages the clustered city-marker layer: groups jobs by resolved
 * coordinate into one pin per unique location (with a popup listing every
 * job there), and clusters nearby pins together as the map zooms out.
 * Both a single pin and a cluster bubble show a job count -- clustering
 * only changes *how many locations* are represented by one bubble, not
 * what the number on it means (enforced via `clusterProperties`' summed
 * `jobCount`, not MapLibre's default per-feature `point_count`).
 *
 * Implementation notes:
 *  - Rendering is done via plain `maplibregl.Marker` HTML elements kept in
 *    sync with the clustered GeoJSON source on every `render` event (the
 *    documented MapLibre pattern for HTML-based clusters), rather than
 *    MapLibre's native circle/symbol layers -- this preserves the app's
 *    existing pin/bubble CSS instead of a native-GL redesign.
 *  - There is no equivalent to `leaflet.markercluster`'s "spiderfy on max
 *    zoom": clicking a cluster eases to its expansion zoom; clusters that
 *    still overlap at `CLUSTER_MAX_ZOOM` just show overlapping pins.
 *  - `getCoordsForJob`/`openPopupForJob` only find a job's individual pin
 *    while its location is currently rendered unclustered -- see
 *    `getCoordsForJob`'s own doc comment for why `flyToJob` still works
 *    regardless.
 */
export const createClusterLayer = (callbacks: ClusterLayerCallbacks) => {
  let map: MaplibreMap | null = null
  let visible = false
  let renderListenerAttached = false
  let highlightedKey: LocationKey | null = null

  let data: PointFeatureCollection = { type: 'FeatureCollection', features: [] }
  let locationJobsByKey = new Map<LocationKey, Job[]>()
  let locationCoordsByKey = new Map<LocationKey, [number, number]>() // [lng, lat]
  let jobIdToLocationKey = new Map<string, LocationKey>()
  let uniqueLngLats: [number, number][] = []

  const markersByKey = new Map<LocationKey, Marker>()
  const clusterMarkersByKey = new Map<string, Marker>()

  const ensureSource = (m: MaplibreMap): void => {
    if (m.getSource(SOURCE_ID)) return
    m.addSource(SOURCE_ID, {
      type: 'geojson',
      data,
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterProperties: { sumJobCount: ['+', ['get', 'jobCount']] }
    })
    // querySourceFeatures only returns features from tiles MapLibre has
    // actually requested/loaded for the current viewport -- and that's
    // driven entirely by which *layers* reference a source, not by the
    // source's mere existence. Since every visible marker/cluster here is
    // a plain HTML overlay (see syncMarkers), not a GL paint layer, this
    // source would otherwise never have any layer causing its tiles to
    // load, and querySourceFeatures would stay permanently empty. This
    // fully transparent circle layer exists solely to make MapLibre treat
    // the source as "in use" for tile-loading purposes; it paints nothing.
    m.addLayer({
      id: INVISIBLE_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: { 'circle-opacity': 0, 'circle-radius': 0 }
    })
  }

  /**
   * Pushes the current `data` to the map, however that's currently
   * possible: if the source already exists, `setData` is always safe
   * regardless of overall style-load status (it's a lightweight update to
   * an existing source, not a new one) -- gating *that* on
   * `isStyleLoaded()` (which fluctuates with unrelated in-flight style
   * work like sprite/glyph loading, not a one-way "ready" latch) risks
   * silently dropping a real update if it's called during a momentary
   * `false` blip. `isStyleLoaded()` only genuinely matters for the very
   * first `addSource` call, which requires the style to exist at all; if
   * that hasn't happened yet either, `onStyleLoad` (see styleSwitcher.ts)
   * is what picks this up, using whatever `data` is current by then.
   */
  const syncSource = (m: MaplibreMap): void => {
    const existing = m.getSource<GeoJSONSource>(SOURCE_ID)
    if (existing) {
      void existing.setData(data)
    } else if (m.isStyleLoaded()) {
      ensureSource(m)
    }
  }

  const removeAllMarkers = (): void => {
    for (const marker of markersByKey.values()) marker.remove()
    markersByKey.clear()
    for (const marker of clusterMarkersByKey.values()) marker.remove()
    clusterMarkersByKey.clear()
  }

  const expandCluster = async (clusterId: number, center: [number, number]): Promise<void> => {
    if (!map) return
    const source = map.getSource<GeoJSONSource>(SOURCE_ID)
    if (!source) return
    try {
      const zoom = await source.getClusterExpansionZoom(clusterId)
      map.easeTo({ center, zoom })
    } catch {
      // The cluster may have changed/disappeared between click and resolution; ignore.
    }
  }

  const syncMarkers = (): void => {
    if (!map || !visible) return
    if (!map.getSource(SOURCE_ID) || !map.isSourceLoaded(SOURCE_ID)) return

    const features = map.querySourceFeatures(SOURCE_ID) as MapGeoJSONFeature[]
    const seenKeys = new Set<LocationKey>()
    const seenClusterKeys = new Set<string>()

    for (const feature of features) {
      if (feature.geometry.type !== 'Point') continue
      const [lng, lat] = feature.geometry.coordinates as [number, number]
      const props = feature.properties

      if (props['cluster']) {
        const clusterId = props['cluster_id'] as number
        const clusterKey = `cluster:${String(clusterId)}`
        seenClusterKeys.add(clusterKey)
        if (clusterMarkersByKey.has(clusterKey)) continue

        const count = (props['sumJobCount'] as number | undefined) ?? (props['point_count'] as number)
        const marker = new Marker({ element: createClusterElement(count), anchor: 'center' }).setLngLat([
          lng,
          lat
        ])
        marker.on('click', () => {
          void expandCluster(clusterId, [lng, lat])
        })
        marker.addTo(map)
        clusterMarkersByKey.set(clusterKey, marker)
        continue
      }

      const key = props['id'] as LocationKey
      seenKeys.add(key)
      if (markersByKey.has(key)) continue

      const jobsAtLocation = locationJobsByKey.get(key) ?? []
      const marker = new Marker({
        element: createPinElement(props['jobCount'] as number, key === highlightedKey),
        anchor: 'bottom'
      }).setLngLat([lng, lat])
      bindPopupUnlessMobile(marker, () => callbacks.buildPopupContent(jobsAtLocation))
      marker.on('click', () => {
        callbacks.onMarkerClick(jobsAtLocation)
      })
      marker.addTo(map)
      markersByKey.set(key, marker)
    }

    for (const [key, marker] of markersByKey) {
      if (!seenKeys.has(key)) {
        marker.remove()
        markersByKey.delete(key)
      }
    }
    for (const [key, marker] of clusterMarkersByKey) {
      if (!seenClusterKeys.has(key)) {
        marker.remove()
        clusterMarkersByKey.delete(key)
      }
    }
  }

  const update = (jobs: readonly Job[]): void => {
    const groups = new Map<LocationKey, { lat: number; lng: number; jobs: Job[] }>()

    for (const job of jobs) {
      const coords = getJobCoords(job)
      if (!coords) continue

      const key = `${coords[0]},${coords[1]}`
      const group = groups.get(key)
      if (group) {
        group.jobs.push(job)
      } else {
        groups.set(key, { lat: coords[0], lng: coords[1], jobs: [job] })
      }
    }

    locationJobsByKey = new Map()
    locationCoordsByKey = new Map()
    jobIdToLocationKey = new Map()
    uniqueLngLats = []
    const features: GeoJSON.Feature<GeoJSON.Point>[] = []

    for (const [key, { lat, lng, jobs: groupedJobs }] of groups) {
      locationJobsByKey.set(key, groupedJobs)
      locationCoordsByKey.set(key, [lng, lat])
      uniqueLngLats.push([lng, lat])
      for (const job of groupedJobs) jobIdToLocationKey.set(getJobId(job), key)

      features.push({
        type: 'Feature',
        properties: { id: key, jobCount: groupedJobs.length },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      })
    }

    data = { type: 'FeatureCollection', features }

    if (map) syncSource(map)
  }

  /** Re-adds the source (with the latest data) after a style change. */
  const onStyleLoad = (m: MaplibreMap): void => { ensureSource(m); }

  const attachTo = (m: MaplibreMap): void => {
    map = m
    visible = true

    if (!renderListenerAttached) {
      m.on('render', syncMarkers)
      renderListenerAttached = true
    }
    if (m.isStyleLoaded()) ensureSource(m)
    syncMarkers()
  }

  const detachFrom = (): void => {
    visible = false
    removeAllMarkers()
  }

  const fitToJobs = (): void => {
    if (!map || uniqueLngLats.length === 0) return

    let west = uniqueLngLats[0]![0]
    let east = uniqueLngLats[0]![0]
    let south = uniqueLngLats[0]![1]
    let north = uniqueLngLats[0]![1]
    for (const [lng, lat] of uniqueLngLats) {
      if (lng < west) west = lng
      if (lng > east) east = lng
      if (lat < south) south = lat
      if (lat > north) north = lat
    }

    map.fitBounds(
      [
        [west, south],
        [east, north]
      ],
      { padding: 30, maxZoom: 12 }
    )
  }

  /** The [lng, lat] coordinates for a job's location, regardless of whether it's currently rendered as an individual pin or merged into a cluster. */
  const getCoordsForJob = (jobId: string): [number, number] | null => {
    const key = jobIdToLocationKey.get(jobId)
    if (!key) return null
    return locationCoordsByKey.get(key) ?? null
  }

  /** Opens the popup for a job's marker, if it's currently rendered as an individual pin. Returns whether it succeeded, so callers can try another layer next. */
  const openPopupForJob = (jobId: string): boolean => {
    const key = jobIdToLocationKey.get(jobId)
    const marker = key ? markersByKey.get(key) : undefined
    if (!marker) return false
    marker.togglePopup()
    return true
  }

  const setHighlightedJob = (jobId: string | null): void => {
    const previousKey = highlightedKey
    if (previousKey) markersByKey.get(previousKey)?.getElement().classList.remove(HIGHLIGHT_CLASS)

    highlightedKey = jobId ? (jobIdToLocationKey.get(jobId) ?? null) : null
    if (highlightedKey) markersByKey.get(highlightedKey)?.getElement().classList.add(HIGHLIGHT_CLASS)
  }

  const destroy = (): void => {
    if (map && renderListenerAttached) map.off('render', syncMarkers)
    removeAllMarkers()
    map = null
    renderListenerAttached = false
  }

  return {
    update,
    attachTo,
    detachFrom,
    fitToJobs,
    getCoordsForJob,
    openPopupForJob,
    setHighlightedJob,
    onStyleLoad,
    destroy
  }
}
