import type { Map as MaplibreMap } from 'maplibre-gl'

// OpenFreeMap's hosted vector styles: free, unlimited, no API key (see
// https://openfreemap.org). "positron" and "dark" are two of their default
// styles, chosen to match the light/dark aesthetic this app previously got
// from CARTO's light_all/dark_all raster basemaps.
const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false

const styleUrlFor = (isDark: boolean): string => (isDark ? DARK_STYLE_URL : LIGHT_STYLE_URL)

/**
 * Manages which OpenFreeMap style (light/dark) is loaded, following the
 * OS/browser's `prefers-color-scheme`, and notifies `onStyleLoad` every
 * time a style finishes loading -- both the very first one (at map
 * creation) and every subsequent one triggered by a scheme change.
 *
 * This notification matters because MapLibre's `setStyle` replaces the
 * entire style document: any source/layer this app added at runtime (job
 * clusters, heatmap, remote-jobs boundary) that isn't part of the newly
 * fetched style JSON gets diffed away. `onStyleLoad` is the single hook
 * the rest of the maplibre provider uses to re-add everything after that
 * happens, instead of scattering that concern across every layer module.
 */
export const createStyleSwitcher = () => {
  const initialStyleUrl = styleUrlFor(prefersDark())

  const attachTo = (map: MaplibreMap, onStyleLoad: (map: MaplibreMap) => void): (() => void) => {
    map.on('style.load', () => { onStyleLoad(map); })

    const darkModeQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null

    const handleChange = (event: MediaQueryListEvent): void => {
      map.setStyle(styleUrlFor(event.matches))
    }
    darkModeQuery?.addEventListener('change', handleChange)

    return () => darkModeQuery?.removeEventListener('change', handleChange)
  }

  return { initialStyleUrl, attachTo }
}
