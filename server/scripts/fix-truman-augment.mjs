import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const description =
  '플레이어를 선택해 다음 2라운드 동안 다른 노래와 그 곡의 정답을 들려줍니다. 맞히면 점수가 오르는 것처럼 보이지만 실제로는 카운트되지 않고, 끝나면 「당신은 트루먼이었습니다」가 공개됩니다.'

const r = await prisma.augment.updateMany({
  where: { name: '트루먼쇼' },
  data: {
    description,
    effectValue: JSON.stringify({ rounds: 2 }),
    effectType: 'sakura_decoy',
  },
})
console.log('트루먼쇼 updated:', r.count)
await prisma.$disconnect()
