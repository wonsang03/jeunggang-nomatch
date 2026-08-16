/**
 * 새로 추가한 곡만 출제되게 문제은행을 임시로 좁혔다가 되돌리는 스위치.
 *
 *   node scripts/toggle-test-bank.mjs on      # 새 곡(아래 JSON 목록)만 enabled, 나머지 전부 비활성
 *   node scripts/toggle-test-bank.mjs off     # 전체 다시 활성 (기존 곡 복구)
 *   node scripts/toggle-test-bank.mjs status  # 현재 상태만 확인
 *
 * 곡을 지우지 않고 enabled 플래그만 건드리므로 언제든 되돌릴 수 있다.
 * 서버가 은행을 최대 60초 캐시하므로, 바꾼 뒤 1분 기다리거나 서버를 재시작해야 반영된다.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PrismaClient } from '@prisma/client'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BATCH_FILES = [
  'data/questions-new-kr-100.json',
  'data/questions-new-en-50.json',
  'data/questions-new-jp-50.json',
]

const ytId = (url) => String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1] || null

const prisma = new PrismaClient()
const mode = (process.argv[2] || 'status').toLowerCase()

const testIds = new Set()
for (const f of BATCH_FILES) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) {
    console.error(`배치 파일 없음: ${f}`)
    continue
  }
  for (const q of JSON.parse(fs.readFileSync(p, 'utf8'))) {
    const id = ytId(q.youtubeUrl)
    if (id) testIds.add(id)
  }
}

const all = await prisma.question.findMany({ select: { id: true, youtubeUrl: true, enabled: true, genre: { select: { name: true } } } })
const isTest = (q) => testIds.has(ytId(q.youtubeUrl))

if (mode === 'on') {
  const testRows = all.filter(isTest)
  if (testRows.length === 0) {
    console.error('테스트 대상 곡이 DB에 없습니다. 먼저 배치 JSON을 반영하세요.')
    process.exit(1)
  }
  await prisma.question.updateMany({ data: { enabled: false } })
  await prisma.question.updateMany({ where: { id: { in: testRows.map((q) => q.id) } }, data: { enabled: true } })
  console.log(`테스트 모드 ON — 새 곡 ${testRows.length}곡만 출제됩니다 (나머지 ${all.length - testRows.length}곡은 보관 상태).`)
} else if (mode === 'off') {
  await prisma.question.updateMany({ data: { enabled: true } })
  console.log(`테스트 모드 OFF — 전체 ${all.length}곡 복구했습니다.`)
}

const after = await prisma.question.groupBy({
  by: ['genreId'],
  where: { enabled: true },
  _count: { _all: true },
})
const genres = await prisma.genre.findMany({ select: { id: true, name: true } })
const byId = new Map(genres.map((g) => [g.id, g.name]))
const counts = {}
for (const row of after) counts[byId.get(row.genreId) || '?'] = row._count._all
console.log('현재 출제 가능(enabled) 장르별 곡 수:', counts)
console.log('테스트 대상으로 등록된 곡:', all.filter(isTest).length, '/ 배치 JSON 곡:', testIds.size)

await prisma.$disconnect()
