import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function ytId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m?.[1] || null
}

const qs = await prisma.question.findMany({
  where: { enabled: true },
  include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
  orderBy: { createdAt: 'desc' },
})

const by = new Map()
for (const q of qs) {
  const id = ytId(q.youtubeUrl)
  if (!id) continue
  if (!by.has(id)) by.set(id, [])
  by.get(id).push(q)
}

const dups = [...by.entries()].filter(([, a]) => a.length > 1)
console.log(JSON.stringify({
  total: qs.length,
  uniqueYt: by.size,
  dupGroups: dups.length,
  extraRows: dups.reduce((n, [, a]) => n + a.length - 1, 0),
  samples: dups.slice(0, 10).map(([id, a]) => ({
    yt: id,
    count: a.length,
    titles: a.map((q) => q.slots.find((s) => s.label.includes('제목'))?.answer || '?'),
  })),
}, null, 2))

let deleted = 0
for (const [, rows] of dups) {
  // createdAt desc → [0] 최신 유지, 나머지 삭제
  for (const row of rows.slice(1)) {
    await prisma.question.delete({ where: { id: row.id } })
    deleted += 1
  }
}

const left = await prisma.question.count({ where: { enabled: true } })
console.log(JSON.stringify({ deleted, remaining: left }, null, 2))
await prisma.$disconnect()
