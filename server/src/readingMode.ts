import type { Server } from 'socket.io'

export type GameMode = 'nomatch' | 'reading'
export type ReadingPhase = 'decide' | 'claim' | 'vote' | 'pre_solve' | 'solve' | 'reveal'

type ReadingQuestion = {
  youtubeUrl: string
  startSec: number
  endSec: number
  genre: string
  slots: Array<{
    id: string
    label: string
    answer: string
    acceptNorms: string[]
    hidden: boolean
  }>
}

export type ReadingState = {
  turnOrder: string[]
  turnIndex: number
  phase: ReadingPhase
  /** 이번 턴에 문제를 받을/받은 사람 (포기 전) */
  offeredUserId: string
  /** 실제 풀이하는 사람 (수락·대리 참가 후) */
  solverId: string | null
  votes: Record<string, 'yes' | 'no'>
  phaseEndsAt: number
  /** 투표자용 미리듣기 중인지 */
  votersHear: boolean
  /** 솔버가 듣는 중인지 */
  solverHears: boolean
  lastResult: {
    solved: boolean
    solverNickname: string
    title: string
    voterPayouts: Array<{ userId: string; nickname: string; vote: 'yes' | 'no'; odds: '정배' | '역배' | '동배'; gain: number }>
  } | null
}

export type ReadingRoomLike = {
  id: string
  gameMode: GameMode
  /** 리딩방 목표 점수 (도달 시 종료) */
  readingTargetScore: number
  status: string
  queue: ReadingQuestion[]
  index: number
  roundEndsAt: number
  roundStartedAt: number
  roundDuration: number
  timer: NodeJS.Timeout | null
  extraTimers: NodeJS.Timeout[]
  members: Map<string, {
    userId: string
    nickname: string
    socketId: string
    score: number
    isSpectator?: boolean
  }>
  reading: ReadingState | null
  revealed: Record<string, { answer: string; by: string; userId: string }>
}

const DECIDE_SEC = 20
const CLAIM_SEC = 15
const VOTE_SEC = 15
const PRE_SOLVE_SEC = 3
const SOLVE_SEC = 15
const REVEAL_SEC = 4

function clearRoomTimer(room: ReadingRoomLike) {
  if (room.timer) {
    clearTimeout(room.timer)
    room.timer = null
  }
}

function titleSlot(q: ReadingQuestion) {
  return q.slots.find((s) => !s.hidden) || q.slots[0] || null
}

function emitSystem(io: Server, room: ReadingRoomLike, text: string) {
  io.to(room.id).emit('chat:message', {
    id: Date.now(),
    userId: '',
    nickname: '시스템',
    text,
    system: true,
    at: Date.now(),
  })
}

function readingPublic(room: ReadingRoomLike, viewerUserId?: string | null) {
  const r = room.reading
  if (!r) return null
  const offered = room.members.get(r.offeredUserId)
  const solver = r.solverId ? room.members.get(r.solverId) : null
  const yes = Object.values(r.votes).filter((v) => v === 'yes').length
  const no = Object.values(r.votes).filter((v) => v === 'no').length
  const isSolverViewer = !!(r.solverId && viewerUserId && viewerUserId === r.solverId)
  // 풀이자·(뷰어 미지정 브로드캐스트)에게는 결과 공개 전까지 투표 수 비공개
  const hideVoteCounts = (
    r.phase === 'vote' || r.phase === 'pre_solve' || r.phase === 'solve'
  ) && (!viewerUserId || isSolverViewer)
  return {
    phase: r.phase,
    turnIndex: r.turnIndex,
    turnOrder: r.turnOrder,
    offeredUserId: r.offeredUserId,
    offeredNickname: offered?.nickname || '?',
    solverId: r.solverId,
    solverNickname: solver?.nickname || null,
    phaseEndsAt: r.phaseEndsAt,
    votersHear: r.votersHear,
    solverHears: r.solverHears,
    voteCounts: hideVoteCounts ? null : { yes, no },
    myVotePossible: true,
    lastResult: r.lastResult,
    questionIndex: room.index,
    questionTotal: room.queue.length,
    targetScore: room.readingTargetScore || 50,
  }
}

export function readingRoomPatch(room: ReadingRoomLike, viewerUserId?: string | null) {
  return {
    gameMode: room.gameMode || 'nomatch',
    readingTargetScore: room.readingTargetScore || 50,
    reading: readingPublic(room, viewerUserId),
  }
}

/** 리딩방: 멤버별 room:state (풀이자 투표 정보 분리) */
function emitReadingRoomState(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  for (const m of room.members.values()) {
    io.to(m.socketId).emit('room:state', roomState(room, m.userId))
  }
}

export function clampReadingTargetScore(n: unknown) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 50
  return Math.min(200, Math.max(50, v))
}

function endReadingGame(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
  reason: string,
) {
  clearRoomTimer(room)
  room.status = 'ended'
  room.reading = null
  const results = [...room.members.values()]
    .filter((m) => !m.isSpectator)
    .map((m) => ({ userId: m.userId, nickname: m.nickname, score: m.score }))
    .sort((a, b) => b.score - a.score)
  io.to(room.id).emit('game:end', { results })
  emitReadingRoomState(io, room, roomState)
  emitSystem(io, room, reason)
}

function reachedTarget(room: ReadingRoomLike) {
  const target = room.readingTargetScore || 50
  for (const m of room.members.values()) {
    if (m.isSpectator) continue
    if (m.score >= target) return m
  }
  return null
}

/** 정배/역배/동배 배당: 맞춘 쪽에만 지급 */
export function calcVoterOdds(yesCount: number, noCount: number, vote: 'yes' | 'no'): '정배' | '역배' | '동배' {
  if (yesCount === noCount) return '동배'
  if (vote === 'yes') return yesCount > noCount ? '정배' : '역배'
  return noCount > yesCount ? '정배' : '역배'
}

function payoutForOdds(odds: '정배' | '역배' | '동배') {
  return odds === '역배' ? 2 : 1
}

/** 리딩방: 감점은 되지만 총점은 0 미만으로 안 내려감 */
function addReadingScore(m: { score: number }, delta: number) {
  m.score = Math.max(0, m.score + delta)
}

function emitReadingRound(
  io: Server,
  room: ReadingRoomLike,
  opts: { hearUserIds: Set<string> | 'all' | 'none'; endsAt: number; duration: number },
) {
  const q = room.queue[room.index]
  if (!q) return
  const slot = titleSlot(q)
  const publicSlots = slot
    ? [{
        id: slot.id,
        label: slot.label || '제목',
        revealed: !!room.revealed[slot.id],
        hidden: false,
        unlocked: true,
        chosung: '',
        answer: room.revealed[slot.id]?.answer,
        by: room.revealed[slot.id]?.by,
      }]
    : []

  const base = {
    index: room.index,
    total: room.queue.length,
    endsAt: opts.endsAt,
    duration: opts.duration,
    genre: q.genre,
    hasHidden: false,
    youtubeUrl: q.youtubeUrl,
    startSec: q.startSec,
    endSec: q.endSec,
    titleChosung: '',
    artistChosung: '',
    slots: publicSlots,
    reading: true,
  }

  for (const m of room.members.values()) {
    const hear = opts.hearUserIds === 'all'
      || (opts.hearUserIds !== 'none' && opts.hearUserIds.has(m.userId))
    io.to(m.socketId).emit('round:start', {
      ...base,
      // 안 듣는 사람은 볼륨 0용으로 url은 유지하되 muted 플래그
      readingMuted: !hear,
    })
  }
}

function advanceTurnOrEnd(io: Server, room: ReadingRoomLike, roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown) {
  const r = room.reading
  if (!r) return

  const winner = reachedTarget(room)
  if (winner) {
    endReadingGame(io, room, roomState, `목표 ${room.readingTargetScore || 50}점 달성! ${winner.nickname}님 승리 · 리딩방 종료`)
    return
  }

  r.turnIndex += 1
  room.index += 1
  room.revealed = {}
  r.lastResult = null
  r.votes = {}
  r.solverId = null

  if (room.index >= room.queue.length) {
    endReadingGame(io, room, roomState, '문제 소진 · 리딩방 종료!')
    return
  }
  beginDecidePhase(io, room, roomState)
}

export function beginDecidePhase(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  if (!room.reading) return
  const r = room.reading
  if (room.index >= room.queue.length) {
    advanceTurnOrEnd(io, room, roomState)
    return
  }
  const offeredUserId = r.turnOrder[r.turnIndex % r.turnOrder.length]
  if (!room.members.has(offeredUserId)) {
    // 퇴장한 사람 스킵
    r.turnIndex += 1
    if (r.turnIndex >= r.turnOrder.length * 2) {
      room.status = 'ended'
      room.reading = null
      emitReadingRoomState(io, room, roomState)
      return
    }
    beginDecidePhase(io, room, roomState)
    return
  }

  clearRoomTimer(room)
  r.phase = 'decide'
  r.offeredUserId = offeredUserId
  r.solverId = null
  r.votes = {}
  r.votersHear = false
  r.solverHears = false
  r.phaseEndsAt = Date.now() + DECIDE_SEC * 1000
  room.status = 'playing'
  room.roundDuration = DECIDE_SEC
  room.roundStartedAt = Date.now()
  room.roundEndsAt = r.phaseEndsAt
  room.revealed = {}

  const nick = room.members.get(offeredUserId)?.nickname || '?'
  emitSystem(io, room, `리딩 · ${nick}님 차례! 이 문제를 도전할지 선택하세요 (${DECIDE_SEC}초)`)
  // decide 단계: 아무도 노래 안 들음
  emitReadingRound(io, room, { hearUserIds: 'none', endsAt: r.phaseEndsAt, duration: DECIDE_SEC })
  emitReadingRoomState(io, room, roomState)

  room.timer = setTimeout(() => {
    // 시간 초과 = 포기로 처리
    readingPass(io, room, offeredUserId, roomState, true)
  }, DECIDE_SEC * 1000 + 50)
}

function beginClaimPhase(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r) return
  clearRoomTimer(room)
  r.phase = 'claim'
  r.solverId = null
  r.votersHear = false
  r.solverHears = false
  r.phaseEndsAt = Date.now() + CLAIM_SEC * 1000
  room.roundEndsAt = r.phaseEndsAt
  room.roundDuration = CLAIM_SEC
  room.roundStartedAt = Date.now()

  emitSystem(io, room, `포기! 다른 사람이 참가할 수 있습니다 (${CLAIM_SEC}초 · 채팅에 「참가」 또는 버튼)`)
  emitReadingRound(io, room, { hearUserIds: 'none', endsAt: r.phaseEndsAt, duration: CLAIM_SEC })
  emitReadingRoomState(io, room, roomState)

  room.timer = setTimeout(() => {
    emitSystem(io, room, '참가자가 없어 다음 차례로 넘어갑니다')
    advanceTurnOrEnd(io, room, roomState)
  }, CLAIM_SEC * 1000 + 50)
}

function beginVotePhase(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || !r.solverId) return
  clearRoomTimer(room)
  r.phase = 'vote'
  r.votes = {}
  r.votersHear = true
  r.solverHears = false
  r.phaseEndsAt = Date.now() + VOTE_SEC * 1000
  room.roundEndsAt = r.phaseEndsAt
  room.roundDuration = VOTE_SEC
  room.roundStartedAt = Date.now()

  const hear = new Set(
    [...room.members.values()]
      .filter((m) => !m.isSpectator && m.userId !== r.solverId)
      .map((m) => m.userId),
  )
  const solverNick = room.members.get(r.solverId)?.nickname || '?'
  emitSystem(io, room, `투표! ${solverNick}님이 이 노래를 맞힐 수 있을까요? (유권자 미리듣기 · ${VOTE_SEC}초)`)
  emitReadingRound(io, room, { hearUserIds: hear, endsAt: r.phaseEndsAt, duration: VOTE_SEC })
  emitReadingRoomState(io, room, roomState)

  room.timer = setTimeout(() => {
    beginSolveCountdown(io, room, roomState)
  }, VOTE_SEC * 1000 + 50)
}

/** 풀이 직전 3-2-1 (노래 정지 · 전원 무음) */
function beginSolveCountdown(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || !r.solverId || r.phase !== 'vote') return
  clearRoomTimer(room)
  r.phase = 'pre_solve'
  r.votersHear = false
  r.solverHears = false
  r.phaseEndsAt = Date.now() + PRE_SOLVE_SEC * 1000
  room.roundEndsAt = r.phaseEndsAt
  room.roundDuration = PRE_SOLVE_SEC
  room.roundStartedAt = Date.now()

  const solverNick = room.members.get(r.solverId)?.nickname || '?'
  emitSystem(io, room, `풀이 준비! ${solverNick}님 · 3-2-1`)
  // 카운트 동안 노래 정지(무음). 풀이 시작 때 round:start로 처음부터 재생
  emitReadingRound(io, room, { hearUserIds: 'none', endsAt: r.phaseEndsAt, duration: PRE_SOLVE_SEC })
  emitReadingRoomState(io, room, roomState)

  room.timer = setTimeout(() => {
    beginSolvePhase(io, room, roomState)
  }, PRE_SOLVE_SEC * 1000 + 50)
}

function beginSolvePhase(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || !r.solverId || r.phase !== 'pre_solve') return
  clearRoomTimer(room)
  r.phase = 'solve'
  // 투표자: 투표~정답 공개 전까지 계속 들음 / 솔버도 풀이 중 들음
  r.votersHear = true
  r.solverHears = true
  r.phaseEndsAt = Date.now() + SOLVE_SEC * 1000
  room.roundEndsAt = r.phaseEndsAt
  room.roundDuration = SOLVE_SEC
  room.roundStartedAt = Date.now()
  room.revealed = {}

  const solverNick = room.members.get(r.solverId)?.nickname || '?'
  emitSystem(io, room, `풀이! ${solverNick}님 · 제목만 · 전원 청취 · 처음부터 · ${SOLVE_SEC}초`)
  // endsAt이 바뀌며 클라 playEpoch 갱신 → 클립 startSec부터 다시 재생
  emitReadingRound(io, room, { hearUserIds: 'all', endsAt: r.phaseEndsAt, duration: SOLVE_SEC })
  emitReadingRoomState(io, room, roomState)

  room.timer = setTimeout(() => {
    finishSolve(io, room, false, roomState)
  }, SOLVE_SEC * 1000 + 50)
}

function finishSolve(
  io: Server,
  room: ReadingRoomLike,
  solved: boolean,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || !r.solverId || r.phase !== 'solve') return
  clearRoomTimer(room)
  const q = room.queue[room.index]
  const slot = q ? titleSlot(q) : null
  const solver = room.members.get(r.solverId)
  if (!solver) {
    advanceTurnOrEnd(io, room, roomState)
    return
  }

  if (solved) addReadingScore(solver, 3)
  else addReadingScore(solver, -3)

  const yesCount = Object.values(r.votes).filter((v) => v === 'yes').length
  const noCount = Object.values(r.votes).filter((v) => v === 'no').length
  const winning: 'yes' | 'no' = solved ? 'yes' : 'no'
  const voterPayouts: NonNullable<ReadingState['lastResult']>['voterPayouts'] = []

  for (const [uid, vote] of Object.entries(r.votes)) {
    if (uid === r.solverId) continue
    const m = room.members.get(uid)
    if (!m) continue
    if (vote !== winning) continue
    const odds = calcVoterOdds(yesCount, noCount, vote)
    const gain = payoutForOdds(odds)
    addReadingScore(m, gain)
    voterPayouts.push({
      userId: uid,
      nickname: m.nickname,
      vote,
      odds,
      gain,
    })
  }

  if (slot && q) {
    room.revealed[slot.id] = {
      answer: slot.answer,
      by: solved ? solver.nickname : '공개',
      userId: solved ? solver.userId : '',
    }
  }

  r.phase = 'reveal'
  r.votersHear = false
  r.solverHears = false
  r.phaseEndsAt = Date.now() + REVEAL_SEC * 1000
  r.lastResult = {
    solved,
    solverNickname: solver.nickname,
    title: slot?.answer || '?',
    voterPayouts,
  }
  room.roundEndsAt = r.phaseEndsAt

  const voteNote = voterPayouts.length
    ? voterPayouts.map((p) => `${p.nickname} ${p.odds}+${p.gain}`).join(' · ')
    : '적중 투표 없음'
  emitSystem(
    io,
    room,
    solved
      ? `${solver.nickname}님 정답! +3 · ${slot?.answer || '?'} · ${voteNote}`
      : `${solver.nickname}님 실패… −3 · 정답 ${slot?.answer || '?'} · ${voteNote}`,
  )

  emitReadingRound(io, room, { hearUserIds: 'none', endsAt: r.phaseEndsAt, duration: REVEAL_SEC })
  io.to(room.id).emit('round:reveal', {
    reason: solved ? 'cleared' : 'timeout',
    slots: slot
      ? [{ id: slot.id, answer: slot.answer, by: solved ? solver.nickname : null }]
      : [],
    pauseSec: REVEAL_SEC,
  })
  emitReadingRoomState(io, room, roomState)

  room.timer = setTimeout(() => {
    advanceTurnOrEnd(io, room, roomState)
  }, REVEAL_SEC * 1000 + 50)
}

export function startReadingGame(
  io: Server,
  room: ReadingRoomLike,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const turnOrder = [...room.members.values()]
    .filter((m) => !m.isSpectator)
    .map((m) => m.userId)
  if (!turnOrder.length) {
    room.status = 'ended'
    return
  }
  room.reading = {
    turnOrder,
    turnIndex: 0,
    phase: 'decide',
    offeredUserId: turnOrder[0],
    solverId: null,
    votes: {},
    phaseEndsAt: 0,
    votersHear: false,
    solverHears: false,
    lastResult: null,
  }
  room.index = 0
  beginDecidePhase(io, room, roomState)
}

export function readingAccept(
  io: Server,
  room: ReadingRoomLike,
  userId: string,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || r.phase !== 'decide') return { ok: false, error: '지금은 수락할 수 없습니다' }
  if (r.offeredUserId !== userId) return { ok: false, error: '당신 차례가 아닙니다' }
  r.solverId = userId
  beginVotePhase(io, room, roomState)
  return { ok: true }
}

export function readingPass(
  io: Server,
  room: ReadingRoomLike,
  userId: string,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
  fromTimeout = false,
) {
  const r = room.reading
  if (!r || r.phase !== 'decide') return { ok: false, error: '지금은 포기할 수 없습니다' }
  if (r.offeredUserId !== userId) return { ok: false, error: '당신 차례가 아닙니다' }
  const m = room.members.get(userId)
  if (m) {
    addReadingScore(m, -1)
    emitSystem(
      io,
      room,
      fromTimeout
        ? `${m.nickname}님 시간 초과 포기 (−1)`
        : `${m.nickname}님 포기 (−1)`,
    )
  }
  beginClaimPhase(io, room, roomState)
  return { ok: true }
}

export function readingClaim(
  io: Server,
  room: ReadingRoomLike,
  userId: string,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || r.phase !== 'claim') return { ok: false, error: '지금은 참가할 수 없습니다' }
  if (userId === r.offeredUserId) return { ok: false, error: '포기한 턴에는 참가할 수 없습니다' }
  if (!room.members.has(userId)) return { ok: false, error: '멤버 아님' }
  if (room.members.get(userId)?.isSpectator) return { ok: false, error: '관전자는 참가할 수 없습니다' }
  r.solverId = userId
  const nick = room.members.get(userId)?.nickname || '?'
  emitSystem(io, room, `${nick}님이 참가합니다!`)
  beginVotePhase(io, room, roomState)
  return { ok: true }
}

export function readingVote(
  io: Server,
  room: ReadingRoomLike,
  userId: string,
  vote: 'yes' | 'no',
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || r.phase !== 'vote') return { ok: false, error: '투표 시간이 아닙니다' }
  if (userId === r.solverId) return { ok: false, error: '풀이자는 투표할 수 없습니다' }
  if (!room.members.has(userId)) return { ok: false, error: '멤버 아님' }
  if (room.members.get(userId)?.isSpectator) return { ok: false, error: '관전자는 투표할 수 없습니다' }
  r.votes[userId] = vote
  emitReadingRoomState(io, room, roomState)

  // 전원 투표 완료 시 즉시 풀이
  const voters = [...room.members.values()]
    .filter((m) => !m.isSpectator && m.userId !== r.solverId)
    .map((m) => m.userId)
  if (voters.length > 0 && voters.every((id) => r.votes[id])) {
    beginSolveCountdown(io, room, roomState)
  }
  return { ok: true }
}

export function readingTryAnswer(
  io: Server,
  room: ReadingRoomLike,
  userId: string,
  text: string,
  isAccepted: (raw: string, norms: string[]) => boolean,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const r = room.reading
  if (!r || r.phase !== 'solve') return false
  if (userId !== r.solverId) return false
  const q = room.queue[room.index]
  if (!q) return false
  const slot = titleSlot(q)
  if (!slot || room.revealed[slot.id]) return false
  if (!isAccepted(text, slot.acceptNorms)) return false
  finishSolve(io, room, true, roomState)
  return true
}

export function readingTryClaimFromChat(
  io: Server,
  room: ReadingRoomLike,
  userId: string,
  text: string,
  roomState: (r: ReadingRoomLike, viewerUserId?: string) => unknown,
) {
  const t = text.trim()
  if (!/^(참가|참여|저요|제가|claim)$/i.test(t)) return false
  const res = readingClaim(io, room, userId, roomState)
  return res.ok
}
