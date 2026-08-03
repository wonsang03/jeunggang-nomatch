/**
 * 여러 JSON을 유튜브 ID 기준 upsert
 * Usage: node scripts/apply-question-jsons.mjs file1.json file2.json ...
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

function ytId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m?.[1] || null
}

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const files = (args.length ? args : [
  'data/questions-gg-batch1.json',
  'data/questions-gg-batch2.json',
]).map((f) => (path.isAbsolute(f) ? f : path.join(root, f)))

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin1234' }),
})
if (!login.ok) throw new Error(`로그인 실패: ${await login.text()}`)
const { token } = await login.json()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

/** genre 목록을 여러 번 긁어 youtubeId → questionId */
async function loadExistingMap() {
  const by = new Map()
  // 장르별 + 전체
  const genres = ['', '한국노래', '일본노래', '해외노래', '영화', '드라마', '애니', '클래식', '버튜버', '게임', '기타']
  for (const g of genres) {
    const url = g
      ? `${BASE}/api/questions?limit=200&genre=${encodeURIComponent(g)}`
      : `${BASE}/api/questions?limit=200`
    const res = await fetch(url, { headers })
    if (!res.ok) continue
    const data = await res.json()
    for (const q of data.questions || []) {
      const id = ytId(q.youtubeUrl)
      if (id && !by.has(id)) by.set(id, q.id)
    }
  }
  return by
}

const byYt = await loadExistingMap()
console.log('existingMapped', byYt.size)

let created = 0
let updated = 0
const errors = []
const seen = new Set()

for (const file of files) {
  const batch = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(batch)) throw new Error(`배열 아님: ${file}`)
  console.log('file', path.basename(file), 'count', batch.length)

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i]
    const id = ytId(item.youtubeUrl)
    if (!id) {
      errors.push({ file: path.basename(file), index: i, error: '유튜브 ID 없음' })
      continue
    }
    // 같은 실행에서 뒤에 오는 파일의 동일 곡은 덮어씀
    const key = id
    try {
      const existing = byYt.get(key)
      if (existing) {
        const r = await fetch(`${BASE}/api/questions/${existing}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(item),
        })
        if (!r.ok) throw new Error(await r.text())
        if (!seen.has(key)) updated += 1
        else updated += 1 // 재갱신 카운트는 단순화
      } else {
        const r = await fetch(`${BASE}/api/questions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(item),
        })
        if (!r.ok) throw new Error(await r.text())
        const data = await r.json()
        if (data.question?.id) byYt.set(key, data.question.id)
        created += 1
      }
      seen.add(key)
    } catch (e) {
      errors.push({
        file: path.basename(file),
        index: i,
        title: item.slots?.[0]?.answer,
        error: String(e.message || e).slice(0, 300),
      })
    }
  }
}

console.log(JSON.stringify({
  files: files.map((f) => path.basename(f)),
  uniqueProcessed: seen.size,
  created,
  updated,
  failed: errors.length,
  errors: errors.slice(0, 30),
}, null, 2))
