// List public notebooks of a Kaggle competition, most recently run first, as JSON
// Usage:
//   playwright-cli goto "https://www.kaggle.com/competitions/<slug>/code#since=YYYY-MM-DD"
//   playwright-cli run-code --filename=list-notebooks.mjs
//
// 開いているページの URL からコンペの slug と since を読み、Code タブを Recently Run の順に
// since より古い notebook だけのページに達するまで送る。since が無ければ 7 日前とする。
// - hotVotes: votes 順で 20 位の notebook の votes (20 件に満たなければ null)
// - scoreOrder: 良いスコアの向き。並べ替えで "Public Score" を選んだときの sortBy から判断する
//   ("ascending" は小さいほうが良い)。判断できなければ null
//
// 一覧のページを開くと、ページが ListKernels API で notebook の一覧を取得する。
// その応答の JSON から読む。応答に一覧が無ければページの終わり。
// 応答は値が 0 や未設定のフィールドを省くので、votes とコメント数は無ければ 0、スコアは null とする。

async (page) => {
  const MAX_PAGES = 15
  const HOT_RANK = 20
  const current = new URL(page.url())
  const slug = current.pathname.match(/^\/competitions\/([^/]+)/)?.[1]
  if (!slug) return JSON.stringify({ error: "not_competition_page", url: page.url() })

  const sinceArg = current.hash.match(/since=(\d{4}-\d{2}-\d{2})/)?.[1]
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00`) : new Date(Date.now() - 7 * 86400 * 1000)
  const base = `https://www.kaggle.com/competitions/${slug}/code`

  // ページが API に送ったリクエストを横取りして Playwright から送り、応答の本文を受け取る。
  // ページは応答を受け取った直後に URL を書き換えるため、ブラウザから応答の本文を読むと失敗することがある
  const fetchListing = async (url, api) => {
    let received
    const body = new Promise(resolve => { received = resolve })
    const handler = async route => {
      const response = await route.fetch()
      received(await response.json())
      await route.fulfill({ response }).catch(() => {})
    }
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no ${api} response: ${url}`)), 30000)
    })
    await page.route(new RegExp(`/${api}$`), handler)
    try {
      await page.goto(url)
      return await Promise.race([body, timeout])
    } finally {
      clearTimeout(timer)
      await page.unroute(new RegExp(`/${api}$`), handler)
    }
  }

  // 一覧の 1 ページを開き、ページが受け取った notebook を返す。応答が無ければ例外
  const readPage = async (url) => {
    const { kernels = [] } = await fetchListing(url, "ListKernels")
    return kernels.map(k => {
      const ref = `${k.author.userName}/${k.currentUrlSlug}`
      return {
        ref,
        title: k.title.trim(),
        url: `https://www.kaggle.com/code/${ref}`,
        votes: k.totalVotes || 0,
        comments: k.totalComments || 0,
        score: k.bestPublicScore ?? null,
        runAt: k.lastRunTime ? new Date(k.lastRunTime).toISOString() : null,
      }
    })
  }

  try {
    const notebooks = new Map()
    let truncated = true
    for (let p = 1; p <= MAX_PAGES; p++) {
      const items = await readPage(`${base}?sortBy=dateRun&page=${p}`)
      if (items.length === 0) {
        truncated = false
        break
      }
      for (const n of items) if (!notebooks.has(n.ref)) notebooks.set(n.ref, n)
      if (items.every(n => n.runAt && new Date(n.runAt) < since)) {
        truncated = false
        break
      }
    }

    const top = (await readPage(`${base}?sortBy=voteCount`)).map(n => n.votes).slice(0, HOT_RANK)
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
  } catch (e) {
    return JSON.stringify({ error: "listing_failed", url: page.url(), message: String(e).slice(0, 300) })
  }
}
