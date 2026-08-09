/**
 * questions-dump.json → DB (기존 곡 전체 교체)
 * node scripts/import-questions-dump.mjs [path]
 */
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()
const file = path.resolve(process.argv[2] || 'data/questions-dump.json')
const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
const list = raw.questions || []
if (!list.length) throw new Error('덤프 비어 있음: ' + file)

console.log('import', list.length, 'from', file)

await prisma.answerSlot.deleteMany()
await prisma.question.deleteMany()

const genreCache = new Map()
async function genreId(name) {
  if (genreCache.has(name)) return genreCache.get(name)
  const g = await prisma.genre.upsert({
    where: { name },
    create: { name },
    update: {},
  })
  genreCache.set(name, g.id)
  return g.id
}

let i = 0
for (const q of list) {
  const gId = await genreId(q.genreName || '기타')
  await prisma.question.create({
    data: {
      youtubeUrl: q.youtubeUrl,
      startSec: q.startSec ?? 0,
      endSec: q.endSec ?? 40,
      enabled: q.enabled !== false,
      tags: q.tags ?? null,
      genreId: gId,
      slots: {
        create: (q.slots || []).map((s, idx) => ({
          label: s.label,
          answer: s.answer,
          acceptAnswers: typeof s.acceptAnswers === 'string' ? s.acceptAnswers : JSON.stringify(s.acceptAnswers || []),
          hidden: !!s.hidden,
          sortOrder: s.sortOrder ?? idx,
        })),
      },
    },
  })
  i++
  if (i % 50 === 0) console.log('...', i)
}

const n = await prisma.question.count()
console.log('done. questions =', n)
await prisma.$disconnect()
