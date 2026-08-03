import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const qs = await prisma.question.findMany({
  where: { enabled: true },
  include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
  orderBy: { createdAt: 'desc' },
})

function keyOf(q) {
  const title = q.slots.find((s) => s.label.includes('제목'))?.answer || ''
  const artist = q.slots.find((s) => s.label.includes('가수'))?.answer || ''
  return `${title.trim().toLowerCase()}||${artist.trim().toLowerCase()}`
}

function ytId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m?.[1] || null
}

const byTitle = new Map()
for (const q of qs) {
  const k = keyOf(q)
  if (!k || k === '||') continue
  if (!byTitle.has(k)) byTitle.set(k, [])
  byTitle.get(k).push(q)
}

const dups = [...byTitle.entries()].filter(([, a]) => a.length > 1)
console.log(JSON.stringify({
  total: qs.length,
  titleDupGroups: dups.length,
  extraRows: dups.reduce((n, [, a]) => n + a.length - 1, 0),
  samples: dups.slice(0, 20).map(([k, a]) => ({
    key: k,
    count: a.length,
    yts: a.map((q) => ytId(q.youtubeUrl)),
    starts: a.map((q) => `${q.startSec}-${q.endSec}`),
    ids: a.map((q) => q.id),
  })),
}, null, 2))

let deleted = 0
for (const [, rows] of dups) {
  // 최신 1개 유지
  for (const row of rows.slice(1)) {
    await prisma.question.delete({ where: { id: row.id } })
    deleted += 1
  }
}

const left = await prisma.question.count({ where: { enabled: true } })
console.log(JSON.stringify({ deletedByTitleArtist: deleted, remaining: left }, null, 2))
await prisma.$disconnect()
