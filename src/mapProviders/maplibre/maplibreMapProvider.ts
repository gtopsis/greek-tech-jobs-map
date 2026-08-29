import { Map as MaplibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre computes its worker script's URL at runtime, relative to its own
// bundled module's `import.meta.url` -- a pattern Vite can't statically
// detect (unlike the `new Worker(new URL('...', import.meta.url))` form it
// looks for), so the worker file never gets copied into the build output
// and `new Worker(...)` 404s in production (this doesn't surface as a
// crash: the map object is still created, it just never renders anything,
// since no worker ever comes up to parse tiles). Explicitly importing the
// worker file as a URL asset (so Vite bundles/hashes it properly) and
// pointing MapLibre at that resolved URL is the officially documented fix
// for this exact bundler gap.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { MapProviderAdapter, MapProviderInitOptions, MapView, ViewMode } from '@/mapProviders/types'
import { GREECE_CENTER, GREECE_DEFAULT_ZOOM } from '@/utils/geo'
import { createStyleSwitcher } from '@/mapProviders/maplibre/styleSwitcher'
import { createClusterLayer } from '@/mapProviders/maplibre/clusterLayer'
import { createHeatmapLayer } from '@/mapProviders/maplibre/heatmapLayer'
import { createRemoteJobsLayer } from '@/mapProviders/maplibre/remoteJobsLayer'
import type { Job } from '@/types/types'

setWorkerUrl(maplibreWorkerUrl)

const FLY_TO_MIN_ZOOM = 12

const toLngLat = ([lat, lng]: readonly [number, number]): [number, number] => [lng, lat]

/**
 * The MapLibre GL + OpenFreeMap implementation of `MapProviderAdapter` (see
 * src/mapProviders/types.ts for the contract, and src/composables/
 * useMapProvider.ts for the single place this is wired up as *the* active
 * provider).
 *
 * Composes four smaller, independently-testable units, each owning one
 * concern's MapLibre-specific lifecycle:
 *  - styleSwitcher: which OpenFreeMap style is loaded (light/dark)
 *  - clusterLayer: clustered city-job pins
 *  - heatmapLayer: the alternative density-heatmap view
 *  - remoteJobsLayer: the nationwide "remote jobs" overlay
 * This file only orchestrates *when* each of those runs, translating the
 * domain-level `MapProviderAdapter` calls into calls on the right unit(s).
 *
 * `clusterLayer`/`remoteJobsLayer` are created inside `init` (rather than
 * up here) because they need the `onMarkerClick`/`buildPopupContent`
 * callbacks passed into `init`, which aren't known until then.
 * `styleSwitcher`/`heatmapLayer` need no such callbacks, so they're created
 * once, up front.
 */
export const createMaplibreMapProvider = (): MapProviderAdapter => {
  const styleSwitcher = createStyleSwitcher()
  const heatmapLayer = createHeatmapLayer()

  let map: MaplibreMap | null = null
  let stopStyleSwitcher: (() => void) | null = null
  let clusterLayer: ReturnType<typeof createClusterLayer> | null = null
  let remoteJobsLayer: ReturnType<typeof createRemoteJobsLayer> | null = null
  let viewMode: ViewMode = 'markers'
  let latestJobs: readonly Job[] = []

  const init = (container: HTMLElement, options: MapProviderInitOptions): void => {
    if (map) return

    const center: [number, number] = options.initialView
      ? [options.initialView.lat, options.initialView.lng]
      : GREECE_CENTER
    const zoom = options.initialView?.zoom ?? GREECE_DEFAULT_ZOOM

    let createdMap: MaplibreMap
    try {
      createdMap = new MaplibreMap({
        container,
        style: styleSwitcher.initialStyleUrl,
        center: toLngLat(center),
        zoom
      })
    } catch (err) {
      options.onFatalError(err)
      return
    }
    map = createdMap

    // MapLibre has no reliable "fatal vs. recoverable" flag on error
    // events (a single failed tile also fires 'error'), so this only
    // treats it as fatal if nothing has rendered yet at all -- e.g. no
    // WebGL support, surfaced via a GPUInitializationError.
    map.on('error', (event) => {
      if (!createdMap.loaded()) options.onFatalError(event.error)
    })

    map.addControl(new NavigationControl(), 'top-right')

    clusterLayer = createClusterLayer({
      buildPopupContent: options.buildPopupContent,
      onMarkerClick: options.onMarkerClick
    })
    remoteJobsLayer = createRemoteJobsLayer({
      buildPopupContent: options.buildPopupContent,
      onMarkerClick: options.onMarkerClick
    })

    stopStyleSwitcher = styleSwitcher.attachTo(createdMap, (m) => {
      clusterLayer?.onStyleLoad(m)
      heatmapLayer.onStyleLoad(m)
      remoteJobsLayer?.onStyleLoad(m)
    })

    const emitViewport = (): void => {
      if (!map) return
      const bounds = map.getBounds()
      options.onBoundsChanged({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      })

      const viewCenter = map.getCenter()
      options.onViewChanged({ lat: viewCenter.lat, lng: viewCenter.lng, zoom: map.getZoom() })
    }

    map.on('moveend', emitViewport)

    remoteJobsLayer.attachTo(createdMap)
    clusterLayer.attachTo(createdMap)

    // The initial viewport is known synchronously (center/zoom are set at
    // construction), but `moveend` only fires from user interaction -- so
    // listeners need one explicit initial emit, otherwise a session with
    // no panning/zooming would never receive a viewport at all.
    emitViewport()
  }

  const destroy = (): void => {
    stopStyleSwitcher?.()
    clusterLayer?.destroy()
    remoteJobsLayer?.destroy()
    map?.remove()
    map = null
    clusterLayer = null
    remoteJobsLayer = null
  }

  const resize = (): void => {
    map?.resize()
  }

  const setJobs = (jobs: readonly Job[]): void => {
    latestJobs = jobs
    clusterLayer?.update(jobs)
    if (viewMode === 'heatmap' && map) heatmapLayer.update(map, jobs)
  }

  const setRemoteJobs = (jobs: readonly Job[], visible: boolean): void => {
    remoteJobsLayer?.update(jobs, visible)
  }

  const setViewMode = (mode: ViewMode): Promise<boolean> => {
    if (!map || !clusterLayer) return Promise.resolve(false)

    try {
      if (mode === 'heatmap') {
        heatmapLayer.update(map, latestJobs)
        clusterLayer.detachFrom()
        heatmapLayer.setVisible(map, true)
      } else {
        heatmapLayer.setVisible(map, false)
        clusterLayer.attachTo(map)
      }
      viewMode = mode
      return Promise.resolve(true)
    } catch (err) {
      console.error('Failed to switch map view mode.', err)
      return Promise.resolve(false)
    }
  }

  const fitToJobs = (): void => {
    clusterLayer?.fitToJobs()
  }

  const flyToJob = (jobId: string): void => {
    if (!map || !clusterLayer) return
    const coords = clusterLayer.getCoordsForJob(jobId) ?? remoteJobsLayer?.getCoordsForJob(jobId)
    if (!coords) return

    map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), FLY_TO_MIN_ZOOM) })
    map.once('moveend', () => {
      if (!clusterLayer?.openPopupForJob(jobId)) remoteJobsLayer?.openPopupForJob(jobId)
    })
  }

  const setHighlightedJob = (jobId: string | null): void => {
    clusterLayer?.setHighlightedJob(jobId)
    remoteJobsLayer?.setHighlightedJob(jobId)
  }

  const getView = (): MapView => {
    if (!map) return { lat: GREECE_CENTER[0], lng: GREECE_CENTER[1], zoom: GREECE_DEFAULT_ZOOM }
    const center = map.getCenter()
    return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
  }

  return {
    init,
    destroy,
    resize,
    setJobs,
    setRemoteJobs,
    setViewMode,
    fitToJobs,
    flyToJob,
    setHighlightedJob,
    getView
  }
}
