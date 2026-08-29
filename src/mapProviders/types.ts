import type { Job } from '@/types/types'

export interface MapView {
  lat: number
  lng: number
  zoom: number
}

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export type ViewMode = 'markers' | 'heatmap'

export interface MapProviderInitOptions {
  /** A persisted viewport (e.g. from a shared URL) to restore on init, instead of the default Greece-wide view. */
  initialView: MapView | null
  /** Builds the popup HTML shown when a marker (one or more jobs) is clicked. */
  buildPopupContent: (jobs: Job[]) => string
  /** Fired whenever the viewport's visible bounds change (pan/zoom end). */
  onBoundsChanged: (bounds: MapBounds) => void
  /** Fired whenever the viewport's center/zoom change, for URL persistence. */
  onViewChanged: (view: MapView) => void
  /** Fired when a marker (city pin or the remote-jobs marker) is clicked. */
  onMarkerClick: (jobs: Job[]) => void
  /**
   * Fired if the map fails to render at all (e.g. no WebGL support in this
   * browser). When this fires, the provider has given up -- callers should
   * show a fallback message instead of the map, not retry `init`.
   */
  onFatalError: (error: unknown) => void
}

/**
 * The single contract JobsMap.vue depends on to render an interactive map
 * of job locations -- deliberately domain-level (jobs in/out, view mode,
 * fly-to, highlight) rather than exposing any particular map library's
 * primitives, so a different provider only has to satisfy this shape, not
 * mimic MapLibre's API.
 *
 * To point the app at a different map library, write a new factory
 * satisfying this interface (see src/mapProviders/maplibre for the
 * reference implementation) and swap the import in
 * src/composables/useMapProvider.ts -- that's the only other place this
 * type is wired to a concrete implementation.
 */
export interface MapProviderAdapter {
  /** Mounts the map into `container` and wires up the callbacks in `options`. Call once. */
  init(container: HTMLElement, options: MapProviderInitOptions): void
  /** Tears down all resources (DOM, listeners, timers) owned by this instance. Call on unmount. */
  destroy(): void
  /** Recalculates the map's canvas/tile dimensions after its container is resized. */
  resize(): void
  /** Replaces the currently rendered city job markers/clusters. */
  setJobs(jobs: readonly Job[]): void
  /** Replaces the nationwide "remote jobs" overlay; `visible: false` hides it without clearing its data. */
  setRemoteJobs(jobs: readonly Job[], visible: boolean): void
  /**
   * Switches between the clustered-pin view and the density-heatmap view.
   * Resolves to `false` (never throws) if the requested mode can't be
   * rendered in the current environment, so the caller can fall back to
   * `'markers'` instead of crashing.
   */
  setViewMode(mode: ViewMode): Promise<boolean>
  /** Pans/zooms to fit all currently-set job markers. Safe to call even with zero markers (no-op). */
  fitToJobs(): void
  /** Smoothly centers on and opens the popup for a specific job's marker, if one is registered. */
  flyToJob(jobId: string): void
  /** Adds/removes the "highlighted" visual state from a job's marker; pass `null` to clear it. */
  setHighlightedJob(jobId: string | null): void
  /** The current viewport, e.g. for URL persistence. */
  getView(): MapView
}

export type MapProviderFactory = () => MapProviderAdapter
