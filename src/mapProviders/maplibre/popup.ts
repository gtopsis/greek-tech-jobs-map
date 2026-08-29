import { Popup, type Marker } from 'maplibre-gl'
import { isMobileViewport } from '@/utils/viewport'

// Roughly mirrors the old Leaflet `popupAnchor: [0, -30]` on a 30px pin
// anchored at its bottom tip -- lifts the popup clear of the pin itself.
const POPUP_OFFSET_PX = 30

/**
 * Binds a popup to a marker, except on mobile viewports -- where tapping a
 * marker already expands the bottom sheet to the same job(s) in a much
 * roomier, scrollable view (see the `onMarkerClick` callback passed to
 * clusterLayer.ts/remoteJobsLayer.ts). Binding a popup too would just
 * duplicate that in a small overlay that can visually compete with the
 * sheet. Desktop has no such sheet, so the popup stays the primary
 * at-a-glance affordance there.
 */
export const bindPopupUnlessMobile = (marker: Marker, buildContent: () => string): void => {
  if (isMobileViewport()) return
  marker.setPopup(new Popup({ offset: POPUP_OFFSET_PX, closeButton: false }).setHTML(buildContent()))
}
