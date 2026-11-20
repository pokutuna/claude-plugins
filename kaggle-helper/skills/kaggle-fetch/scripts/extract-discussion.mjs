// Extract a Kaggle Discussion page, or the comments page of a notebook, to Markdown
// Usage: playwright-cli run-code --filename=extract-discussion.mjs

async (page) => {
  // コメントは遅延読み込みされ、返信は折りたたまれている。
  // 件数が増えなくなるまで、末尾へのスクロールと「N more replies」の展開を繰り返す。
  // 500 件を超えて読み込むとページがクラッシュして何も取れなくなるため、上限で打ち切る
  const MAX_COMMENTS = 300
  // discussion はトピックの見出し、notebook の comments ページはコメント欄の描画を待つ。
  // コメントが 0 件でも描画されるため、これ以降は件数 0 を「コメントが無い」と判断できる
  await page
    .locator('[data-testid="discussions-topic-header"], [data-testid="notebook-detail-render-tid"]')
    .first()
    .waitFor({ timeout: 30000 })
  const comments = page.locator('[data-testid="discussions-comment"]')
  let prev = -1
  let stable = 0
  while (stable < 3 && prev < MAX_COMMENTS) {
    const more = page.locator("button", { hasText: /more repl/i })
    while (await more.count() > 0) {
      await more.first().click()
      await page.waitForTimeout(300)
    }
    // 0 件のときに最後のコメントへスクロールすると、要素の出現を 30 秒待ってタイムアウトする
    if (await comments.count() > 0) {
      await comments.last().scrollIntoViewIfNeeded()
    } else {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    }
    await page.waitForTimeout(1500)
    const n = await comments.count()
    stable = n === prev ? stable + 1 : 0
    prev = n
  }
  const truncated = stable < 3

  await page.addScriptTag({ url: "https://unpkg.com/turndown/dist/turndown.js" })

  const result = await page.evaluate((truncated) => {
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })

    function findBodyDiv(container) {
      const divs = [...container.querySelectorAll("div")]
      return divs.reverse().find(d => {
        const hasContent = d.querySelector(":scope > p, :scope > pre, :scope > ul, :scope > ol, :scope > blockquote, :scope > h1, :scope > h2, :scope > h3, :scope > h4")
        if (!hasContent) return false
        const t = d.textContent.trim()
        return !t.startsWith("Posted") && !t.includes("arrow_drop_up")
      })
    }

    function convertBody(container) {
      const el = findBodyDiv(container)
      if (!el) return ""
      const clone = el.cloneNode(true)
      clone.querySelectorAll("button").forEach(e => e.remove())
      clone.querySelectorAll("span").forEach(s => {
        if (s.textContent.trim() === "content_copy") s.remove()
      })
      return td.turndown(clone.innerHTML)
    }

    function parseMeta(el) {
      const aLink = el.querySelector('a[aria-label$="\'s profile"]')
      const authorId = aLink?.getAttribute("href")?.replace(/^\//, "") || ""
      const votes = el.querySelector('button[aria-label*="votes"]')?.textContent?.trim() || "0"
      const rank = el.textContent.match(/(\d+)(?:st|nd|rd|th) in this Competition/)?.[1] || ""
      return { authorId, votes, rank }
    }

    function fmtMeta(m) {
      let s = `@${m.authorId}`
      if (m.rank) s += ` (${m.rank}th)`
      if (m.votes !== "0") s += ` [${m.votes} votes]`
      return s
    }

    // Flatten all comments with numbering and reply-to references
    function flattenComments(els) {
      const result = []
      let num = 0

      function visit(el, parentNum) {
        num++
        const meta = parseMeta(el)
        const clone = el.cloneNode(true)
        clone.querySelectorAll('[data-testid="discussions-comment"]').forEach(c => c.remove())
        const body = convertBody(clone)
        const myNum = num
        result.push({ ...meta, body, num: myNum, parentNum })

        const replies = [...el.querySelectorAll('[data-testid="discussions-comment"]')]
          .filter(c => c.parentElement.closest('[data-testid="discussions-comment"]') === el)
        for (const r of replies) visit(r, myNum)
      }

      for (const el of els) visit(el, null)
      return result
    }

    function formatComment(c) {
      let header = `### #${c.num} ${fmtMeta(c)}`
      if (c.parentNum) header += ` → #${c.parentNum}`
      let md = header + "\n\n"
      if (c.body) md += c.body + "\n\n"
      return md
    }

    // --- Topic (notebook の comments ページには無い) ---
    const header = document.querySelector('[data-testid="discussions-topic-header"]')

    // --- Comments ---
    const container =
      document.querySelector('[data-testid="discussion-detail-render-tid"]') ||
      document.querySelector('[data-testid="notebook-detail-render-tid"]')
    const topLevel = container
      ? [...container.querySelectorAll('[data-testid="discussions-comment"]')]
          .filter(c => !c.parentElement.closest('[data-testid="discussions-comment"]'))
      : []

    if (!header && !container) {
      return JSON.stringify("Error: No discussion or comments found on this page.")
    }

    // --- Output ---
    const pageTitle = document.title.replace(/\s*\|\s*Kaggle$/, "").trim()
    let output = ""
    if (header) {
      const title = header.querySelector("h3")?.textContent?.trim() || pageTitle
      output += `# ${title}\n\n`
      output += `**${fmtMeta(parseMeta(header))}**\n`
      output += `URL: ${window.location.href}\n\n`
      output += "---\n\n"
      output += convertBody(header) + "\n\n"
    } else {
      output += `# ${pageTitle}\n\n`
      output += `URL: ${window.location.href}\n\n`
    }

    // 0 件でも見出しを出し、コメントが無いことを取得結果に残す
    const comments = flattenComments(topLevel)
    output += "---\n\n"
    output += `## Comments (${comments.length})\n\n`
    if (truncated) output += "> 読み込みを途中で打ち切ったため、一部のコメントのみ\n\n"
    for (const c of comments) {
      output += formatComment(c)
    }

    return JSON.stringify(output)
  }, truncated)

  return result
}
