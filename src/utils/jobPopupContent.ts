import type { Job } from '@/types/types'

const MANY_JOBS_SCROLL_THRESHOLD = 15

/**
 * Builds the DOM content shown inside a map marker's popup: a single
 * job's title/company/location, or -- when a pin/cluster represents more
 * than one job -- a count plus a bulleted list of every job there.
 *
 * Returns a real DOM element (built via `createElement`/`textContent`,
 * never HTML strings) so job data -- which comes from a third-party
 * spreadsheet, not code this app controls -- can never be misinterpreted
 * as markup, and MapLibre's `Popup.setDOMContent` can attach it directly
 * (see mapProviders/maplibre/popup.ts).
 */
export const buildJobsPopupContent = (jobs: readonly Job[]): HTMLElement => {
  const root = document.createElement('div')

  if (jobs.length === 1) {
    root.append(...buildSingleJobContent(jobs[0]!))
    return root
  }

  root.append(buildJobsCountHeading(jobs.length), buildJobsList(jobs))
  return root
}

const buildSingleJobContent = (job: Job): Node[] => {
  const title = document.createElement('strong')
  title.textContent = job.title

  const location = document.createElement('em')
  location.textContent = job.location

  return [
    title,
    document.createElement('br'),
    document.createTextNode(job.company),
    document.createElement('br'),
    location
  ]
}

const buildJobsCountHeading = (count: number): HTMLElement => {
  const heading = document.createElement('strong')
  heading.textContent = `${count} jobs`
  return heading
}

const buildJobsList = (jobs: readonly Job[]): HTMLElement => {
  const list = document.createElement('ul')
  list.className = jobs.length > MANY_JOBS_SCROLL_THRESHOLD ? 'jobs-list scrollable' : 'jobs-list'

  for (const job of jobs) {
    const item = document.createElement('li')
    item.textContent = `${job.company} \u2013 ${job.title}`
    list.appendChild(item)
  }

  return list
}
