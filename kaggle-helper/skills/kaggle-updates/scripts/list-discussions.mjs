// List Kaggle discussion topics of a competition, most recently active first, as JSON
// Usage:
//   playwright-cli goto "https://www.kaggle.com/competitions/<slug>/discussion#since=<ISO 8601 の日時か YYYY-MM-DD>"
//   playwright-cli run-code --filename=list-discussions.mjs
//
// 開いているページの URL からコンペの slug と since を読み、最終活動 (投稿または最後のコメント) が
// since より古いトピックだけのページに達するまでページを送る。since が無ければ 7 日前とする。
// hotVotes は、votes 順で 20 位のトピックの votes (ピン留めを除く。20 件に満たなければ null)
//
// 一覧のページを開くと、ページが GetTopicListByForumId API でトピックの一覧を取得する。
// その応答の JSON から読む。応答に一覧が無ければページの終わり。

async (page) => {
  const MAX_PAGES = 10
  const HOT_RANK = 20
  const current = new URL(page.url())
  const slug = current.pathname.match(/^\/competitions\/([^/]+)/)?.[1]
  if (!slug) return JSON.stringify({ error: "not_competition_page", url: page.url() })

  // since は list.py が時差付きの ISO 8601 で渡す。日付だけならローカル時刻の 0 時とする
  const sinceArg = decodeURIComponent(current.hash.match(/since=([^&]+)/)?.[1] ?? "")
  const since = !sinceArg
    ? new Date(Date.now() - 7 * 86400 * 1000)
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(sinceArg) ? `${sinceArg}T00:00:00` : sinceArg)
  if (isNaN(since)) return JSON.stringify({ error: "invalid_since", since: sinceArg })
  const base = `https://www.kaggle.com/competitions/${slug}/discussion`

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

  // 一覧の 1 ページを開き、ページが受け取ったトピックを返す。応答が無ければ例外
  const readPage = async (url) => {
    const { topics = [] } = await fetchListing(url, "GetTopicListByForumId")
    return topics.map(t => {
      // lastCommentPostDate はコメントの無いトピックでは投稿日時になる
      const activityAt = t.lastCommentPostDate || t.postDate
      return {
        id: t.id,
        title: t.title.trim(),
        url: "https://www.kaggle.com" + t.topicUrl,
        votes: t.votes || 0,
        comments: t.commentCount || 0,
        activity: t.commentCount ? "comment" : "posted",
        activityAt: activityAt ? new Date(activityAt).toISOString() : null,
        pinned: !!t.isSticky,
        byAdmin: t.authorType === "ADMIN",
      }
    })
  }

  try {
    const topics = new Map()
    let truncated = true
    for (let p = 1; p <= MAX_PAGES; p++) {
      const items = await readPage(`${base}?sort=recent-comments&page=${p}`)
      if (items.length === 0) {
        truncated = false
        break
      }
      for (const t of items) if (!topics.has(t.id)) topics.set(t.id, t)

      // ピン留めは活動時刻に関係なく先頭に並ぶため、打ち切りの判定から除く
      const unpinned = items.filter(t => !t.pinned && t.activityAt)
      if (unpinned.length === 0 || unpinned.every(t => new Date(t.activityAt) < since)) {
        truncated = false
        break
      }
    }

    // ピン留めは votes 順でも先頭に並ぶため除く
    let top = []
    for (let p = 1; p <= 3 && top.length < HOT_RANK; p++) {
      const items = await readPage(`${base}?sort=votes&page=${p}`)
      if (items.length === 0) break
      top.push(...items.filter(t => !t.pinned).map(t => t.votes))
    }
    top = top.slice(0, HOT_RANK)
    // 20 件に満たないコンペは盛り上がっているとはいえないので、水準を置かない
    const hotVotes = top.length >= HOT_RANK ? Math.min(...top) : null

    const result = [...topics.values()]
      .filter(t => t.activityAt && new Date(t.activityAt) >= since)
      .sort((a, b) => b.activityAt.localeCompare(a.activityAt))
    return JSON.stringify({ slug, since: since.toISOString(), truncated, hotVotes, topics: result })
  } catch (e) {
    return JSON.stringify({ error: "listing_failed", url: page.url(), message: String(e).slice(0, 300) })
  }
}
