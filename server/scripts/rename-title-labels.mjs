/**
 * 장르별 슬롯 라벨 변경
 * - 한국노래/일본노래/해외노래: 제목 → 노래 제목
 * - 애니: 제목 → 애니 제목
 *
 * 사용: node scripts/rename-title-labels.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SONG_GENRES = ['한국노래', '일본노래', '해외노래', '버튜버']
const ANIME_GENRES = ['애니']

async function renameForGenres(genreNames, fromLabel, toLabel) {
  const genres = await prisma.genre.findMany({
    where: { name: { in: genreNames } },
    select: { id: true, name: true },
  })
  if (genres.length === 0) {
    console.log(`[skip] 장르 없음: ${genreNames.join(', ')}`)
    return 0
  }
  const genreIds = genres.map((g) => g.id)
  const result = await prisma.answerSlot.updateMany({
    where: {
      label: fromLabel,
      question: { genreId: { in: genreIds } },
    },
    data: { label: toLabel },
  })
  console.log(
    `${genreNames.join('/')}: "${fromLabel}" → "${toLabel}" · ${result.count}개`,
  )
  return result.count
}

async function main() {
  const before = await prisma.answerSlot.groupBy({
    by: ['label'],
    _count: true,
    orderBy: { _count: { label: 'desc' } },
  })
  console.log('변경 전 라벨:', before)

  let total = 0
  total += await renameForGenres(SONG_GENRES, '제목', '노래 제목')
  total += await renameForGenres(ANIME_GENRES, '제목', '애니 제목')

  // 이미 "노래 제목"인데 애니까 "제목"만 남아있는 경우 등 방어
  // (부분 일치로 잘못 바뀐 건 건드리지 않음)

  const after = await prisma.answerSlot.groupBy({
    by: ['label'],
    _count: true,
    orderBy: { _count: { label: 'desc' } },
  })
  console.log('변경 후 라벨:', after)
  console.log(`총 변경: ${total}개`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
