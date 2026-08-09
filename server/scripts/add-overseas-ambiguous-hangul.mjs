/**
 * 해외노래 — 발음이 갈리는 곡만 한글 인정답 변종 추가
 * node scripts/add-overseas-ambiguous-hangul.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** 영어 제목(exact) → 추가할 한글 변종 */
const TITLE_VARIANTS = {
  "There's Nothing Holdin' Me Back": [
    '데어스 나띵 홀딩 미 백',
    '데어스 낫띵 홀딩 미 백',
    '데얼스 나띵 홀딩 미 백',
    '데얼스 낫띵 홀딩 미 백',
    '데어스 나띵 홀딘 미 백',
    '데얼스 나띵 홀딘 미 백',
    '데어스낫띵홀딩미백',
    '데얼스낫띵홀딩미백',
    '데어스나띵홀딩미백',
    '데얼스나띵홀딩미백',
  ],
  "That's What I Like": [
    '댓츠 왓 아이 라이크',
    '댓스 왓 아이 라이크',
    '댓츠왓아이라이크',
    '댓스왓아이라이크',
  ],
  "That's Hilarious": [
    '댓츠 힐래리어스',
    '댓스 힐래리어스',
    '댓츠 힐레리어스',
    '댓츠힐래리어스',
  ],
  'Something Just Like This': [
    '섬띵 저스트 라이크 디스',
    '썸띵 저스트 라이크 디스',
    '섬싱 저스트 라이크 디스',
    '섬띵저스트라이크디스',
    '썸띵저스트라이크디스',
  ],
  "I Don't Think That I Like Her": [
    '아이 돈 띵크 댓 아이 라이크 허',
    '아이 돈트 씽크 댓 아이 라이크 허',
    '아이 돈 씽크 댓 아이 라이크 허',
    '아이돈띵크댓아이라이크허',
  ],
  "We Don't Talk Anymore": [
    '위 돈 톡 애니모어',
    '위 돈트 톡 애니모어',
    '위돈톡애니모어',
  ],
  "If I Ain't Got You": [
    '이프 아이 에인트 갓 유',
    '이프 아이 에인트 갓유',
    '이프아이에인트갓유',
  ],
  "Isn't She Lovely": [
    '이즌트 쉬 러블리',
    '이즌트 시 러블리',
    '이즌트쉬러블리',
    '이즌트시러블리',
  ],
  "I'm Yours": [
    '아임 유얼스',
    '아임유얼스',
    '아이엠 유어스',
    '아임 유어스',
    '아임유어스',
  ],
  'Love Yourself': [
    '러브 유어셀프',
    '러브유어셀프',
    '러브 유얼셀프',
    '러브유얼셀프',
    '러브유어셀',
  ],
  'Lose Yourself': [
    '루즈 유어셀프',
    '루즈유어셀프',
    '루즈 유얼셀프',
    '루즈유얼셀프',
    '로스 유어셀프',
  ],
  'Someone Like You': [
    '썸원 라이크 유',
    '섬원 라이크 유',
    '썸원라이크유',
    '섬원라이크유',
  ],
  'Thinking Out Loud': [
    '띵킹 아웃 라우드',
    '싱킹 아웃 라우드',
    '띵킹아웃라우드',
    '싱킹아웃라우드',
  ],
  'Honesty': ['어네스티', '아니스티', '어니스티', '호네스티'],
  'Rather Be': ['래더 비', '라더 비', '래더비', '라더비'],
  'Shallow': ['셜로우', '샬로우', '쉘로우'],
  'Unholy': ['언홀리', '언홀리이'],
  'The Spectre': ['더 스펙터', '더 스펙트레', '스펙터', '스펙트레'],
  'Heroes': ['히어로즈', '히어로스', '히어로우스'],
  'Anti-Hero': ['앤티 히어로', '안티 히어로', '앤티히어로', '안티히어로'],
  'Dangerously': ['덴저러스리', '데인저러슬리', '덴저러슬리'],
  'At My Worst': ['앳 마이 워스트', '액 마이 워스트', '앳마이워스트'],
  'Birthday': ['버스데이', '벌스데이'],
  'California Gurls': [
    '캘리포니아 걸스',
    '캘리포니아 걸즈',
    '캘리포니아걸스',
    '캘리포니아걸즈',
  ],
  'Señorita': ['세뇨리따', '세뇨리타', '시뇨리타'],
  'Peaches': ['피치스', '피치즈'],
  'Memories': ['메모리즈', '메모리스'],
  'Attention': ['어텐션', '어텐숀'],
  'How Long': ['하우롱', '하우 롱', '하울롱'],
  'Falling Slowly': ['폴링 슬로우리', '폴링슬로우리'],
  'Englishman In New York': [
    '잉글리시맨 인 뉴욕',
    '잉글리시맨인뉴욕',
    '잉글리시맨인뉴',
  ],
  "Can't Take My Eyes off You": [
    '캔트 테이크 마이 아이즈 오프 유',
    '캔트테이크마이아이즈오브유',
    '캔트테이크마이아이즈오프유',
  ],
  'Just The Way You Are': [
    '저스트 더 웨이 유 아',
    '저스트더웨이유알',
    '저스트더웨이유아',
  ],
  'L-O-V-E': ['엘오브이이', '러브', '엘 오 브이 이', '엘오비이'],
  '2002': [
    '투사우전드앤투',
    '투 사우전드 앤 투',
    '이천이',
    '이천 이',
    '2002',
  ],
  '7 Years': ['세븐 이어즈', '세븐 이얼즈', '세븐이어즈', '세븐이얼즈'],
  'comethru': ['컴스루', '컴스루우', '컴 스루'],
  'Off My Face': ['오프 마이 페이스', '오프마이페이스'],
  'Know Me Too Well': ['노 미 투 웰', '노우 미 투 웰', '노미투웰'],
  'Youth': ['유스', '유쓰'],
  'Problem': ['프라블럼', '프로블럼', '프라블렘'],
  'Payphone': ['페이폰', '페이 폰'],
  'Payphone (Acoustic)': ['페이폰', '페이 폰', '페이폰 어쿠스틱'],
  'Steal The Show': ['스틸 더 쇼', '스틸더쇼', '스틸 더쇼'],
  'Hello': ['헬로', '헬로우'],
  "See You Again": ['씨유어게인', '씨 유 어게인', '시유어게인', '시 유 어게인'],
  'Bad Guy': ['배드가이', '배드 가이', '뱃가이'],
  'Bang Bang': ['뱅 뱅', '뱅뱅'],
  'Viva La Vida': ['비바라비다', '비바 라 비다', '비바 라비다'],
  'Shape of You': ['셰이프오브유', '셰이프 오브 유', '쉐이프 오브 유', '쉐이프오브유'],
  'Maps': ['맵스', '맵'],
  'I Like Me Better': [
    '아이 라이크 미 베터',
    '아이라이크미베터',
    '아이 라이크 미 베러',
  ],
  'Lost In Japan': ['로스트 인 재팬', '로스트인재팬', '로스트 인 재팬'],
  'Girls Like You': ['걸스 라이크 유', '걸즈 라이크 유', '걸스라이크유'],
  'Blinding Lights': ['블라인딩 라이츠', '블라인딩라이츠'],
  'As It Was': ['애즈잇 와즈', '애즈 잇 와즈', '애즈잇와즈'],
  'Leave The Door Open': [
    '리브 더 도어 오픈',
    '리브더도어오픈',
    '리브 더 도어 오픈',
  ],
  'Moves Like Jagger': [
    '무브스 라이크 재거',
    '무브즈 라이크 재거',
    '무브스라이크재거',
  ],
  'Make You Feel My Love': [
    '메이크 유 필 마이 러브',
    '메이크유필마이러브',
  ],
  'Supermarket Flowers': [
    '슈퍼마켓 플라워스',
    '슈퍼마켓 플라워즈',
    '슈퍼마켓플라워스',
  ],
  'Fly Me To The Moon': [
    '플라이 미 투 더 문',
    '플라이미투더문',
  ],
  'Double Take': ['더블 테이크', '더블테이크'],
  'Light Switch': ['라이트 스위치', '라이트스위치'],
  'One Call Away': ['원 콜 어웨이', '원콜어웨이'],
  'Call Me Maybe': ['콜 미 메이비', '콜미메이비'],
  'Call You Mine': ['콜 유 마인', '콜유마인'],
  'Count On Me': ['카운트 온 미', '카운트온미'],
  'Paris in the Rain': ['파리스 인 더 레인', '패리스 인 더 레인', '파리스인더레인'],
  'Santa Tell Me': ['산타 텔 미', '산타텔미'],
  'Last Friday Night': [
    '라스트 프라이데이 나이트',
    '라스트프라이데이나이트',
  ],
  'Runaway Baby': ['런어웨이 베이비', '런어웨이베이비'],
  'Best Part': ['베스트 파트', '베스트파트'],
  'Get You': ['겟 유', '겟유'],
  'To Find You': ['투 파인드 유', '투파인드유'],
  'Golden Hour': ['골든 아워', '골든아워'],
  '24K Magic': ['투엔티포케이 매직', '투엔티포케이매직', '24케이 매직', '이십사케이 매직'],
  'FRIENDS': ['프렌즈', '프렌드스'],
  'Happier': ['해피어', '해피얼'],
  'Symphony': ['심포니', '심퍼니'],
  'Solo': ['솔로'],
  'Faded': ['페이디드'],
}

/** 가수명 애매 변종 (영어 exact) */
const ARTIST_VARIANTS = {
  'Charlie Puth': ['찰리 푸스', '찰리푸스', '챨리 푸스', '찰리 푸쓰'],
  'Ed Sheeran': ['에드 시런', '에드시런', '에드 쉬런', '에드쉬런'],
  'Shawn Mendes': ['숀 멘데스', '숀멘데스', '션 멘데스'],
  'Bruno Mars': ['브루노 마스', '브루노마스', '브루노 마즈'],
  'Maroon 5': ['마룬 파이브', '마룬파이브', '마룬5', '마룬 5'],
  'Anne-Marie': ['앤 마리', '앤마리', '앤-마리'],
  'Pink Sweat$': ['핑크 스웨츠', '핑크스웨츠', '핑크 스웻츠'],
  'Billie Eilish': ['빌리 아일리시', '빌리아일리시', '빌리 에이리시'],
  'Ariana Grande': ['아리아나 그란데', '아리아나그란데'],
  'Taylor Swift': ['테일러 스위프트', '테일러스위프트'],
  'Sam Smith': ['샘 스미스', '샘스미스'],
  'Troye Sivan': ['트로이 시반', '트로이시반'],
  'Jeremy Zucker': ['제레미 주커', '제레미주커'],
  'Jason Mraz': ['제이슨 무라즈', '제이슨무라즈', '제이슨 므라즈'],
  'Avril Lavigne': ['에이브릴 라빈', '에이브릴라빈', 'avril 라빈'],
  'Lady Gaga': ['레이디 가가', '레이디가가'],
  'Katy Perry': ['케이티 페리', '케이티페리'],
  'Clean Bandit': ['클린 밴딧', '클린밴딧'],
  'Alan Walker': ['앨런 워커', '알렌 워커', '앨런워커'],
  'Alesso': ['알레소', '알레소'],
  'Lauv': ['라우브', '라우프'],
  'New Hope Club': ['뉴 호프 클럽', '뉴호프클럽'],
  'Lukas Graham': ['루카스 그레이엄', '루카스 그램', '루카스그램'],
  'The Chainsmokers': ['더 체인스모커스', '체인스모커스'],
  'Nat King Cole': ['냇 킹 콜', '냇킹콜'],
  'Stevie Wonder': ['스티비 원더', '스티비원더'],
  'Glen Hansard': ['글렌 한사드', '글렌한사드'],
  'Slchld': ['슬칠드', '슬칠'],
  'Jessie J': ['제시 제이', '제시제이'],
  'Coldplay': ['콜드플레이'],
  'Adele': ['아델', '아델레'],
  'Justin Bieber': ['저스틴 비버', '저스틴비버'],
  'Eminem': ['에미넴'],
  'Sting': ['스팅'],
  'Alicia Keys': ['알리샤 키스', '알리샤키스'],
}

function uniq(arr) {
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))]
}

async function main() {
  const genre = await prisma.genre.findUnique({ where: { name: '해외노래' } })
  if (!genre) throw new Error('해외노래 장르 없음')

  const qs = await prisma.question.findMany({
    where: { genreId: genre.id, enabled: true },
    include: { slots: { orderBy: { sortOrder: 'asc' } } },
  })

  let titleUpdated = 0
  let artistUpdated = 0
  let titleSkipped = 0

  for (const q of qs) {
    const titleSlot = q.slots.find((s) => !s.label.includes('가수')) || q.slots[0]
    const en = titleSlot?.answer
    const extras = TITLE_VARIANTS[en]
    if (extras && titleSlot) {
      const cur = JSON.parse(titleSlot.acceptAnswers || '[]')
      const next = uniq([en, ...cur, ...extras])
      if (next.length !== uniq([en, ...cur]).length || next.some((x, i) => x !== uniq([en, ...cur])[i])) {
        const before = new Set(uniq([en, ...cur]))
        const added = next.filter((x) => !before.has(x))
        if (added.length) {
          await prisma.answerSlot.update({
            where: { id: titleSlot.id },
            data: { acceptAnswers: JSON.stringify(next) },
          })
          titleUpdated++
          console.log(`[title] ${en} +${added.length}: ${added.join(' / ')}`)
        } else {
          titleSkipped++
        }
      } else {
        titleSkipped++
      }
    }

    for (const a of q.slots.filter((s) => s.label.includes('가수'))) {
      const extrasA = ARTIST_VARIANTS[a.answer]
      if (!extrasA) continue
      const cur = JSON.parse(a.acceptAnswers || '[]')
      const before = uniq([a.answer, ...cur])
      const next = uniq([a.answer, ...cur, ...extrasA])
      const added = next.filter((x) => !before.includes(x))
      if (!added.length) continue
      await prisma.answerSlot.update({
        where: { id: a.id },
        data: { acceptAnswers: JSON.stringify(next) },
      })
      artistUpdated++
      console.log(`[artist] ${a.answer} +${added.length}: ${added.join(' / ')}`)
    }
  }

  const mapped = Object.keys(TITLE_VARIANTS).length
  const found = qs.filter((q) => {
    const t = (q.slots.find((s) => !s.label.includes('가수')) || q.slots[0])?.answer
    return TITLE_VARIANTS[t]
  }).length
  console.log(`\n제목 맵 ${mapped} · DB매칭 ${found} · 제목갱신 ${titleUpdated} · 가수갱신 ${artistUpdated}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
