/**
 * 가호사진/ → web/public/augments 복사 + DB imageUrl 연결
 * node scripts/sync-augment-images.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PrismaClient } from '@prisma/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const srcDir = path.join(root, '가호사진')
const destDir = path.join(root, 'web', 'public', 'augments')

/** 파일명(확장자 제외) → 증강 이름(들). DB name과 정확히 일치해야 함 */
const FILE_TO_AUGMENTS = {
  '꼴지의 반란': ['꼴찌의 반란'],
  '나이거 뭔지 알아': ['나이거 뭔지 알아'],
  '내친구 진석이': ['내친구 진석이'],
  '리신': ['리신'],
  '무지개 반사': ['무지개 반사'],
  '묻고더블로가': ['묻고 더블로가'],
  '반전술식': ['반전 술식'],
  '범인은 당신이야': ['범인은 당신이야!'],
  '불꽃남자김상원': ['불꽃남자김상원'],
  '삥뜯기': ['삥뜯기'],
  '산데비스탄': ['산데비스탄'],
  '서상원의 가호': ['서상원의 가호'],
  '세노': ['세노'],
  '쉬었음청년': ['쉬었음청년'],
  '습박 돌던져': ['습박 돌던져'],
  '신 강림': ['신 강림'],
  '신창섭의 가호': ['신창섭의 가호'],
  '아디나다요': ['다요'],
  '야차룰': ['야차룰'],
  '엄준식': ['엄', '준', '식'],
  '에라모르겠다': ['에라모르겠다'],
  '영역전개': ['영역전개'],
  '예의바른청년': ['예의바른청년'],
  '잠깐만요': ['잠깐만요'],
  '잡았죠': ['맞췄죠?'],
  '전원을 꺼봤습니다': ['전원을 꺼봤습니다'],
  '전환': ['전환'],
  '조커뽑기': ['조커뽑기'],
  '진흙탕싸움': ['진흙탕 싸움'],
  '진조이니라': ['진조이니라'],
  '트루먼쇼': ['트루먼쇼'],
  '한입만': ['한입만'],
  '김동주의 가호': ['김동주의 가호'],
  '박진성의 가호': ['박진성의 가호'],
  '신동혁의 가호': ['신동혁의 가호'],
  '일론 머스크의 가호': ['일론 머스크의 가호'],
  '풍악을 울려라': ['풍악을 울려라'],
  '미룬이의 가호': ['미룬이의 가호'],
  '쪼아요': ['쪼아요~'],
}

/** 증강명 → public URL용 파일 슬러그 */
const SLUG = {
  '꼴찌의 반란': 'last-place-revolt',
  '나이거 뭔지 알아': 'i-know-that',
  '내친구 진석이': 'friend-jinseok',
  '리신': 'leesin',
  '무지개 반사': 'rainbow-reflect',
  '묻고 더블로가': 'ask-and-double',
  '반전 술식': 'reversal-jutsu',
  '범인은 당신이야!': 'you-are-the-culprit',
  '불꽃남자김상원': 'fire-sangwon',
  '삥뜯기': 'shake-down',
  '산데비스탄': 'sandevistan',
  '서상원의 가호': 'seosangwon-gaho',
  '세노': 'seno',
  '쉬었음청년': 'rested-youth',
  '습박 돌던져': 'throw-rock',
  '신 강림': 'god-descent',
  '신창섭의 가호': 'sinchangseop-gaho',
  '다요': 'dayo',
  '야차룰': 'yacha-rule',
  '엄': 'eomjunshik',
  '준': 'eomjunshik',
  '식': 'eomjunshik',
  '에라모르겠다': 'whatever',
  '영역전개': 'domain-expansion',
  '예의바른청년': 'polite-youth',
  '잠깐만요': 'wait-a-moment',
  '맞췄죠?': 'got-it-right',
  '전원을 꺼봤습니다': 'turned-off-all',
  '전환': 'convert',
  '조커뽑기': 'joker-draw',
  '진흙탕 싸움': 'mudfight',
  '진조이니라': 'jinjo-inira',
  '트루먼쇼': 'truman-show',
  '한입만': 'one-bite',
  '김동주의 가호': 'kimdongju-gaho',
  '박진성의 가호': 'parkjinseong-gaho',
  '신동혁의 가호': 'sindonghyeok-gaho',
  '일론 머스크의 가호': 'elon-musk-gaho',
  '풍악을 울려라': 'pungak',
  '미룬이의 가호': 'miruni-gaho',
  '쪼아요~': 'peck',
}

function extFor(file) {
  const e = path.extname(file).toLowerCase()
  if (e === '.jfif' || e === '.jpeg') return '.jpg'
  return e || '.jpg'
}

const prisma = new PrismaClient()

async function main() {
  fs.mkdirSync(destDir, { recursive: true })
  const files = fs.readdirSync(srcDir)
  const results = []
  const unmatchedFiles = []
  const copiedSlugs = new Set()

  for (const file of files) {
    const stem = path.basename(file, path.extname(file))
    const names = FILE_TO_AUGMENTS[stem]
    if (!names) {
      unmatchedFiles.push(file)
      continue
    }

    const src = path.join(srcDir, file)
    for (const name of names) {
      const slug = SLUG[name]
      if (!slug) throw new Error(`슬러그 없음: ${name}`)
      const destName = `${slug}${extFor(file)}`
      const dest = path.join(destDir, destName)
      if (!copiedSlugs.has(destName)) {
        fs.copyFileSync(src, dest)
        copiedSlugs.add(destName)
      }
      const imageUrl = `/augments/${destName}`
      const updated = await prisma.augment.updateMany({
        where: { name },
        data: { imageUrl },
      })
      results.push({ file, name, imageUrl, count: updated.count })
    }
  }

  console.log('연결 결과:')
  for (const r of results) {
    console.log(`  ${r.file} → ${r.name} (${r.count}) ${r.imageUrl}`)
  }
  if (unmatchedFiles.length) {
    console.log('매핑 안 된 파일:', unmatchedFiles)
  }

  const stillNull = await prisma.augment.findMany({
    where: { imageUrl: null, enabled: true },
    select: { name: true, tier: true },
    orderBy: { name: 'asc' },
  })
  console.log(`\n아직 사진 없는 증강 ${stillNull.length}개:`)
  for (const a of stillNull) console.log(`  - ${a.name} (${a.tier})`)

  const withImg = await prisma.augment.count({ where: { imageUrl: { not: null } } })
  console.log(`\n사진 연결됨: ${withImg}개`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
