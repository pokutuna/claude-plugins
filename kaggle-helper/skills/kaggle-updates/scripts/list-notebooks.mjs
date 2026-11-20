// List public notebooks of a Kaggle competition, most recently run first, as JSON
// Usage:
//   playwright-cli open "https://www.kaggle.com/competitions/<slug>/code#since=YYYY-MM-DD"
//   playwright-cli run-code --filename=list-notebooks.mjs
//
// 開いているページの URL からコンペの slug と since を読み、Code タブを Recently Run の順に
// since より古い notebook だけのページに達するまで送る。since が無ければ 7 日前とする。
// - hotVotes: votes 順で 20 位の notebook の votes (20 件に満たなければ null)
// - scoreOrder: 良いスコアの向き。並べ替えで "Public Score" を選んだときの sortBy から判断する
//   ("ascending" は小さいほうが良い)。判断できなければ null

async (page) => {
  const MAX_PAGES = 15
  const HOT_RANK = 20
  const current = new URL(page.url())
  const slug = current.pathname.match(/^\/competitions\/([^/]+)/)?.[1]
  if (!slug) return JSON.stringify({ error: "not_competition_page", url: page.url() })

  const sinceArg = current.hash.match(/since=(\d{4}-\d{2}-\d{2})/)?.[1]
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00`) : new Date(Date.now() - 7 * 86400 * 1000)
  const base = `https://www.kaggle.com/competitions/${slug}/code`

  // 一覧の 1 ページを読む。notebook の無いページなら null
  const readPage = async (url) => {
    await page.goto(url)
    try {
      await page.locator('li a[href^="/code/"]').first().waitFor({ timeout: 15000 })
    } catch {
      return null
    }
    await page.waitForTimeout(1000)
    return page.evaluate(() => {
      return [...document.querySelectorAll("li")].flatMap(li => {
        const link = li.querySelector('a[href^="/code/"]')
        if (!link || !/Updated/.test(li.innerText)) return []
        const ref = link.getAttribute("href").split("/").slice(2, 4).join("/")
        const time = [...li.querySelectorAll("[title]")]
          .map(e => e.getAttribute("title"))
          .find(t => /GMT/.test(t)) || ""
        const runAt = new Date(time.replace(/\s*\(.*\)$/, ""))
        const score = li.innerText.match(/Score:\s*([-\d.,eE+]+)/)?.[1]
        const votes = [...li.querySelectorAll("[aria-label]")]
          .map(e => e.getAttribute("aria-label").match(/^(-?\d+) votes?$/)?.[1])
          .find(Boolean)
        return [{
          ref,
          title: link.getAttribute("aria-label") || li.innerText.split("\n")[0].trim(),
          url: `https://www.kaggle.com/code/${ref}`,
          votes: Number(votes || 0),
          comments: Number(li.innerText.match(/(\d+) comments?/)?.[1] || 0),
          score: score ? Number(score.replace(/,/g, "")) : null,
          runAt: isNaN(runAt) ? null : runAt.toISOString(),
        }]
      })
    })
  }

  const notebooks = new Map()
  let truncated = true
  for (let p = 1; p <= MAX_PAGES; p++) {
    const items = await readPage(`${base}?sortBy=dateRun&page=${p}`)
    if (!items || items.length === 0) {
      truncated = false
      break
    }
    for (const n of items) if (!notebooks.has(n.ref)) notebooks.set(n.ref, n)
    if (items.every(n => n.runAt && new Date(n.runAt) < since)) {
      truncated = false
      break
    }
  }

  const top = ((await readPage(`${base}?sortBy=voteCount`)) || []).map(n => n.votes).slice(0, HOT_RANK)
  // 20 件に満たないコンペは盛り上がっているとはいえないので、水準を置かない
  const hotVotes = top.length >= HOT_RANK ? Math.min(...top) : null

  // スコアの向きはコンペごとに違う。Kaggle の "Public Score" の並べ替えが選ぶ向きを使う
  let scoreOrder = null
  try {
    await page.getByRole("combobox", { name: /Select Sort/ }).click()
    await page.getByRole("option", { name: /Public Score/ }).click()
    await page.waitForURL(/sortBy=score/, { timeout: 10000 })
    scoreOrder = /sortBy=scoreDescending/.test(page.url()) ? "descending" : "ascending"
  } catch {}

  const result = [...notebooks.values()]
    .filter(n => n.runAt && new Date(n.runAt) >= since)
    .sort((a, b) => b.runAt.localeCompare(a.runAt))
  return JSON.stringify({ slug, since: since.toISOString(), truncated, hotVotes, scoreOrder, notebooks: result })
}
