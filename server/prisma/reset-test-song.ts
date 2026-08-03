import { PrismaClient } from '@prisma/client'
import { GENRES } from '../src/genres.js'

const prisma = new PrismaClient()

async function main() {
  for (const name of GENRES) {
    await prisma.genre.upsert({ where: { name }, update: {}, create: { name } })
  }

  await prisma.answerSlot.deleteMany()
  await prisma.question.deleteMany()
  console.log('Cleared all questions')

  const genre = await prisma.genre.findUniqueOrThrow({ where: { name: '한국노래' } })

  const q = await prisma.question.create({
    data: {
      youtubeUrl: 'https://www.youtube.com/watch?v=8fByP3JR_Hw',
      startSec: 0,
      endSec: 40,
      genreId: genre.id,
      slots: {
        create: [
          {
            label: '제목',
            answer: '네리사에게 혼났습니다',
            acceptAnswers: JSON.stringify([
              '네리사에게 혼났습니다',
              '네리사에게 혼났습니다..',
              '네리사에게혼났습니다',
            ]),
            sortOrder: 0,
          },
          {
            label: '가수',
            answer: '아오쿠모 린',
            acceptAnswers: JSON.stringify([
              '아오쿠모 린',
              'AOKUMO RIN',
              'aokumo rin',
              '아오쿠모린',
            ]),
            sortOrder: 1,
          },
        ],
      },
    },
    include: { genre: true, slots: true },
  })

  console.log('Inserted test question:', {
    id: q.id,
    genre: q.genre.name,
    youtubeUrl: q.youtubeUrl,
    slots: q.slots.map((s) => `${s.label}=${s.answer}`),
  })
  console.log('Total questions:', await prisma.question.count())
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
