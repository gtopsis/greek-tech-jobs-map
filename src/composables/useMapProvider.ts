import { createMaplibreMapProvider } from '@/mapProviders/maplibre/maplibreMapProvider'
import type { MapProviderAdapter } from '@/mapProviders/types'

/**
 * Returns a fresh `MapProviderAdapter` instance for a single map (each
 * mounted JobsMap.vue needs its own, since a provider owns one map
 * container's worth of state). To point the app at a different map
 * library, swap this import for a different factory satisfying
 * `MapProviderAdapter` (see src/mapProviders/types.ts) -- that's the only
 * other place this gets wired to a concrete implementation.
 */
export const useMapProvider = (): MapProviderAdapter => createMaplibreMapProvider()
