import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import HomeView from '@/views/HomeView.vue'
import JobsMap from '@/components/JobsMap.vue'
import { useMapProvider } from '@/composables/useMapProvider'
import type { FakeMapProvider } from '@/mapProviders/testUtils/fakeMapProvider'

const HEADER_ROWS = Array.from({ length: 5 }, () => ['', '', '', '', ''])

// Job rows are [company, title, location, techArea, url].
const FRONTEND_JOB = [
  'Acme Corp',
  'Senior Frontend Engineer',
  'Athens',
  'Frontend',
  'https://example.com/job/1'
]
const BACKEND_JOB = [
  'Beta Ltd',
  'Backend Engineer',
  'Thessaloniki',
  'Backend',
  'https://example.com/job/2'
]
// Remote listing: has no city to plot, but is a legitimate location value
// (not a data error) -- shown as a nationwide map overlay instead.
const REMOTE_JOB = ['Gamma Inc', 'DevOps Engineer', 'Remote', 'DevOps', 'https://example.com/job/3']

const DEFAULT_JOB_ROWS = [FRONTEND_JOB, BACKEND_JOB, REMOTE_JOB]

const stubJobsResponse = (jobRows: string[][]): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          majorDimension: 'ROWS',
          range: 'Jobs!A1:E100',
          values: [...HEADER_ROWS, ...jobRows]
        })
    })
  )
}

const mountHomeView = async (): Promise<VueWrapper> => {
  const wrapper = mount(HomeView, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

// Grabs the fake MapProviderAdapter instance backing the currently-mounted
// JobsMap (see vitest.setup.ts / fakeMapProvider.ts), so a test can
// reconfigure it (e.g. make `setViewMode` reject) after mounting.
const getLatestFakeMapProvider = (): FakeMapProvider => {
  const results = vi.mocked(useMapProvider).mock.results
  return results[results.length - 1]!.value as FakeMapProvider
}

/**
 * The list defaults to following the map's current viewport ("area"
 * focus). The map itself is a test double here (see vitest.setup.ts) that
 * reports an initial viewport covering the whole globe, so nothing is
 * narrowed out by default -- tests that care about filter/search/notice
 * behavior (not map-viewport narrowing) still opt out via the "Sync list
 * with map view" toggle first, matching what a user unchecking it would
 * do and staying robust if that default viewport ever changes.
 */
const showAllJobs = async (wrapper: VueWrapper): Promise<void> => {
  const toggle = wrapper.findAll('input[type="checkbox"]')[0]!
  await toggle.setValue(false)
  await flushPromises()
}

describe('HomeView', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    stubJobsResponse(DEFAULT_JOB_ROWS)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('mounts without throwing, fetches jobs, and renders the map + job panel', async () => {
    wrapper = await mountHomeView()
    await showAllJobs(wrapper)

    expect(window.fetch).toHaveBeenCalled()
    expect(wrapper.find('.app-shell').exists()).toBe(true)
    expect(wrapper.findAll('article').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('Senior Frontend Engineer')
  })

  it('filters jobs by search query', async () => {
    wrapper = await mountHomeView()
    await showAllJobs(wrapper)

    const searchInput = wrapper.findAll('input[type="search"]')[0]!
    await searchInput.setValue('Backend')
    await flushPromises()

    expect(wrapper.text()).toContain('Backend Engineer')
    expect(wrapper.text()).not.toContain('Senior Frontend Engineer')
  })

  it("updates each filter pill's job count to reflect the search query, regardless of which pills are toggled", async () => {
    wrapper = await mountHomeView()
    await showAllJobs(wrapper)

    expect(wrapper.text()).toContain('Frontend (1)')
    expect(wrapper.text()).toContain('Backend (1)')

    const searchInput = wrapper.findAll('input[type="search"]')[0]!
    await searchInput.setValue('Backend')
    await flushPromises()

    expect(wrapper.text()).toContain('Frontend (0)')
    expect(wrapper.text()).toContain('Backend (1)')
  })

  it("updates each filter pill's job count to reflect the map's current viewport when synced to it", async () => {
    wrapper = await mountHomeView()
    // Default state: synced to the map view ('area' focus) -- do NOT call
    // showAllJobs(), since the whole point is verifying the map narrows
    // the counts while synced.

    const jobsMap = wrapper.findComponent(JobsMap)

    // Athens ~[37.98, 23.73]; Thessaloniki ~[40.64, 22.93] -- this range
    // encloses only Athens (Frontend job), excluding Backend (Thessaloniki).
    await jobsMap.vm.$emit('bounds-changed', { north: 38.5, south: 37.5, east: 24, west: 23 })
    await flushPromises()

    expect(wrapper.text()).toContain('Frontend (1)')
    expect(wrapper.text()).toContain('Backend (0)')

    await jobsMap.vm.$emit('bounds-changed', { north: 41, south: 37, east: 24, west: 22 })
    await flushPromises()

    expect(wrapper.text()).toContain('Frontend (1)')
    expect(wrapper.text()).toContain('Backend (1)')
  })

  it('includes remote jobs in the synced list/counts when the viewport contains the remote marker (not just a city pin)', async () => {
    wrapper = await mountHomeView()
    // Default state: synced to the map view ('area' focus).

    const jobsMap = wrapper.findComponent(JobsMap)

    // Athens ~[37.98, 23.73] and GREECE_CENTER ~[39.07, 21.82] (where the
    // remote-jobs marker is always drawn) both fall within this range;
    // Thessaloniki ~[40.64, 22.93] (Backend) does not.
    await jobsMap.vm.$emit('bounds-changed', { north: 39.5, south: 37.5, east: 24, west: 21.5 })
    await flushPromises()

    expect(wrapper.text()).toContain('Senior Frontend Engineer')
    expect(wrapper.text()).toContain('DevOps Engineer')
    expect(wrapper.text()).not.toContain('Backend Engineer')

    expect(wrapper.text()).toContain('Frontend (1)')
    expect(wrapper.text()).toContain('DevOps (1)')
    expect(wrapper.text()).toContain('Backend (0)')

    // Panning away from GREECE_CENTER (but still over Athens) drops the
    // remote job again, confirming it's genuinely tied to the marker's
    // location rather than always being included once synced.
    await jobsMap.vm.$emit('bounds-changed', { north: 38.5, south: 37.5, east: 24, west: 23 })
    await flushPromises()

    expect(wrapper.text()).toContain('Senior Frontend Engineer')
    expect(wrapper.text()).not.toContain('DevOps Engineer')
    expect(wrapper.text()).toContain('DevOps (0)')
  })

  it('gracefully falls back to markers view if heatmap rendering is unavailable', async () => {
    // Simulates a provider that can't render heatmap mode (e.g. no WebGL
    // support) -- verifies the app degrades gracefully (no crash, button
    // stays reflecting marker view) instead of assuming it always works.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    wrapper = await mountHomeView()
    getLatestFakeMapProvider().setViewMode.mockResolvedValueOnce(false)

    const toggle = wrapper.find('.map-view-toggle')
    expect(toggle.text()).toBe('Heatmap')

    await toggle.trigger('click')
    await flushPromises()

    expect(toggle.text()).toBe('Heatmap')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Heatmap view is unavailable')
    )
  })

  it('requires Alt for the r/h keyboard shortcuts (WCAG 2.1.4: Character Key Shortcuts)', async () => {
    // Reuses the same "provider rejects heatmap mode" signal as the
    // fallback test above, purely to confirm the "h" shortcut actually ran
    // toggleViewMode().
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    wrapper = await mountHomeView()
    getLatestFakeMapProvider().setViewMode.mockResolvedValue(false)

    const fetchCallsBefore = (window.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }))
    await flushPromises()
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', altKey: true }))
    await flushPromises()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Heatmap view is unavailable')
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    await flushPromises()
    expect((window.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsBefore)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', altKey: true }))
    await flushPromises()
    expect((window.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      fetchCallsBefore
    )
  })

  it('persists the map center/zoom in the URL', async () => {
    wrapper = await mountHomeView()

    const params = new URLSearchParams(window.location.search)
    expect(params.has('lat')).toBe(true)
    expect(params.has('lng')).toBe(true)
    expect(params.has('z')).toBe(true)
  })

  it('updates the job-count text live as the map is panned, while synced to the map view', async () => {
    wrapper = await mountHomeView()
    // Default state: synced to the map view ('area' focus) -- do NOT call
    // showAllJobs() here, since the whole point is to verify the count
    // reacts to panning while synced, not just to search/filters.

    const jobsMap = wrapper.findComponent(JobsMap)

    // Athens ~[37.98, 23.73]; Thessaloniki ~[40.64, 22.93] -- this range
    // encloses only Athens (Frontend job).
    await jobsMap.vm.$emit('bounds-changed', { north: 38.5, south: 37.5, east: 24, west: 23 })
    await flushPromises()
    expect(wrapper.text()).toContain('1 job')
    expect(wrapper.text()).not.toContain('2 jobs')

    await jobsMap.vm.$emit('bounds-changed', { north: 41, south: 37, east: 24, west: 22 })
    await flushPromises()
    expect(wrapper.text()).toContain('2 jobs')
  })

  it('surfaces jobs whose location could not be placed on the map', async () => {
    const unmappableJob = [
      'Delta LLC',
      'QA Engineer',
      'Definitely Not A Known City',
      'QA',
      'https://example.com/job/4'
    ]
    stubJobsResponse([...DEFAULT_JOB_ROWS, unmappableJob])

    wrapper = await mountHomeView()
    await showAllJobs(wrapper)

    expect(wrapper.text()).toContain("1 job couldn't be placed on the map")
    expect(wrapper.text()).toContain('Definitely Not A Known City')
  })

  it('surfaces remote jobs as a distinct nationwide overlay, not as an unmappable/error job', async () => {
    wrapper = await mountHomeView()

    expect(wrapper.text()).not.toContain("couldn't be placed on the map")
    expect(wrapper.text()).toContain('1 remote job shown as a nationwide overlay on the map')
  })

  it('clicking a marker narrows the list to that location (point focus), revertible via its pill or by panning', async () => {
    wrapper = await mountHomeView()

    const jobsMap = wrapper.findComponent(JobsMap)
    const athensJob = {
      company: 'Acme Corp',
      title: 'Senior Frontend Engineer',
      location: 'Athens',
      techArea: 'Frontend',
      url: 'https://example.com/job/1'
    }

    await jobsMap.vm.$emit('marker-click', [athensJob])
    await flushPromises()

    expect(wrapper.text()).toContain('Senior Frontend Engineer')
    expect(wrapper.text()).not.toContain('Backend Engineer')
    const locationPill = wrapper.find('[aria-label="Reset to the default map view"]')
    expect(locationPill.exists()).toBe(true)
    expect(locationPill.text()).toContain('Athens')

    await locationPill.trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="Reset to the default map view"]').exists()).toBe(false)

    await jobsMap.vm.$emit('marker-click', [athensJob])
    await flushPromises()
    expect(wrapper.find('[aria-label="Reset to the default map view"]').exists()).toBe(true)

    await jobsMap.vm.$emit('bounds-changed', { north: 41, south: 40, east: 23, west: 22 })
    await flushPromises()
    expect(wrapper.find('[aria-label="Reset to the default map view"]').exists()).toBe(false)
  })

  it('selecting a marker while sync is off has no effect until sync is turned back on', async () => {
    wrapper = await mountHomeView()
    await showAllJobs(wrapper) // sync off ("all jobs")

    const jobsMap = wrapper.findComponent(JobsMap)
    const athensJob = {
      company: 'Acme Corp',
      title: 'Senior Frontend Engineer',
      location: 'Athens',
      techArea: 'Frontend',
      url: 'https://example.com/job/1'
    }

    await jobsMap.vm.$emit('marker-click', [athensJob])
    await flushPromises()

    // Still shows every job -- the marker was remembered, but sync being
    // off means it doesn't narrow the list yet.
    expect(wrapper.text()).toContain('Senior Frontend Engineer')
    expect(wrapper.text()).toContain('Backend Engineer')

    const syncToggle = wrapper.findAll('input[type="checkbox"]')[0]!
    await syncToggle.setValue(true)
    await flushPromises()

    expect(wrapper.text()).toContain('Senior Frontend Engineer')
    expect(wrapper.text()).not.toContain('Backend Engineer')
  })
})
