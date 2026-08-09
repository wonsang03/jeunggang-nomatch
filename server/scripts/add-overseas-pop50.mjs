/**
 * 해외노래 일괄 추가: 제목 중복 스킵, 괄호 발음=인정답, 표시 답=원문
 * Usage: node scripts/add-overseas-pop50.mjs
 */
import { PrismaClient } from '@prisma/client'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const prisma = new PrismaClient()

/** @type {Array<{ title: string, titleKo: string, artist: string, artistKo: string }>} */
const SONGS = [
  { title: "I'm Yours", titleKo: '아이엠 유어스', artist: 'Jason Mraz', artistKo: '제이슨 무라즈' },
  { title: '2002', titleKo: '투 사우전드 앤 투', artist: 'Anne-Marie', artistKo: '앤 마리' },
  { title: 'Shape of You', titleKo: '셰이프 오브 유', artist: 'Ed Sheeran', artistKo: '에드 시런' },
  { title: 'Off My Face', titleKo: '오프 마이 페이스', artist: 'Justin Bieber', artistKo: '저스틴 비버' },
  { title: 'Paris in the Rain', titleKo: '파리스 인 더 레인', artist: 'Lauv', artistKo: '라우브' },
  { title: 'comethru', titleKo: '컴스루', artist: 'Jeremy Zucker', artistKo: '제레미 주커' },
  { title: 'At My Worst', titleKo: '액 마이 워스트', artist: 'Pink Sweat$', artistKo: '핑크 스웨츠' },
  { title: 'Call You Mine', titleKo: '콜 유 마인', artist: 'Jeff Bernat', artistKo: '제프 버넷' },
  { title: 'Bad', titleKo: '배드', artist: 'Christopher', artistKo: '크리스토퍼' },
  { title: 'Sunday Morning', titleKo: '선데이 모닝', artist: 'Maroon 5', artistKo: '마룬 파이브' },
  { title: 'Lost Stars', titleKo: '로스트 스타즈', artist: 'Adam Levine', artistKo: '애덤 리바인' },
  { title: 'Make You Feel My Love', titleKo: '메이크 유 필 마이 러브', artist: 'Adele', artistKo: '아델' },
  { title: "If I Ain't Got You", titleKo: '이프 아이 에인트 갓 유', artist: 'Alicia Keys', artistKo: '앨리샤 키스' },
  { title: 'Dance Monkey', titleKo: '댄스 몽키', artist: 'Tones and I', artistKo: '톤즈 앤 아이' },
  { title: 'STAY', titleKo: '스테이', artist: 'The Kid LAROI, Justin Bieber', artistKo: '더 키드 라로이, 저스틴 비버' },
  { title: 'Maniac', titleKo: '매니악', artist: 'Conan Gray', artistKo: '코난 그레이' },
  { title: 'Uptown Funk', titleKo: '업타운 펑크', artist: 'Mark Ronson, Bruno Mars', artistKo: '마크 론슨, 브루노 마스' },
  { title: 'Sugar', titleKo: '슈가', artist: 'Maroon 5', artistKo: '마룬 파이브' },
  { title: 'See You Again', titleKo: '씨 유 어게인', artist: 'Charlie Puth, Wiz Khalifa', artistKo: '찰리 푸스, 위즈 칼리파' },
  { title: 'Dangerously', titleKo: '덴저러스리', artist: 'Charlie Puth', artistKo: '찰리 푸스' },
  { title: "We Don't Talk Anymore", titleKo: '위 돈 톡 애니모어', artist: 'Charlie Puth, Selena Gomez', artistKo: '찰리 푸스, 셀레나 고메즈' },
  { title: 'Closer', titleKo: '클로저', artist: 'The Chainsmokers, Halsey', artistKo: '체인스모커스, 홀시' },
  { title: 'Viva La Vida', titleKo: '비바 라 비다', artist: 'Coldplay', artistKo: '콜드플레이' },
  { title: 'Something Just Like This', titleKo: '섬띵 저스트 라이크 디스', artist: 'The Chainsmokers, Coldplay', artistKo: '체인스모커스, 콜드플레이' },
  { title: 'bad guy', titleKo: '배드 가이', artist: 'Billie Eilish', artistKo: '빌리 아이리시' },
  { title: 'Havana', titleKo: '하바나', artist: 'Camila Cabello', artistKo: '카밀라 카베요' },
  { title: 'Señorita', titleKo: '세뇨리따', artist: 'Shawn Mendes, Camila Cabello', artistKo: '숀 멘데스, 카밀라 카베요' },
  { title: 'Bang Bang', titleKo: '뱅 뱅', artist: 'Jessie J, Ariana Grande, Nicki Minaj', artistKo: '제시 제이, 아리아나 그란데, 니키 미나즈' },
  { title: 'Problem', titleKo: '프라블럼', artist: 'Ariana Grande', artistKo: '아리아나 그란데' },
  { title: 'Santa Tell Me', titleKo: '산타 텔 미', artist: 'Ariana Grande', artistKo: '아리아나 그란데' },
  { title: 'Call Me Maybe', titleKo: '콜 미 메이비', artist: 'Carly Rae Jepsen', artistKo: '칼리 레이 젭슨' },
  { title: 'Love Yourself', titleKo: '러브 유어셀프', artist: 'Justin Bieber', artistKo: '저스틴 비버' },
  { title: 'Peaches', titleKo: '피치스', artist: 'Justin Bieber', artistKo: '저스틴 비버' },
  { title: "That's Hilarious", titleKo: '댓츠 힐래리어스', artist: 'Charlie Puth', artistKo: '찰리 푸스' },
  { title: 'Unholy', titleKo: '언홀리', artist: 'Sam Smith, Kim Petras', artistKo: '샘 스미스, 킴 페트라스' },
  { title: 'As It Was', titleKo: '애즈잇 와즈', artist: 'Harry Styles', artistKo: '해리 스타일스' },
  { title: 'Anti-Hero', titleKo: '앤티 히어로', artist: 'Taylor Swift', artistKo: '테일러 스위프트' },
  { title: 'Blinding Lights', titleKo: '블라인딩 라이츠', artist: 'The Weeknd', artistKo: '더 위켄드' },
  { title: 'Shallow', titleKo: '셜로우', artist: 'Lady Gaga, Bradley Cooper', artistKo: '레이디 가가, 브래들리 쿠퍼' },
  { title: 'Leave The Door Open', titleKo: '리브 더 도어 오픈', artist: 'Bruno Mars, Anderson .Paak, Silk Sonic', artistKo: '브루노 마스, 앤더슨 팩, 실크 소닉' },
  { title: 'Count On Me', titleKo: '카운트 온 미', artist: 'Bruno Mars', artistKo: '브루노 마스' },
  { title: 'Treasure', titleKo: '트레저', artist: 'Bruno Mars', artistKo: '브루노 마스' },
  { title: 'Payphone', titleKo: '페이폰', artist: 'Maroon 5', artistKo: '마룬 파이브' },
  { title: 'Moves Like Jagger', titleKo: '무브스 라이크 재거', artist: 'Maroon 5', artistKo: '마룬 파이브' },
  { title: 'Maps', titleKo: '맵스', artist: 'Maroon 5', artistKo: '마룬 파이브' },
  { title: 'Day 1', titleKo: '데이 원', artist: 'Honne', artistKo: '혼네' },
  { title: 'Know Me Too Well', titleKo: '노 미 투 웰', artist: 'New Hope Club', artistKo: '뉴 호프 클럽' },
  { title: '7 Years', titleKo: '세븐 이어즈', artist: 'Lukas Graham', artistKo: '루카스 그래엄' },
  { title: 'Youth', titleKo: '유스', artist: 'Troye Sivan', artistKo: '트로이 시반' },
  { title: 'Espresso', titleKo: '에스프레소', artist: 'Sabrina Carpenter', artistKo: '사브리나 카펜터' },
]

function normalizeAnswer(s) {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[."""'''『』「」\[\]()（）{}<>〈〉《》·・…~\-_/\\|:;!?！？。，、]/g, '')
}

function uniq(arr) {
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))]
}

function splitArtists(en, ko) {
  const enParts = en.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)
  const koParts = ko.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)
  return enParts.map((name, i) => ({
    answer: name,
    accepts: uniq([name, koParts[i]].filter(Boolean)),
  }))
}

async function ytSearchId(query) {
  const { stdout } = await execFileAsync(
    'yt-dlp',
    ['ytsearch1:' + query, '--print', '%(id)s', '--no-playlist', '--skip-download'],
    { timeout: 60000, windowsHide: true },
  )
  const id = String(stdout).trim().split(/\r?\n/).filter(Boolean)[0]
  if (!id || id.length !== 11) throw new Error(`yt id 실패: ${query} → ${stdout}`)
  return id
}

async function main() {
  const genre = await prisma.genre.findUnique({ where: { name: '해외노래' } })
  if (!genre) throw new Error('해외노래 장르 없음')

  const titleSlots = await prisma.answerSlot.findMany({
    where: { label: { contains: '제목' }, question: { enabled: true } },
    select: { answer: true, acceptAnswers: true },
  })
  const existingNorms = new Set()
  for (const s of titleSlots) {
    existingNorms.add(normalizeAnswer(s.answer))
    try {
      for (const a of JSON.parse(s.acceptAnswers || '[]')) existingNorms.add(normalizeAnswer(a))
    } catch { /* ignore */ }
  }

  const skipped = []
  const toAdd = []
  for (const song of SONGS) {
    const norms = [song.title, song.titleKo].map(normalizeAnswer)
    if (norms.some((n) => existingNorms.has(n))) {
      skipped.push(song.title)
      continue
    }
    toAdd.push(song)
  }

  console.log(`목록 ${SONGS.length} · 중복스킵 ${skipped.length} · 추가예정 ${toAdd.length}`)
  if (skipped.length) console.log('스킵:', skipped.join(', '))

  const created = []
  const errors = []

  for (let i = 0; i < toAdd.length; i++) {
    const song = toAdd[i]
    const q = `${song.title} ${song.artist.split(',')[0].trim()} official audio`
    process.stdout.write(`[${i + 1}/${toAdd.length}] ${song.title} ... `)
    try {
      const videoId = await ytSearchId(q)
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`
      const artists = splitArtists(song.artist, song.artistKo)
      const titleAccepts = uniq([song.title, song.titleKo])
      // Maps 별칭
      if (song.title === 'Maps') titleAccepts.push('Map', '맵')

      const slots = [
        { label: '노래 제목', answer: song.title, acceptAnswers: titleAccepts, hidden: false, sortOrder: 0 },
        ...artists.map((a, idx) => ({
          label: '가수',
          answer: a.answer,
          acceptAnswers: a.accepts,
          hidden: false,
          sortOrder: idx + 1,
        })),
      ]

      // 슬롯 간 인정답 충돌 방지(같은 문제 내)
      const seen = new Set()
      for (const s of slots) {
        const cleaned = []
        for (const a of uniq([s.answer, ...s.acceptAnswers])) {
          const n = normalizeAnswer(a)
          if (!n || seen.has(n)) continue
          seen.add(n)
          cleaned.push(a)
        }
        s.acceptAnswers = cleaned
      }

      await prisma.question.create({
        data: {
          youtubeUrl,
          startSec: 40,
          endSec: 80,
          genreId: genre.id,
          tags: '[]',
          enabled: true,
          slots: {
            create: slots.map((s) => ({
              label: s.label,
              answer: s.answer,
              acceptAnswers: JSON.stringify(s.acceptAnswers),
              hidden: s.hidden,
              sortOrder: s.sortOrder,
            })),
          },
        },
      })
      for (const a of titleAccepts) existingNorms.add(normalizeAnswer(a))
      created.push({ title: song.title, videoId })
      console.log(videoId)
    } catch (e) {
      console.log('FAIL')
      errors.push({ title: song.title, error: String(e.message || e) })
    }
  }

  console.log(`\n생성 ${created.length} · 실패 ${errors.length} · 스킵 ${skipped.length}`)
  if (errors.length) console.log(errors)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
