/**
 * 해외노래 배치2: 음원(official audio/topic) 검색으로 추가 + 체크.md 생성
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PrismaClient } from '@prisma/client'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const prisma = new PrismaClient()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

/** @type {Array<{ title: string, titleKo: string, artist: string, artistKo: string, search?: string }>} */
const SONGS = [
  { title: "I Don't Think That I Like Her", titleKo: '아이 돈 띵크 댓 아이 라이크 허', artist: 'Charlie Puth', artistKo: '찰리 푸스' },
  { title: 'Light Switch', titleKo: '라이트 스위치', artist: 'Charlie Puth', artistKo: '찰리 푸스' },
  { title: 'Snowman', titleKo: '스노우맨', artist: 'Sia', artistKo: '시아' },
  { title: 'Suncity', titleKo: '선시티', artist: 'Khalid', artistKo: '칼리드' },
  { title: 'Honolulu Bicycle Club', titleKo: '호놀룰루 바이시클 클럽', artist: 'Kaeru', artistKo: '카에루' },
  { title: 'Honesty', titleKo: '어네스티', artist: 'Pink Sweat$', artistKo: '핑크 스웨츠', search: 'Honesty Pink Sweat$ official audio' },
  { title: 'Off My Face', titleKo: '오프 마이 페이스', artist: 'Justin Bieber', artistKo: '저스틴 비버' },
  { title: 'Ghost', titleKo: '고스트', artist: 'Justin Bieber', artistKo: '저스틴 비버' },
  { title: 'Double Take', titleKo: '더블 테이크', artist: 'dhruv', artistKo: '드루브' },
  { title: 'Fly Me To The Moon', titleKo: '플라이 미 투 더 문', artist: 'Frank Sinatra', artistKo: '프랭크 시나트라' },
  { title: 'L-O-V-E', titleKo: '러브', artist: 'Nat King Cole', artistKo: '냇 킹 콜' },
  { title: "Isn't She Lovely", titleKo: '이즈nt 쉬 러블리', artist: 'Stevie Wonder', artistKo: '스티비 원더' },
  { title: 'Supermarket Flowers', titleKo: '슈퍼마켓 플라워스', artist: 'Ed Sheeran', artistKo: '에드 시런' },
  { title: 'Thinking Out Loud', titleKo: '띵킹 아웃 라우드', artist: 'Ed Sheeran', artistKo: '에드 시런' },
  { title: 'Perfect', titleKo: '퍼펙트', artist: 'Ed Sheeran', artistKo: '에드 시런' },
  { title: 'Unreachable', titleKo: '언리처블', artist: 'Slchld', artistKo: '슬칠' },
  { title: 'I Like Me Better', titleKo: '아이 라이크 미 베터', artist: 'Lauv', artistKo: '라우브' },
  { title: 'Steal The Show', titleKo: '스틸 더 쇼', artist: 'Lauv', artistKo: '라우브' },
  { title: 'Memories', titleKo: '메모리즈', artist: 'Maroon 5', artistKo: '마룬 파이브' },
  { title: 'Girls Like You', titleKo: '걸스 라이크 유', artist: 'Maroon 5', artistKo: '마룬 파이브' },
  { title: '24K Magic', titleKo: '투엔티포케이 매직', artist: 'Bruno Mars', artistKo: '브루노 마스' },
  { title: "That's What I Like", titleKo: '댓츠 왓 아이 라이크', artist: 'Bruno Mars', artistKo: '브루노 마스' },
  { title: 'Runaway Baby', titleKo: '런어웨이 베이비', artist: 'Bruno Mars', artistKo: '브루노 마스' },
  { title: 'Easy', titleKo: '이지', artist: 'Mac Ayres', artistKo: '맥 에이리스' },
  { title: 'Best Part', titleKo: '베스트 파트', artist: 'Daniel Caesar, H.E.R.', artistKo: '다니엘 시저, 허' },
  { title: 'Get You', titleKo: '겟 유', artist: 'Daniel Caesar', artistKo: '다니엘 시저' },
  { title: 'Heavy', titleKo: '헤비', artist: 'Anne-Marie', artistKo: '앤 마리' },
  { title: 'Birthday', titleKo: '버스데이', artist: 'Anne-Marie', artistKo: '앤 마리' },
  { title: 'To Find You', titleKo: '투 파인드 유', artist: 'Sing Street', artistKo: '싱 스트리트', search: 'To Find You Sing Street OST official audio' },
  { title: 'Falling Slowly', titleKo: '폴링 슬로우리', artist: 'Glen Hansard, Marketa Irglova', artistKo: '글렌 한사드, 마케타 이르글로바', search: 'Falling Slowly Once OST official audio' },
  { title: 'Lost In Japan', titleKo: '로스트 인 재팬', artist: 'Shawn Mendes', artistKo: '숀 멘데스' },
  { title: "There's Nothing Holdin' Me Back", titleKo: '데어스 나띵 홀딩 미 백', artist: 'Shawn Mendes', artistKo: '숀 멘데스' },
  { title: 'Symphony', titleKo: '심포니', artist: 'Clean Bandit, Zara Larsson', artistKo: '클린 밴디트, 자라 라슨' },
  { title: 'Rather Be', titleKo: '래더 비', artist: 'Clean Bandit, Jess Glynne', artistKo: '클린 밴디트, 제스 글린' },
  { title: 'Solo', titleKo: '솔로', artist: 'Clean Bandit, Demi Lovato', artistKo: '클린 밴디트, 데미 로바토' },
  { title: 'FRIENDS', titleKo: '프렌즈', artist: 'Marshmello, Anne-Marie', artistKo: '마슈멜로, 앤 마리' },
  { title: 'Happier', titleKo: '해피어', artist: 'Marshmello, Bastille', artistKo: '마슈멜로, 바스티유' },
  { title: 'Faded', titleKo: '페이디드', artist: 'Alan Walker', artistKo: '알렌 워커' },
  { title: 'The Spectre', titleKo: '더 스펙터', artist: 'Alan Walker', artistKo: '알렌 워커' },
  { title: 'Heroes', titleKo: '히어로즈', artist: 'Alesso, Tove Lo', artistKo: '알레소, 토브 로', search: 'Alesso Tove Lo Heroes official audio' },
  { title: 'Firework', titleKo: '파이어워크', artist: 'Katy Perry', artistKo: '케이티 페리' },
  { title: 'California Gurls', titleKo: '캘리포니아 걸스', artist: 'Katy Perry', artistKo: '케이티 페리' },
  { title: 'Last Friday Night', titleKo: '라스트 프라이데이 나이트', artist: 'Katy Perry', artistKo: '케이티 페리', search: 'Katy Perry Last Friday Night T.G.I.F. official audio' },
  { title: 'Payphone', titleKo: '페이폰', artist: 'Maroon 5', artistKo: '마룬 파이브', search: 'Maroon 5 Payphone acoustic official audio' },
  { title: 'One Call Away', titleKo: '원 콜 어웨이', artist: 'Charlie Puth', artistKo: '찰리 푸스' },
  { title: 'Attention', titleKo: '어텐션', artist: 'Charlie Puth', artistKo: '찰리 푸스', search: 'Charlie Puth Attention official audio' },
  { title: 'How Long', titleKo: '하우롱', artist: 'Charlie Puth', artistKo: '찰리 푸스' },
  { title: 'Snooze', titleKo: '스누즈', artist: 'SZA', artistKo: '에스지에이', search: 'SZA Snooze official audio' },
  { title: 'Golden Hour', titleKo: '골든 아워', artist: 'JVKE', artistKo: '제이크' },
]

// 애매해서 제외: Sometimes(Crush/Audrey Nuna), Speed Limit(Keane), 2002 acoustic, Versatile 모음
const EXTRA_TITLE_ACCEPTS = {
  Honesty: ['아니스티'],
  "Isn't She Lovely": ['이즌트 쉬 러블리', '이즈nt 쉬 러블리'],
}

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

async function ytSearchAudio(song) {
  const queries = [
    song.search,
    `${song.title} ${song.artist.split(',')[0].trim()} official audio`,
    `${song.title} ${song.artist.split(',')[0].trim()} audio`,
    `${song.title} ${song.artist.split(',')[0].trim()} topic`,
  ].filter(Boolean)

  let lastErr
  for (const q of queries) {
    try {
      const { stdout } = await execFileAsync(
        'yt-dlp',
        ['ytsearch1:' + q, '--print', '%(id)s\t%(title)s', '--no-playlist', '--skip-download'],
        { timeout: 70000, windowsHide: true },
      )
      const line = String(stdout).trim().split(/\r?\n/).filter(Boolean)[0] || ''
      const [id, ...rest] = line.split('\t')
      if (id && id.length === 11) return { id, foundTitle: rest.join('\t'), query: q }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('검색 실패')
}

async function findExistingOverseas(title) {
  const slots = await prisma.answerSlot.findMany({
    where: {
      label: { contains: '제목' },
      question: { enabled: true, genre: { name: '해외노래' } },
    },
    include: { question: true },
  })
  const n = normalizeAnswer(title)
  for (const s of slots) {
    if (normalizeAnswer(s.answer) === n) return s.question
    try {
      for (const a of JSON.parse(s.acceptAnswers || '[]')) {
        if (normalizeAnswer(a) === n) return s.question
      }
    } catch { /* ignore */ }
  }
  // Attention: 같은 제목 한국노래와 구분 — 해외+가수 Charlie만 중복
  return null
}

async function patchAccepts(questionId, song) {
  const slots = await prisma.answerSlot.findMany({ where: { questionId }, orderBy: { sortOrder: 'asc' } })
  const artists = splitArtists(song.artist, song.artistKo)
  for (const s of slots) {
    let accepts = []
    try { accepts = JSON.parse(s.acceptAnswers || '[]') } catch { accepts = [] }
    if (s.label.includes('제목')) {
      const extra = EXTRA_TITLE_ACCEPTS[song.title] || []
      accepts = uniq([s.answer, ...accepts, song.titleKo, ...extra])
      await prisma.answerSlot.update({
        where: { id: s.id },
        data: {
          answer: /[\uac00-\ud7a3]/.test(s.answer) ? song.title : s.answer,
          acceptAnswers: JSON.stringify(accepts),
        },
      })
    } else if (s.label.includes('가수')) {
      const match = artists.find((a) => normalizeAnswer(a.answer) === normalizeAnswer(s.answer)
        || normalizeAnswer(s.answer).includes(normalizeAnswer(a.answer))
        || normalizeAnswer(a.answer).includes(normalizeAnswer(s.answer)))
      if (match) {
        accepts = uniq([s.answer, ...accepts, ...match.accepts])
        await prisma.answerSlot.update({
          where: { id: s.id },
          data: {
            answer: /[\uac00-\ud7a3]/.test(s.answer) ? match.answer : s.answer,
            acceptAnswers: JSON.stringify(accepts),
          },
        })
      }
    }
  }
}

async function main() {
  const genre = await prisma.genre.findUnique({ where: { name: '해외노래' } })
  if (!genre) throw new Error('해외노래 장르 없음')

  /** @type {Array<{ title: string, artist: string, url: string, status: string, videoTitle?: string }>} */
  const rows = []
  let created = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < SONGS.length; i++) {
    const song = SONGS[i]
    process.stdout.write(`[${i + 1}/${SONGS.length}] ${song.title} ... `)

    // Payphone acoustic: 기존 Payphone과 제목 같아도 별도 음원이면 추가하되, 제목을 구분
    const titleForDup = song.search?.includes('acoustic') && song.title === 'Payphone'
      ? 'Payphone (Acoustic)'
      : song.title

    const existing = titleForDup === 'Payphone (Acoustic)'
      ? await findExistingOverseas('Payphone (Acoustic)')
      : await findExistingOverseas(song.title)

    // Charlie Puth Attention vs NewJeans — 해외노래에만 있으면 스킵
    if (existing && !(song.title === 'Attention' && song.artist.includes('Charlie'))) {
      await patchAccepts(existing.id, song)
      rows.push({
        title: song.title,
        artist: song.artist,
        url: existing.youtubeUrl,
        status: '중복스킵(발음보강)',
      })
      skipped += 1
      console.log('SKIP', existing.youtubeUrl)
      continue
    }
    if (existing && song.title === 'Attention') {
      // 해외노래에 이미 Charlie Attention 있으면 스킵
      const artists = await prisma.answerSlot.findMany({ where: { questionId: existing.id, label: { contains: '가수' } } })
      if (artists.some((a) => /charlie|푸스|puth/i.test(a.answer))) {
        await patchAccepts(existing.id, song)
        rows.push({ title: song.title, artist: song.artist, url: existing.youtubeUrl, status: '중복스킵(발음보강)' })
        skipped += 1
        console.log('SKIP', existing.youtubeUrl)
        continue
      }
    }

    try {
      const { id, foundTitle, query } = await ytSearchAudio(song)
      const youtubeUrl = `https://www.youtube.com/watch?v=${id}`
      const displayTitle = titleForDup === 'Payphone (Acoustic)' ? 'Payphone (Acoustic)' : song.title
      const artists = splitArtists(song.artist, song.artistKo)
      const titleAccepts = uniq([
        displayTitle,
        song.title,
        song.titleKo,
        ...(EXTRA_TITLE_ACCEPTS[song.title] || []),
      ])

      const slots = [
        { label: '노래 제목', answer: displayTitle, acceptAnswers: titleAccepts, hidden: false, sortOrder: 0 },
        ...artists.map((a, idx) => ({
          label: '가수',
          answer: a.answer,
          acceptAnswers: a.accepts,
          hidden: false,
          sortOrder: idx + 1,
        })),
      ]

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
      created += 1
      rows.push({
        title: displayTitle,
        artist: song.artist,
        url: youtubeUrl,
        status: '신규',
        videoTitle: foundTitle,
      })
      console.log(id, `(${query})`)
    } catch (e) {
      failed += 1
      rows.push({
        title: song.title,
        artist: song.artist,
        url: '',
        status: `실패: ${e.message || e}`,
      })
      console.log('FAIL', e.message || e)
    }
  }

  const md = [
    '# 해외노래 배치2 유튜브 체크',
    '',
    `생성 ${created} · 스킵 ${skipped} · 실패 ${failed} · 총 ${rows.length}`,
    '',
    '애매해서 **제외**: Sometimes(Crush/Audrey Nuna), Speed Limit(Keane), 2002 acoustic, Versatile 모음류',
    '',
    '| # | 상태 | 제목 | 가수 | 링크 |',
    '|--:|:--|:--|:--|:--|',
    ...rows.map((r, i) => {
      const link = r.url ? `[열기](${r.url})` : '-'
      return `| ${i + 1} | ${r.status} | ${r.title} | ${r.artist} | ${link} |`
    }),
    '',
    '## 링크 목록',
    '',
    ...rows.filter((r) => r.url).map((r) => `- [${r.title} — ${r.artist}](${r.url})`),
    '',
  ].join('\n')

  const outPath = path.join(ROOT, '체크.md')
  fs.writeFileSync(outPath, md, 'utf8')
  console.log(`\n체크 파일: ${outPath}`)
  console.log(`생성 ${created} · 스킵 ${skipped} · 실패 ${failed}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
