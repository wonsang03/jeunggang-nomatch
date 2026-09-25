/**
 * 강제곡·환상 곡 뽑기 (트루먼쇼·세노·에라모르겠다 등)와 야차룰 대결 문제 뽑기.
 */
import type { Server } from 'socket.io'
import { extractYoutubeId } from './answer.js'
import { loadGenreQuestions } from './bankCache.js'
import { prisma } from './config.js'
import type { Member, QuestionRuntime, Room } from './gameTypes.js'
import { YACHA_GENRE } from './genres.js'
import { isTrumanIllusion } from './memberBuffs.js'
import { toQuestionRuntime, toQueueQuestion } from './questionQueue.js'
import { shuffleArray } from './random.js'

export function isGameGenre(genre: string) {
  const g = (genre || '').toLowerCase()
  return g.includes('메이플') || g.includes('리겜') || g.includes('게임')
}

export async function pickDecoyTrack(
  room: Room,
  extraExcludeYt: string[] = [],
): Promise<{
  youtubeUrl: string
  startSec: number
  endSec: number
  slots: QuestionRuntime['slots']
  genre: string
  titleChosung: string
  artistChosung: string
} | null> {
  // 트루먼쇼: 지금 방 라운드와 같은 장르 · 큐/직전 디코이 제외 랜덤
  const usedIds = new Set(room.queue.map((q) => q.id))
  const usedYt = new Set(
    room.queue
      .map((q) => extractYoutubeId(q.youtubeUrl))
      .filter((id): id is string => !!id),
  )
  for (const yt of extraExcludeYt) {
    if (yt) usedYt.add(yt)
  }
  const cur = room.queue[room.index]
  const curYt = cur ? extractYoutubeId(cur.youtubeUrl) : null
  if (curYt) usedYt.add(curYt)
  const genreName = (cur?.genre || '').trim()

  // 라운드 시작을 붙잡고 도는 경로라 은행을 매번 읽지 않고 캐시에서 가져온다
  const list = genreName ? await loadGenreQuestions(genreName) : []
  // 동 장르가 비면(장르명 불일치 등) 전체로 폴백
  const allList = list.length
    ? list
    : await prisma.question.findMany({
        where: { enabled: true },
        include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
      })

  const unused = allList.filter((q) => {
    if (usedIds.has(q.id)) return false
    const yt = extractYoutubeId(q.youtubeUrl)
    if (!yt) return false
    if (usedYt.has(yt)) return false
    return true
  })
  const pool = unused.length
    ? unused
    : allList.filter((q) => {
        const yt = extractYoutubeId(q.youtubeUrl)
        return !!yt && yt !== curYt
      })
  if (!pool.length) return null
  const q = pool[Math.floor(Math.random() * pool.length)]
  // 제목만 방인데 가짜 곡만 「가수」 슬롯이 붙어 나오면 환상이 바로 들통난다
  const rt = toQueueQuestion(room, q)
  return {
    youtubeUrl: rt.youtubeUrl,
    startSec: rt.startSec,
    endSec: rt.endSec,
    slots: rt.slots.filter((s) => !s.hidden),
    genre: rt.genre,
    titleChosung: rt.titleChosung,
    artistChosung: rt.artistChosung,
  }
}

/** 트루먼 활성 라운드마다 다른 가짜 곡·슬롯으로 갱신 */
export async function refreshTrumanDecoyForRound(room: Room, m: Member): Promise<boolean> {
  if (!isTrumanIllusion(m, room.index) || !m.sakuraDecoy) return false
  const decoy = m.sakuraDecoy
  const picked = await pickDecoyTrack(room, decoy.usedDecoyYt)
  if (!picked || !picked.slots.length) return false
  const yt = extractYoutubeId(picked.youtubeUrl)
  decoy.youtubeUrl = picked.youtubeUrl
  decoy.startSec = picked.startSec
  decoy.endSec = picked.endSec
  decoy.slots = picked.slots
  decoy.genre = picked.genre
  decoy.titleChosung = picked.titleChosung
  decoy.artistChosung = picked.artistChosung
  decoy.fakeRevealed = {}
  if (yt && !decoy.usedDecoyYt.includes(yt)) decoy.usedDecoyYt.push(yt)
  return true
}

export function emitIllusionRound(io: Server, m: Member) {
  if (!m.sakuraDecoy || m.sakuraDecoy.mode !== 'truman' || !m.sakuraDecoy.slots.length) return
  const decoy = m.sakuraDecoy
  io.to(m.socketId).emit('illusion:round', {
    slots: decoy.slots.map((s) => ({
      id: s.id,
      label: s.label,
      revealed: false,
      hidden: false,
      unlocked: true,
      chosung: s.chosung || '',
    })),
    genre: decoy.genre,
    titleChosung: decoy.titleChosung,
    artistChosung: decoy.artistChosung,
  })
}

/** 제목 슬롯에 특정 문자열이 포함된 곡 (세노 등) · effectValue에 youtubeUrl 있으면 고정 재생 */
export async function pickNamedTrack(
  room: Room,
  titleIncludes: string,
  fixed?: { youtubeUrl?: string; startSec?: number },
): Promise<{ youtubeUrl: string; startSec: number } | null> {
  const fixedUrl = String(fixed?.youtubeUrl || '').trim()
  if (fixedUrl) {
    const startRaw = Number(fixed?.startSec)
    return {
      youtubeUrl: fixedUrl,
      startSec: Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0,
    }
  }
  const needle = titleIncludes.trim().toLowerCase()
  if (!needle) return null
  const titleOf = (slots: { label: string; answer: string }[]) =>
    slots.find((s) => s.label.includes('제목'))?.answer || ''

  const fromQueue = room.queue.filter((q) => titleOf(q.slots).toLowerCase().includes(needle))
  if (fromQueue.length > 0) {
    const q = fromQueue[Math.floor(Math.random() * fromQueue.length)]
    return { youtubeUrl: q.youtubeUrl, startSec: q.startSec }
  }

  const list = await prisma.question.findMany({
    where: {
      enabled: true,
      slots: { some: { answer: { contains: titleIncludes.trim() } } },
    },
    include: { slots: true },
    take: 40,
  })
  const preferred = list.filter((q) => titleOf(q.slots).toLowerCase().includes(needle))
  const pool = preferred.length ? preferred : list
  if (!pool.length) return null
  const q = pool[Math.floor(Math.random() * pool.length)]
  return { youtubeUrl: q.youtubeUrl, startSec: q.startSec }
}

/** 야차룰: 기타 장르만 · 큐에 없는 새 곡 · 제목 슬롯만 */
export async function pickDuelQuestion(room: Room): Promise<QuestionRuntime | null> {
  try {
    const excludeIds = new Set(room.queue.map((q) => q.id))
    const currentYt = room.queue[room.index] ? extractYoutubeId(room.queue[room.index].youtubeUrl) : null
    const list = await prisma.question.findMany({
      where: { enabled: true, genre: { name: YACHA_GENRE } },
      include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
    })
    if (!list.length) return null
    const preferred = list.filter((q) => !excludeIds.has(q.id) && extractYoutubeId(q.youtubeUrl) !== currentYt)
    const fallback = list.filter((q) => extractYoutubeId(q.youtubeUrl) !== currentYt)
    const candidates = preferred.length ? preferred : (fallback.length ? fallback : list)
    const pool = shuffleArray(candidates)
    for (const q of pool) {
      const rt = toQuestionRuntime(q)
      const title = rt.slots.find((s) => !s.hidden && s.label.includes('제목'))
        || rt.slots.find((s) => !s.hidden)
      if (!title) continue
      return {
        ...rt,
        artistChosung: '',
        slots: [{ ...title, hidden: false, label: title.label.includes('제목') ? title.label : '제목' }],
      }
    }
    return null
  } catch (err) {
    console.error('[yacha_duel] pickDuelQuestion failed', err)
    return null
  }
}
