// List Kaggle discussion topics of a competition, most recently active first, as JSON
// Usage:
//   playwright-cli open "https://www.kaggle.com/competitions/<slug>/discussion#since=YYYY-MM-DD"
//   playwright-cli run-code --filename=list-discussions.mjs
//
// 開いているページの URL からコンペの slug と since を読み、最終活動 (投稿または最後のコメント) が
// since より古いトピックだけのページに達するまでページを送る。since が無ければ 7 日前とする

async (page) => {
  const MAX_PAGES = 10
  const current = new URL(page.url())
  const slug = current.pathname.match(/^\/competitions\/([^/]+)/)?.[1]
  if (!slug) return JSON.stringify({ error: "not_competition_page", url: page.url() })

  const sinceArg = current.hash.match(/since=(\d{4}-\d{2}-\d{2})/)?.[1]
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00`) : new Date(Date.now() - 7 * 86400 * 1000)

  const topics = new Map()
  let truncated = true
  for (let p = 1; p <= MAX_PAGES; p++) {
    await page.goto(`https://www.kaggle.com/competitions/${slug}/discussion?sort=recent-comments&page=${p}`)
    const rows = page.locator('li a[href*="/discussion/"]')
    try {
      await rows.first().waitFor({ timeout: 15000 })
    } catch {
      truncated = false // トピックの無いページ = 最後のページを過ぎた
      break
    }

    const items = await page.evaluate(() => {
      const isTopicLink = a => /\/discussion\/\d+$/.test(a.getAttribute("href") || "")
      return [...document.querySelectorAll("li")].flatMap(li => {
        const link = [...li.querySelectorAll('a[href*="/discussion/"]')].find(isTopicLink)
        if (!link) return []
        const lines = link.innerText.split("\n").map(l => l.trim()).filter(Boolean)
        const time = li.querySelector("span[title]")?.getAttribute("title") || ""
        const activityAt = new Date(time.replace(/\s*\(.*\)$/, ""))
        return [{
          id: Number(link.getAttribute("href").match(/\d+$/)[0]),
          title: lines.find(l => l !== "push_pin") || "",
          url: "https://www.kaggle.com" + link.getAttribute("href"),
          votes: parseInt(li.querySelector('[aria-label$="votes"]')?.textContent || "0", 10) || 0,
          comments: Number(li.innerText.match(/(\d+) comments?/)?.[1] || 0),
          activity: /Last comment/.test(li.innerText) ? "comment" : "posted",
          activityAt: isNaN(activityAt) ? null : activityAt.toISOString(),
          pinned: lines.includes("push_pin"),
        }]
      })
    })

    for (const t of items) if (!topics.has(t.id)) topics.set(t.id, t)

    // ピン留めは活動時刻に関係なく先頭に並ぶため、打ち切りの判定から除く
    const unpinned = items.filter(t => !t.pinned && t.activityAt)
    if (unpinned.length === 0 || unpinned.every(t => new Date(t.activityAt) < since)) {
      truncated = false
      break
    }
  }

  const result = [...topics.values()]
    .filter(t => t.activityAt && new Date(t.activityAt) >= since)
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt))
  return JSON.stringify({ slug, since: since.toISOString(), truncated, topics: result })
}
