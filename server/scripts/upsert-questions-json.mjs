/**
 * questions-gg-batch1.json 등을 DB에 반영 (유튜브 ID 기준 upsert)
 * Usage: node scripts/upsert-questions-json.mjs ../data/questions-gg-batch1.json
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.API_BASE || 'http://127.0.0.1:4000'
const jsonPath = path.resolve(process.cwd(), process.argv[2] || '../data/questions-gg-batch1.json')

function ytId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m?.[1] || null
}

async function main() {
  const raw = fs.readFileSync(jsonPath, 'utf8')
  const questions = JSON.parse(raw)
  if (!Array.isArray(questions) || !questions.length) {
    throw new Error('JSON 배열이 비어 있습니다')
  }

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin1234' }),
  })
  if (!loginRes.ok) throw new Error(`로그인 실패: ${await loginRes.text()}`)
  const { token } = await loginRes.json()
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  async function findExistingId(videoId) {
    const res = await fetch(`${BASE}/api/questions?limit=50&q=${encodeURIComponent(videoId)}`, { headers })
    if (!res.ok) return null
    const data = await res.json()
    for (const q of data.questions || []) {
      if (ytId(q.youtubeUrl) === videoId) return q.id
    }
    return null
  }

  let created = 0
  let updated = 0
  const errors = []

  for (let i = 0; i < questions.length; i++) {
    const item = questions[i]
    const id = ytId(item.youtubeUrl)
    if (!id) {
      errors.push({ index: i, error: '유튜브 ID 없음' })
      continue
    }
    try {
      const existingId = await findExistingId(id)
      if (existingId) {
        const res = await fetch(`${BASE}/api/questions/${existingId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(item),
        })
        if (!res.ok) throw new Error(await res.text())
        updated += 1
      } else {
        const res = await fetch(`${BASE}/api/questions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(item),
        })
        if (!res.ok) throw new Error(await res.text())
        created += 1
      }
    } catch (e) {
      errors.push({ index: i, title: item.slots?.[0]?.answer, error: String(e.message || e) })
    }
  }

  console.log(JSON.stringify({ file: jsonPath, total: questions.length, created, updated, failed: errors.length, errors }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
