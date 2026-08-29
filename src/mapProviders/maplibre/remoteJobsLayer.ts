import { Marker, type Map as MaplibreMap } from 'maplibre-gl'
import type { Geometry } from 'geojson'
import type { Job } from '@/types/types'
import { GREECE_CENTER, getJobId } from '@/utils/geo'
import { bindPopupUnlessMobile } from '@/mapProviders/maplibre/popup'
import greeceBoundary from '@/data/greece-boundary.json'

export interface RemoteJobsLayerCallbacks {
  /** Builds the popup content shown when the remote marker is clicked. */
  buildPopupContent: (jobs: Job[]) => HTMLElement
  /** Called when the remote marker is clicked (mirrors city marker clicks). */
  onMarkerClick: (jobs: Job[]) => void
}

const SOURCE_ID = 'remote-jobs-boundary'
const FILL_LAYER_ID = 'remote-jobs-boundary-fill'
const LINE_LAYER_ID = 'remote-jobs-boundary-outline'
const HIGHLIGHT_CLASS = 'marker-highlighted'

// [lng, lat] -- MapLibre's coordinate order, vs. the app-domain [lat, lng].
const GREECE_CENTER_LNGLAT: [number, number] = [GREECE_CENTER[1], GREECE_CENTER[0]]

const boundaryFeature: GeoJSON.Feature = {
  type: 'Feature',
  properties: {},
  geometry: greeceBoundary as Geometry
}

const createMarkerElement = (count: number, highlighted: boolean): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'custom-marker'
  if (highlighted) el.classList.add(HIGHLIGHT_CLASS)
  el.innerHTML = `<div class="marker-pin marker-pin-remote">${count}</div>`
  return el
}

/**
 * Manages the "remote jobs" map overlay: a translucent fill over the whole
 * of Greece (since "remote" means the job could be worked from anywhere in
 * the country, a single pin would be arbitrary) plus a fixed, clickable
 * marker at the country's center showing the count. The fill itself is a
 * plain GL layer with no click handling wired up, so it never blocks
 * clicks/pans on city pins underneath it.
 *
 * The boundary source/layers must be re-added after every style change
 * (see styleSwitcher.ts) since MapLibre's `setStyle` diffs them away --
 * `onStyleLoad` is the hook for that. The fixed marker itself is a plain
 * DOM overlay (a `maplibregl.Marker`), unaffected by style changes, so it
 * doesn't need to be recreated there.
 */
export const createRemoteJobsLayer = (callbacks: RemoteJobsLayerCallbacks) => {
  let map: MaplibreMap | null = null
  let marker: Marker | null = null
  let visible = false
  let currentJobIds = new Set<string>()
  let highlighted = false

  const ensureBoundarySource = (m: MaplibreMap): void => {
    if (m.getSource(SOURCE_ID)) return

    m.addSource(SOURCE_ID, { type: 'geojson', data: boundaryFeature })
    m.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: { 'fill-color': '#8b5cf6', 'fill-opacity': 0.12 }
    })
    m.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: { 'line-color': '#8b5cf6', 'line-opacity': 0.35, 'line-width': 1 }
    })
  }

  const setBoundaryVisible = (isVisible: boolean): void => {
    if (!map?.getLayer(FILL_LAYER_ID)) return
    const visibility = isVisible ? 'visible' : 'none'
    map.setLayoutProperty(FILL_LAYER_ID, 'visibility', visibility)
    map.setLayoutProperty(LINE_LAYER_ID, 'visibility', visibility)
  }

  const removeMarker = (): void => {
    marker?.remove()
    marker = null
  }

  /** Re-adds the boundary source/layers after a style change. */
  const onStyleLoad = (m: MaplibreMap): void => { ensureBoundarySource(m); }

  const attachTo = (m: MaplibreMap): void => {
    map = m
    if (m.isStyleLoaded()) ensureBoundarySource(m)
  }

  /**
   * Redraws the overlay for the given remote jobs. Pass `isVisible: false`
   * to hide it without needing the caller to track visibility separately
   * (e.g. while in heatmap view, where a translucent fill would visually
   * compete with the heatmap's own color scale).
   */
  const update = (remoteJobs: readonly Job[], isVisible: boolean): void => {
    visible = isVisible
    currentJobIds = new Set(remoteJobs.map(getJobId))
    setBoundaryVisible(isVisible && remoteJobs.length > 0)
    removeMarker()

    if (!map || !isVisible || remoteJobs.length === 0) return

    marker = new Marker({
      element: createMarkerElement(remoteJobs.length, highlighted),
      anchor: 'bottom'
    }).setLngLat(GREECE_CENTER_LNGLAT)
    bindPopupUnlessMobile(marker, () => callbacks.buildPopupContent([...remoteJobs]))
    marker.on('click', () => {
      callbacks.onMarkerClick([...remoteJobs])
    })
    marker.addTo(map)
  }

  /** [lng, lat] for a remote job -- always Greece's center, regardless of current visibility. */
  const getCoordsForJob = (jobId: string): [number, number] | null =>
    currentJobIds.has(jobId) ? GREECE_CENTER_LNGLAT : null

  /** Opens the remote marker's popup, if `jobId` is currently one of its jobs. Returns whether it succeeded. */
  const openPopupForJob = (jobId: string): boolean => {
    if (!marker || !currentJobIds.has(jobId)) return false
    marker.togglePopup()
    return true
  }

  const setHighlightedJob = (jobId: string | null): void => {
    highlighted = jobId !== null && currentJobIds.has(jobId)
    const el = marker?.getElement()
    if (!el) return
    el.classList.toggle(HIGHLIGHT_CLASS, highlighted)
  }

  const destroy = (): void => {
    removeMarker()
    map = null
  }

  return {
    attachTo,
    update,
    getCoordsForJob,
    openPopupForJob,
    setHighlightedJob,
    onStyleLoad,
    destroy
  }
}
