// 유튜브 검색 결과 HTML에서 videoRenderer 를 긁어 후보를 뽑는다.
// API 키 없이 ytInitialData 를 파싱한다.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

function durToSec(text) {
  if (!text) return 0
  const parts = String(text).split(':').map((n) => parseInt(n, 10))
  if (parts.some(Number.isNaN)) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** ytInitialData 안의 videoRenderer 들을 순서대로 뽑아낸다 */
function extractRenderers(html) {
  const out = []
  let idx = 0
  while (true) {
    const at = html.indexOf('"videoRenderer":{', idx)
    if (at === -1) break
    const start = at + '"videoRenderer":'.length
    // 중괄호 균형 맞춰 객체 끝을 찾는다 (문자열 안의 괄호는 건너뜀)
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let i = start; i < html.length; i++) {
      const c = html[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    if (end === -1) break
    try {
      out.push(JSON.parse(html.slice(start, end)))
    } catch {
      /* 깨진 조각은 버린다 */
    }
    idx = end
  }
  return out
}

function toCandidate(r) {
  const id = r.videoId
  if (!id) return null
  const title = r.title?.runs?.map((x) => x.text).join('') || r.title?.simpleText || ''
  const channel =
    r.ownerText?.runs?.[0]?.text ||
    r.longBylineText?.runs?.[0]?.text ||
    r.shortBylineText?.runs?.[0]?.text ||
    ''
  const length = r.lengthText?.simpleText || ''
  const views = r.viewCountText?.simpleText || r.shortViewCountText?.simpleText || ''
  const badges = (r.badges || []).map((b) => b?.metadataBadgeRenderer?.label).filter(Boolean)
  const ownerBadges = (r.ownerBadges || [])
    .map((b) => b?.metadataBadgeRenderer?.style)
    .filter(Boolean)
  return {
    id,
    title,
    channel,
    length,
    seconds: durToSec(length),
    views,
    verified: ownerBadges.some((s) => /VERIFIED/i.test(s)),
    badges,
  }
}

export async function ytSearch(query, { limit = 10 } = {}) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${query}`)
  const html = await res.text()
  const items = extractRenderers(html)
    .map(toCandidate)
    .filter(Boolean)
  // 같은 id 중복 제거, 검색 순서 유지
  const seen = new Set()
  const uniq = []
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    uniq.push(it)
    if (uniq.length >= limit) break
  }
  return uniq
}

if (/ytsearch\.mjs$/.test(process.argv[1] || '') && process.argv.length > 2) {
  const q = process.argv.slice(2).join(' ')
  const r = await ytSearch(q, { limit: 8 })
  for (const c of r) {
    console.log(
      `${c.id}  ${c.length.padStart(7)}  ${c.verified ? '✓' : ' '} ${c.channel} — ${c.title}`,
    )
  }
}
