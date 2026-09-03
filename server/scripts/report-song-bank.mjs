/**
 * 한국·일본·해외 노래 검수표 생성 (초성 · 띄어쓰기 · 정답 인정 확인용)
 *   npx tsx scripts/report-song-bank.mjs
 * 출력: ../문제은행-검수.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { hintChosung } from '../src/answer.js'

const GENRES = ['한국노래', '일본노래', '해외노래']
const dump = JSON.parse(fs.readFileSync('data/questions-dump.json', 'utf8'))

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

const rows = { 한국노래: [], 일본노래: [], 해외노래: [] }
let total = 0

for (const q of dump.questions) {
  if (!GENRES.includes(q.genreName)) continue
  total++

  const slots = (re) =>
    q.slots
      .filter((s) => !s.hidden && re.test(s.label))
      .map((s) => {
        let acc = []
        try { acc = JSON.parse(s.acceptAnswers || '[]') } catch {}
        return {
          answer: s.answer,
          accepts: [...new Set([s.answer, ...acc])],
          chosung: hintChosung(s.answer, acc),
        }
      })

  const titles = slots(/제목|이름/)
  const artists = slots(/가수|아티스트|커버/)
  rows[q.genreName].push({ title: titles[0], artists })
}

let md = `# 문제은행 검수표 — 한국 · 일본 · 해외 노래

총 **${total}곡** (한국 ${rows.한국노래.length} · 일본 ${rows.일본노래.length} · 해외 ${rows.해외노래.length})

- **초성** 칸이 게임에서 플레이어에게 실제로 보이는 힌트입니다. 띄어쓰기까지 그대로 보입니다.
- **인정답** 칸의 표기는 전부 정답 처리됩니다. 대소문자·띄어쓰기·일부 문장부호는 무시되므로
  \`판타스틱 베이비\` 가 있으면 \`판타스틱베이비\` 도 자동으로 맞습니다.
`

for (const g of GENRES) {
  md += `\n## ${g} (${rows[g].length}곡)\n\n`
  md += `| 제목 | 초성 | 제목 인정답 | 가수 | 가수 인정답 |\n`
  md += `|---|---|---|---|---|\n`
  for (const r of rows[g]) {
    const t = r.title
    md += `| **${esc(t?.answer)}** `
    md += `| \`${esc(t?.chosung)}\` `
    md += `| ${esc((t?.accepts ?? []).join(', '))} `
    md += `| ${esc(r.artists.map((a) => a.answer).join(' / '))} `
    md += `| ${esc(r.artists.flatMap((a) => a.accepts).join(', '))} |\n`
  }
}

const out = path.resolve('..', '문제은행-검수.md')
fs.writeFileSync(out, md, 'utf8')
console.log('wrote', out, '|', total, '곡')
