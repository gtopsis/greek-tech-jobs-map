import { describe, it, expect } from 'vitest'
import { buildJobsPopupContent } from '@/utils/jobPopupContent'
import type { Job } from '@/types/types'

const jobAt = (overrides: Partial<Job> = {}): Job => ({
  company: 'Acme',
  title: 'Engineer',
  location: 'Athens',
  techArea: 'Backend',
  url: 'https://x/1',
  ...overrides
})

describe('buildJobsPopupContent', () => {
  it('renders a single job as title/company/location, not a list', () => {
    const job = jobAt({ title: 'Senior Engineer', company: 'Acme', location: 'Athens' })

    const content = buildJobsPopupContent([job])

    expect(content.querySelector('ul')).toBeNull()
    expect(content.querySelector('strong')?.textContent).toBe('Senior Engineer')
    expect(content.querySelector('em')?.textContent).toBe('Athens')
    expect(content.textContent).toContain('Acme')
  })

  it('renders multiple jobs as a count heading plus one <li> per job', () => {
    const jobs = [
      jobAt({ company: 'Acme', title: 'Engineer' }),
      jobAt({ company: 'Beta', title: 'Designer' })
    ]

    const content = buildJobsPopupContent(jobs)

    expect(content.querySelector('strong')?.textContent).toBe('2 jobs')
    const items = content.querySelectorAll('ul.jobs-list li')
    expect(items).toHaveLength(2)
    expect(items[0]!.textContent).toBe('Acme \u2013 Engineer')
    expect(items[1]!.textContent).toBe('Beta \u2013 Designer')
  })

  it('only adds the "scrollable" class once there are more than 15 jobs', () => {
    const fewJobs = Array.from({ length: 15 }, (_, i) => jobAt({ url: `https://x/${i}` }))
    const manyJobs = Array.from({ length: 16 }, (_, i) => jobAt({ url: `https://x/${i}` }))

    expect(buildJobsPopupContent(fewJobs).querySelector('ul')?.className).toBe('jobs-list')
    expect(buildJobsPopupContent(manyJobs).querySelector('ul')?.className).toBe(
      'jobs-list scrollable'
    )
  })

  it('never interprets job data as markup, even if it looks like HTML', () => {
    const maliciousJob = jobAt({
      title: '<img src=x onerror="window.__pwned=true">',
      company: '<strong>Injected</strong>'
    })

    const content = buildJobsPopupContent([maliciousJob])

    expect(content.querySelector('img')).toBeNull()
    expect(content.querySelectorAll('strong')).toHaveLength(1) // only the real title <strong>
    expect(content.textContent).toContain('<strong>Injected</strong>')
  })
})
