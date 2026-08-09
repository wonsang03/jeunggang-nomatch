/**
 * 로컬 DB → questions-dump.json
 * node scripts/export-questions-dump.mjs
 */
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()
const out = path.resolve('data/questions-dump.json')

const questions = await prisma.question.findMany({
  include: {
    genre: true,
    slots: { orderBy: { sortOrder: 'asc' } },
  },
  orderBy: { id: 'asc' },
})

const payload = {
  exportedAt: new Date().toISOString(),
  count: questions.length,
  questions: questions.map((q) => ({
    youtubeUrl: q.youtubeUrl,
    startSec: q.startSec,
    endSec: q.endSec,
    enabled: q.enabled,
    tags: q.tags,
    genreName: q.genre.name,
    slots: q.slots.map((s) => ({
      label: s.label,
      answer: s.answer,
      acceptAnswers: s.acceptAnswers,
      hidden: s.hidden,
      sortOrder: s.sortOrder,
    })),
  })),
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(payload), 'utf8')
console.log('wrote', out, 'count', payload.count)
await prisma.$disconnect()
