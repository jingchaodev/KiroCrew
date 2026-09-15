/**
 * Screenshot harness for the Overview TODAY card and its `?view=today` drill-in.
 *
 * Seeds what the card reads -- live slots active today (redux, via
 * /api/chat/slots), archived rows modified today (/api/sessions), folders, a
 * day file in the shape `append_history` writes (/api/memory/history?date=),
 * and the consolidation setting -- and asserts in the REAL built SPA
 * (website/dist) that:
 *
 *   1. the summary card states the active-session count and the folder chips,
 *   2. the drill-in lists the sessions grouped by folder, and
 *   3. the day file's entries render newest first beside them.
 *
 * Dark + light shots of both views land in temp-screenshots/overview-today-card/
 * (the sanctioned PR-screenshot location). Nothing in CI runs this file; the
 * CI-enforced halves are the vitest suites (todayActivity.test.ts,
 * TodayTab.test.tsx, OverviewPage.test.tsx) and the backend history tests.
 *
 * Usage: node scripts/capture-overview-today-card.mjs [outDir]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { serveDist } from './lib/serve-dist.mjs'
import { logPageProblems, stubDashboardApi, json } from './lib/stub-dashboard-api.mjs'

const OUT = process.argv[2] || '../temp-screenshots/overview-today-card'
mkdirSync(OUT, { recursive: true })

const nowSec = Math.floor(Date.now() / 1000)
const ago = (minutes) => nowSec - minutes * 60
const isoAgo = (minutes) => new Date(ago(minutes) * 1000).toISOString()
const localDateKey = (d) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const TODAY = localDateKey(new Date())

const folders = [
  { id: 'f-crew', name: 'KiroCrew', order: 0, collapsed: false },
  { id: 'f-planner', name: 'Planner', order: 1, collapsed: false },
]

const slotBase = {
  agent: 'kirocrew',
  memory_mode: 'persistent',
  project: '/home/user/workspace/notes',
  source_links: [],
  source_links_total: 0,
}

const slots = [
  { ...slotBase, key: 'chat-today-1', title: 'Overview "Today" card goal loop', running: true, messages: 41, last_turn_ts: isoAgo(3), folder_id: 'f-crew' },
  { ...slotBase, key: 'chat-today-2', title: 'Retry timeout on the chat endpoint', running: false, messages: 28, last_turn_ts: isoAgo(140), folder_id: 'f-planner' },
  { ...slotBase, key: 'chat-today-3', title: 'Cron timezone question', running: false, messages: 6, last_turn_ts: isoAgo(210), folder_id: '' },
]

const archived = {
  sessions: [
    { key: 'chat-old-1', title: 'Babysit the open PR set', modified: ago(80), created: isoAgo(300), messages: 12, folder_id: 'f-crew', memory_mode: 'persistent' },
    // Yesterday: must NOT appear.
    { key: 'chat-yday', title: 'Yesterday only', modified: nowSec - 30 * 3600, created: isoAgo(2000), messages: 4, folder_id: 'f-crew', memory_mode: 'persistent' },
  ],
  has_more: false,
}

const historyDoc =
  `# ${TODAY}\n\n`
  + '#### 07:58 PDT\nAnswered the cron timezone question: job timezone, else the global config timezone, else UTC.\n\n'
  + '#### 09:12 PDT\nRebased the Bedrock KB PR after upstream drift; one allowlist conflict, both entries kept, gates green.\n'

const failures = []
function expect(cond, label) {
  if (!cond) failures.push(label)
}

async function stub(page, theme) {
  await stubDashboardApi(page, {
    theme,
    slots,
    folders,
    extra: async (path, route) => {
      const url = new URL(route.request().url())
      if (path === '/api/sessions') return json(route, archived), true
      if (path === '/api/memory/history') {
        expect(url.searchParams.get('date') === TODAY, `${theme}: history read must carry the browser-local date (${url.search})`)
        return json(route, { content: historyDoc, content_redacted: false }), true
      }
      if (path === '/api/memory/settings') return json(route, { history_idle_hours: 3, history_max_days: 90, migrated: true }), true
      if (path === '/api/status') {
        return json(route, { sessions: slots.length, messages: 2431, cron_jobs: 3, subagents: 0, lessons: 560, uptime: 3 * 86400 + 4 * 3600, version: '0.6.1' }), true
      }
      if (path.startsWith('/api/wakatime/stats')) return json(route, { configured: false }), true
      if (path === '/api/usage/kiro') {
        // Sibling card only; the shape the ACP adapter's fetchUsage maps.
        const bucket = (sessions, messages) => ({ sessions, messages, tool_calls: 0 })
        return json(route, {
          sessions: {
            total_sessions: 3,
            today: bucket(2, 41),
            this_week: bucket(3, 75),
            this_month: bucket(3, 75),
            avg_msgs_per_session: 25,
            daily_history: [],
          },
          billing: {},
        }), true
      }
      return false
    },
  })
}

async function shoot(browser, base, theme) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
  logPageProblems(page)
  await stub(page, theme)

  await page.goto(`${base}/settings/overview`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const card = page.getByTestId('overview-today-card')
  expect(await card.count() === 1, `${theme}: the Today summary card must render on the landing view`)
  const cardText = await card.innerText()
  expect(cardText.includes('4 sessions active today'), `${theme}: card must count the 4 sessions active today (got: ${cardText.slice(0, 120)})`)
  expect(cardText.includes('1 running') && !cardText.includes('{{'), `${theme}: card must interpolate the running count (got: ${cardText.slice(0, 120)})`)
  expect(cardText.includes('KiroCrew') && cardText.includes('Planner'), `${theme}: card must show one chip per folder`)
  expect(cardText.includes('2 saved to memory'), `${theme}: card must count the day file's entries`)
  expect(!cardText.includes('Yesterday only'), `${theme}: yesterday's row must not leak into today`)
  // The sibling Usage card names its basis so the two "today" counts read as
  // different sets rather than a disagreement.
  const pageText = await page.locator('body').innerText()
  expect(pageText.includes('2 sessions started'), `${theme}: the Usage card must say its sessions are the ones STARTED today`)
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/today-card-${theme}.png` })

  await page.getByTestId('overview-today-open').click()
  await page.waitForTimeout(1200)
  const tab = page.getByTestId('today-tab')
  expect(await tab.count() === 1, `${theme}: clicking View details must open the Today drill-in`)
  const body = await tab.innerText()
  for (const title of ['Overview "Today" card goal loop', 'Babysit the open PR set', 'Retry timeout on the chat endpoint', 'Cron timezone question']) {
    expect(body.includes(title), `${theme}: drill-in must list "${title}"`)
  }
  expect(!body.includes('Yesterday only'), `${theme}: drill-in must not list yesterday's row`)
  expect(body.includes('Unfiled'), `${theme}: the unfiled group must be labelled`)
  expect(body.indexOf('09:12 PDT') < body.indexOf('07:58 PDT'), `${theme}: memory entries must render newest first`)
  expect(page.url().includes('view=today'), `${theme}: the drill-in must be URL-backed`)
  await page.screenshot({ path: `${OUT}/today-drillin-${theme}.png` })
  await page.close()
}

async function main() {
  const { srv, base } = await serveDist()
  const browser = await chromium.launch()
  try {
    await shoot(browser, base, 'dark')
    await shoot(browser, base, 'light')
  } finally {
    await browser.close()
    srv.close()
  }
  if (failures.length) {
    console.error('FAILURES:')
    for (const f of failures) console.error(' -', f)
    process.exit(1)
  }
  console.log('OK — 4 screenshots in', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
