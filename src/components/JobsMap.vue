<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { Job } from '@/types/types'
import type { MapBounds, MapView, ViewMode } from '@/mapProviders/types'
import { useMapProvider } from '@/composables/useMapProvider'
import { debounce } from '@/utils/debounce'

export type { MapView }

const props = defineProps<{
  jobs: readonly Job[]
  remoteJobs?: readonly Job[]
  highlightedJobId?: string | null
  initialView?: MapView | null
}>()

const emit = defineEmits<{
  'bounds-changed': [bounds: MapBounds]
  'marker-click': [jobs: Job[]]
  'view-changed': [view: MapView]
}>()

// The whole point of this component: it depends only on the
// MapProviderAdapter contract (src/mapProviders/types.ts), never on any
// particular map library directly. To change map providers, see
// src/composables/useMapProvider.ts -- nothing here needs to change.
const mapProvider = useMapProvider()

const mapContainer = ref<HTMLDivElement | null>(null)
const viewMode = ref<ViewMode>('markers')
const mapError = ref<string | null>(null)
let resizeObserver: ResizeObserver | null = null

const buildPopupContent = (jobs: Job[]): string => {
  if (jobs.length === 1) {
    const { title, company, location } = jobs[0]!
    return `<strong>${title}</strong><br>${company}<br><em>${location}</em>`
  }

  const scrollable = jobs.length > 15 ? ' scrollable' : ''
  const items = jobs.map((job) => `${job.company} - ${job.title}`).join('<br>')
  return `<strong>${jobs.length} jobs</strong><div class="jobs-list${scrollable}">${items}</div>`
}

/**
 * Hides the nationwide remote-jobs overlay in heatmap view, where a
 * translucent country-wide fill would visually compete with the
 * heatmap's own color scale.
 */
const updateRemoteLayer = (): void => {
  mapProvider.setRemoteJobs(props.remoteJobs ?? [], viewMode.value !== 'heatmap')
}

/**
 * Rebuilds the city-marker/cluster layer and the remote overlay. Does not
 * re-fit the viewport -- see fitToInitialJobsOnce.
 */
const refreshJobLayers = (): void => {
  mapProvider.setJobs(props.jobs)
  updateRemoteLayer()
}

/**
 * Shows either the clustered pin markers or a density heatmap. If the
 * requested mode can't be rendered (the provider is the one that knows
 * why -- e.g. no WebGL/canvas support), falls back to the marker view
 * instead of leaving the map in a broken state.
 */
const applyViewMode = async (): Promise<void> => {
  const succeeded = await mapProvider.setViewMode(viewMode.value)

  if (!succeeded && viewMode.value === 'heatmap') {
    console.error('Heatmap view is unavailable, falling back to markers.')
    viewMode.value = 'markers'
    await mapProvider.setViewMode('markers')
  }

  updateRemoteLayer()
}

const toggleViewMode = (): void => {
  viewMode.value = viewMode.value === 'markers' ? 'heatmap' : 'markers'
  void applyViewMode()
}

let hasFitInitialBounds = false

/**
 * Fits the viewport to the current jobs, but only ever once -- jobs
 * typically arrive asynchronously after mount, so this may run from the
 * mount-time call or the jobs-changed watcher, whichever sees non-empty
 * jobs first. Never again after that: `props.jobs` also changes whenever
 * a filter/search changes, and re-fitting on every one of those would
 * reset the user's current pan/zoom. A persisted initial view (e.g. from
 * a shared URL) skips auto-fitting entirely.
 */
const fitToInitialJobsOnce = (): void => {
  if (hasFitInitialBounds || props.initialView || props.jobs.length === 0) return
  mapProvider.fitToJobs()
  hasFitInitialBounds = true
}

const syncMapForJobsChange = (): void => {
  refreshJobLayers()
  fitToInitialJobsOnce()
}

// Rebuilding every marker/popup (and the remote-jobs overlay's whole
// country-boundary polygon) is expensive enough to visibly stutter typing
// in the search box, which narrows `jobs` on every keystroke -- so the
// watcher below coalesces a rapid burst of changes into a single rebuild
// once it pauses, instead of rebuilding after every single one.
const JOBS_CHANGE_DEBOUNCE_MS = 200
const debouncedSyncMapForJobsChange = debounce(syncMapForJobsChange, JOBS_CHANGE_DEBOUNCE_MS)

const flyToJob = (jobId: string): void => {
  mapProvider.flyToJob(jobId)
}

defineExpose({ flyToJob, toggleViewMode })

onMounted(() => {
  if (!mapContainer.value) return

  mapProvider.init(mapContainer.value, {
    initialView: props.initialView ?? null,
    buildPopupContent,
    onBoundsChanged: (bounds) => { emit('bounds-changed', bounds); },
    onViewChanged: (view) => { emit('view-changed', view); },
    onMarkerClick: (jobs) => { emit('marker-click', jobs); },
    onFatalError: (err) => {
      console.error('Map failed to initialize.', err)
      mapError.value = 'The map could not be loaded in this browser.'
    }
  })

  refreshJobLayers()
  void applyViewMode()

  // If jobs are already available at mount time, fit to them now --
  // otherwise the jobs-changed watcher below picks this up once they
  // arrive from the (typically async) initial fetch.
  fitToInitialJobsOnce()

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => { mapProvider.resize(); })
    resizeObserver.observe(mapContainer.value)
  }
})

onUnmounted(() => {
  debouncedSyncMapForJobsChange.cancel()
  resizeObserver?.disconnect()
  mapProvider.destroy()
})

// Not `{ deep: true }`: `jobs`/`remoteJobs` are always new array
// references from upstream `computed()`s (never mutated in place), so a
// shallow watch already sees every change -- deep-comparing every Job
// object inside them on each keystroke would just add unnecessary work.
watch([() => props.jobs, () => props.remoteJobs], debouncedSyncMapForJobsChange)

watch(
  () => props.highlightedJobId,
  (jobId) => { mapProvider.setHighlightedJob(jobId ?? null); }
)
</script>

<template>
  <div class="relative w-full h-full min-h-[300px]">
    <div
      ref="mapContainer"
      role="region"
      aria-label="Interactive map of job locations across Greece. The job list panel provides the same data in text form."
      class="absolute inset-0"
    ></div>

    <div
      v-if="mapError"
      class="absolute inset-0 flex items-center justify-center text-center p-6 bg-(--color-bg) text-(--color-text-2) text-sm"
    >
      {{ mapError }}
    </div>

    <button
      v-else
      type="button"
      class="map-view-toggle absolute top-3 right-3 z-[1000] rounded-lg px-3 py-1.5 text-xs font-semibold shadow-md bg-(--color-bg) text-(--color-text-1) ring-1 ring-inset ring-(--color-divider) cursor-pointer hover:opacity-90"
      :aria-pressed="viewMode === 'heatmap'"
      :title="
        (viewMode === 'markers' ? 'Switch to heatmap view' : 'Switch to marker view') + ' (Alt+H)'
      "
      aria-keyshortcuts="Alt+h"
      @click="toggleViewMode"
    >
      {{ viewMode === 'markers' ? 'Heatmap' : 'Markers' }}
    </button>
  </div>
</template>

<style>
/*
 * maplibre-gl.css's own `.maplibregl-map { position: relative }` rule has
 * the same specificity as Tailwind's `.absolute` utility already on this
 * element (see the template), so which one wins depends on unpredictable
 * bundle/import ordering -- when maplibre-gl.css wins, `inset-0` silently
 * becomes a no-op. Since MapLibre's own children (the canvas etc.) are
 * absolutely positioned, that leaves this container's height at its auto
 * (content) height -- 0, since absolutely positioned children don't
 * contribute to it -- instead of filling its sized parent. `!important`
 * makes this deterministic regardless of import order.
 */
.maplibregl-map {
  position: absolute !important;
  inset: 0;
}

.custom-marker {
  background: none;
  border: none;
}

.marker-pin {
  width: 30px;
  height: 30px;
  border-radius: 50% 50% 50% 0;
  background: #3b82f6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 12px;
  transform: rotate(-45deg);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}

.marker-highlighted .marker-pin {
  transform: rotate(-45deg) scale(1.35);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4);
  z-index: 1000;
}

/*
 * Distinguishes the fixed "remote jobs" marker (placed at the country's
 * center, representing all of Greece) from city-pinned markers.
 */
.marker-pin-remote {
  background: #8b5cf6;
}

.marker-highlighted .marker-pin-remote {
  box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.4);
}

.marker-cluster-custom {
  background: none;
  border: none;
}

.marker-cluster-inner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 13px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.6);
}

.marker-cluster-small {
  background: #34d399;
}

.marker-cluster-medium {
  background: #f59e0b;
}

.marker-cluster-large {
  background: #ef4444;
}

.maplibregl-popup-content {
  border-radius: 8px;
  margin: 0;
  padding: 12px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  max-height: 300px;
  overflow-y: auto;
}

.maplibregl-popup-content strong {
  font-size: 14px;
}

.jobs-list.scrollable {
  max-height: 200px;
  overflow-y: auto;
  margin-top: 8px;
  padding-right: 4px;
}

.jobs-list.scrollable::-webkit-scrollbar {
  width: 6px;
}

.jobs-list.scrollable::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 3px;
}
</style>
