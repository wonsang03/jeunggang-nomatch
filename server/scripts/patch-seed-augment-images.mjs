/**
 * seed.ts의 imageUrl을 sync 매핑에 맞게 갱신
 * node scripts/patch-seed-augment-images.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const seedPath = path.join(__dirname, '../prisma/seed.ts')

/** name → imageUrl (전환은 bronze/silver 둘 다 동일) */
const URLS = {
  '리신': '/augments/leesin.jpg',
  '신창섭의 가호': '/augments/sinchangseop-gaho.jpg',
  '엄': '/augments/eomjunshik.jpg',
  '준': '/augments/eomjunshik.jpg',
  '식': '/augments/eomjunshik.jpg',
  '서상원의 가호': '/augments/seosangwon-gaho.jpg',
  '전환': '/augments/convert.png',
  '꼴찌의 반란': '/augments/last-place-revolt.jpg',
  '한입만': '/augments/one-bite.jpg',
  '잠깐만요': '/augments/wait-a-moment.jpg',
  '삥뜯기': '/augments/shake-down.jpg',
  '나이거 뭔지 알아': '/augments/i-know-that.jpg',
  '내친구 진석이': '/augments/friend-jinseok.png',
  '신 강림': '/augments/god-descent.jpg',
  '범인은 당신이야!': '/augments/you-are-the-culprit.jpg',
  '에라모르겠다': '/augments/whatever.png',
  '세노': '/augments/seno.jpg',
  '영역전개': '/augments/domain-expansion.png',
  '습박 돌던져': '/augments/throw-rock.jpg',
  '묻고 더블로가': '/augments/ask-and-double.jpg',
  '반전 술식': '/augments/reversal-jutsu.jpg',
  '다요': '/augments/dayo.jpg',
  '진조이니라': '/augments/jinjo-inira.png',
  '쉬었음청년': '/augments/rested-youth.jpg',
  '전원을 꺼봤습니다': '/augments/turned-off-all.jpg',
  '야차룰': '/augments/yacha-rule.jpg',
  '진흙탕 싸움': '/augments/mudfight.jpg',
  '산데비스탄': '/augments/sandevistan.jpg',
  '조커뽑기': '/augments/joker-draw.jpg',
  '맞췄죠?': '/augments/got-it-right.jpg',
  '예의바른청년': '/augments/polite-youth.jpg',
  '트루먼쇼': '/augments/truman-show.jpg',
  '불꽃남자김상원': '/augments/fire-sangwon.jpg',
  '무지개 반사': '/augments/rainbow-reflect.jpg',
  '김동주의 가호': '/augments/kimdongju-gaho.jpg',
  '박진성의 가호': '/augments/parkjinseong-gaho.jpg',
  '신동혁의 가호': '/augments/sindonghyeok-gaho.jpg',
  '일론 머스크의 가호': '/augments/elon-musk-gaho.jpg',
  '풍악을 울려라': '/augments/pungak.jpg',
  '미룬이의 가호': '/augments/miruni-gaho.png',
}

let src = fs.readFileSync(seedPath, 'utf8')

// 각 증강 블록: name: 'X' ... imageUrl: ... 를 찾아 교체
for (const [name, url] of Object.entries(URLS)) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `(name:\\s*'${escaped}'[\\s\\S]*?imageUrl:\\s*)(?:null|'[^']*'|"[^"]*")`,
    'g',
  )
  let count = 0
  src = src.replace(re, (_, prefix) => {
    count += 1
    return `${prefix}'${url}'`
  })
  console.log(`${name}: ${count}`)
}

fs.writeFileSync(seedPath, src)
console.log('seed.ts patched')
