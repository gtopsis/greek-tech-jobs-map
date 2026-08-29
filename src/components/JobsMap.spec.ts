import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import JobsMap from '@/components/JobsMap.vue'
import { useMapProvider } from '@/composables/useMapProvider'
import type { FakeMapProvider } from '@/mapProviders/testUtils/fakeMapProvider'
import type { Job } from '@/types/types'

const jobAt = (location: string, url: string): Job => ({
  company: 'Acme',
  title: 'Engineer',
  location,
  techArea: 'Backend',
  url
})

const ATHENS_JOB = jobAt('Athens', 'https://x/1')
const THESSALONIKI_JOB = jobAt('Thessaloniki', 'https://x/2')

// Matches JobsMap.vue's JOBS_CHANGE_DEBOUNCE_MS: the jobs/remoteJobs watcher
// debounces its (expensive) map rebuild, so tests that change `jobs` via
// `setProps` need to wait this long afterwards to see its effect.
const awaitJobsChangeDebounce = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 250))

// JobsMap.vue depends only on `useMapProvider()` (globally mocked in
// vitest.setup.ts to return a fresh `createFakeMapProvider()` per call --
// see fakeMapProvider.ts), so these tests assert against that fake instead
// of any real map library. Grabs the instance the most recently mounted
// JobsMap actually received.
const getLatestFakeProvider = (): FakeMapProvider => {
  const results = vi.mocked(useMapProvider).mock.results
  return results[results.length - 1]!.value as FakeMapProvider
}

describe('JobsMap', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.clearAllMocks()
  })

  it('fits the viewport to the initial jobs exactly once, not again on every subsequent jobs change', async () => {
    wrapper = mount(JobsMap, {
      props: { jobs: [ATHENS_JOB, THESSALONIKI_JOB] }
    })
    await wrapper.vm.$nextTick()

    const provider = getLatestFakeProvider()
    expect(provider.fitToJobs).toHaveBeenCalledTimes(1)

    // Simulates what happens when the user toggles a tech-area filter or
    // types a search query while synced to the map: `jobs` narrows, but
    // the viewport must NOT reset/zoom out because of it.
    await wrapper.setProps({ jobs: [ATHENS_JOB] })
    await awaitJobsChangeDebounce()

    expect(provider.fitToJobs).toHaveBeenCalledTimes(1)

    // Narrowing further (e.g. a search query matching nothing) must not
    // trigger a fit either.
    await wrapper.setProps({ jobs: [] })
    await awaitJobsChangeDebounce()

    expect(provider.fitToJobs).toHaveBeenCalledTimes(1)
  })

  it('never auto-fits when a persisted initial view is provided', async () => {
    wrapper = mount(JobsMap, {
      props: {
        jobs: [ATHENS_JOB, THESSALONIKI_JOB],
        initialView: { lat: 38, lng: 23, zoom: 10 }
      }
    })
    await wrapper.vm.$nextTick()

    const provider = getLatestFakeProvider()
    expect(provider.fitToJobs).not.toHaveBeenCalled()

    await wrapper.setProps({ jobs: [ATHENS_JOB] })
    await awaitJobsChangeDebounce()

    expect(provider.fitToJobs).not.toHaveBeenCalled()
  })

  it('falls back to markers view if the provider reports heatmap mode as unsupported', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    wrapper = mount(JobsMap, { props: { jobs: [ATHENS_JOB] } })
    await wrapper.vm.$nextTick()

    const provider = getLatestFakeProvider()
    provider.setViewMode.mockResolvedValueOnce(false)

    const toggle = wrapper.find('.map-view-toggle')
    expect(toggle.text()).toBe('Heatmap')

    await toggle.trigger('click')
    await flushMicrotasks()

    expect(toggle.text()).toBe('Heatmap')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Heatmap view is unavailable')
    )
    // Reverts by explicitly asking the provider for 'markers' again.
    expect(provider.setViewMode).toHaveBeenLastCalledWith('markers')
  })

  it('shows a fallback message instead of the toggle button if the map fails to initialize', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    wrapper = mount(JobsMap, { props: { jobs: [ATHENS_JOB] } })
    await wrapper.vm.$nextTick()

    const provider = getLatestFakeProvider()
    provider.getInitOptions().onFatalError(new Error('no WebGL'))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.map-view-toggle').exists()).toBe(false)
    expect(wrapper.text()).toContain('could not be loaded')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
