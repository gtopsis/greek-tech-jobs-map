import { Popup, type Marker } from 'maplibre-gl'
import { isMobileViewport } from '@/utils/viewport'

// Roughly mirrors the old Leaflet `popupAnchor: [0, -30]` on a 30px pin
// anchored at its bottom tip -- lifts the popup clear of the pin itself.
const POPUP_OFFSET_PX = 30

// MapLibre's own default (`240px`) is too narrow for most job titles,
// forcing awkward mid-word wraps; capped at `90vw` so it still fits on
// narrow (desktop-only, see isMobileViewport below) viewports.
const POPUP_MAX_WIDTH = 'min(320px, 90vw)'

/**
 * Binds a popup to a marker, except on mobile viewports -- where tapping a
 * marker already expands the bottom sheet to the same job(s) in a much
 * roomier, scrollable view (see the `onMarkerClick` callback passed to
 * clusterLayer.ts/remoteJobsLayer.ts). Binding a popup too would just
 * duplicate that in a small overlay that can visually compete with the
 * sheet. Desktop has no such sheet, so the popup stays the primary
 * at-a-glance affordance there.
 *
 * `buildContent` returns a real DOM element (see utils/jobPopupContent.ts),
 * attached via `setDOMContent` rather than `setHTML` -- no job data (which
 * comes from a third-party spreadsheet) is ever parsed as markup.
 */
export const bindPopupUnlessMobile = (marker: Marker, buildContent: () => HTMLElement): void => {
  if (isMobileViewport()) return
  marker.setPopup(
    new Popup({ offset: POPUP_OFFSET_PX, closeButton: false, maxWidth: POPUP_MAX_WIDTH }).setDOMContent(
      buildContent()
    )
  )
}
