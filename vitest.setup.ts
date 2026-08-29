import { vi } from 'vitest'
import { createFakeMapProvider } from '@/mapProviders/testUtils/fakeMapProvider'

// Global test double for the map: no test in this suite should ever
// construct a real MapLibre GL map (jsdom has no WebGL, and a real
// provider would also fetch OpenFreeMap's style JSON over the network).
// See src/mapProviders/testUtils/fakeMapProvider.ts for what this returns,
// and src/composables/useMapProvider.ts for the module being replaced.
//
// Kept as a `vi.fn()` (not a plain arrow function) so individual tests can
// still inspect/reconfigure it via `vi.mocked(useMapProvider)`.
vi.mock('@/composables/useMapProvider', () => ({
  useMapProvider: vi.fn(() => createFakeMapProvider())
}))
