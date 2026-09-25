/**
 * 이번 판 곡 큐 — 은행에서 뽑기(최근곡 가중치), DB 행 → 런타임 문제 변환,
 * 노래 수 증강(반전 술식·셔플·밴픽)과 야차 실패 보정의 남은 큐 재배분.
 */
import {
  extractYoutubeId,
  normalizeAnswer,
  hintChosung,
  expandArtistAccepts,
  expandTitleAccepts,
} from './answer.js'
import { applyAnswerMode } from './answerFormat.js'
import { pickRandomIndex, shuffleArray } from './random.js'
import { loadGenreBankCounts, loadGenreQuestions } from './bankCache.js'
import type { QuestionRuntime, Room } from './gameTypes.js'
import { PLAYABLE_GENRES, isPlayableGenre } from './genres.js'
import { isArtistLikeLabel, isTitleLikeLabel, toSlotRows } from './roundRules.js'
import { memoryWindow, songWeight, weightedShuffle, type SongMemory } from './songPick.js'
import { parseTagsJson } from './tags.js'

export async function clampGenreCounts(counts: Record<string, number>): Promise<Record<string, number>> {
  const bank = await loadGenreBankCounts()
  const out: Record<string, number> = {}
  for (const name of PLAYABLE_GENRES) {
    const max = bank[name] ?? 0
    const v = Math.max(0, Math.min(max, Math.floor(Number(counts?.[name]) || 0)))
    out[name] = v
  }
  return out
}

/** 기본 ON: 최근에 나온 곡일수록 덜 뽑힘 */
export const DEFAULT_RECENT_SONG_PENALTY = 1

export function clampRecentSongPenalty(n: unknown) {
  const v = Number(n)
  if (!Number.isFinite(v)) return DEFAULT_RECENT_SONG_PENALTY
  return Math.max(0, Math.min(1, Math.round(v * 100) / 100))
}

/**
 * 가중 비복원 추출.
 *
 * 순서를 정하는 방식만 다를 뿐 고르는 절차는 예전과 같다 — 풀을 섞고 앞에서부터
 * 중복(같은 문제·같은 영상)을 걸러가며 count개를 뗀다. weightOf 가 전부 1이면
 * 균등 추첨과 분포가 같다.
 */
export function pickUniqueQuestions<T extends { id: string; youtubeUrl: string }>(
  list: T[],
  count: number,
  usedIds: Set<string>,
  usedYt: Set<string>,
  weightOf: (q: T) => number,
): T[] {
  const pool = weightedShuffle(
    list.filter((q) => {
      if (usedIds.has(q.id)) return false
      const yt = extractYoutubeId(q.youtubeUrl)
      if (yt && usedYt.has(yt)) return false
      return true
    }),
    weightOf,
  )
  const picked: T[] = []
  for (const q of pool) {
    if (picked.length >= count) break
    usedIds.add(q.id)
    const yt = extractYoutubeId(q.youtubeUrl)
    if (yt) usedYt.add(yt)
    picked.push(q)
  }
  return picked
}

/**
 * 방 설정대로 큐를 뽑는다.
 *
 * penalty > 0 이면 이 방에서 최근에 나온 곡의 가중치를 낮춘다. 후보에서 빼는 게
 * 아니라서 은행이 작아도 뽑을 곡이 마르지 않고, 기억 기간은 장르마다 은행 크기에
 * 맞춰 따로 잡는다. penalty = 0 이면 전 곡 가중치가 같아 균등 추첨이 된다.
 */
export async function pickQuestions(
  genreCounts: Record<string, number>,
  opts?: { memory?: SongMemory; recentPenalty?: number },
): Promise<QuestionRuntime[]> {
  const out: QuestionRuntime[] = []
  const usedIds = new Set<string>()
  const usedYt = new Set<string>()
  const penalty = clampRecentSongPenalty(opts?.recentPenalty ?? 0)
  const memory = penalty > 0 ? opts?.memory : undefined

  const entries = Object.entries(genreCounts).filter(
    ([genreName, count]) => count > 0 && isPlayableGenre(genreName),
  )
  const genreRows = await Promise.all(
    entries.map(async ([genreName, count]) => {
      const list = await loadGenreQuestions(genreName)
      if (!list.length) return null
      return { genreName, count, list }
    }),
  )

  for (const row of genreRows) {
    if (!row) continue
    const window = memoryWindow(row.list.length, row.count)
    const weightOf = memory
      ? (q: { id: string }) => songWeight(memory, q.id, window, penalty)
      : () => 1
    const picked = pickUniqueQuestions(row.list, row.count, usedIds, usedYt, weightOf)
    for (const q of picked) out.push(toQuestionRuntime(q))
  }
  return shuffleArray(out)
}

export type DbQuestionWithSlots = {
  id: string
  youtubeUrl: string
  startSec: number
  endSec: number
  tags?: string | null
  genre: { name: string }
  slots: Array<{
    id: string
    label: string
    answer: string
    acceptAnswers: string
    hidden: boolean
  }>
}

export function toQuestionRuntime(q: DbQuestionWithSlots): QuestionRuntime {
  const rows = q.slots.flatMap(toSlotRows)
  const titleSlot = rows.find((s) => !s.hidden && isTitleLikeLabel(s.label))
    || rows.find((s) => !s.hidden && !isArtistLikeLabel(s.label))
    || rows.find((s) => !s.hidden)
  const artistSlots = rows.filter((s) => !s.hidden && isArtistLikeLabel(s.label))
  const title = titleSlot?.answer || ''
  const titleAccepts = titleSlot ? expandTitleAccepts(titleSlot.answer, titleSlot.accepts) : []
  const artistChosungParts = artistSlots
    .map((s) => hintChosung(s.answer, expandArtistAccepts(s.answer, s.accepts)))
    .filter(Boolean)

  return {
    id: q.id,
    youtubeUrl: q.youtubeUrl,
    startSec: q.startSec,
    endSec: q.endSec,
    genre: q.genre.name,
    tags: parseTagsJson(q.tags),
    titleChosung: title ? hintChosung(title, titleAccepts) : '',
    artistChosung: artistChosungParts.join(' / '),
    slots: rows.map((s) => {
      const isArtist = isArtistLikeLabel(s.label)
      const expanded = isArtist
        ? expandArtistAccepts(s.answer, s.accepts)
        : isTitleLikeLabel(s.label)
          ? expandTitleAccepts(s.answer, s.accepts)
          : s.accepts
      const acceptNorms = [...new Set([s.answer, ...expanded].map(normalizeAnswer))]
      return {
        id: s.id,
        label: s.label,
        answer: s.answer,
        accepts: expanded,
        acceptNorms,
        hidden: s.hidden,
        chosung: hintChosung(s.answer, expanded),
      }
    }),
  }
}

/** 게임 중 큐를 보충할 때도 방의 정답 모드(제목만 등)를 그대로 적용한다 */
export function toQueueQuestion(room: Room, q: DbQuestionWithSlots): QuestionRuntime {
  const reading = room.gameMode === 'reading'
  const mode = reading ? 'title' : (room.answerMode || 'title_artist')
  return applyAnswerMode(toQuestionRuntime(q), mode, !reading)
}

/** 남은 곡(현재 포함)에서 최소·최대 장르 잔량을 서로 바꿈. 현재 재생 곡은 유지. */
export async function swapExtremeGenreRemaining(room: Room): Promise<{ ok: boolean; hint: string }> {
  const from = room.index
  const rest = room.queue.slice(from)
  if (rest.length < 2) return { ok: false, hint: '남은 곡이 부족합니다' }

  const counts = new Map<string, number>()
  for (const q of rest) counts.set(q.genre, (counts.get(q.genre) || 0) + 1)
  if (counts.size < 2) return { ok: false, hint: '남은 장르가 1개뿐이라 반전할 수 없습니다' }

  let minGenre = ''
  let maxGenre = ''
  let minC = Infinity
  let maxC = -1
  for (const [g, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
    if (c < minC) {
      minC = c
      minGenre = g
    }
    if (c > maxC) {
      maxC = c
      maxGenre = g
    }
  }
  if (!minGenre || !maxGenre || minGenre === maxGenre || minC === maxC) {
    return { ok: false, hint: '장르 잔량이 같아 반전할 수 없습니다' }
  }

  const delta = maxC - minC
  const current = rest[0]
  let upcoming = rest.slice(1)

  const usedIds = new Set(room.queue.map((q) => q.id))
  const usedYt = new Set(
    room.queue.map((q) => extractYoutubeId(q.youtubeUrl)).filter((x): x is string => !!x),
  )

  const pool = await loadGenreQuestions(minGenre)
  if (!pool.length) return { ok: false, hint: `${minGenre} 장르를 찾을 수 없습니다` }
  const extras: QuestionRuntime[] = []
  for (const q of shuffleArray(pool)) {
    if (extras.length >= delta) break
    if (usedIds.has(q.id)) continue
    const yt = extractYoutubeId(q.youtubeUrl)
    if (yt && usedYt.has(yt)) continue
    usedIds.add(q.id)
    if (yt) usedYt.add(yt)
    extras.push(toQueueQuestion(room, q))
  }

  if (extras.length === 0) {
    return { ok: false, hint: `${minGenre} 곡을 은행에서 더 가져올 수 없습니다` }
  }

  const n = extras.length
  const removeIdx: number[] = []
  for (let i = upcoming.length - 1; i >= 0 && removeIdx.length < n; i--) {
    if (upcoming[i].genre === maxGenre) removeIdx.push(i)
  }
  if (removeIdx.length < n) {
    return {
      ok: false,
      hint: `앞으로 나올 ${maxGenre} 곡이 부족해 반전할 수 없습니다 (현재 곡은 유지)`,
    }
  }

  const drop = new Set(removeIdx)
  upcoming = upcoming.filter((_, i) => !drop.has(i))
  upcoming = shuffleArray([...upcoming, ...extras])

  room.queue = [...room.queue.slice(0, from), current, ...upcoming]

  const afterMin = minC + n
  const afterMax = maxC - n
  return {
    ok: true,
    hint: `${minGenre} ${minC}↔${afterMin} · ${maxGenre} ${maxC}↔${afterMax} (남은 곡 잔량 반전)`,
  }
}

/** 남은 곡(현재 제외) 장르 잔량을 평균에 가깝게 맞춤 */
export async function equalizeGenreRemaining(room: Room): Promise<{ ok: boolean; hint: string }> {
  const from = room.index
  const rest = room.queue.slice(from)
  if (rest.length < 2) return { ok: false, hint: '남은 곡이 부족합니다' }

  const current = rest[0]
  let upcoming = rest.slice(1)
  if (upcoming.length < 2) return { ok: false, hint: '앞으로 나올 곡이 부족합니다' }

  const byGenre = new Map<string, QuestionRuntime[]>()
  for (const q of upcoming) {
    const list = byGenre.get(q.genre) || []
    list.push(q)
    byGenre.set(q.genre, list)
  }
  const genres = [...byGenre.keys()].sort((a, b) => a.localeCompare(b, 'ko'))
  if (genres.length < 2) return { ok: false, hint: '남은 장르가 1개뿐이라 평균을 맞출 수 없습니다' }

  const total = upcoming.length
  const n = genres.length
  const base = Math.floor(total / n)
  const rem = total % n
  const targets = new Map<string, number>()
  genres.forEach((g, i) => targets.set(g, base + (i < rem ? 1 : 0)))

  const usedIds = new Set(room.queue.map((q) => q.id))
  const usedYt = new Set(
    room.queue.map((q) => extractYoutubeId(q.youtubeUrl)).filter((x): x is string => !!x),
  )

  const nextUpcoming: QuestionRuntime[] = []
  const changes: string[] = []

  for (const g of genres) {
    const pool = shuffleArray([...(byGenre.get(g) || [])])
    const target = targets.get(g) || base
    const keep = pool.slice(0, Math.min(target, pool.length))
    nextUpcoming.push(...keep)

    if (keep.length < target) {
      const need = target - keep.length
      const bank = await loadGenreQuestions(g)
      if (!bank.length) continue
      let added = 0
      for (const q of shuffleArray(bank)) {
        if (added >= need) break
        if (usedIds.has(q.id)) continue
        const yt = extractYoutubeId(q.youtubeUrl)
        if (yt && usedYt.has(yt)) continue
        usedIds.add(q.id)
        if (yt) usedYt.add(yt)
        nextUpcoming.push(toQueueQuestion(room, q))
        added += 1
      }
      changes.push(`${g} ${pool.length}→${keep.length + added}`)
    } else if (pool.length > target) {
      changes.push(`${g} ${pool.length}→${target}`)
    } else {
      changes.push(`${g} ${pool.length}`)
    }
  }

  if (changes.every((c) => !c.includes('→'))) {
    return { ok: false, hint: '이미 장르 잔량이 고르게 퍼져 있습니다' }
  }

  room.queue = [
    ...room.queue.slice(0, from),
    current,
    ...shuffleArray(nextUpcoming),
  ]
  return {
    ok: true,
    hint: `장르 잔량 평균화 · ${changes.join(' · ')}`,
  }
}

/**
 * 특정 장르 밴: 앞으로 나올 해당 장르 곡을 제거하고, 그 수만큼 다른 장르에 랜덤 배분.
 * 큐 길이(total)는 반드시 유지 — 은행 유니크가 모자라면 수신 장르에서 중복 보충.
 * (길이가 줄면 Q 진행도·20곡 증강 주기가 어긋남)
 */
export async function banGenreAndRedistribute(
  room: Room,
  banGenre: string,
): Promise<{ ok: boolean; hint: string }> {
  const genre = banGenre.trim()
  if (!genre) return { ok: false, hint: '밴할 장르를 선택하세요' }

  const from = room.index
  const rest = room.queue.slice(from)
  if (!rest.length) return { ok: false, hint: '남은 곡이 없습니다' }

  const current = rest[0]
  const upcoming = rest.slice(1)
  const banned = upcoming.filter((q) => q.genre === genre)
  const keep = upcoming.filter((q) => q.genre !== genre)
  const n = banned.length
  if (n === 0) {
    return { ok: false, hint: `앞으로 나올 「${genre}」 곡이 없습니다` }
  }

  let receivers = [...new Set(keep.map((q) => q.genre))].filter(isPlayableGenre)
  if (receivers.length === 0) {
    receivers = Object.entries(room.genreCounts)
      .filter(([g, c]) => g !== genre && Number(c) > 0 && isPlayableGenre(g))
      .map(([g]) => g)
  }
  if (receivers.length === 0) {
    return { ok: false, hint: '배분할 다른 장르가 없습니다' }
  }

  const banks = new Map<string, Awaited<ReturnType<typeof loadGenreQuestions>>>()
  for (const g of receivers) {
    banks.set(g, await loadGenreQuestions(g))
  }
  const viable = receivers.filter((g) => (banks.get(g)?.length || 0) > 0)
  if (viable.length === 0) {
    return { ok: false, hint: '다른 장르 곡을 은행에서 가져올 수 없습니다' }
  }

  const allot = new Map<string, number>()
  for (const g of viable) allot.set(g, 0)
  for (let i = 0; i < n; i++) {
    const g = viable[pickRandomIndex(viable.length)]
    allot.set(g, (allot.get(g) || 0) + 1)
  }

  const usedIds = new Set(room.queue.map((q) => q.id))
  const usedYt = new Set(
    room.queue.map((q) => extractYoutubeId(q.youtubeUrl)).filter((x): x is string => !!x),
  )

  const extras: QuestionRuntime[] = []
  const distParts: string[] = []
  let dupFill = 0

  for (const [g, need] of allot.entries()) {
    if (need <= 0) continue
    const bank = banks.get(g) || []
    if (!bank.length) continue
    let added = 0
    for (const q of shuffleArray(bank)) {
      if (added >= need) break
      if (usedIds.has(q.id)) continue
      const yt = extractYoutubeId(q.youtubeUrl)
      if (yt && usedYt.has(yt)) continue
      usedIds.add(q.id)
      if (yt) usedYt.add(yt)
      extras.push(toQueueQuestion(room, q))
      added += 1
    }
    // 유니크 부족분: 같은 장르 은행에서 중복 허용해 슬롯 수(큐 길이) 유지
    if (added < need) {
      const shuffled = shuffleArray(bank)
      let i = 0
      while (added < need && shuffled.length > 0) {
        const q = shuffled[i % shuffled.length]
        i += 1
        extras.push(toQueueQuestion(room, q))
        added += 1
        dupFill += 1
      }
    }
    if (added > 0) distParts.push(`${g} +${added}`)
  }

  // 배정 장르가 비는 등 예외 시 남은 슬롯을 아무 viable 장르로 채움
  while (extras.length < n) {
    const g = viable[pickRandomIndex(viable.length)]
    const bank = banks.get(g) || []
    if (!bank.length) break
    const q = bank[pickRandomIndex(bank.length)]
    extras.push(toQueueQuestion(room, q))
    dupFill += 1
    const partIdx = distParts.findIndex((p) => p.startsWith(`${g} +`))
    if (partIdx >= 0) {
      const prev = Number(distParts[partIdx].slice(`${g} +`.length)) || 0
      distParts[partIdx] = `${g} +${prev + 1}`
    } else {
      distParts.push(`${g} +1`)
    }
  }

  if (extras.length === 0) {
    return { ok: false, hint: '다른 장르 곡을 은행에서 가져올 수 없습니다' }
  }

  const fill = extras.slice(0, n)
  room.queue = [
    ...room.queue.slice(0, from),
    current,
    ...shuffleArray([...keep, ...fill]),
  ]

  const dupNote = dupFill > 0
    ? ` (은행 한도 초과 ${dupFill}곡은 중복 보충 · 총 곡 수 유지)`
    : ''
  return {
    ok: true,
    hint: `「${genre}」 ${n}곡 밴 → ${distParts.join(' · ') || '배분'}${dupNote}`,
  }
}

/**
 * 밴픽 실패: 밴하려던 장르 제외 잔량 합의 ratio(기본 20%)만큼
 * 해당 장르에 추가하고, 나머지 장르에서 비율대로 제거. (지금 곡 유지)
 */
export async function boostAttemptedGenreFromOthers(
  room: Room,
  boostGenre: string,
  ratio = 0.2,
): Promise<{ ok: boolean; hint: string }> {
  const genre = boostGenre.trim()
  if (!genre) return { ok: false, hint: '장르가 없습니다' }

  const from = room.index
  const rest = room.queue.slice(from)
  if (!rest.length) return { ok: false, hint: '남은 곡이 없습니다' }

  const current = rest[0]
  const upcoming = rest.slice(1)
  const same = upcoming.filter((q) => q.genre === genre)
  const others = upcoming.filter((q) => q.genre !== genre)
  const otherSum = others.length
  const addCount = Math.floor(otherSum * ratio)
  if (addCount <= 0) {
    return { ok: true, hint: '미안하다 함지자 (옮길 곡이 부족합니다)' }
  }

  const counts = new Map<string, number>()
  for (const q of others) counts.set(q.genre, (counts.get(q.genre) || 0) + 1)

  const removeAllot = new Map<string, number>()
  let assigned = 0
  const frac: Array<{ g: string; rem: number }> = []
  for (const [g, c] of counts.entries()) {
    const exact = (c / otherSum) * addCount
    const base = Math.min(c, Math.floor(exact))
    removeAllot.set(g, base)
    assigned += base
    frac.push({ g, rem: exact - Math.floor(exact) })
  }
  frac.sort((a, b) => b.rem - a.rem)
  let left = addCount - assigned
  for (let i = 0; left > 0 && i < frac.length * 2; i++) {
    const g = frac[i % frac.length].g
    const cur = removeAllot.get(g) || 0
    if (cur >= (counts.get(g) || 0)) continue
    removeAllot.set(g, cur + 1)
    left -= 1
  }

  const byGenre = new Map<string, QuestionRuntime[]>()
  for (const q of others) {
    const list = byGenre.get(q.genre) || []
    list.push(q)
    byGenre.set(q.genre, list)
  }

  const keepOthers: QuestionRuntime[] = []
  const removeParts: string[] = []
  let removed = 0
  for (const [g, list] of byGenre.entries()) {
    const rem = Math.min(removeAllot.get(g) || 0, list.length)
    const shuffled = shuffleArray(list)
    if (rem > 0) {
      removeParts.push(`${g} −${rem}`)
      removed += rem
    }
    keepOthers.push(...shuffled.slice(rem))
  }

  if (removed <= 0) {
    return { ok: true, hint: '미안하다 함지자 (옮길 곡이 부족합니다)' }
  }

  const usedIds = new Set<string>()
  const usedYt = new Set<string>()
  for (const q of [...room.queue.slice(0, from + 1), ...same, ...keepOthers]) {
    usedIds.add(q.id)
    const yt = extractYoutubeId(q.youtubeUrl)
    if (yt) usedYt.add(yt)
  }

  const extras: QuestionRuntime[] = []
  const bank = await loadGenreQuestions(genre)
  if (bank.length) {
    for (const q of shuffleArray(bank)) {
      if (extras.length >= removed) break
      if (usedIds.has(q.id)) continue
      const yt = extractYoutubeId(q.youtubeUrl)
      if (yt && usedYt.has(yt)) continue
      usedIds.add(q.id)
      if (yt) usedYt.add(yt)
      extras.push(toQueueQuestion(room, q))
    }
  }

  if (extras.length === 0) {
    return { ok: true, hint: '미안하다 함지자 (은행에서 곡을 가져올 수 없습니다)' }
  }

  // 은행 부족 시 제거량도 맞춤: extras만큼만 제거 반영은 이미 했고, 부족분은 keep에서 복구하기 어려우니
  // extras만 추가 (총 곡 수가 줄 수 있음). 가능한 한 extras.length === removed 유지.
  room.queue = [
    ...room.queue.slice(0, from),
    current,
    ...shuffleArray([...same, ...keepOthers, ...extras]),
  ]

  const short = extras.length < removed ? ` (은행 부족 ${extras.length}/${removed})` : ''
  return {
    ok: true,
    hint: `미안하다 함지자 · 「${genre}」 +${extras.length} ← ${removeParts.join(' · ')}${short}`,
  }
}
