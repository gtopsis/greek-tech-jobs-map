import { vi, type Mock } from 'vitest'
import type { MapProviderAdapter, MapProviderInitOptions, MapView, ViewMode } from '@/mapProviders/types'
import type { Job } from '@/types/types'

export interface FakeMapProvider extends MapProviderAdapter {
  init: Mock<(container: HTMLElement, options: MapProviderInitOptions) => void>
  destroy: Mock<() => void>
  resize: Mock<() => void>
  setJobs: Mock<(jobs: readonly Job[]) => void>
  setRemoteJobs: Mock<(jobs: readonly Job[], visible: boolean) => void>
  setViewMode: Mock<(mode: ViewMode) => Promise<boolean>>
  fitToJobs: Mock<() => void>
  flyToJob: Mock<(jobId: string) => void>
  setHighlightedJob: Mock<(jobId: string | null) => void>
  getView: Mock<() => MapView>
  /** Test-only: the options passed to the most recent `init()` call, so tests can trigger callbacks (bounds-changed, marker-click, fatal-error) as if the map produced them. */
  getInitOptions: () => MapProviderInitOptions
}

/**
 * A hand-written `MapProviderAdapter` test double -- every method is a
 * `vi.fn()` (recording calls, no real map library involved), plus a
 * `getInitOptions()` escape hatch so tests can trigger the callbacks
 * (`onBoundsChanged`/`onViewChanged`/`onMarkerClick`/`onFatalError`) a real
 * provider would normally fire itself, as if the map produced them.
 *
 * Used to keep component/view-level tests (JobsMap.spec.ts,
 * HomeView.spec.ts) independent of which map library is actually plugged
 * in -- see src/composables/useMapProvider.ts, which is mocked globally in
 * vitest.setup.ts to always return one of these.
 */
export const createFakeMapProvider = (): FakeMapProvider => {
  let initOptions: MapProviderInitOptions | null = null

  const provider: FakeMapProvider = {
    init: vi.fn((_container: HTMLElement, options: MapProviderInitOptions) => {
      initOptions = options
      // Real providers emit an initial viewport synchronously after setup
      // (see maplibreMapProvider.ts's `emitViewport` call at the end of
      // `init`) since `moveend`-like events never fire on their own
      // without user interaction -- mirrored here so provider-agnostic
      // callers (e.g. URL persistence and the "sync to map view" toggle
      // in useMapView.ts) see a viewport even in tests that never
      // simulate a pan/zoom. The bounds are deliberately huge (the whole
      // globe) so they never accidentally narrow a test's job list --
      // tests that care about viewport narrowing emit their own specific
      // `bounds-changed` instead (see HomeView.spec.ts).
      options.onBoundsChanged({ north: 90, south: -90, east: 180, west: -180 })
      options.onViewChanged(options.initialView ?? { lat: 39.0742, lng: 21.8243, zoom: 6 })
    }),
    destroy: vi.fn(),
    resize: vi.fn(),
    setJobs: vi.fn(),
    setRemoteJobs: vi.fn(),
    setViewMode: vi.fn(() => Promise.resolve(true)),
    fitToJobs: vi.fn(),
    flyToJob: vi.fn(),
    setHighlightedJob: vi.fn(),
    getView: vi.fn(() => ({ lat: 39.0742, lng: 21.8243, zoom: 6 })),
    getInitOptions: (): MapProviderInitOptions => {
      if (!initOptions) throw new Error('createFakeMapProvider: init() was not called yet')
      return initOptions
    }
  }

  return provider
}
