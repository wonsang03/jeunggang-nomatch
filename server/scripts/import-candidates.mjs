/**
 * draft 문제 JSON을 DB에 직접 넣는다 (유튜브 ID 기준 upsert).
 *
 * 기존 upsert-questions-json.mjs 는 서버가 떠 있어야 하고 admin/admin1234 로
 * 로그인한다. 그 기본 계정은 이제 시드에서 안 만들기 때문에, 여기서는
 * Prisma 로 dev.db 에 바로 쓴다.
 *
 *   node scripts/import-candidates.mjs ../data/draft/questions-anime-50.json [...]
 *   node scripts/import-candidates.mjs --dry ../data/draft/*.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function ytId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m?.[1] || null
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const files = args.filter((a) => !a.startsWith('--'))
  if (!files.length) throw new Error('JSON 파일을 인자로 주세요')

  const genreIds = {}
  for (const g of await prisma.genre.findMany()) genreIds[g.name] = g.id

  let added = 0
  let updated = 0
  let skipped = 0

  for (const f of files) {
    const rows = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'))
    console.log(`\n── ${path.basename(f)} (${rows.length}곡)`)

    for (const r of rows) {
      const vid = ytId(r.youtubeUrl)
      if (!vid) {
        console.log(`  ! 유튜브 ID 없음: ${r.youtubeUrl}`)
        skipped++
        continue
      }
      const genreId = genreIds[r.genreName]
      if (!genreId) throw new Error(`알 수 없는 장르: ${r.genreName}`)

      const existing = await prisma.question.findFirst({
        where: { youtubeUrl: { contains: vid } },
        include: { genre: true },
      })

      const data = {
        youtubeUrl: r.youtubeUrl,
        startSec: r.startSec,
        endSec: r.endSec,
        genreId,
        tags: JSON.stringify(r.tags || []),
        enabled: true,
      }
      const slots = r.slots.map((s, i) => ({
        label: s.label,
        answer: s.answer,
        acceptAnswers: JSON.stringify(s.acceptAnswers || [s.answer]),
        sortOrder: i,
      }))

      if (existing) {
        if (dry) {
          console.log(`  = 이미 있음: ${r.slots[0].answer} (${existing.genre.name})`)
        } else {
          await prisma.question.update({ where: { id: existing.id }, data })
          await prisma.answerSlot.deleteMany({ where: { questionId: existing.id } })
          await prisma.answerSlot.createMany({
            data: slots.map((s) => ({ ...s, questionId: existing.id })),
          })
        }
        updated++
        continue
      }

      if (dry) {
        console.log(`  + ${r.slots.map((s) => s.answer).join(' / ')}`)
      } else {
        await prisma.question.create({ data: { ...data, slots: { create: slots } } })
      }
      added++
    }
  }

  console.log(
    `\n${dry ? '[시험 실행] ' : ''}새로 추가 ${added} · 기존 갱신 ${updated} · 건너뜀 ${skipped}`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
