import type { Server, Socket } from 'socket.io'
import { randomInt } from 'node:crypto'
import { prisma } from './config.js'
import { verifyToken, type AuthUser } from './auth.js'
import { extractYoutubeId, normalizeAnswer, hintChosung, expandArtistAccepts, hangulToQwertyMistype, isAcceptedAnswer } from './answer.js'
import { parseTagsJson } from './tags.js'
import { PLAYABLE_GENRES, YACHA_GENRE, isPlayableGenre } from './genres.js'
import {
  startReadingGame,
  readingAccept,
  readingPass,
  readingClaim,
  readingVote,
  readingTryAnswer,
  readingTryClaimFromChat,
  readingRoomPatch,
  clampReadingTargetScore,
  type GameMode,
  type ReadingState,
} from './readingMode.js'

type SlotPublic = {
  id: string
  label: string
  revealed: boolean
  hidden: boolean
  unlocked: boolean
  answer?: string
  by?: string
  /** 초성 힌트 (라벨명과 무관 · 슬롯 단위) */
  chosung?: string
}
type QuestionRuntime = {
  id: string
  youtubeUrl: string
  startSec: number
  endSec: number
  genre: string
  tags: string[]
  titleChosung: string
  artistChosung: string
  slots: Array<{
    id: string
    label: string
    answer: string
    accepts: string[]
    /** normalizeAnswer 미리 계산 — 채점 핫패스용 */
    acceptNorms: string[]
    hidden: boolean
    chosung: string
  }>
}

/** 사용 시점부터 roundsLeft 동안 적용 (본인 버프는 이번 R 포함 · 상대 디버프는 보통 startIndex=다음 R) */
type ActiveBuff = {
  name: string
  description: string
  effectType: string
  effectValue: Record<string, unknown>
  imageUrl: string | null
  usedByNickname: string
  startIndex: number
  roundsLeft: number
}

type Member = {
  userId: string
  nickname: string
  avatarUrl: string | null
  ready: boolean
  score: number
  socketId: string
  /** 관전: 채팅만 · 점수/증강/정답 미참여 */
  isSpectator: boolean
  heldAugmentId: string | null
  heldAugmentName: string | null
  heldAugmentDescription: string | null
  heldAugmentImageUrl: string | null
  heldAugmentEffectType: string | null
  heldAugmentEffectValue: string | null
  heldAugmentTier: string | null
  usedAugments: string[]
  /** 이번 증강 선택 페이즈에서 이미 보여준 후보 id (리롤 시 제외) */
  offerSeenAugmentIds: string[]
  /** 지금 화면에 떠 있는 후보 3장 (타임아웃 랜덤은 여기서만) */
  lastOfferCandidateIds: string[]
  /** 가호선택: 고정 3장 후보 (리롤 없음) */
  gahoPickIds: string[] | null
  activeBuffs: ActiveBuff[]
  /** 엄→준→식 등 다단계 수집 */
  collectedPieces: string[]
  /** 채팅·제출 금지 (라운드 단위) */
  chatMute: { startIndex: number; roundsLeft: number; byName: string; byNickname: string } | null
  /** 쉬었음청년 소프트 뮤트: 이 시각까지 채팅·제출 차단 */
  chatMuteUntil: number | null
  /** 님아 매너좀: 라운드 시작 후 N초까지 제출 불가 */
  answerDelay: {
    startIndex: number
    roundsLeft: number
    delaySec: number
    byName: string
    byNickname: string
  } | null
  /** 예의바른청년/다요/진조이니라: 답 끝에 suffix 필수 */
  politeSuffix: {
    startIndex: number
    roundsLeft: number
    suffix: string
    byName: string
    byNickname: string
    /** 진조이니라 등: 정답 시 추가 점수 */
    bonus?: number
  } | null
  /** 쉬었음청년(구)·수면: 정답 인정 불가 (채팅은 가능) */
  answerBlock: {
    startIndex: number
    roundsLeft: number
    byName: string
    byNickname: string
  } | null
  /** 영역전개: 시각 기반 정답 불가 */
  answerBlockUntil: number | null
  answerBlockUntilBy: string | null
  /** 슬로우 스타터·야차 대상 등: 이 시각까지 노래 지연 */
  audioDelayUntil: number | null
  /** 야차룰 시전자: 대결 중 초성 즉시 */
  duelEarlyChosung: boolean
  /** 범인은 당신이야: 감시 라운드에 정답 시 → 다음 R 수면 */
  accuseMark: {
    watchIndex: number
    byName: string
    byNickname: string
  } | null
  /** 가불기: 정답 시 시전자에게 점수 이전 · 라운드 무득점 시 추가 이전 */
  gabuki: {
    startIndex: number
    roundsLeft: number
    casterUserId: string
    hitPenalty: number
    missPenalty: number
    byName: string
    byNickname: string
  } | null
  /** 신속정확대리: 대상 정답 → 결산 시 시전자 점수 */
  answerProxy: {
    targetUserId: string
    startIndex: number
    roundsLeft: number
    pendingScore: number
    byName: string
  } | null
  /** 트루먼쇼(환상) / 세노 등: 다른 곡 재생 · truman은 가짜 점수 */
  sakuraDecoy: {
    youtubeUrl: string
    startSec: number
    endSec: number
    startIndex: number
    roundsLeft: number
    scoreMult: number
    byName: string
    byNickname: string
    mode: 'truman' | 'classic'
    slots: Array<{ id: string; label: string; answer: string; accepts: string[]; acceptNorms: string[]; hidden: boolean; chosung: string }>
    fakeRevealed: Record<string, true>
    fakeScore: number
    /** 트루먼: 이미 들려준 디코이 yt (라운드마다 다른 곡) */
    usedDecoyYt: string[]
    genre: string
    titleChosung: string
    artistChosung: string
  } | null
  /** 불꽃남자김상원: 본인 고정곡 청취 · 정답 시 대상 점수 감소 */
  flameKim: {
    targetUserId: string
    targetNickname: string
    startIndex: number
    roundsLeft: number
    drain: number
    youtubeUrl: string
    startSec: number
    byName: string
  } | null
  /** 전원을 꺼봤습니다: 이 시각까지 노래 음소거(본인 제외 대상) */
  songMuteUntil: number | null
  /** 이번 라운드 본인 득점 합 (콤보 결산용) */
  roundScoreGain: number
}

type Room = {
  id: string
  name: string
  hostId: string
  isPrivate: boolean
  code: string | null
  maxPlayers: number
  genreCounts: Record<string, number>
  /** 문제은행 장르별 보유 수 — 대기실 슬라이더 max */
  genreBankCounts: Record<string, number>
  /** 제목만(첫 비전 슬롯) | 제목+가수(전 슬롯, 히든 포함) */
  answerMode: 'title' | 'title_artist'
  /** false면 증강 선택 페이즈 생략 */
  augmentsEnabled: boolean
  /** 노맞(기본) | 리딩방(증강 OFF · 턴제 투표) */
  gameMode: GameMode
  /** 리딩방 목표 점수 */
  readingTargetScore: number
  reading: ReadingState | null
  /** 이 방에서 최근에 나온 문제 id (다음 뽑기 가중치↓) */
  recentQuestionIds: string[]
  /** 0=끔 · >0=최근곡 완전 제외 (기본 1, 은행 부족 시에만 재사용) */
  recentSongPenalty: number
  members: Map<string, Member>
  status: 'lobby' | 'playing' | 'revealing' | 'augment' | 'countdown' | 'duel' | 'ended'
  queue: QuestionRuntime[]
  index: number
  roundEndsAt: number
  roundStartedAt: number
  roundDuration: number
  skipVotes: Set<string>
  revealed: Record<string, {
    answer: string
    by: string
    userId: string
    at?: number
    /** 선답자에게 준 슬롯 점수(중복 정답 우선 처리 시 회수용) */
    points?: number
    /** 선답 시 맞췄죠? 등으로 준 추가 점수 */
    wagerPts?: number
  }>
  /** 전부 맞춤 안내 채팅을 이번 라운드에 이미 보냈는지 */
  clearedHintSent: boolean
  timer: NodeJS.Timeout | null
  extraTimers: NodeJS.Timeout[]
  lastAugmentAt: number
  /** 이번 증강 선택: bronze | silver | gold 단일 등급 */
  augmentOfferLockedTier: 'bronze' | 'silver' | 'gold' | null
  /** 증강 선택 마감 시각 */
  augmentOfferEndsAt: number
  /** 점수가 2배: 이번 라운드 -1 이미 적용한 유저 */
  riskyBustApplied: Set<string>
  /** 맞췄죠?: 이번 라운드 성공 결산 완료한 유저 */
  wagerSettled: Set<string>
  /** 보너스 타임: 슬롯별 선답 후 추종 가능 창 */
  followAnswerWindow: Record<string, {
    at: number
    windowMs: number
    acceptNorms: string[]
    answer: string
    label: string
    hidden: boolean
    byUserId: string
  }>
  /** 보너스 타임: 슬롯별 이미 추종 득점한 유저 */
  followAnswerClaimed: Record<string, Set<string>>
  /** 미룬이의 가호: 이미 공개된 슬롯을 뒤늦게 맞힌 유저 */
  lateAnswerClaimed: Record<string, Set<string>>
  /** 야차룰 1v1 */
  duel: {
    challengerId: string
    opponentId: string
    question: QuestionRuntime
    penalty: number
    byName: string
    casterEarlyChosung: boolean
    targetAudioDelaySec: number
    resumeIndex: number
    /** 야차 시작 전 본게임 라운드 진행도 */
    savedRevealed: Record<string, { answer: string; by: string; userId: string }>
    savedRemainingMs: number
    savedRiskyBust: Set<string>
    savedWagerSettled: Set<string>
  } | null
  /** 라운드 진행 중 사용 시 → 다음 라운드 시작 때 발동 */
  pendingDuel: {
    challengerId: string
    opponentId: string
    penalty: number
    byName: string
    casterEarlyChosung: boolean
    targetAudioDelaySec: number
  } | null
  /** 야차 곡 고르는 중 — startRound 재진입 방지 */
  duelStarting: boolean
  /** 다음 라운드 발동 증강: 예약자는 즉시 알고, 전원은 실제 발동 때 알림 */
  pendingAugmentNotices: Array<{
    startIndex: number
    userId: string
    nickname: string
    name: string
    effectType: string
    description: string
    imageUrl: string | null
    tier?: string
    message: string
  }>
  /** 코로나: 채팅방 분리(격리조) */
  chatIsolate: {
    startIndex: number
    roundsLeft: number
    byName: string
    byNickname: string
    groupByUserId: Record<string, number>
  } | null
}

function parseEffectValue(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function buffApplies(buff: ActiveBuff, roundIndex: number) {
  return roundIndex >= buff.startIndex && buff.roundsLeft > 0
}

function activeBuffsAt(m: Member, roundIndex: number, _room?: Room | null) {
  return m.activeBuffs.filter((b) => buffApplies(b, roundIndex))
}

function tickBuffsAfterRound(
  io: Server,
  room: Room,
  m: Member,
  endedIndex: number,
) {
  if (
    m.sakuraDecoy
    && m.sakuraDecoy.mode === 'truman'
    && endedIndex >= m.sakuraDecoy.startIndex
    && m.sakuraDecoy.roundsLeft > 0
  ) {
    m.sakuraDecoy.roundsLeft -= 1
    if (m.sakuraDecoy.roundsLeft <= 0) {
      settleTrumanIllusion(io, room, m)
    }
  }

  for (const b of m.activeBuffs) {
    if (endedIndex >= b.startIndex && b.roundsLeft > 0) b.roundsLeft -= 1
  }
  m.activeBuffs = m.activeBuffs.filter((b) => b.roundsLeft > 0)
  if (m.chatMute && endedIndex >= m.chatMute.startIndex && m.chatMute.roundsLeft > 0) {
    m.chatMute.roundsLeft -= 1
    if (m.chatMute.roundsLeft <= 0) m.chatMute = null
  }
  if (m.answerDelay && endedIndex >= m.answerDelay.startIndex && m.answerDelay.roundsLeft > 0) {
    m.answerDelay.roundsLeft -= 1
    if (m.answerDelay.roundsLeft <= 0) m.answerDelay = null
  }
  if (m.politeSuffix && endedIndex >= m.politeSuffix.startIndex && m.politeSuffix.roundsLeft > 0) {
    m.politeSuffix.roundsLeft -= 1
    if (m.politeSuffix.roundsLeft <= 0) m.politeSuffix = null
  }
  if (m.answerBlock && endedIndex >= m.answerBlock.startIndex && m.answerBlock.roundsLeft > 0) {
    m.answerBlock.roundsLeft -= 1
    if (m.answerBlock.roundsLeft <= 0) m.answerBlock = null
  }
  if (m.accuseMark && endedIndex >= m.accuseMark.watchIndex) {
    m.accuseMark = null
  }
  if (m.gabuki && endedIndex >= m.gabuki.startIndex && m.gabuki.roundsLeft > 0) {
    m.gabuki.roundsLeft -= 1
    if (m.gabuki.roundsLeft <= 0) m.gabuki = null
  }
  if (m.answerProxy && endedIndex >= m.answerProxy.startIndex && m.answerProxy.roundsLeft > 0) {
    m.answerProxy.roundsLeft -= 1
  }
  // 세노 등 비-트루먼 디코이
  if (
    m.sakuraDecoy
    && m.sakuraDecoy.mode !== 'truman'
    && endedIndex >= m.sakuraDecoy.startIndex
    && m.sakuraDecoy.roundsLeft > 0
  ) {
    m.sakuraDecoy.roundsLeft -= 1
    if (m.sakuraDecoy.roundsLeft <= 0) m.sakuraDecoy = null
  }
  if (m.flameKim && endedIndex >= m.flameKim.startIndex && m.flameKim.roundsLeft > 0) {
    m.flameKim.roundsLeft -= 1
    if (m.flameKim.roundsLeft <= 0) m.flameKim = null
  }
}

function isAnswerProxyActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.answerProxy && roundIndex >= m.answerProxy.startIndex && m.answerProxy.roundsLeft > 0)
}

/** 대리 기간 종료 시 적립 점수 결산. 대상 닉네임은 공개하지 않음 */
function settleAnswerProxy(io: Server, room: Room, m: Member) {
  if (!m.answerProxy || m.answerProxy.roundsLeft > 0) return
  const gained = m.answerProxy.pendingScore
  const name = m.answerProxy.byName
  m.score += gained
  m.answerProxy = null
  io.to(room.id).emit('chat:message', {
    id: Date.now(),
    userId: '',
    nickname: '시스템',
    text: `${m.nickname}님의 [${name}] 결산! +${gained}점`,
    system: true,
    at: Date.now(),
  })
  io.to(m.socketId).emit('augment:hint', {
    name,
    hint: `[${name}] 결산 완료 · +${gained}점`,
    durationMs: 0,
  })
}

function settleAllAnswerProxies(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (m.answerProxy && m.answerProxy.roundsLeft <= 0) {
      settleAnswerProxy(io, room, m)
    }
  }
}

/** 맞췄죠?: 해당 라운드에 슬롯을 하나라도 맞히면 bonus, 아니면 penalty */
function wagerBuffAt(m: Member, room: Room) {
  return activeBuffsAt(m, room.index, room).find((b) => b.effectType === 'wager_answer') || null
}

/** 정답 즉시 성공 결산. 적용된 보너스 점수 반환 */
function tryResolveWagerWin(io: Server, room: Room, m: Member): number {
  if (room.wagerSettled.has(m.userId)) return 0
  const b = wagerBuffAt(m, room)
  if (!b) return 0
  const bonus = Number(b.effectValue.bonus)
  const winPts = Number.isFinite(bonus) ? bonus : 5
  room.wagerSettled.add(m.userId)
  m.score += winPts
  shareLinkedScoreGain(io, room, m, winPts)
  io.to(room.id).emit('chat:message', {
    id: Date.now() + 7,
    userId: '',
    nickname: '시스템',
    text: `${m.nickname}님의 [${b.name}] 성공! +${winPts}점`,
    system: true,
    at: Date.now(),
  })
  io.to(m.socketId).emit('augment:hint', {
    name: b.name,
    hint: `[${b.name}] 정답! +${winPts}점`,
    durationMs: 0,
  })
  return winPts
}

/** 라운드 종료: 아직 성공 결산 안 된 wager → 실패 패널티 (penalty≤0이면 스킵) */
function settleWagerAnswers(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (room.wagerSettled.has(m.userId)) continue
    const b = wagerBuffAt(m, room)
    if (!b) continue
    room.wagerSettled.add(m.userId)
    const penalty = Number(b.effectValue.penalty)
    if (!(Number.isFinite(penalty) && penalty > 0)) {
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: `[${b.name}] 미성공 · 패널티 없음`,
        durationMs: 0,
      })
      continue
    }
    const losePts = penalty
    m.score -= losePts
    io.to(room.id).emit('chat:message', {
      id: Date.now() + Math.floor(Math.random() * 100),
      userId: '',
      nickname: '시스템',
      text: `${m.nickname}님의 [${b.name}] 실패… −${losePts}점`,
      system: true,
      at: Date.now(),
    })
    io.to(m.socketId).emit('augment:hint', {
      name: b.name,
      hint: `[${b.name}] 못 맞춤… −${losePts}점`,
      durationMs: 0,
    })
  }
}

function isGabukiActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.gabuki && roundIndex >= m.gabuki.startIndex && m.gabuki.roundsLeft > 0)
}

/** 가불기: 대상이 정답을 맞히면 시전자에게 hitPenalty 이전 */
function applyGabukiOnCorrect(io: Server, room: Room, victim: Member) {
  if (!isGabukiActive(victim, room.index, room) || !victim.gabuki) return
  const g = victim.gabuki
  const amt = g.hitPenalty > 0 ? g.hitPenalty : 1
  const caster = room.members.get(g.casterUserId)
  victim.score -= amt
  if (caster && caster.userId !== victim.userId) {
    caster.score += amt
  }
  io.to(room.id).emit('chat:message', {
    id: Date.now() + 11,
    userId: '',
    nickname: '시스템',
    text: caster && caster.userId !== victim.userId
      ? `${victim.nickname}님의 [${g.byName}]! −${amt} → ${caster.nickname}님 +${amt}`
      : `${victim.nickname}님의 [${g.byName}]! −${amt}점`,
    system: true,
    at: Date.now(),
  })
  io.to(victim.socketId).emit('augment:hint', {
    name: g.byName,
    hint: `[${g.byName}] 정답 · −${amt}점${caster ? ` → ${caster.nickname}` : ''}`,
    durationMs: 0,
  })
}

/** 가불기: 해당 라운드에 정답을 한 번도 못 맞히면 missPenalty 이전 */
function settleGabukiMiss(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (!isGabukiActive(m, room.index, room) || !m.gabuki) continue
    const hadCorrect = Object.values(room.revealed).some((r) => r.userId === m.userId)
    if (hadCorrect) continue
    const g = m.gabuki
    const amt = g.missPenalty > 0 ? g.missPenalty : 2
    const caster = room.members.get(g.casterUserId)
    m.score -= amt
    if (caster && caster.userId !== m.userId) {
      caster.score += amt
    }
    io.to(room.id).emit('chat:message', {
      id: Date.now() + 12 + Math.floor(Math.random() * 50),
      userId: '',
      nickname: '시스템',
      text: caster && caster.userId !== m.userId
        ? `${m.nickname}님의 [${g.byName}] 미득점! −${amt} → ${caster.nickname}님 +${amt}`
        : `${m.nickname}님의 [${g.byName}] 미득점! −${amt}점`,
      system: true,
      at: Date.now(),
    })
    io.to(m.socketId).emit('augment:hint', {
      name: g.byName,
      hint: `[${g.byName}] 이번 라운드 정답 없음 · −${amt}점`,
      durationMs: 0,
    })
  }
}

/** 물귀신: 이번 라운드 점수를 전부 못 맞히면 맞춘 플레이어 각 −penalty, 본인 +gain */
function settleWaterGhost(io: Server, room: Room) {
  const q = room.queue[room.index]
  if (!q || q.slots.length === 0) return

  for (const m of room.members.values()) {
    const b = activeBuffsAt(m, room.index, room).find((x) => x.effectType === 'water_ghost')
    if (!b) continue
    // 본인이 이번 라운드 모든 슬롯(점수)을 맞혀야 원정 실패
    const gotAll = q.slots.every((s) => room.revealed[s.id]?.userId === m.userId)
    if (gotAll) {
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: `[${b.name}] 전부 정답! 원정 실패`,
        durationMs: 0,
      })
      continue
    }
    const penRaw = Number(b.effectValue.penalty)
    const pen = Number.isFinite(penRaw) && penRaw > 0 ? Math.floor(penRaw) : 2
    const gainRaw = Number(b.effectValue.gain)
    const gain = Number.isFinite(gainRaw) && gainRaw > 0 ? Math.floor(gainRaw) : 1
    const scorers = new Set<string>()
    for (const r of Object.values(room.revealed)) {
      if (r.userId && r.userId !== m.userId) scorers.add(r.userId)
    }
    if (scorers.size === 0) {
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: `[${b.name}] 점수 미완 · 끌어내릴 상대 없음`,
        durationMs: 0,
      })
      continue
    }
    const names: string[] = []
    for (const id of scorers) {
      const other = room.members.get(id)
      if (!other) continue
      other.score -= pen
      names.push(other.nickname)
    }
    m.score += gain
    io.to(room.id).emit('chat:message', {
      id: Date.now() + Math.floor(Math.random() * 100),
      userId: '',
      nickname: '시스템',
      text: `${m.nickname}님의 [${b.name}]! ${names.join('·')} 각 −${pen}점 · 본인 +${gain}점`,
      system: true,
      at: Date.now(),
    })
    io.to(m.socketId).emit('augment:hint', {
      name: b.name,
      hint: `[${b.name}] 원정! 맞춘 플레이어 각 −${pen} · 본인 +${gain}`,
      durationMs: 0,
    })
  }
}

/** 콤보: 매 R 1회+ 정답 유지 · 실패 시 즉시 종료 · 기간 종료 시 누적 점수 한 번 더(+acc) */
function settleComboClear(io: Server, room: Room) {
  const q = room.queue[room.index]
  if (!q || q.slots.length === 0) return

  for (const m of room.members.values()) {
    const b = activeBuffsAt(m, room.index, room).find((x) => x.effectType === 'combo_clear_double')
    if (!b) continue
    const gotAny = q.slots.some((s) => room.revealed[s.id]?.userId === m.userId)
    if (!gotAny) {
      m.activeBuffs = m.activeBuffs.filter((x) => x !== b)
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: `[${b.name}] 콤보 끊김 (이번 라운드 정답 없음)`,
        durationMs: 0,
      })
      continue
    }
    const earned = Math.max(0, Math.floor(m.roundScoreGain))
    const prevAcc = Number(b.effectValue.acc)
    const acc = (Number.isFinite(prevAcc) ? prevAcc : 0) + earned
    b.effectValue.acc = acc
    // tick 전 roundsLeft===1이면 이번이 마지막 성공 라운드 → 누적분 더블
    if (b.roundsLeft <= 1) {
      if (acc > 0) {
        m.score += acc
        io.to(room.id).emit('chat:message', {
          id: Date.now() + Math.floor(Math.random() * 100),
          userId: '',
          nickname: '시스템',
          text: `${m.nickname}님의 [${b.name}]! 기간 점수 ×2 (+${acc})`,
          system: true,
          at: Date.now(),
        })
        io.to(m.socketId).emit('augment:hint', {
          name: b.name,
          hint: `[${b.name}] 콤보 완성! 누적 +${acc}점`,
          durationMs: 0,
        })
      } else {
        io.to(m.socketId).emit('augment:hint', {
          name: b.name,
          hint: `[${b.name}] 콤보 종료 · 추가 점수 없음`,
          durationMs: 0,
        })
      }
    } else {
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: `[${b.name}] 유지 · 누적 ${acc}점 · 남은 ${b.roundsLeft - 1}R`,
        durationMs: 2500,
      })
    }
  }
}

/** 게임 종료 등으로 기간이 남았어도 강제 결산 */
function forceSettleAnswerProxies(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (!m.answerProxy) continue
    m.answerProxy.roundsLeft = 0
    settleAnswerProxy(io, room, m)
  }
}

/** 영역전개: 시전자보다 점수 높은 인원에게 시한 정답 차단 */
function applyDomainExpansionPulse(
  io: Server,
  room: Room,
  caster: Member,
  byName: string,
  blockMs: number,
  opts?: { allowReflect?: boolean; casterUser?: { id: string; nickname: string } },
) {
  const higherRanked = [...room.members.values()].filter(
    (other) => other.userId !== caster.userId && other.score > caster.score,
  )
  if (!higherRanked.length) return { hit: 0, reflectedCount: 0 }
  const until = Date.now() + blockMs
  let hit = 0
  let reflectedCount = 0
  for (const other of higherRanked) {
    let victim = other
    let label = byName
    if (opts?.allowReflect) {
      const shield = takeReflectShield(other, room.index)
      if (shield) {
        reflectedCount += 1
        victim = caster
        label = shield.name
        io.to(other.socketId).emit('augment:hint', {
          name: shield.name,
          hint: `[무지개 반사] ${opts.casterUser?.nickname || caster.nickname}님의 [${byName}]을(를) 되돌려보냈습니다`,
          durationMs: 0,
        })
      }
    }
    victim.answerBlockUntil = until
    victim.answerBlockUntilBy = label
    hit += 1
  }
  const t = setTimeout(() => {
    for (const x of room.members.values()) {
      if (x.answerBlockUntil && x.answerBlockUntil <= Date.now()) {
        x.answerBlockUntil = null
        x.answerBlockUntilBy = null
      }
    }
    io.to(room.id).emit('room:state', roomState(room))
  }, blockMs + 80)
  room.extraTimers.push(t)
  return { hit, reflectedCount }
}

/** 기생수: 파트너에게 동일 득점 복사 (재공유 없음) */
function shareLinkedScoreGain(io: Server, room: Room, from: Member, amount: number) {
  if (amount <= 0) return
  const buff = activeBuffsAt(from, room.index, room).find((b) => b.effectType === 'score_share')
  if (!buff) return
  const partnerId = String(buff.effectValue.partnerId || '')
  if (!partnerId || partnerId === from.userId) return
  const partner = room.members.get(partnerId)
  if (!partner) return
  partner.score += amount
  partner.roundScoreGain += amount
  io.to(room.id).emit('chat:message', {
    id: Date.now() + 21,
    userId: '',
    nickname: '시스템',
    text: `${partner.nickname}님 [${buff.name}]! ${from.nickname}님과 같이 +${amount}점`,
    system: true,
    at: Date.now(),
  })
  io.to(partner.socketId).emit('augment:hint', {
    name: buff.name,
    hint: `[${buff.name}] ${from.nickname}님 득점 공유 +${amount}`,
    durationMs: 2500,
  })
}

/** 차차차 등: 기생수 공유 점수 회수 (채팅 없음) */
function reverseShareLinkedScoreGain(room: Room, from: Member, amount: number) {
  if (amount <= 0) return
  const buff = activeBuffsAt(from, room.index, room).find((b) => b.effectType === 'score_share')
  if (!buff) return
  const partnerId = String(buff.effectValue.partnerId || '')
  if (!partnerId || partnerId === from.userId) return
  const partner = room.members.get(partnerId)
  if (!partner) return
  partner.score -= amount
  partner.roundScoreGain -= amount
}

/** 대상이 득점했을 때 대리 시전자들에게 적립 */
function bankAnswerProxyPoints(io: Server, room: Room, targetUserId: string, gain: number) {
  if (gain <= 0) return
  for (const m of room.members.values()) {
    if (!isAnswerProxyActive(m, room.index, room)) continue
    if (m.answerProxy!.targetUserId !== targetUserId) continue
    m.answerProxy!.pendingScore += gain
    io.to(m.socketId).emit('augment:hint', {
      name: m.answerProxy!.byName,
      hint: `[${m.answerProxy!.byName}] 대리 적립 +${gain} (누적 ${m.answerProxy!.pendingScore})`,
      durationMs: 2500,
    })
  }
}

/** 차차차 등: 대리 적립 회수 */
function reverseBankAnswerProxyPoints(room: Room, targetUserId: string, gain: number) {
  if (gain <= 0) return
  for (const m of room.members.values()) {
    if (!isAnswerProxyActive(m, room.index, room)) continue
    if (m.answerProxy!.targetUserId !== targetUserId) continue
    m.answerProxy!.pendingScore = Math.max(0, m.answerProxy!.pendingScore - gain)
  }
}

/** 선답 점수·맞췄죠? 보너스 회수 (차차차 중복 정답 우선 처리) */
function revokeRevealedAnswerCredit(room: Room, rev: {
  userId: string
  points?: number
  wagerPts?: number
}) {
  const victim = room.members.get(rev.userId)
  if (!victim) return
  const points = Number(rev.points) || 0
  const wagerPts = Number(rev.wagerPts) || 0
  if (points) {
    victim.score -= points
    victim.roundScoreGain -= points
    reverseShareLinkedScoreGain(room, victim, points)
    reverseBankAnswerProxyPoints(room, rev.userId, points)
  }
  if (wagerPts > 0) {
    victim.score -= wagerPts
    reverseShareLinkedScoreGain(room, victim, wagerPts)
    room.wagerSettled.delete(rev.userId)
  }
}

/** 범인은 당신이야: 감시 라운드 정답 → 다음 라운드 수면 */
function tryTriggerAccuseSleep(io: Server, room: Room, m: Member) {
  const mark = m.accuseMark
  if (!mark || room.index !== mark.watchIndex) return
  m.accuseMark = null
  m.answerBlock = {
    startIndex: room.index + 1,
    roundsLeft: 1,
    byName: '수면',
    byNickname: mark.byNickname,
  }
  io.to(m.socketId).emit('augment:hint', {
    name: mark.byName,
    hint: `[${mark.byName}] 정답! 다음 라운드 수면 (정답 인정 안 됨 · 채팅 OK)`,
    durationMs: 0,
  })
  io.to(room.id).emit('chat:message', {
    id: Date.now() + 8,
    userId: '',
    nickname: '시스템',
    text: `${m.nickname}님 [${mark.byName}] 발동! 다음 라운드 수면 (정답 인정 안 됨 · 채팅 OK)`,
    system: true,
    at: Date.now(),
  })
  io.to(room.id).emit('room:state', roomState(room))
}

function isChatMuted(m: Member, roundIndex: number, _room?: Room | null) {
  if (m.chatMuteUntil && m.chatMuteUntil > Date.now()) return true
  return !!(m.chatMute && roundIndex >= m.chatMute.startIndex && m.chatMute.roundsLeft > 0)
}

/** 스킵 필요 인원: 플레이어 수의 절반 (홀수는 올림) · 최소 1 */
function skipVotesNeeded(memberCount: number) {
  const n = Math.max(0, Math.floor(memberCount))
  if (n <= 0) return 1
  return Math.max(1, Math.ceil(n / 2))
}

function isPlayingMember(m: Member) {
  return !m.isSpectator
}

function playerMembers(room: Room) {
  return [...room.members.values()].filter(isPlayingMember)
}

function playerCount(room: Room) {
  return playerMembers(room).length
}

/** 이미 증강 효과(활성·예약)가 걸린 대상 → 타겟 증강 추가 적용 불가 */
function hasIncomingAugmentEffect(m: Member, room: Room): boolean {
  if ((m.activeBuffs || []).some((b) => b.roundsLeft > 0)) return true
  if (m.chatMute && m.chatMute.roundsLeft > 0) return true
  if (m.chatMuteUntil && m.chatMuteUntil > Date.now()) return true
  if (m.answerDelay && m.answerDelay.roundsLeft > 0) return true
  if (m.politeSuffix && m.politeSuffix.roundsLeft > 0) return true
  if (m.answerBlock && m.answerBlock.roundsLeft > 0) return true
  if (m.answerBlockUntil && m.answerBlockUntil > Date.now()) return true
  if (m.audioDelayUntil && m.audioDelayUntil > Date.now()) return true
  if (m.accuseMark) return true
  if (m.gabuki && m.gabuki.roundsLeft > 0) return true
  if (m.answerProxy && m.answerProxy.roundsLeft > 0) return true
  if (m.sakuraDecoy && m.sakuraDecoy.roundsLeft > 0) return true
  if (m.flameKim && m.flameKim.roundsLeft > 0) return true
  if (m.songMuteUntil && m.songMuteUntil > Date.now()) return true
  if (room.pendingDuel && (room.pendingDuel.challengerId === m.userId || room.pendingDuel.opponentId === m.userId)) {
    return true
  }
  if (room.duel && (room.duel.challengerId === m.userId || room.duel.opponentId === m.userId)) {
    return true
  }
  return false
}

/** 타겟 증강 지목 가능 (플레이어 + 효과 없음) */
function canReceiveTargetAugment(m: Member, room: Room) {
  return isPlayingMember(m) && !hasIncomingAugmentEffect(m, room)
}

function rejectBusyTarget(
  intended: Member | null | undefined,
  selfId: string,
  room: Room,
): { ok: false; hint: string | null; chatText: null } | null {
  if (!intended || intended.userId === selfId) return { ok: false, hint: null, chatText: null }
  if (intended.isSpectator) {
    return { ok: false, hint: '관전자에게는 증강을 사용할 수 없습니다', chatText: null }
  }
  if (hasIncomingAugmentEffect(intended, room)) {
    return { ok: false, hint: '이미 증강이 적용 중인 대상입니다', chatText: null }
  }
  return null
}

function isChatIsolateActive(room: Room, roundIndex = room.index) {
  const iso = room.chatIsolate
  return !!(iso && roundIndex >= iso.startIndex && iso.roundsLeft > 0)
}

function isChatIsolatePending(room: Room) {
  return !!(room.chatIsolate && room.index < room.chatIsolate.startIndex)
}

/** 플레이어 채팅 · 코로나 격리 중이면 같은 조에게만 전달 */
function emitPlayerChat(
  io: Server,
  room: Room,
  msg: {
    id: number
    userId: string
    nickname: string
    text: string
    at: number
    system?: boolean
  },
) {
  if (!isChatIsolateActive(room) || msg.system) {
    io.to(room.id).emit('chat:message', msg)
    return
  }
  const iso = room.chatIsolate!
  let group = iso.groupByUserId[msg.userId]
  if (group === undefined) {
    // 중간에 들어온 사람 → 인원 적은 조에 배정
    const counts = [0, 0]
    for (const g of Object.values(iso.groupByUserId)) {
      if (g === 0 || g === 1) counts[g] += 1
    }
    group = counts[0] <= counts[1] ? 0 : 1
    iso.groupByUserId[msg.userId] = group
  }
  for (const other of room.members.values()) {
    const og = iso.groupByUserId[other.userId]
    if (og === group) io.to(other.socketId).emit('chat:message', msg)
  }
}

function tickChatIsolate(room: Room, endedIndex: number) {
  const iso = room.chatIsolate
  if (!iso || endedIndex < iso.startIndex || iso.roundsLeft <= 0) return
  iso.roundsLeft -= 1
  if (iso.roundsLeft <= 0) room.chatIsolate = null
}

function isAnswerDelayActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.answerDelay && roundIndex >= m.answerDelay.startIndex && m.answerDelay.roundsLeft > 0)
}

function isPoliteSuffixActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.politeSuffix && roundIndex >= m.politeSuffix.startIndex && m.politeSuffix.roundsLeft > 0)
}

function isAnswerBlocked(m: Member, roundIndex: number, room?: Room | null) {
  if (m.answerBlockUntil && m.answerBlockUntil > Date.now()) return true
  if (m.answerBlock && roundIndex >= m.answerBlock.startIndex && m.answerBlock.roundsLeft > 0) return true
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'know_but_cant')
}

function knowButCantBuff(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'know_but_cant') || null
}

function knowButCantPending(m: Member, roundIndex: number) {
  return m.activeBuffs.find((b) => b.effectType === 'know_but_cant' && roundIndex < b.startIndex) || null
}

function answerBlockPublic(m: Member, roundIndex: number, room?: Room | null) {
  const timedActive = !!(m.answerBlockUntil && m.answerBlockUntil > Date.now())
  const classicActive = !!(m.answerBlock && roundIndex >= m.answerBlock.startIndex && m.answerBlock.roundsLeft > 0)
  const classicPending = !!(m.answerBlock && roundIndex < m.answerBlock.startIndex)
  const know = knowButCantBuff(m, roundIndex, room)
  const knowPend = knowButCantPending(m, roundIndex)
  return {
    answerBlocked: classicActive || !!know || timedActive,
    answerBlockPending: classicPending || !!knowPend,
    answerBlockRoundsLeft: classicActive
      ? m.answerBlock!.roundsLeft
      : know
        ? know.roundsLeft
        : classicPending
          ? m.answerBlock!.roundsLeft
          : knowPend?.roundsLeft ?? null,
    answerBlockBy: timedActive
      ? (m.answerBlockUntilBy || null)
      : classicActive || classicPending
        ? (m.answerBlock!.byName || null)
        : (know?.name || knowPend?.name || null),
  }
}

function hasEarlyChosung(m: Member, roundIndex: number, room?: Room | null) {
  if (m.duelEarlyChosung && room?.status === 'duel') return true
  if (activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'early_chosung')) return true
  const wager = activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'wager_answer')
  return !!(wager && wager.effectValue.earlyChosung)
}

/** 이번/지정 라운드에 노래 교체(진흙탕·디코이)가 겹치면 true — 풍악(오버레이)은 제외 */
function hasReplaceAudioConflict(room: Room, atIndex: number) {
  for (const m of room.members.values()) {
    for (const b of m.activeBuffs) {
      if (b.effectType !== 'mud_fight') continue
      if (b.roundsLeft <= 0) continue
      if (atIndex >= b.startIndex && atIndex < b.startIndex + b.roundsLeft) return true
    }
    const d = m.sakuraDecoy
    if (d && d.roundsLeft > 0 && atIndex >= d.startIndex && atIndex < d.startIndex + d.roundsLeft) {
      return true
    }
  }
  return false
}

function isGameGenre(genre: string) {
  const g = (genre || '').toLowerCase()
  return g.includes('메이플') || g.includes('리겜') || g.includes('게임')
}

function answerDelayRemainingMs(room: Room, m: Member): number {
  if (!isAnswerDelayActive(m, room.index, room) || !m.answerDelay) return 0
  const unlockAt = room.roundStartedAt + m.answerDelay.delaySec * 1000
  return Math.max(0, unlockAt - Date.now())
}

function isDuelParticipant(room: Room, userId: string): boolean {
  return !!(room.duel && (userId === room.duel.challengerId || userId === room.duel.opponentId))
}

/** 야차룰 관전 채팅 — 대결 당사자에게는 안 보냄 */
function emitSpectatorChat(
  io: Server,
  room: Room,
  msg: {
    id: number
    userId: string
    nickname: string
    text: string
    at: number
    system?: boolean
  },
) {
  const payload = { ...msg, spectator: true as const }
  for (const m of room.members.values()) {
    if (isDuelParticipant(room, m.userId)) continue
    io.to(m.socketId).emit('chat:message', payload)
  }
}

function answerScoreFor(m: Member, roundIndex: number, slotHidden = false, room?: Room | null) {
  const base = slotHidden ? 3 : 1
  let mult = 1
  for (const b of activeBuffsAt(m, roundIndex, room)) {
    if (
      b.effectType === 'score_mult'
      || b.effectType === 'score_mult_no_hint'
      || b.effectType === 'score_mult_hint_only'
      || b.effectType === 'score_mult_risky'
    ) {
      // 점수가 2배: excludeHidden 시 히든 슬롯 배율 제외
      if (b.effectType === 'score_mult' && slotHidden && b.effectValue.excludeHidden) continue
      const n = Number(b.effectValue.mult)
      if (Number.isFinite(n) && n > mult) mult = n
    }
  }
  if (isSakuraDecoyActive(m, roundIndex) && m.sakuraDecoy!.mode !== 'truman') {
    const n = m.sakuraDecoy!.scoreMult
    if (Number.isFinite(n) && n > mult) mult = n
  }
  return Math.max(1, Math.floor(base * mult))
}

function hasRiskyDouble(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'score_mult_risky')
}

function hasHiddenRun(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'hidden_run')
}

/** 히든런: 일반 슬롯 0점, 히든은 baseGain × mult */
function hiddenRunGainForAnswer(
  m: Member,
  roundIndex: number,
  slotHidden: boolean,
  baseGain: number,
  room?: Room | null,
): number {
  if (!hasHiddenRun(m, roundIndex, room)) return baseGain
  if (!slotHidden) return 0
  const buff = activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'hidden_run')
  const n = Number(buff?.effectValue.mult)
  const mult = Number.isFinite(n) && n > 0 ? n : 3
  return Math.max(1, Math.floor(baseGain * mult))
}

function isTitleLikeLabel(label: string) {
  return label.includes('제목') || label.includes('게임')
}

/** 가수 = 커버 = 캐릭터 (힌트·초성·스포일 동일 취급) */
function isArtistLikeLabel(label: string) {
  return label.includes('가수') || label.includes('커버') || label.includes('캐릭터')
}

/** 조사 을/를 */
function josaUlReul(word: string) {
  const ch = [...word].filter((c) => /[가-힣]/.test(c)).pop()
  if (!ch) return '를'
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return '를'
  return code % 28 === 0 ? '를' : '을'
}

function findTitleSlot(q: QuestionRuntime) {
  return q.slots.find((s) => !s.hidden && isTitleLikeLabel(s.label))
    || q.slots.find((s) => !s.hidden && !isArtistLikeLabel(s.label))
    || null
}

function findArtistSlots(q: QuestionRuntime) {
  return q.slots.filter((s) => !s.hidden && isArtistLikeLabel(s.label))
}

/** 제목만 모드: 첫 번째 비전 슬롯(1번) + 히든 슬롯 유지 */
function applyAnswerMode(q: QuestionRuntime, mode: 'title' | 'title_artist'): QuestionRuntime {
  if (mode !== 'title') return q
  const first = q.slots.find((s) => !s.hidden) || q.slots[0]
  const hiddenSlots = q.slots.filter((s) => s.hidden)
  if (!first) {
    return {
      ...q,
      slots: hiddenSlots.map((s) => ({ ...s })),
      artistChosung: '',
    }
  }
  const titleSlot = { ...first, hidden: false }
  return {
    ...q,
    slots: [titleSlot, ...hiddenSlots.map((s) => ({ ...s }))],
    titleChosung: titleSlot.chosung || q.titleChosung,
    artistChosung: '',
  }
}

/**
 * 점수가 2배: 제목을 남이 먼저 맞힌 상태면 이후 정답도 -1.
 * (선점 실패 시 즉시 -1은 제목 공개 시점에 이미 적용)
 */
function riskyGainForAnswer(
  room: Room,
  m: Member,
  userId: string,
  q: QuestionRuntime,
  baseGain: number,
): number {
  if (!hasRiskyDouble(m, room.index, room)) return baseGain
  const titleSlot = findTitleSlot(q)
  if (!titleSlot) return baseGain
  const titleRev = room.revealed[titleSlot.id]
  if (!titleRev || titleRev.userId === userId) return baseGain
  return -1
}

function isSakuraDecoyActive(m: Member, roundIndex: number, _room?: Room | null) {
  if (!(m.sakuraDecoy && roundIndex >= m.sakuraDecoy.startIndex && m.sakuraDecoy.roundsLeft > 0)) return false
  return true
}

/** 트루먼쇼 환상 모드 (가짜 곡 채점 · 가짜 점수 표시) */
function isTrumanIllusion(m: Member, roundIndex: number) {
  return !!(
    m.sakuraDecoy
    && m.sakuraDecoy.mode === 'truman'
    && roundIndex >= m.sakuraDecoy.startIndex
    && m.sakuraDecoy.roundsLeft > 0
  )
}

function displayScoreOf(m: Member, roundIndex: number) {
  if (isTrumanIllusion(m, roundIndex) && m.sakuraDecoy) {
    return m.score + m.sakuraDecoy.fakeScore
  }
  return m.score
}

/** 트루먼쇼 종료: 가짜 점수 무효 공개 · 실제 점수는 그대로 */
function settleTrumanIllusion(io: Server, room: Room, m: Member) {
  if (!m.sakuraDecoy || m.sakuraDecoy.mode !== 'truman') {
    m.sakuraDecoy = null
    return
  }
  const fake = m.sakuraDecoy.fakeScore
  const name = m.sakuraDecoy.byName
  m.sakuraDecoy = null
  const text = fake > 0
    ? `짜잔! ${m.nickname}님은 트루먼이었습니다! (가짜 +${fake}점은 무효 · 실제 ${m.score}점)`
    : `짜잔! ${m.nickname}님은 트루먼이었습니다!`
  io.to(room.id).emit('chat:message', {
    id: Date.now(),
    userId: '',
    nickname: '시스템',
    text,
    system: true,
    at: Date.now(),
  })
  io.to(m.socketId).emit('truman:reveal', {
    name,
    fakeScore: fake,
    realScore: m.score,
  })
  io.to(m.socketId).emit('augment:hint', {
    name,
    hint: fake > 0
      ? `짜잔! 당신은 트루먼이었습니다 · 가짜 +${fake}점 무효 (실제 ${m.score}점)`
      : '짜잔! 당신은 트루먼이었습니다!',
    durationMs: 0,
  })
}

function forceSettleTrumanIllusions(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (!m.sakuraDecoy || m.sakuraDecoy.mode !== 'truman') continue
    settleTrumanIllusion(io, room, m)
  }
}

function isFlameKimActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.flameKim && roundIndex >= m.flameKim.startIndex && m.flameKim.roundsLeft > 0)
}

/** 방 노래와 분리된 증강 트릭 오디오 (클라 이중 플레이어용) */
function resolveAudioTrick(m: Member, room: Room): {
  mode: 'replace' | 'overlay'
  youtubeUrl: string
  startSec: number
  endSec: number | null
  label: string
  source: 'mud' | 'sakura' | 'flame' | 'party'
} | null {
  if (room.status === 'duel') return null
  // 트루먼 대상에게는 환상 곡과 슬롯이 항상 우선이다.
  if (isTrumanIllusion(m, room.index) && m.sakuraDecoy?.youtubeUrl) {
    const end = m.sakuraDecoy.endSec
    return {
      mode: 'replace',
      youtubeUrl: m.sakuraDecoy.youtubeUrl,
      startSec: m.sakuraDecoy.startSec,
      endSec: end > m.sakuraDecoy.startSec ? end : null,
      label: '다른 곡',
      source: 'sakura',
    }
  }
  for (const b of activeBuffsAt(m, room.index, room)) {
    if (b.effectType !== 'mud_fight') continue
    const youtubeUrl = String(b.effectValue.bgmUrl || b.effectValue.youtubeUrl || '').trim()
    if (!youtubeUrl) continue
    const startRaw = Number(b.effectValue.bgmStartSec ?? b.effectValue.startSec)
    return {
      mode: 'replace',
      youtubeUrl,
      startSec: Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0,
      endSec: null,
      label: b.name || '진흙탕 싸움',
      source: 'mud',
    }
  }
  // 세노·에라모르겠다 등: 대상에게 강제곡 (방 곡 대체)
  if (isSakuraDecoyActive(m, room.index, room) && m.sakuraDecoy?.youtubeUrl) {
    const end = m.sakuraDecoy.endSec
    return {
      mode: 'replace',
      youtubeUrl: m.sakuraDecoy.youtubeUrl,
      startSec: m.sakuraDecoy.startSec,
      endSec: end > m.sakuraDecoy.startSec ? end : null,
      label: m.sakuraDecoy.mode === 'truman' ? '다른 곡' : (m.sakuraDecoy.byName || '다른 곡'),
      source: 'sakura',
    }
  }
  // 풍악: 방 곡 + 풍악 동시 재생
  for (const b of activeBuffsAt(m, room.index, room)) {
    if (b.effectType !== 'party_music_others') continue
    const youtubeUrl = String(b.effectValue.bgmUrl || b.effectValue.youtubeUrl || '').trim()
    if (!youtubeUrl) continue
    const startRaw = Number(b.effectValue.bgmStartSec ?? b.effectValue.startSec)
    return {
      mode: 'overlay',
      youtubeUrl,
      startSec: Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0,
      endSec: null,
      label: b.name || '풍악을 울려라',
      source: 'party',
    }
  }
  // 불꽃남자: 방 곡 + 트릭 곡 오버레이
  if (isFlameKimActive(m, room.index, room) && m.flameKim) {
    return {
      mode: 'overlay',
      youtubeUrl: m.flameKim.youtubeUrl,
      startSec: m.flameKim.startSec,
      endSec: null,
      label: m.flameKim.byName || '불꽃남자김상원',
      source: 'flame',
    }
  }
  return null
}

/** 불꽃남자김상원: 시전자 정답 시 대상 점수 감소 (시전자 본인 득점은 그대로) */
function applyFlameKimOnCorrect(io: Server, room: Room, caster: Member) {
  if (!isFlameKimActive(caster, room.index, room) || !caster.flameKim) return
  const f = caster.flameKim
  const victim = room.members.get(f.targetUserId)
  if (!victim || victim.userId === caster.userId) return
  const amt = f.drain > 0 ? f.drain : 1
  victim.score -= amt
  io.to(room.id).emit('chat:message', {
    id: Date.now() + 13,
    userId: '',
    nickname: '시스템',
    text: `${caster.nickname}님의 [${f.byName}]! ${victim.nickname}님 −${amt}점`,
    system: true,
    at: Date.now(),
  })
  io.to(victim.socketId).emit('augment:hint', {
    name: f.byName,
    hint: `[${f.byName}] ${caster.nickname}님이 맞혀 −${amt}점`,
    durationMs: 0,
  })
}

async function pickDecoyTrack(
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

  const list = await prisma.question.findMany({
    where: {
      enabled: true,
      ...(genreName ? { genre: { name: genreName } } : {}),
    },
    include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
  })
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
  const rt = toQuestionRuntime(q)
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
async function refreshTrumanDecoyForRound(room: Room, m: Member): Promise<boolean> {
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

function emitIllusionRound(io: Server, m: Member) {
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
async function pickNamedTrack(
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
async function pickDuelQuestion(room: Room): Promise<QuestionRuntime | null> {
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

function playbackRateFor(m: Member, roundIndex: number, room?: Room | null): number | null {
  for (const b of activeBuffsAt(m, roundIndex, room)) {
    if (b.effectType === 'slow_playback') {
      const r = Number(b.effectValue.rate)
      if (Number.isFinite(r) && r > 0) return r
    }
  }
  return null
}

function slowStarterDelaySec(m: Member, roundIndex: number, room?: Room | null): number | null {
  const b = activeBuffsAt(m, roundIndex, room).find((x) => x.effectType === 'slow_starter')
  if (!b) return null
  const n = Number(b.effectValue.delaySec)
  return Number.isFinite(n) && n > 0 ? n : 7
}

function slowStarterBonus(m: Member, roundIndex: number, room?: Room | null): number {
  const b = activeBuffsAt(m, roundIndex, room).find((x) => x.effectType === 'slow_starter')
  if (!b) return 0
  const n = Number(b.effectValue.bonus)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2
}

/** 보너스 타임: 남이 맞힌 뒤 windowMs 안에 같은 답을 치면 추가 인정 */
function hasFollowAnswer(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'follow_answer')
}

function lateAnswerBuff(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'late_answer') || null
}

/** 차차차: 보유 중 · 선답 직후 windowMs 안 동시 입력이면 중복 정답에서 우선권 */
function chaChaHeld(m: Member | null | undefined) {
  if (!m || m.heldAugmentEffectType !== 'cha_cha_cha' || !m.heldAugmentName) return null
  const value = parseEffectValue(m.heldAugmentEffectValue)
  const chargesRaw = Number(value.charges)
  const charges = Number.isFinite(chargesRaw) && chargesRaw > 0 ? Math.floor(chargesRaw) : 0
  if (charges <= 0) return null
  const windowRaw = Number(value.windowMs)
  const windowMs = Number.isFinite(windowRaw) && windowRaw > 0 ? Math.floor(windowRaw) : 500
  return { name: m.heldAugmentName, charges, windowMs, value }
}

/** 핑/지터 완충 — 의도 창(0.5초)은 effectValue, 여기에 소량만 가산 */
const CHA_CHA_GRACE_MS = 150

/** 차차차 1회 소모. 잔여 0이면 held 해제 */
function consumeChaChaCharge(m: Member): { name: string; chargesLeft: number } | null {
  const held = chaChaHeld(m)
  if (!held) return null
  const chargesLeft = held.charges - 1
  if (chargesLeft > 0) {
    m.heldAugmentEffectValue = JSON.stringify({ ...held.value, charges: chargesLeft, windowMs: held.windowMs })
  } else {
    m.usedAugments.push(held.name)
    clearHeldAugment(m)
  }
  return { name: held.name, chargesLeft }
}

function followAnswerWindowMsForRoom(room: Room): number {
  let ms = 2000
  for (const m of room.members.values()) {
    for (const b of activeBuffsAt(m, room.index, room)) {
      if (b.effectType !== 'follow_answer') continue
      const n = Number(b.effectValue.windowMs)
      if (Number.isFinite(n) && n > 0) ms = Math.max(ms, Math.floor(n))
    }
  }
  return ms
}

function openFollowAnswerWindow(
  room: Room,
  slot: { id: string; label: string; answer: string; acceptNorms: string[]; hidden: boolean },
  byUserId: string,
) {
  if (![...room.members.values()].some((m) => hasFollowAnswer(m, room.index, room))) return
  room.followAnswerWindow[slot.id] = {
    at: Date.now(),
    windowMs: followAnswerWindowMsForRoom(room),
    acceptNorms: slot.acceptNorms,
    answer: slot.answer,
    label: slot.label,
    hidden: slot.hidden,
    byUserId,
  }
  room.followAnswerClaimed[slot.id] = new Set([byUserId])
}

// follow_answer는 "남이 맞힌 뒤 N초 안에"라는 서버 타이머 창이지만,
// 클라이언트 submit 지연(핑/지터) 때문에 경계에서 탈락하는 걸 완화한다.
// 너무 크게 잡으면 공정성이 흔들리니 아주 작은 완충치만 둔다.
const FOLLOW_ANSWER_GRACE_MS = 250

/** 보너스 타임 등: 정답 시 추가 점수 */
function scoreBonusFor(m: Member, roundIndex: number, room?: Room | null): number {
  let extra = 0
  for (const b of activeBuffsAt(m, roundIndex, room)) {
    if (b.effectType !== 'score_bonus' && b.effectType !== 'mud_fight') continue
    const n = Number(b.effectValue.bonus)
    if (Number.isFinite(n) && n > 0) extra += Math.floor(n)
  }
  return extra
}

/** 진조이니라 등: politeSuffix.bonus */
function politeSuffixBonus(m: Member, roundIndex: number, room?: Room | null): number {
  if (!isPoliteSuffixActive(m, roundIndex, room) || !m.politeSuffix) return 0
  const n = Number(m.politeSuffix.bonus)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 무지개 반사: 활성 버프 또는 보유 중(지목 시 자동 사용) 실드 소모 */
function takeReflectShield(m: Member, roundIndex: number): ActiveBuff | null {
  const idx = m.activeBuffs.findIndex(
    (b) => b.effectType === 'reflect_debuff' && buffApplies(b, roundIndex),
  )
  if (idx >= 0) {
    const [buff] = m.activeBuffs.splice(idx, 1)
    return buff
  }
  // 보유만 하고 아직 안 쓴 무지개 → 지목당하면 자동 사용
  if (m.heldAugmentEffectType === 'reflect_debuff' && m.heldAugmentName) {
    const value = parseEffectValue(m.heldAugmentEffectValue)
    const roundsRaw = Number(value.rounds)
    const roundsLeft = Number.isFinite(roundsRaw) && roundsRaw > 0 ? Math.floor(roundsRaw) : 1
    const buff: ActiveBuff = {
      name: m.heldAugmentName,
      description: m.heldAugmentDescription || '',
      effectType: 'reflect_debuff',
      effectValue: value,
      imageUrl: m.heldAugmentImageUrl,
      usedByNickname: m.nickname,
      startIndex: roundIndex,
      roundsLeft,
    }
    m.usedAugments.push(m.heldAugmentName)
    clearHeldAugment(m)
    return buff
  }
  return null
}

function hiddenUnlockedForQuestion(room: Room, q: QuestionRuntime) {
  const openSlots = q.slots.filter((s) => !s.hidden)
  return openSlots.length === 0 || openSlots.every((s) => room.revealed[s.id])
}

function formatSlotAnswers(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .map((s) => `${s.hidden ? (s.label || '히든') : s.label}: ${s.answer}`)
    .join(' / ')
}

/** 제목·가수/커버/캐릭터만 (나이거·미래시 등) */
function formatTitleArtistAnswers(q: QuestionRuntime) {
  const parts: string[] = []
  const title = findTitleSlot(q)
  if (title) parts.push(`${title.label}: ${title.answer}`)
  for (const artist of findArtistSlots(q)) {
    parts.push(`${artist.label}: ${artist.answer}`)
  }
  return parts.join(' · ') || formatSlotAnswers(q)
}

/** 타이핑 공개용: 괄호(한자·원제 등) 안은 빼고 본문만 */
function stripParenHint(answer: string) {
  return String(answer || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 제목/가수 라벨 없이 답만 (타이핑 공개용) · 슬롯 역순(마지막→첫 번째) */
function formatSlotAnswersPlain(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .slice()
    .reverse()
    .map((s) => stripParenHint(s.answer))
    .filter(Boolean)
    .join('\n')
}

/** 슬롯별 스포일 맵 (나이거 / 일론 등) */
function buildSpoilBySlot(
  q: QuestionRuntime,
  mode: 'plain' | 'qwerty',
  includeHidden: boolean,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of q.slots) {
    if (!includeHidden && s.hidden) continue
    const raw = (s.answer || '').trim()
    if (!raw) continue
    out[s.id] = mode === 'qwerty' ? hangulToQwertyMistype(raw) : raw
  }
  return out
}

/** 일론 머스크의 가호: 외계인 영타 표기 */
function formatAlienQwertyAnswers(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .map((s) => `${s.hidden ? (s.label || '히든') : s.label}: ${hangulToQwertyMistype(s.answer)}`)
    .join(' / ')
}

function alienQwertyBuff(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'alien_qwerty_answer') || null
}

function clearHeldAugment(m: Member) {
  m.heldAugmentId = null
  m.heldAugmentName = null
  m.heldAugmentDescription = null
  m.heldAugmentImageUrl = null
  m.heldAugmentEffectType = null
  m.heldAugmentEffectValue = null
  m.heldAugmentTier = null
  m.gahoPickIds = null
}

function setHeldAugment(
  m: Member,
  aug: {
    id: string
    name: string
    description: string
    effectType?: string
    effectValue?: string | null
    imageUrl?: string | null
    tier?: string | null
  } | null | undefined,
) {
  if (!aug) {
    clearHeldAugment(m)
    return
  }
  m.heldAugmentId = aug.id
  m.heldAugmentName = aug.name
  m.heldAugmentDescription = aug.description
  m.heldAugmentImageUrl = aug.imageUrl || null
  m.heldAugmentEffectType = aug.effectType || null
  m.heldAugmentEffectValue = aug.effectValue ?? null
  m.heldAugmentTier = aug.tier || null
}

function emptyMember(
  userId: string,
  nickname: string,
  avatarUrl: string | null,
  socketId: string,
  opts?: { spectator?: boolean },
): Member {
  return {
    userId,
    nickname,
    avatarUrl,
    ready: false,
    score: 0,
    socketId,
    isSpectator: !!opts?.spectator,
    heldAugmentId: null,
    heldAugmentName: null,
    heldAugmentDescription: null,
    heldAugmentImageUrl: null,
    heldAugmentEffectType: null,
    heldAugmentEffectValue: null,
    heldAugmentTier: null,
    usedAugments: [],
    offerSeenAugmentIds: [],
    lastOfferCandidateIds: [],
    gahoPickIds: null,
    activeBuffs: [],
    collectedPieces: [],
    chatMute: null,
    chatMuteUntil: null,
    answerDelay: null,
    politeSuffix: null,
    answerBlock: null,
    answerBlockUntil: null,
    answerBlockUntilBy: null,
    audioDelayUntil: null,
    duelEarlyChosung: false,
    accuseMark: null,
    gabuki: null,
    answerProxy: null,
    sakuraDecoy: null,
    flameKim: null,
    songMuteUntil: null,
    roundScoreGain: 0,
  }
}

/** 선택 화면용 — 이름·사진·설명 포함 */
function toOfferAugment(a: {
  id: string
  name: string
  description?: string
  effectType: string
  tier: string
  imageUrl?: string | null
}) {
  return {
    id: a.id,
    name: a.name,
    description: a.description || '',
    effectType: a.effectType,
    tier: a.tier,
    imageUrl: a.imageUrl || null,
  }
}

/** 가호선택 후보 3장 */
function ensureGahoPickCandidates(m: Member, list: CachedAugment[], count = 3) {
  const used = new Set(m.usedAugments || [])
  const unused = list.filter((a) => a.tier === '가호' && !used.has(a.name))
  const pool = unused.length ? unused : list.filter((a) => a.tier === '가호')
  if (!m.gahoPickIds || m.gahoPickIds.length === 0) {
    const picked: string[] = []
    const seenNames = new Set<string>()
    for (const a of shuffleArray(pool)) {
      if (seenNames.has(a.name)) continue
      seenNames.add(a.name)
      picked.push(a.id)
      if (picked.length >= count) break
    }
    m.gahoPickIds = picked
  }
  const byId = new Map(list.map((a) => [a.id, a]))
  const out = (m.gahoPickIds || [])
    .map((id) => byId.get(id))
    .filter((a): a is CachedAugment => !!a && a.tier === '가호')
  // 삭제·비활성 등으로 비면 다시 뽑음
  if (out.length === 0 && pool.length) {
    m.gahoPickIds = null
    return ensureGahoPickCandidates(m, list, count)
  }
  return out.map(toOfferAugment)
}

// 테스트용 강제 오퍼 제거됨 — 일반 랜덤 티어 오퍼만 사용

type OfferTier = 'bronze' | 'silver' | 'gold'

/** CSPRNG Fisher–Yates */
function shuffleArray<T>(arr: T[] | Iterable<T> | null | undefined): T[] {
  const a = [...(arr ?? [])]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

function pickRandomIndex(length: number) {
  if (length <= 0) return 0
  return randomInt(length)
}

function shouldOfferAugment(room: Room) {
  // 시작(index 0) 제외 · 20곡마다 (20, 40, …)
  return (
    room.augmentsEnabled !== false
    && room.index > 0
    && room.index % 20 === 0
    && room.lastAugmentAt !== room.index
  )
}

/** 브론즈·실버·골드 등급 추첨 확률 1:1:1 */
function pickRandomOfferTier(
  list: Array<{ tier: string }>,
): OfferTier {
  const order: OfferTier[] = shuffleArray(['bronze', 'silver', 'gold'] as OfferTier[])
  for (const t of order) {
    if (list.some((a) => a.tier === t)) return t
  }
  return 'bronze'
}

/** 엄→준→식처럼 requires / 이미 획득한 조각 필터 */
function isCollectPieceOfferable(
  a: { effectType: string; effectValue: string | null; name: string },
  collectedPieces: string[],
) {
  if (a.effectType !== 'collect_piece') return true
  const v = parseEffectValue(a.effectValue)
  const piece = String(v.piece || a.name)
  if (collectedPieces.includes(piece)) return false
  const requires = Array.isArray(v.requires) ? v.requires.map(String) : []
  return requires.every((r) => collectedPieces.includes(r))
}

type OfferPickOpts = {
  /** 이번 페이즈에서 이미 뜬 카드 (리롤 제외) */
  excludeIds?: Iterable<string>
  /** 이미 사용한 증강 이름 (이번 판 재등장 금지) */
  excludeNames?: Iterable<string>
}

function filterOfferPool<T extends {
  id: string
  name: string
  effectType: string
  effectValue: string | null
  tier: string
  imageUrl: string | null
}>(
  list: T[],
  collectedPieces: string[],
  lockedTier?: OfferTier | null,
  opts?: OfferPickOpts,
): T[] {
  const excludeIds = new Set(opts?.excludeIds || [])
  const excludeNames = new Set(opts?.excludeNames || [])
  const base = list.filter(
    (a) => a.tier !== '가호' && isCollectPieceOfferable(a, collectedPieces),
  )
  let tierPool = lockedTier ? base.filter((a) => a.tier === lockedTier) : base
  if (tierPool.length === 0) tierPool = base

  // 1) 사용·이미본 둘 다 제외
  let pool = tierPool.filter((a) => !excludeIds.has(a.id) && !excludeNames.has(a.name))
  // 2) 모자라면 리롤 제외만 풀고, 사용 증강은 유지
  if (pool.length === 0) {
    pool = tierPool.filter((a) => !excludeNames.has(a.name))
  }
  // 3) 그래도 없으면(전부 사용) 티어 풀 전체
  if (pool.length === 0) pool = tierPool
  return pool
}

/**
 * 후보 3장: 해당 티어 풀에서 균등 랜덤 (이름/id 중복만 방지).
 * 계열(family) 필터 없음 — 카드마다 동일 확률.
 */
function pickOfferCandidates(
  list: Array<{
    id: string
    name: string
    effectType: string
    effectValue: string | null
    tier: string
    imageUrl: string | null
  }>,
  collectedPieces: string[],
  count = 3,
  lockedTier?: OfferTier | null,
  opts?: OfferPickOpts,
) {
  const pool = shuffleArray(filterOfferPool(list, collectedPieces, lockedTier, opts))
  const picked: typeof pool = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const a of pool) {
    if (picked.length >= count) break
    if (seenIds.has(a.id) || seenNames.has(a.name)) continue
    seenIds.add(a.id)
    seenNames.add(a.name)
    picked.push(a)
  }
  return shuffleArray(picked).map(toOfferAugment)
}

function pickRandomFromOfferPool<T extends {
  id: string
  name: string
  effectType: string
  effectValue: string | null
  imageUrl: string | null
  tier: string
}>(
  list: T[],
  collectedPieces: string[],
  lockedTier?: OfferTier | null,
  opts?: OfferPickOpts,
): T | undefined {
  const pool = filterOfferPool(list, collectedPieces, lockedTier, opts)
  if (pool.length) return pool[pickRandomIndex(pool.length)]
  const nonGaho = list.filter((a) => a.tier !== '가호')
  if (nonGaho.length) return nonGaho[pickRandomIndex(nonGaho.length)]
  if (!list.length) return undefined
  return list[pickRandomIndex(list.length)]
}

/** 오퍼에 띄운 후보 id를 이번 페이즈 시야·현재 화면에 기록 */
function rememberOfferSeen(m: Member, candidates: Array<{ id: string }>) {
  const set = new Set(m.offerSeenAugmentIds)
  for (const c of candidates) set.add(c.id)
  m.offerSeenAugmentIds = [...set]
  m.lastOfferCandidateIds = candidates.map((c) => c.id)
}

/** 전환: 상위 등급 중 랜덤 1장 */
function pickTierUpgradeTarget(
  list: CachedAugment[],
  aug: { effectType: string; effectValue: string | null; tier: string },
  excludeNames?: Iterable<string>,
): CachedAugment | null {
  const value = parseEffectValue(aug.effectValue)
  const rawTiers = Array.isArray(value.higherTiers) ? value.higherTiers.map(String) : []
  const higherTiers = rawTiers.length
    ? rawTiers
    : (aug.tier === 'bronze' ? ['silver'] : ['gold'])
  const used = new Set(excludeNames || [])
  const pool = list.filter(
    (a) =>
      higherTiers.includes(a.tier)
      && a.effectType !== 'tier_upgrade'
      && a.effectType !== 'chaos_cast'
      && a.effectType !== 'gaho_select'
      && a.tier !== '가호'
      && !used.has(a.name),
  )
  const fallback = list.filter(
    (a) =>
      higherTiers.includes(a.tier)
      && a.effectType !== 'tier_upgrade'
      && a.effectType !== 'chaos_cast'
      && a.effectType !== 'gaho_select'
      && a.tier !== '가호',
  )
  const finalPool = pool.length ? pool : fallback
  if (!finalPool.length) return null
  return finalPool[pickRandomIndex(finalPool.length)]
}

/** 증강 선택 확정 시 전환·가호선택은 즉시 실제 카드로 치환해 보관 */
function assignHeldFromOfferPick(
  m: Member,
  list: CachedAugment[],
  aug: CachedAugment,
  gahoAugmentId?: string,
) {
  if (aug.effectType === 'tier_upgrade') {
    const pick = pickTierUpgradeTarget(list, aug, m.usedAugments)
    setHeldAugment(m, pick || aug)
    return
  }
  if (aug.effectType === 'gaho_select') {
    const used = new Set(m.usedAugments)
    const gahos = list.filter((a) => a.tier === '가호' && !used.has(a.name))
    const allGahos = list.filter((a) => a.tier === '가호')
    const pool = gahos.length ? gahos : allGahos
    const locked = (m.gahoPickIds || [])
      .map((id) => list.find((a) => a.id === id && a.tier === '가호'))
      .filter((a): a is CachedAugment => !!a)
    const pickPool = locked.length ? locked : pool
    const pick = gahoAugmentId
      ? pickPool.find((a) => a.id === gahoAugmentId)
        || (locked.length ? undefined : allGahos.find((a) => a.id === gahoAugmentId))
      : pickPool[pickRandomIndex(pickPool.length)]
    setHeldAugment(m, pick || aug)
    m.gahoPickIds = null
    return
  }
  setHeldAugment(m, aug)
}

const rooms = new Map<string, Room>()
/** userId → roomId 빠른 조회 */
const userRoomId = new Map<string, string>()

type CachedAugment = {
  id: string
  name: string
  description: string
  effectType: string
  effectValue: string | null
  imageUrl: string | null
  tier: string
}

let augmentCache: { at: number; list: CachedAugment[] } | null = null
const AUGMENT_CACHE_MS = 60_000

async function getEnabledAugments(): Promise<CachedAugment[]> {
  if (augmentCache && Date.now() - augmentCache.at < AUGMENT_CACHE_MS) {
    return augmentCache.list
  }
  const list = await prisma.augment.findMany({ where: { enabled: true } })
  augmentCache = { at: Date.now(), list }
  return list
}

function attachMember(room: Room, m: Member) {
  room.members.set(m.userId, m)
  userRoomId.set(m.userId, room.id)
}

function detachMember(room: Room, userId: string) {
  room.members.delete(userId)
  userRoomId.delete(userId)
}

function publicRooms() {
  return [...rooms.values()]
    .filter((r) => !r.isPrivate && r.status === 'lobby')
    .map((r) => ({
      id: r.id,
      name: r.name,
      players: r.members.size,
      max: r.maxPlayers,
      priv: r.isPrivate,
      genre: Object.keys(r.genreCounts)[0] || '전체',
      gameMode: r.gameMode || 'nomatch',
    }))
}

function roomState(room: Room, viewerUserId?: string) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    status: room.status,
    maxPlayers: room.maxPlayers,
    genreCounts: room.genreCounts,
    genreBankCounts: room.genreBankCounts || {},
    answerMode: room.answerMode || 'title_artist',
    augmentsEnabled: room.augmentsEnabled !== false,
    recentSongPenalty: clampRecentSongPenalty(room.recentSongPenalty),
    ...readingRoomPatch(room, viewerUserId),
    upcomingGenreCounts: (() => {
      const counts: Record<string, number> = {}
      for (const q of room.queue.slice(room.index + 1)) {
        counts[q.genre] = (counts[q.genre] || 0) + 1
      }
      return counts
    })(),
    members: [...room.members.values()].map((m) => {
      const block = answerBlockPublic(m, room.index, room)
      const spoilQ = room.queue[room.index]
      // 트루먼에게 진짜 곡 정답 힌트를 보내 환상이 깨지는 중첩을 방지한다.
      const truman = isTrumanIllusion(m, room.index)
      const spoilActive = !!(spoilQ && room.status !== 'duel' && !truman && knowButCantBuff(m, room.index, room))
      const alienActive = !!(spoilQ && room.status !== 'duel' && !truman && !spoilActive && alienQwertyBuff(m, room.index, room))
      // 일론=전 슬롯·히든 영타 / 나이거=제목·가수·커버·캐릭터 평문
      const spoilBySlot = alienActive
        ? buildSpoilBySlot(spoilQ!, 'qwerty', true)
        : spoilActive
          ? (() => {
              const out: Record<string, string> = {}
              const title = findTitleSlot(spoilQ!)
              if (title?.answer) out[title.id] = title.answer
              for (const s of findArtistSlots(spoilQ!)) {
                if (s.answer) out[s.id] = s.answer
              }
              return out
            })()
          : null
      return {
      userId: m.userId,
      nickname: m.nickname,
      avatarUrl: m.avatarUrl,
      ready: m.ready,
      score: m.isSpectator ? 0 : displayScoreOf(m, room.index),
      scoreReal: m.isSpectator ? 0 : m.score,
      isHost: m.userId === room.hostId,
      isSpectator: !!m.isSpectator,
      augmentBusy: !m.isSpectator && hasIncomingAugmentEffect(m, room),
      heldAugmentId: m.isSpectator ? null : m.heldAugmentId,
      heldAugmentName: m.isSpectator ? null : m.heldAugmentName,
      heldAugmentDescription: m.heldAugmentDescription,
      heldAugmentImageUrl: m.heldAugmentImageUrl,
      heldAugmentEffectType: m.heldAugmentEffectType,
      heldAugmentTier: m.heldAugmentTier,
      usedAugments: m.usedAugments,
      chatMuted: isChatMuted(m, room.index, room),
      chatMutePending: !!(m.chatMute && room.index < m.chatMute.startIndex)
        || m.activeBuffs.some((b) => b.effectType === 'soft_chat_mute' && room.index < b.startIndex),
      chatMuteBy: (m.chatMuteUntil && m.chatMuteUntil > Date.now())
        ? (m.activeBuffs.find((b) => b.effectType === 'soft_chat_mute' && buffApplies(b, room.index))?.name
          || m.chatMute?.byName || null)
        : (m.chatMute?.byName || null),
      chatMuteByNickname: m.chatMute?.byNickname || null,
      chatMuteStartIndex: m.chatMute?.startIndex ?? null,
      chatMuteUntil: (m.chatMuteUntil && m.chatMuteUntil > Date.now()) ? m.chatMuteUntil : null,
      chatIsolated: isChatIsolateActive(room),
      chatIsolatePending: isChatIsolatePending(room),
      chatIsolateGroup: room.chatIsolate?.groupByUserId[m.userId] ?? null,
      chatIsolateBy: room.chatIsolate?.byName || null,
      chatIsolateRoundsLeft: room.chatIsolate
        ? (isChatIsolateActive(room) || isChatIsolatePending(room) ? room.chatIsolate.roundsLeft : null)
        : null,
      earlyChosungActive: hasEarlyChosung(m, room.index, room),
      hiddenPreview: hasHiddenRun(m, room.index, room),
      answerDelayed: answerDelayRemainingMs(room, m) > 0,
      answerDelaySec: isAnswerDelayActive(m, room.index, room) ? m.answerDelay!.delaySec : null,
      answerDelayUnlockAt: isAnswerDelayActive(m, room.index, room)
        ? room.roundStartedAt + m.answerDelay!.delaySec * 1000
        : null,
      answerDelayPending: !!(m.answerDelay && room.index < m.answerDelay.startIndex),
      answerDelayRoundsLeft: m.answerDelay?.roundsLeft ?? null,
      answerDelayBy: m.answerDelay?.byName || null,
      politeActive: isPoliteSuffixActive(m, room.index, room),
      politePending: !!(m.politeSuffix && room.index < m.politeSuffix.startIndex),
      politeSuffix: isPoliteSuffixActive(m, room.index, room) ? m.politeSuffix!.suffix : null,
      politeRoundsLeft: m.politeSuffix?.roundsLeft ?? null,
      politeBy: m.politeSuffix?.byName || null,
      politeBonus: isPoliteSuffixActive(m, room.index, room) ? (m.politeSuffix!.bonus || null) : null,
      answerBlocked: block.answerBlocked,
      answerBlockPending: block.answerBlockPending,
      answerBlockRoundsLeft: block.answerBlockRoundsLeft,
      answerBlockBy: block.answerBlockBy,
      answerBlockUntil: (m.answerBlockUntil && m.answerBlockUntil > Date.now()) ? m.answerBlockUntil : null,
      knowSpoilTitle: spoilActive
        ? (findTitleSlot(spoilQ)?.answer || null)
        : alienActive
          ? hangulToQwertyMistype(findTitleSlot(spoilQ!)?.answer || '')
          : null,
      knowSpoilArtist: spoilActive
        ? (findArtistSlots(spoilQ!).map((s) => s.answer).join(', ') || null)
        : alienActive
          ? hangulToQwertyMistype(findArtistSlots(spoilQ!).map((s) => s.answer).join(', '))
          : null,
      /** 슬롯 id → 스포일 텍스트 (일론=전 슬롯·히든 영타 / 나이거=비전 슬롯 평문) */
      knowSpoilSlots: spoilBySlot,
      alienQwertyActive: alienActive,
      accuseWatchPending: !!(m.accuseMark && room.index < m.accuseMark.watchIndex),
      accuseWatchActive: !!(m.accuseMark && room.index === m.accuseMark.watchIndex),
      accuseWatchBy: m.accuseMark?.byName || null,
      gabukiActive: isGabukiActive(m, room.index, room),
      gabukiPending: !!(m.gabuki && room.index < m.gabuki.startIndex),
      gabukiRoundsLeft: m.gabuki?.roundsLeft ?? null,
      gabukiBy: m.gabuki?.byName || null,
      playbackRate: room.status === 'duel' ? 1 : playbackRateFor(m, room.index, room),
      audioStutter: (() => {
        if (room.status === 'duel') return null
        const b = activeBuffsAt(m, room.index, room).find((x) => x.effectType === 'audio_stutter')
        if (!b) return null
        const onRaw = Number(b.effectValue.onMs)
        const offRaw = Number(b.effectValue.offMs)
        return {
          onMs: Number.isFinite(onRaw) && onRaw > 0 ? Math.floor(onRaw) : 1000,
          offMs: Number.isFinite(offRaw) && offRaw > 0 ? Math.floor(offRaw) : 1000,
          byName: b.name,
        }
      })(),
      hintsHidden: room.status === 'duel'
        ? false
        : activeBuffsAt(m, room.index, room).some(
          (b) => b.effectType === 'hide_hints' || b.effectType === 'score_mult_no_hint',
        ),
      hintsHiddenBy: (() => {
        if (room.status === 'duel') return null
        const b = activeBuffsAt(m, room.index, room).find((x) => x.effectType === 'hide_hints')
        return b?.name || null
      })(),
      audioDelaySec: (() => {
        if (m.audioDelayUntil && m.audioDelayUntil > Date.now()) {
          return Math.max(0, Math.ceil((m.audioDelayUntil - Date.now()) / 1000))
        }
        if (room.status === 'duel') return null
        return slowStarterDelaySec(m, room.index, room)
      })(),
      audioDelayUntil: (() => {
        if (m.audioDelayUntil && m.audioDelayUntil > Date.now()) return m.audioDelayUntil
        if (room.status === 'duel') return null
        const d = slowStarterDelaySec(m, room.index, room)
        return d != null ? room.roundStartedAt + d * 1000 : null
      })(),
      songMuteUntil: (m.songMuteUntil && m.songMuteUntil > Date.now()) ? m.songMuteUntil : null,
      /** 방 노래와 분리된 트릭 오디오 · mode=replace면 방 곡 음소거, overlay면 동시 재생 */
      audioTrick: resolveAudioTrick(m, room),
      decoyYoutubeUrl: (() => {
        if (room.status === 'duel') return null
        if (isSakuraDecoyActive(m, room.index, room)) return m.sakuraDecoy!.youtubeUrl
        if (isFlameKimActive(m, room.index, room)) return m.flameKim!.youtubeUrl
        return null
      })(),
      decoyStartSec: (() => {
        if (room.status === 'duel') return null
        if (isSakuraDecoyActive(m, room.index, room)) return m.sakuraDecoy!.startSec
        if (isFlameKimActive(m, room.index, room)) return m.flameKim!.startSec
        return null
      })(),
      // 트루먼쇼는 UI·버프 패널에 안 보이게 (audioTrick만으로 재생)
      sakuraActive: room.status === 'duel'
        ? false
        : (isSakuraDecoyActive(m, room.index, room) && m.sakuraDecoy!.mode !== 'truman'),
      sakuraScoreMult: room.status === 'duel'
        ? null
        : (isSakuraDecoyActive(m, room.index, room) && m.sakuraDecoy!.mode !== 'truman'
          ? m.sakuraDecoy!.scoreMult
          : null),
      sakuraBy: room.status === 'duel'
        ? null
        : (isSakuraDecoyActive(m, room.index, room) && m.sakuraDecoy!.mode !== 'truman'
          ? m.sakuraDecoy!.byName
          : null),
      sakuraTruman: false,
      trumanIllusion: false,
      trumanFakeScore: 0,
      flameKimActive: room.status === 'duel' ? false : isFlameKimActive(m, room.index, room),
      flameKimPending: !!(m.flameKim && room.index < m.flameKim.startIndex),
      flameKimRoundsLeft: m.flameKim?.roundsLeft ?? null,
      flameKimTarget: m.flameKim?.targetNickname || null,
      flameKimBy: m.flameKim?.byName || null,
      answerProxyActive: (isAnswerProxyActive(m, room.index)
        || !!(m.answerProxy && room.index < m.answerProxy.startIndex)),
      answerProxyPending: !!(m.answerProxy && room.index < m.answerProxy.startIndex),
      answerProxyPendingScore: m.answerProxy?.pendingScore ?? 0,
      answerProxyRoundsLeft: m.answerProxy?.roundsLeft ?? null,
      activeBuffs: m.activeBuffs.map((b) => {
        const multRaw = Number(b.effectValue.mult)
        const rateRaw = Number(b.effectValue.rate)
        const bgmUrl = String(b.effectValue.bgmUrl || '').trim() || null
        const bgmStartRaw = Number(b.effectValue.bgmStartSec)
        const applies = buffApplies(b, room.index)
        return {
          name: b.name,
          description: b.description,
          effectType: b.effectType,
          imageUrl: b.imageUrl || null,
          usedByNickname: b.usedByNickname,
          mult: Number.isFinite(multRaw) && multRaw > 1 ? multRaw : null,
          rate: Number.isFinite(rateRaw) && rateRaw > 0 && rateRaw !== 1 ? rateRaw : null,
          bgmUrl: applies ? bgmUrl : null,
          bgmStartSec: applies && Number.isFinite(bgmStartRaw) && bgmStartRaw >= 0
            ? Math.floor(bgmStartRaw)
            : null,
          startIndex: b.startIndex,
          roundsLeft: b.roundsLeft,
          pending: room.index < b.startIndex,
          active: applies,
          frozen: false,
        }
      }),
    }
    }),
    augmentPaused: false,
    duel: room.duel
      ? {
          challengerId: room.duel.challengerId,
          opponentId: room.duel.opponentId,
          challengerNickname: room.members.get(room.duel.challengerId)?.nickname || '?',
          opponentNickname: room.members.get(room.duel.opponentId)?.nickname || '?',
          penalty: room.duel.penalty,
          byName: room.duel.byName,
        }
      : null,
    pendingDuel: room.pendingDuel
      ? {
          challengerId: room.pendingDuel.challengerId,
          opponentId: room.pendingDuel.opponentId,
          challengerNickname: room.members.get(room.pendingDuel.challengerId)?.nickname || '?',
          opponentNickname: room.members.get(room.pendingDuel.opponentId)?.nickname || '?',
          penalty: room.pendingDuel.penalty,
          byName: room.pendingDuel.byName,
        }
      : null,
  }
}

async function loadGenreBankCounts(): Promise<Record<string, number>> {
  const genres = await prisma.genre.findMany()
  const grouped = await prisma.question.groupBy({
    by: ['genreId'],
    where: { enabled: true },
    _count: { _all: true },
  })
  const byId = new Map(grouped.map((g) => [g.genreId, g._count._all]))
  const out: Record<string, number> = {}
  // 대기실 슬라이더: 플레이어블만 (기타·클래식 제외)
  for (const name of PLAYABLE_GENRES) out[name] = 0
  for (const g of genres) {
    if (!isPlayableGenre(g.name)) continue
    out[g.name] = byId.get(g.id) || 0
  }
  return out
}

async function clampGenreCounts(counts: Record<string, number>): Promise<Record<string, number>> {
  const bank = await loadGenreBankCounts()
  const out: Record<string, number> = {}
  for (const name of PLAYABLE_GENRES) {
    const max = bank[name] ?? 0
    const v = Math.max(0, Math.min(max, Math.floor(Number(counts?.[name]) || 0)))
    out[name] = v
  }
  return out
}

/** 약 3판(장르당~40곡) 분량까지 최근곡 기억 */
const RECENT_SONG_HISTORY_MAX = 120
/** 기본 ON: 최근곡 완전 제외 (은행 부족 시에만 재사용) */
const DEFAULT_RECENT_SONG_PENALTY = 1

function clampRecentSongPenalty(n: unknown) {
  const v = Number(n)
  if (!Number.isFinite(v)) return DEFAULT_RECENT_SONG_PENALTY
  return Math.max(0, Math.min(1, Math.round(v * 100) / 100))
}

function rememberQueueQuestions(room: Room, questions: QuestionRuntime[]) {
  if (!questions.length) return
  const next = [...(room.recentQuestionIds || [])]
  for (const q of questions) {
    const i = next.indexOf(q.id)
    if (i >= 0) next.splice(i, 1)
    next.push(q.id)
  }
  room.recentQuestionIds = next.slice(-RECENT_SONG_HISTORY_MAX)
}

/** 균등 비복원 추출 */
function pickUniqueQuestions<T extends { id: string; youtubeUrl: string }>(
  list: T[],
  count: number,
  usedIds: Set<string>,
  usedYt: Set<string>,
): T[] {
  const pool = shuffleArray(
    list.filter((q) => {
      if (usedIds.has(q.id)) return false
      const yt = extractYoutubeId(q.youtubeUrl)
      if (yt && usedYt.has(yt)) return false
      return true
    }),
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

async function pickQuestions(
  genreCounts: Record<string, number>,
  opts?: { recentIds?: string[]; recentPenalty?: number },
): Promise<QuestionRuntime[]> {
  const out: QuestionRuntime[] = []
  const usedIds = new Set<string>()
  const usedYt = new Set<string>()
  const recentSet = new Set(opts?.recentIds || [])
  const penalty = clampRecentSongPenalty(opts?.recentPenalty ?? 0)
  /** penalty>0이면 최근곡 먼저 완전 제외 · 은행 부족할 때만 최근곡 보충 */
  const excludeRecent = penalty > 0

  const entries = Object.entries(genreCounts).filter(
    ([genreName, count]) => count > 0 && isPlayableGenre(genreName),
  )
  const genreRows = await Promise.all(
    entries.map(async ([genreName, count]) => {
      const genre = await prisma.genre.findUnique({ where: { name: genreName } })
      if (!genre) return null
      const list = await prisma.question.findMany({
        where: { genreId: genre.id, enabled: true },
        include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
      })
      return { genreName, count, list }
    }),
  )

  for (const row of genreRows) {
    if (!row) continue
    const fresh = excludeRecent ? row.list.filter((q) => !recentSet.has(q.id)) : row.list
    let picked = pickUniqueQuestions(fresh, row.count, usedIds, usedYt)
    if (picked.length < row.count && excludeRecent) {
      const need = row.count - picked.length
      const reuse = row.list.filter((q) => recentSet.has(q.id))
      picked = [...picked, ...pickUniqueQuestions(reuse, need, usedIds, usedYt)]
    }
    for (const q of picked) out.push(toQuestionRuntime(q))
  }
  return shuffleArray(out)
}

type DbQuestionWithSlots = {
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

function toQuestionRuntime(q: DbQuestionWithSlots): QuestionRuntime {
  const titleSlot = q.slots.find((s) => !s.hidden && isTitleLikeLabel(s.label))
    || q.slots.find((s) => !s.hidden && !isArtistLikeLabel(s.label))
    || q.slots.find((s) => !s.hidden)
  const artistSlots = q.slots.filter((s) => !s.hidden && isArtistLikeLabel(s.label))
  const title = titleSlot?.answer || ''
  const titleAccepts = titleSlot ? (JSON.parse(titleSlot.acceptAnswers || '[]') as string[]) : []
  const artistChosungParts = artistSlots.map((s) => {
    const accepts = JSON.parse(s.acceptAnswers || '[]') as string[]
    return hintChosung(s.answer, expandArtistAccepts(s.answer, accepts))
  }).filter(Boolean)

  return {
    id: q.id,
    youtubeUrl: q.youtubeUrl,
    startSec: q.startSec,
    endSec: q.endSec,
    genre: q.genre.name,
    tags: parseTagsJson(q.tags),
    titleChosung: title ? hintChosung(title, titleAccepts) : '',
    artistChosung: artistChosungParts.join(' / '),
    slots: q.slots.map((s) => {
      const accepts = JSON.parse(s.acceptAnswers || '[]') as string[]
      const isArtist = isArtistLikeLabel(s.label)
      const expanded = isArtist ? expandArtistAccepts(s.answer, accepts) : accepts
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

/** 남은 곡(현재 포함)에서 최소·최대 장르 잔량을 서로 바꿈. 현재 재생 곡은 유지. */
async function swapExtremeGenreRemaining(room: Room): Promise<{ ok: boolean; hint: string }> {
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

  const genreRow = await prisma.genre.findUnique({ where: { name: minGenre } })
  if (!genreRow) return { ok: false, hint: `${minGenre} 장르를 찾을 수 없습니다` }

  const pool = await prisma.question.findMany({
    where: { genreId: genreRow.id, enabled: true },
    include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
  })
  const extras: QuestionRuntime[] = []
  for (const q of shuffleArray(pool)) {
    if (extras.length >= delta) break
    if (usedIds.has(q.id)) continue
    const yt = extractYoutubeId(q.youtubeUrl)
    if (yt && usedYt.has(yt)) continue
    usedIds.add(q.id)
    if (yt) usedYt.add(yt)
    extras.push(toQuestionRuntime(q))
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
async function equalizeGenreRemaining(room: Room): Promise<{ ok: boolean; hint: string }> {
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
      const genreRow = await prisma.genre.findUnique({ where: { name: g } })
      if (!genreRow) continue
      const bank = await prisma.question.findMany({
        where: { genreId: genreRow.id, enabled: true },
        include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
      })
      let added = 0
      for (const q of shuffleArray(bank)) {
        if (added >= need) break
        if (usedIds.has(q.id)) continue
        const yt = extractYoutubeId(q.youtubeUrl)
        if (yt && usedYt.has(yt)) continue
        usedIds.add(q.id)
        if (yt) usedYt.add(yt)
        nextUpcoming.push(toQuestionRuntime(q))
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

/** 특정 장르 밴: 앞으로 나올 해당 장르 곡을 제거하고, 그 수만큼 다른 장르에 랜덤 배분(은행 보충) */
async function banGenreAndRedistribute(
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

  const allot = new Map<string, number>()
  for (const g of receivers) allot.set(g, 0)
  for (let i = 0; i < n; i++) {
    const g = receivers[Math.floor(Math.random() * receivers.length)]
    allot.set(g, (allot.get(g) || 0) + 1)
  }

  const usedIds = new Set(room.queue.map((q) => q.id))
  const usedYt = new Set(
    room.queue.map((q) => extractYoutubeId(q.youtubeUrl)).filter((x): x is string => !!x),
  )
  // 밴으로 빠지는 곡은 재사용 가능하도록 used에서 제외하지 않음(이미 큐에 있었음)

  const extras: QuestionRuntime[] = []
  const distParts: string[] = []
  for (const [g, need] of allot.entries()) {
    if (need <= 0) continue
    const genreRow = await prisma.genre.findUnique({ where: { name: g } })
    if (!genreRow) continue
    const bank = await prisma.question.findMany({
      where: { genreId: genreRow.id, enabled: true },
      include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
    })
    let added = 0
    for (const q of shuffleArray(bank)) {
      if (added >= need) break
      if (usedIds.has(q.id)) continue
      const yt = extractYoutubeId(q.youtubeUrl)
      if (yt && usedYt.has(yt)) continue
      usedIds.add(q.id)
      if (yt) usedYt.add(yt)
      extras.push(toQuestionRuntime(q))
      added += 1
    }
    if (added > 0) distParts.push(`${g} +${added}`)
  }

  if (extras.length === 0) {
    return { ok: false, hint: '다른 장르 곡을 은행에서 가져올 수 없습니다' }
  }

  room.queue = [
    ...room.queue.slice(0, from),
    current,
    ...shuffleArray([...keep, ...extras]),
  ]

  const short = extras.length < n ? ` (은행 부족으로 ${extras.length}/${n}곡만 보충)` : ''
  return {
    ok: true,
    hint: `「${genre}」 ${n}곡 밴 → ${distParts.join(' · ') || '배분'}${short}`,
  }
}

/**
 * 밴픽 실패: 밴하려던 장르 제외 잔량 합의 ratio(기본 20%)만큼
 * 해당 장르에 추가하고, 나머지 장르에서 비율대로 제거. (지금 곡 유지)
 */
async function boostAttemptedGenreFromOthers(
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
  const genreRow = await prisma.genre.findUnique({ where: { name: genre } })
  if (genreRow) {
    const bank = await prisma.question.findMany({
      where: { genreId: genreRow.id, enabled: true },
      include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
    })
    for (const q of shuffleArray(bank)) {
      if (extras.length >= removed) break
      if (usedIds.has(q.id)) continue
      const yt = extractYoutubeId(q.youtubeUrl)
      if (yt && usedYt.has(yt)) continue
      usedIds.add(q.id)
      if (yt) usedYt.add(yt)
      extras.push(toQuestionRuntime(q))
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

const TARGET_AUGMENT_TYPES = new Set([
  'mute_chat',
  'soft_chat_mute',
  'slow_playback',
  'answer_proxy',
  'named_decoy',
  'sakura_decoy',
  'answer_delay',
  'yacha_duel',
  'polite_suffix',
  'answer_block',
  'rock_throw',
  'steal_chain',
  'score_steal',
  'accuse_sleep',
  'gabuki_mark',
  'steal_held_augment',
  'flame_kim',
  'hide_hints',
  'audio_stutter',
  'score_share',
])

const GENRE_AUGMENT_TYPES = new Set(['ban_genre'])

const AUTO_APPLY_AUGMENT_TYPES = new Set(['water_ghost', 'combo_clear_double'])
/** 수동 사용 불가 · 지목당하면 자동 발동 */
const PASSIVE_HELD_AUGMENT_TYPES = new Set(['reflect_debuff'])
/** 수동 사용 불가 · 조건 충족 시 자동 소모 (차차차 등) */
const AUTO_TRIGGER_HELD_AUGMENT_TYPES = new Set(['cha_cha_cha'])
/** 사용 시 예약되고 다음 라운드부터 실제 효과가 시작되는 공개형 증강 */
const NEXT_ROUND_PUBLIC_AUGMENT_TYPES = new Set([
  'mute_chat',
  'soft_chat_mute',
  'polite_suffix',
  'answer_block',
  'gabuki_mark',
  'flame_kim',
  'answer_delay',
  'yacha_duel',
  'slow_playback',
  'named_decoy',
  'answer_proxy',
  'mud_fight',
  'slow_starter',
  'party_music_others',
  'chat_isolate',
  'hide_hints',
  'audio_stutter',
  'score_share',
  'answer_block_others',
])

type AugmentLike = {
  name: string
  description: string
  effectType: string
  effectValue: string | null
  imageUrl?: string | null
  tier?: string
}

type ApplyAugmentResult = {
  ok: boolean
  hint: string | null
  chatText: string | null
  /** true면 방 전체 사용 연출·시스템 채팅 생략 (트루먼쇼 등) */
  silent?: boolean
  /** true면 held 소모·usedAugments 기록 생략 (넘어가요 잔여 충전 등) */
  keepHeld?: boolean
  /** 지정 시 이 유저를 제외한 멤버에게만 사용 연출·채팅 전송 */
  excludeNotifyUserId?: string
}

function formatActivatedAugmentMessage(message: string) {
  const activated = message
    .replace(/다음\s+(\d+)\s*R/g, '지금부터 $1R')
    .replace(/다음\s+라운드에/g, '이번 라운드에')
    .replace(/다음\s+라운드부터/g, '이번 라운드부터')
    .replace(/다음\s+라운드/g, '이번 라운드')
  return `발동! ${activated}`
}

function flushPendingAugmentNotices(io: Server, room: Room) {
  const due = room.pendingAugmentNotices.filter((notice) => notice.startIndex <= room.index)
  if (!due.length) return
  room.pendingAugmentNotices = room.pendingAugmentNotices.filter((notice) => notice.startIndex > room.index)
  for (const notice of due) {
    // 야차룰은 startDuelRound 전용 문구가 본체 — 여기서 중복 발동 알림 내지 않음
    if (notice.effectType === 'yacha_duel') continue
    const message = formatActivatedAugmentMessage(notice.message)
    io.to(room.id).emit('augment:used', {
      userId: notice.userId,
      nickname: notice.nickname,
      name: notice.name,
      description: notice.description,
      imageUrl: notice.imageUrl,
      tier: notice.tier,
      message,
    })
    io.to(room.id).emit('chat:message', {
      id: Date.now() + Math.floor(Math.random() * 1000),
      userId: '',
      nickname: '시스템',
      text: message,
      system: true,
      at: Date.now(),
      augmentCard: {
        name: notice.name,
        description: notice.description,
        imageUrl: notice.imageUrl,
        tier: notice.tier,
      },
    })
  }
}

/** held 소모·usedAugments 기록은 호출측에서. 효과만 적용 */
async function applyAugmentEffect(
  io: Server,
  room: Room,
  m: Member,
  user: { id: string; nickname: string },
  aug: AugmentLike,
  targetUserId?: string,
  genreName?: string,
  targetUserIds?: string[],
): Promise<ApplyAugmentResult> {
  const value = parseEffectValue(aug.effectValue)
  const rounds = Number(value.rounds) || 0
  const defaultChat = `${user.nickname}님이 증강 [${aug.name}]을(를) 사용했습니다`

  if (m.isSpectator) {
    return { ok: false, hint: '관전자는 증강을 사용할 수 없습니다', chatText: null }
  }

  if (TARGET_AUGMENT_TYPES.has(aug.effectType)) {
    if (aug.effectType === 'sakura_decoy' && targetUserIds?.length) {
      for (const id of targetUserIds) {
        const t = room.members.get(id)
        const bad = rejectBusyTarget(t, m.userId, room)
        if (bad) return bad
      }
    } else if (targetUserId) {
      const t = room.members.get(targetUserId)
      const bad = rejectBusyTarget(t, m.userId, room)
      if (bad) return bad
    }
  }

  if (aug.effectType === 'mute_chat') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const muteRounds = rounds > 0 ? rounds : 2
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    victim.chatMute = {
      startIndex: room.index + 1,
      roundsLeft: muteRounds,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
    }
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 ${muteRounds}R 채팅·제출 불가!`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${muteRounds}라운드 채팅·제출 불가`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님의 채팅·제출을 막았습니다! (다음 ${muteRounds}R)`,
    }
  }

  if (aug.effectType === 'soft_chat_mute') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const muteRounds = rounds > 0 ? rounds : 3
    const muteSecRaw = Number(value.muteSec)
    const muteSec = Number.isFinite(muteSecRaw) && muteSecRaw > 0 ? Math.floor(muteSecRaw) : 5
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    const startIndex = room.index + 1
    victim.activeBuffs = victim.activeBuffs.filter((b) => b.effectType !== 'soft_chat_mute')
    victim.activeBuffs.push({
      name: reflected ? shield!.name : aug.name,
      description: aug.description,
      effectType: 'soft_chat_mute',
      effectValue: { rounds: muteRounds, muteSec },
      imageUrl: aug.imageUrl || null,
      usedByNickname: reflected ? intended.nickname : user.nickname,
      startIndex,
      roundsLeft: muteRounds,
    })
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${muteRounds}R · 매 R 시작 ${muteSec}초 채팅·제출 차단`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${muteRounds}R · 매 R 시작 ${muteSec}초 채팅·제출 차단`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님의 채팅·제출을 막았습니다! (다음 ${muteRounds}R · 매 R 시작 ${muteSec}초)`,
    }
  }

  if (aug.effectType === 'chat_isolate') {
    const isoRounds = rounds > 0 ? rounds : 2
    const startIndex = room.index + 1
    const ids = shuffleArray(playerMembers(room).map((p) => p.userId))
    if (ids.length < 2) {
      return { ok: false, hint: `[${aug.name}] 격리할 플레이어가 부족합니다`, chatText: null }
    }
    const groupByUserId: Record<string, number> = {}
    ids.forEach((id, i) => {
      groupByUserId[id] = i % 2
    })
    room.chatIsolate = {
      startIndex,
      roundsLeft: isoRounds,
      byName: aug.name,
      byNickname: user.nickname,
      groupByUserId,
    }
    for (const other of playerMembers(room)) {
      other.activeBuffs = other.activeBuffs.filter((b) => b.effectType !== 'chat_isolate')
      other.activeBuffs.push({
        name: aug.name,
        description: aug.description,
        effectType: 'chat_isolate',
        effectValue: { rounds: isoRounds, group: groupByUserId[other.userId] ?? 0 },
        imageUrl: aug.imageUrl || null,
        usedByNickname: user.nickname,
        startIndex,
        roundsLeft: isoRounds,
      })
    }
    const g0 = ids.filter((_, i) => i % 2 === 0).length
    const g1 = ids.length - g0
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${isoRounds}R · 채팅방 분리 (격리조 ${g0}/${g1})`,
      chatText: '이런 코로나가 이방에 터졌습니다! 격리 해야겠지?',
    }
  }

  if (aug.effectType === 'power_off_others') {
    const secRaw = Number(value.seconds)
    const seconds = Number.isFinite(secRaw) && secRaw > 0 ? Math.min(60, secRaw) : 20
    const until = Date.now() + seconds * 1000
    let hit = 0
    for (const other of room.members.values()) {
      if (other.userId === m.userId) continue
      if (!canReceiveTargetAugment(other, room)) continue
      other.songMuteUntil = until
      hit += 1
      // 즉시 하드컷 (room:state 대기 없이)
      io.to(other.socketId).emit('song:power_off', { until, seconds })
    }
    if (!hit) return { ok: false, hint: `[${aug.name}] 적용 가능한 대상이 없습니다`, chatText: null }
    const t = setTimeout(() => {
      for (const x of room.members.values()) {
        if (x.songMuteUntil && x.songMuteUntil <= Date.now()) x.songMuteUntil = null
      }
      io.to(room.id).emit('song:power_off_end', {})
      io.to(room.id).emit('room:state', roomState(room))
    }, seconds * 1000 + 80)
    room.extraTimers.push(t)
    return {
      ok: true,
      hint: `[${aug.name}] 다른 플레이어 ${hit}명 · ${seconds}초 노래 끊김`,
      chatText: `${user.nickname}님이 [${aug.name}]! 본인 제외 전원 ${seconds}초 동안 노래가 끊깁니다`,
    }
  }

  if (aug.effectType === 'party_music_others') {
    const partyRounds = rounds > 0 ? rounds : 3
    const youtubeUrl = String(value.youtubeUrl || '').trim()
    if (!youtubeUrl) return { ok: false, hint: '재생할 영상 주소가 없습니다', chatText: null }
    const startRaw = Number(value.startSec)
    const startSec = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0
    const startIndex = room.index + 1
    let hit = 0
    for (const other of room.members.values()) {
      if (other.userId === m.userId) continue
      if (!canReceiveTargetAugment(other, room)) continue
      other.activeBuffs = other.activeBuffs.filter((b) => b.effectType !== 'party_music_others')
      other.activeBuffs.push({
        name: aug.name,
        description: aug.description,
        effectType: aug.effectType,
        effectValue: { rounds: partyRounds, youtubeUrl, startSec },
        imageUrl: aug.imageUrl || null,
        usedByNickname: user.nickname,
        startIndex,
        roundsLeft: partyRounds,
      })
      hit += 1
    }
    if (!hit) return { ok: false, hint: '적용할 상대가 없습니다', chatText: null }
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${partyRounds}R · 본인 제외 ${hit}명 · 방 곡+풍악 동시`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다음 ${partyRounds}R 동안 본인 제외 전원에게 방 노래와 풍악이 같이 들립니다`,
    }
  }

  if (aug.effectType === 'polite_suffix') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const politeRounds = rounds > 0 ? rounds : 3
    const suffix = String(value.suffix || '입니다')
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    victim.politeSuffix = {
      startIndex: room.index + 1,
      roundsLeft: politeRounds,
      suffix,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
    }
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${politeRounds}R · 답 끝「${suffix}」필수`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${politeRounds}R · 답 끝「${suffix}」필수`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님에게 답 끝「${suffix}」를 요구했습니다! (다음 ${politeRounds}R)`,
    }
  }

  // 진조이니라: 본인에게 즉시 N라운드 · 답 끝 suffix 필수 · 정답 시 +bonus
  if (aug.effectType === 'self_suffix_bonus') {
    const selfRounds = rounds > 0 ? rounds : 3
    const suffix = String(value.suffix || '이니라')
    const bonusRaw = Number(value.bonus)
    const bonus = Number.isFinite(bonusRaw) && bonusRaw > 0 ? Math.floor(bonusRaw) : 1
    m.politeSuffix = {
      startIndex: room.index,
      roundsLeft: selfRounds,
      suffix,
      byName: aug.name,
      byNickname: user.nickname,
      bonus,
    }
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${selfRounds}R · 답 끝「${suffix}」필수 · 정답 시 +${bonus}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${selfRounds}R 동안 답 끝에 「${suffix}」를 붙여야 하며, 맞히면 +${bonus}점`,
    }
  }

  if (aug.effectType === 'answer_block') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const blockRounds = rounds > 0 ? rounds : 2
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    victim.answerBlock = {
      startIndex: room.index + 1,
      roundsLeft: blockRounds,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
    }
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${blockRounds}R · 정답 인정 안 됨`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${blockRounds}R · 정답 인정 안 됨 (채팅 OK)`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님에게 수면을 걸었습니다! (다음 ${blockRounds}R · 정답 인정 안 됨)`,
    }
  }

  if (aug.effectType === 'answer_block_others') {
    const blockMsRaw = Number(value.blockMs)
    const blockMs = Number.isFinite(blockMsRaw) && blockMsRaw > 0 ? Math.floor(blockMsRaw) : 10000
    const domainRounds = rounds > 0 ? rounds : 3
    const higherNow = playerMembers(room).some(
      (other) => other.userId !== m.userId && other.score > m.score,
    )
    if (!higherNow) {
      return { ok: false, hint: '현재 본인보다 높은 등수의 플레이어가 없습니다', chatText: null }
    }
    const startIndex = room.index + 1
    const sec = Math.round(blockMs / 1000)
    m.activeBuffs = m.activeBuffs.filter((b) => b.effectType !== 'answer_block_others')
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: 'answer_block_others',
      effectValue: { rounds: domainRounds, blockMs },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: domainRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${domainRounds}R · 매 R 시작 상위 등수 ${sec}초 정답 인정 안 됨 (채팅 OK)`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다음 라운드부터 ${domainRounds}R 동안 매 라운드 점수 상위는 ${sec}초간 정답 인정 안 됨 (채팅 OK)`,
    }
  }

  if (aug.effectType === 'accuse_sleep') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    victim.accuseMark = {
      watchIndex: room.index + 1,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
    }
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕김 · 다음 R 정답 시 그 다음 R 수면`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} · 다음 R 정답 시 → 그 다음 R 수면 (대상에게는 비공개)`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${victim.nickname}님에게 감시가 걸렸습니다 (다음 라운드 정답 시 수면)`,
      excludeNotifyUserId: victim.userId,
    }
  }

  if (aug.effectType === 'gabuki_mark') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const gabukiRounds = rounds > 0 ? rounds : 3
    const hitRaw = Number(value.hitPenalty)
    const missRaw = Number(value.missPenalty)
    const hitPenalty = Number.isFinite(hitRaw) && hitRaw > 0 ? Math.floor(hitRaw) : 1
    const missPenalty = Number.isFinite(missRaw) && missRaw > 0 ? Math.floor(missRaw) : 2
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const casterId = shield ? intended.userId : m.userId
    const reflected = !!shield
    victim.gabuki = {
      startIndex: room.index + 1,
      roundsLeft: gabukiRounds,
      casterUserId: casterId,
      hitPenalty,
      missPenalty,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
    }
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${gabukiRounds}R 가불기!`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} · 다음 ${gabukiRounds}R · 정답 −${hitPenalty} / 미득점 −${missPenalty}`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님에게 가불기를 걸었습니다! (다음 ${gabukiRounds}R)`,
    }
  }

  if (aug.effectType === 'flame_kim') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    const solo = room.members.size < 2
    // 혼자 시험할 때는 대상 없이 오버레이만
    if (!solo && (!intended || intended.userId === m.userId)) {
      return { ok: false, hint: '대상을 선택하세요', chatText: null }
    }
    const flameRoundsRaw = Number(value.rounds)
    const flameRounds = Number.isFinite(flameRoundsRaw) && flameRoundsRaw > 0
      ? Math.floor(flameRoundsRaw)
      : (rounds > 0 ? rounds : 3)
    const drainRaw = Number(value.drain)
    const drain = Number.isFinite(drainRaw) && drainRaw > 0 ? Math.floor(drainRaw) : 1
    const youtubeUrl = String(value.youtubeUrl || '').trim()
      || 'https://www.youtube.com/watch?v=x1PTr27NYds'
    const startRaw = Number(value.startSec)
    // 인트로 건너뛰고 10초부터 (시드 0이어도 10)
    const startSec = Number.isFinite(startRaw) && startRaw > 0 ? Math.floor(startRaw) : 10
    const target = intended && intended.userId !== m.userId ? intended : null
    // 다음 라운드부터 N라운드 · 본인이 고정곡을 들으며 맞춤
    m.flameKim = {
      targetUserId: target?.userId || m.userId,
      targetNickname: target?.nickname || m.nickname,
      startIndex: room.index + 1,
      roundsLeft: flameRounds,
      drain: target ? drain : 0,
      youtubeUrl,
      startSec,
      byName: aug.name,
    }
    io.to(m.socketId).emit('augment:hint', {
      name: aug.name,
      hint: target
        ? `[${aug.name}] 다음 ${flameRounds}R · 방곡+「불꽃남자」 · 정답 시 ${target.nickname} −${drain}`
        : `[${aug.name}] 다음 ${flameRounds}R · 방곡+「불꽃남자」(혼자 시험 · 감점 없음)`,
      durationMs: 0,
    })
    return {
      ok: true,
      hint: target
        ? `[${aug.name}] ${target.nickname} 지목 · 다음 ${flameRounds}R · 방곡+고정곡 · 정답 시 대상 −${drain}`
        : `[${aug.name}] 다음 ${flameRounds}R · 방곡+고정곡 (혼자 시험)`,
      chatText: target
        ? `${user.nickname}님이 [${aug.name}]으로 ${target.nickname}님을 불태웁니다! (다음 ${flameRounds}R · 방곡과 불꽃남자가 같이 들림 · 맞히면 대상 −${drain})`
        : `${user.nickname}님이 [${aug.name}]! (다음 ${flameRounds}R · 방곡과 불꽃남자가 같이 들림)`,
    }
  }

  if (aug.effectType === 'answer_delay') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const delayRounds = rounds > 0 ? rounds : 5
    const delaySec = Number(value.delaySec) || 5
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    victim.answerDelay = {
      startIndex: room.index + 1,
      roundsLeft: delayRounds,
      delaySec,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
    }
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${delayRounds}R · ${delaySec}초 후 제출`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${delayRounds}R · 매 라운드 ${delaySec}초 후 제출`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님의 제출을 ${delaySec}초 늦췄습니다! (다음 ${delayRounds}R)`,
    }
  }

  if (aug.effectType === 'yacha_duel') {
    if (room.duel || room.pendingDuel || room.duelStarting) {
      return { ok: false, hint: '이미 야차룰이 예약·진행 중입니다', chatText: null }
    }
    if (room.status !== 'playing' && room.status !== 'revealing' && room.status !== 'countdown') {
      return { ok: false, hint: '지금은 야차룰을 시작할 수 없습니다', chatText: null }
    }
    if (room.members.size < 2) {
      return { ok: false, hint: '야차룰은 상대가 1명 이상 필요합니다', chatText: null }
    }
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) {
      return { ok: false, hint: '야차룰로 맞붙을 상대를 선택하세요', chatText: null }
    }
    const shield = takeReflectShield(intended, room.index)
    const challenger = shield ? intended : m
    const opponent = shield ? m : intended
    const reflected = !!shield
    const penaltyRaw = Number(value.penalty)
    const penalty = Number.isFinite(penaltyRaw) && penaltyRaw > 0 ? Math.floor(penaltyRaw) : 5
    const delayRaw = Number(value.targetAudioDelaySec)
    const targetAudioDelaySec = Number.isFinite(delayRaw) && delayRaw > 0 ? Math.floor(delayRaw) : 5
    const casterEarlyChosung = value.casterEarlyChosung !== false
    const byName = reflected ? shield!.name : aug.name
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
    }

    // 현재 라운드/공개/카운트다운 중이면 끊지 않고 다음 곡 시작 직전에 발동
    room.pendingDuel = {
      challengerId: challenger.userId,
      opponentId: opponent.userId,
      penalty,
      byName,
      casterEarlyChosung,
      targetAudioDelaySec,
    }
    return {
      ok: true,
      hint: reflected
        ? `[무지개 반사] 다음 라운드 야차룰! ${challenger.nickname} vs ${opponent.nickname} · 패자 −${penalty}`
        : `[${aug.name}] 다음 라운드에 적용 · ${challenger.nickname} vs ${opponent.nickname} · 패자 −${penalty}`,
      chatText: reflected
        ? `${intended.nickname}님의 [무지개 반사]! 다음 라운드 야차룰! ${challenger.nickname} vs ${opponent.nickname} (제목만 · 패자 −${penalty})`
        : `${user.nickname}님이 [${aug.name}]! 다음 라운드에 ${challenger.nickname} vs ${opponent.nickname} (제목만 · 패자 −${penalty} · 시전자 초성 · 대상 ${targetAudioDelaySec}초 지연)`,
    }
  }

  if (aug.effectType === 'slow_playback') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const minRaw = Number(value.rateMin)
    const maxRaw = Number(value.rateMax)
    const rateMin = Number.isFinite(minRaw) ? minRaw : 0.4
    const rateMax = Number.isFinite(maxRaw) ? maxRaw : 0.6
    const lo = Math.min(rateMin, rateMax)
    const hi = Math.max(rateMin, rateMax)
    const rate = Math.round((lo + Math.random() * (hi - lo)) * 100) / 100
    const slowRounds = rounds > 0 ? rounds : 3
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    victim.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rate, rounds: slowRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: reflected ? intended.nickname : user.nickname,
      startIndex: room.index + 1,
      roundsLeft: slowRounds,
    })
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다 (×${rate})`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${slowRounds}R · 배속 ×${rate}`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다! (×${rate})`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${slowRounds}R · 배속 ×${rate}`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님의 배속을 ×${rate}로 바꿨습니다! (다음 ${slowRounds}R)`,
    }
  }

  if (aug.effectType === 'hide_hints') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const hideRounds = rounds > 0 ? rounds : 5
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    const startIndex = room.index + 1
    victim.activeBuffs = victim.activeBuffs.filter((b) => b.effectType !== 'hide_hints')
    victim.activeBuffs.push({
      name: reflected ? shield!.name : aug.name,
      description: aug.description,
      effectType: 'hide_hints',
      effectValue: { rounds: hideRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: reflected ? intended.nickname : user.nickname,
      startIndex,
      roundsLeft: hideRounds,
    })
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${hideRounds}R · 힌트 차단`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${hideRounds}R · 힌트 차단`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님의 힌트를 가렸습니다! (다음 ${hideRounds}R · 장르·초성 등 불가)`,
    }
  }

  if (aug.effectType === 'audio_stutter') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const stutterRounds = rounds > 0 ? rounds : 5
    const onRaw = Number(value.onMs)
    const offRaw = Number(value.offMs)
    const onMs = Number.isFinite(onRaw) && onRaw > 0 ? Math.floor(onRaw) : 1000
    const offMs = Number.isFinite(offRaw) && offRaw > 0 ? Math.floor(offRaw) : 1000
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    const startIndex = room.index + 1
    victim.activeBuffs = victim.activeBuffs.filter((b) => b.effectType !== 'audio_stutter')
    victim.activeBuffs.push({
      name: reflected ? shield!.name : aug.name,
      description: aug.description,
      effectType: 'audio_stutter',
      effectValue: { rounds: stutterRounds, onMs, offMs },
      imageUrl: aug.imageUrl || null,
      usedByNickname: reflected ? intended.nickname : user.nickname,
      startIndex,
      roundsLeft: stutterRounds,
    })
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${stutterRounds}R · ${onMs}ms켜/${offMs}ms꺼`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${stutterRounds}R · ${onMs / 1000}초 켜/${offMs / 1000}초 꺼`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님의 노래를 끊었습니다! (다음 ${stutterRounds}R · ${onMs / 1000}초마다 깜빡)`,
    }
  }

  if (aug.effectType === 'score_share') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const shareRounds = rounds > 0 ? rounds : 5
    const startIndex = room.index + 1
    const clearScoreShare = (mem: Member) => {
      const old = mem.activeBuffs.find((b) => b.effectType === 'score_share')
      if (old) {
        const oldPartnerId = String(old.effectValue.partnerId || '')
        const oldPartner = oldPartnerId ? room.members.get(oldPartnerId) : null
        if (oldPartner) {
          oldPartner.activeBuffs = oldPartner.activeBuffs.filter((b) => b.effectType !== 'score_share')
        }
      }
      mem.activeBuffs = mem.activeBuffs.filter((b) => b.effectType !== 'score_share')
    }
    clearScoreShare(m)
    clearScoreShare(intended)
    const pushLink = (owner: Member, partner: Member) => {
      owner.activeBuffs.push({
        name: aug.name,
        description: aug.description,
        effectType: 'score_share',
        effectValue: { rounds: shareRounds, partnerId: partner.userId, partnerNickname: partner.nickname },
        imageUrl: aug.imageUrl || null,
        usedByNickname: user.nickname,
        startIndex,
        roundsLeft: shareRounds,
      })
    }
    pushLink(m, intended)
    pushLink(intended, m)
    return {
      ok: true,
      hint: `[${aug.name}] ${intended.nickname}과(와) 다음 ${shareRounds}R · 득점 공유`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님과 다음 ${shareRounds}R 동안 점수가 같이 오릅니다`,
    }
  }

  if (aug.effectType === 'sakura_decoy') {
    const requestedIds = [...new Set(
      (targetUserIds?.length ? targetUserIds : (targetUserId ? [targetUserId] : []))
        .filter((id) => id !== m.userId),
    )]
    if (requestedIds.length > 2) {
      return { ok: false, hint: '트루먼은 최대 2명까지 선택할 수 있습니다', chatText: null }
    }
    const intendedList = requestedIds
      .map((id) => room.members.get(id))
      .filter((member): member is Member => !!member && member.userId !== m.userId)
    if (!intendedList.length) {
      return { ok: false, hint: '트루먼으로 만들 상대를 1~2명 선택하세요', chatText: null }
    }
    const startIndex = room.index + 1
    if (hasReplaceAudioConflict(room, startIndex)) {
      return { ok: false, hint: `[${aug.name}] 이미 다른 노래 교체 증강이 적용 중입니다`, chatText: null }
    }
    const probe = await pickDecoyTrack(room)
    if (!probe) return { ok: false, hint: `[${aug.name}] 틀 곡을 찾지 못했습니다`, chatText: null }
    const sakuraRounds = rounds > 0 ? rounds : 2
    let applied = 0
    let skipped = 0
    for (const intended of intendedList) {
      const shield = takeReflectShield(intended, room.index)
      const victim = shield ? m : intended
      if (shield) {
        io.to(intended.socketId).emit('augment:hint', {
          name: shield.name,
          hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
          durationMs: 0,
        })
      }
      // 세노·에라모르겠다·다른 트루먼과 같은 강제곡 슬롯을 공유하므로 덮어쓰지 않는다.
      if (victim.sakuraDecoy?.roundsLeft && victim.sakuraDecoy.roundsLeft > 0) {
        skipped += 1
        continue
      }
      victim.sakuraDecoy = {
        youtubeUrl: '',
        startSec: 0,
        endSec: 0,
        startIndex,
        roundsLeft: sakuraRounds,
        scoreMult: 1,
        byName: shield ? shield.name : aug.name,
        byNickname: shield ? intended.nickname : user.nickname,
        mode: 'truman',
        slots: [],
        fakeRevealed: {},
        fakeScore: 0,
        usedDecoyYt: [],
        genre: '',
        titleChosung: '',
        artistChosung: '',
      }
      applied += 1
    }
    if (!applied) {
      return {
        ok: false,
        hint: `[${aug.name}] 선택한 대상 모두 다른 강제곡 증강이 적용 중입니다`,
        chatText: null,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] 몰래 적용됨 (${applied}명${skipped ? ` · 중첩 ${skipped}명 제외` : ''})`,
      chatText: null,
      silent: true,
    }
  }

  if (aug.effectType === 'named_decoy') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    if (intended.sakuraDecoy?.mode === 'truman' && intended.sakuraDecoy.roundsLeft > 0) {
      return {
        ok: false,
        hint: `[${aug.name}] 선택한 대상은 트루먼쇼 진행 중이라 다른 강제곡을 겹칠 수 없습니다`,
        chatText: null,
      }
    }
    const startIndex = room.index + 1
    if (hasReplaceAudioConflict(room, startIndex)) {
      return { ok: false, hint: `[${aug.name}] 이미 다른 노래 교체 증강이 적용 중입니다`, chatText: null }
    }
    const titleKey = String(value.titleIncludes || '').trim() || '연애서큘레이션'
    const decoy = await pickNamedTrack(room, titleKey, {
      youtubeUrl: String(value.youtubeUrl || ''),
      startSec: Number(value.startSec),
    })
    if (!decoy) {
      return {
        ok: false,
        hint: `[${aug.name}] 문제은행에 「${titleKey}」이(가) 없습니다`,
        chatText: null,
      }
    }
    const youtubeUrl = decoy.youtubeUrl
    const startSec = decoy.startSec
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    const multDefault = 1
    const multRaw = Number(value.scoreMult)
    const mult = Number.isFinite(multRaw) && multRaw > 0 ? Math.floor(multRaw) : multDefault
    const sakuraRounds = rounds > 0 ? rounds : 1
    const songLabel = titleKey
    const multHint = mult > 1 ? ` · 정답 시 ×${mult}` : ''
    const whenHint = `다음 ${sakuraRounds}R `
    victim.sakuraDecoy = {
      youtubeUrl,
      startSec,
      endSec: 0,
      startIndex,
      roundsLeft: sakuraRounds,
      scoreMult: mult,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
      mode: 'classic',
      slots: [],
      fakeRevealed: {},
      fakeScore: 0,
      usedDecoyYt: [],
      genre: '',
      titleChosung: '',
      artistChosung: '',
    }
    io.to(victim.socketId).emit('augment:hint', {
      name: aug.name,
      hint: reflected
        ? `[무지개 반사] ${whenHint}「${songLabel}」이(가) 재생됩니다${multHint}`
        : `[${aug.name}] ${whenHint}「${songLabel}」이(가) 재생됩니다${multHint}`,
      durationMs: 0,
    })
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 ${whenHint}「${songLabel}」 재생${multHint}`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → ${whenHint}「${songLabel}」${multHint}`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님에게 ${whenHint}「${songLabel}」을(를) 틀었습니다!${multHint}`,
    }
  }

  if (aug.effectType === 'named_decoy_all') {
    const titleKey = String(value.titleIncludes || '').trim() || '한로로'
    const startIndex = room.index
    if (hasReplaceAudioConflict(room, startIndex)) {
      return { ok: false, hint: `[${aug.name}] 이미 다른 노래 교체 증강이 적용 중입니다`, chatText: null }
    }
    const decoy = await pickNamedTrack(room, titleKey, {
      youtubeUrl: String(value.youtubeUrl || ''),
      startSec: Number(value.startSec),
    })
    if (!decoy) {
      return {
        ok: false,
        hint: `[${aug.name}] 문제은행에 「${titleKey}」이(가) 없습니다`,
        chatText: null,
      }
    }
    const multRaw = Number(value.scoreMult)
    const mult = Number.isFinite(multRaw) && multRaw > 0 ? Math.floor(multRaw) : 1
    const sakuraRounds = rounds > 0 ? rounds : 1
    const songLabel = String(value.songLabel || '').trim() || titleKey
    let applied = 0
    for (const other of room.members.values()) {
      if (other.userId === m.userId) continue
      if (!canReceiveTargetAugment(other, room)) continue
      // 트루먼 환상 곡과 가짜 정답 슬롯의 싱크를 깨지 않는다.
      if (other.sakuraDecoy?.mode === 'truman' && other.sakuraDecoy.roundsLeft > 0) continue
      other.sakuraDecoy = {
        youtubeUrl: decoy.youtubeUrl,
        startSec: decoy.startSec,
        endSec: 0,
        startIndex,
        roundsLeft: sakuraRounds,
        scoreMult: mult,
        byName: aug.name,
        byNickname: user.nickname,
        mode: 'classic',
        slots: [],
        fakeRevealed: {},
        fakeScore: 0,
        usedDecoyYt: [],
        genre: '',
        titleChosung: '',
        artistChosung: '',
      }
      io.to(other.socketId).emit('augment:hint', {
        name: aug.name,
        hint: `[${aug.name}] 지금부터 ${sakuraRounds}R 「${songLabel}」이(가) 재생됩니다`,
        durationMs: 0,
      })
      applied += 1
    }
    if (!applied) return { ok: false, hint: `[${aug.name}] 적용 가능한 대상이 없습니다`, chatText: null }
    return {
      ok: true,
      hint: `[${aug.name}] ${applied}명 · 지금부터 ${sakuraRounds}R 「${songLabel}」`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${sakuraRounds}R 동안 ${applied}명에게 「${songLabel}」이(가) 재생됩니다`,
    }
  }

  if (aug.effectType === 'reflect_debuff') {
    // 보유만 가능 — 실제 발동은 지목당할 때 takeReflectShield에서 처리
    return {
      ok: false,
      hint: `[${aug.name}] 다른 플레이어에게 지목당하면 자동으로 반사됩니다`,
      chatText: null,
    }
  }

  if (aug.effectType === 'rock_throw' || aug.effectType === 'steal_chain') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    // 구 rock_throw(채팅 봉인)도 동일하게 연속 탈취로 처리
    const chanceRaw = Number(value.hitChance)
    const hitChance = Number.isFinite(chanceRaw) && chanceRaw > 0 && chanceRaw <= 1 ? chanceRaw : 0.5
    const amtRaw = Number(value.amount)
    const amount = Number.isFinite(amtRaw) && amtRaw > 0 ? Math.floor(amtRaw) : 1

    let stolen = 0
    let thief = m
    let victim = intended
    let reflected = false
    let resolvedShield = false

    while (Math.random() < hitChance) {
      if (!resolvedShield) {
        resolvedShield = true
        const shield = takeReflectShield(intended, room.index)
        if (shield) {
          reflected = true
          thief = intended
          victim = m
          io.to(intended.socketId).emit('augment:hint', {
            name: shield.name,
            hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
            durationMs: 0,
          })
        }
      }
      victim.score -= amount
      thief.score += amount
      stolen += amount
    }

    if (stolen <= 0) {
      return {
        ok: true,
        hint: `[${aug.name}] ${intended.nickname}에게 돌 빗나감!`,
        chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님에게 돌을 던졌지만 빗나갔습니다`,
      }
    }

    if (reflected) {
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님이 돌로 ${stolen}점 탈취!`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님에게서 돌로 ${stolen}점을 뜯었습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname}에게서 ${stolen}점 탈취!`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${victim.nickname}님에게서 ${stolen}점을 뜯었습니다`,
    }
  }

  if (aug.effectType === 'answer_proxy') {
    const target = targetUserId ? room.members.get(targetUserId) : null
    if (!target || target.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const proxyRounds = rounds > 0 ? rounds : 3
    m.answerProxy = {
      targetUserId: target.userId,
      startIndex: room.index + 1,
      roundsLeft: proxyRounds,
      pendingScore: 0,
      byName: aug.name,
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${target.nickname} 대리 설정 · 다음 ${proxyRounds}R 후 결산 (비공개)`,
      chatText: `${user.nickname}님이 [${aug.name}]을(를) 사용했습니다! (대상은 비공개 · ${proxyRounds}R 후 결산)`,
    }
  }

  if (aug.effectType === 'wager_answer') {
    const wagerRounds = rounds > 0 ? rounds : 1
    const bonus = Number(value.bonus)
    const penalty = Number(value.penalty)
    const winPts = Number.isFinite(bonus) ? bonus : 5
    const losePts = Number.isFinite(penalty) ? penalty : 5
    const nextRound = !!value.nextRound
    const earlyChosung = !!value.earlyChosung
    const startIndex = nextRound ? room.index + 1 : room.index
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: {
        rounds: wagerRounds,
        bonus: winPts,
        penalty: losePts,
        nextRound,
        earlyChosung,
      },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: wagerRounds,
    })
    const when = nextRound ? `다음 ${wagerRounds}R` : `지금부터 ${wagerRounds}R`
    const penPart = losePts > 0 ? ` / 실패 시 −${losePts}` : ' · 실패 패널티 없음'
    const chosungPart = earlyChosung ? ' · 초성 즉시' : ''
    return {
      ok: true,
      hint: `[${aug.name}] ${when} · 정답 시 +${winPts}${penPart}${chosungPart}`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'mud_fight') {
    const mudRounds = rounds > 0 ? rounds : 1
    const bonusRaw = Number(value.bonus)
    const bonus = Number.isFinite(bonusRaw) && bonusRaw > 0 ? Math.floor(bonusRaw) : 5
    const bgmUrl = String(value.bgmUrl || value.youtubeUrl || '').trim()
      || 'https://www.youtube.com/watch?v=ZzHYbM0l4ec'
    const startRaw = Number(value.bgmStartSec ?? value.startSec)
    const bgmStartSec = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0
    const startIndex = room.index + 1
    if (hasReplaceAudioConflict(room, startIndex)) {
      return { ok: false, hint: `[${aug.name}] 이미 다른 노래 교체 증강이 적용 중입니다`, chatText: null }
    }
    let hit = 0
    for (const other of room.members.values()) {
      if (!isPlayingMember(other)) continue
      const isCaster = other.userId === m.userId
      if (!isCaster && !canReceiveTargetAugment(other, room)) continue
      other.activeBuffs = other.activeBuffs.filter((b) => b.effectType !== 'mud_fight')
      other.activeBuffs.push({
        name: aug.name,
        description: aug.description,
        effectType: aug.effectType,
        effectValue: {
          rounds: mudRounds,
          bonus: isCaster ? bonus : 0,
          bgmUrl,
          bgmStartSec,
        },
        imageUrl: aug.imageUrl || null,
        usedByNickname: user.nickname,
        startIndex,
        roundsLeft: mudRounds,
      })
      hit += 1
    }
    if (!hit) return { ok: false, hint: `[${aug.name}] 적용 가능한 대상이 없습니다`, chatText: null }
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${mudRounds}R · ${hit}명 BGM·초성 · 본인 정답 +${bonus}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다음 ${mudRounds}R ${hit}명 노래 대신 BGM·초성 · ${user.nickname}님만 정답 시 +${bonus}`,
    }
  }

  if (aug.effectType === 'hidden_run') {
    const runRounds = rounds > 0 ? rounds : 3
    const multRaw = Number(value.mult)
    const mult = Number.isFinite(multRaw) && multRaw > 0 ? multRaw : 3
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: runRounds, mult },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: runRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${runRounds}R · 히든 ×${mult} · 일반 문제 득점 없음`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'slow_starter') {
    const starterRounds = rounds > 0 ? rounds : 3
    const delayRaw = Number(value.delaySec)
    const bonusRaw = Number(value.bonus)
    const delaySec = Number.isFinite(delayRaw) && delayRaw > 0 ? delayRaw : 7
    const bonus = Number.isFinite(bonusRaw) && bonusRaw > 0 ? Math.floor(bonusRaw) : 2
    // 다음 라운드부터 적용 (이번 R에는 안 걸림)
    const startIndex = room.index + 1
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: starterRounds, delaySec, bonus },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: starterRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 다음부터 ${starterRounds}R · ${delaySec}초 뒤 재생 · 정답 시 +${bonus}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다음 라운드부터 ${starterRounds}R · ${delaySec}초 뒤 재생 · 정답 +${bonus}`,
    }
  }

  if (aug.effectType === 'late_answer') {
    const lateRounds = rounds > 0 ? rounds : 5
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: lateRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index + 1,
      roundsLeft: lateRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${lateRounds}R · 이미 공개된 정답도 스킵 전까지 제출 가능`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다음 ${lateRounds}R 동안 스킵 전까지 늦은 정답도 인정됩니다`,
    }
  }

  if (aug.effectType === 'water_ghost') {
    const ghostRounds = rounds > 0 ? rounds : 1
    const penRaw = Number(value.penalty)
    const penalty = Number.isFinite(penRaw) && penRaw > 0 ? Math.floor(penRaw) : 2
    const gainRaw = Number(value.gain)
    const gain = Number.isFinite(gainRaw) && gainRaw > 0 ? Math.floor(gainRaw) : 1
    // 증강 선택 자동 / 플레이 중(혼돈 등) 모두 → 해당 시점의 이번 라운드
    const startIndex = room.index
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: ghostRounds, penalty, gain },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: ghostRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 이번 ${ghostRounds}R · 점수 미완 시 맞춘 사람 각 −${penalty} · 본인 +${gain}`,
      chatText:
        room.status === 'augment' || room.status === 'countdown'
          ? `${user.nickname}님의 [${aug.name}]이(가) 자동 적용되었습니다`
          : defaultChat,
    }
  }

  if (aug.effectType === 'combo_clear_double') {
    const comboRounds = rounds > 0 ? rounds : 3
    const startIndex = room.index
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: comboRounds, acc: 0 },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: comboRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 최대 ${comboRounds}R · 매 R 1회+ 정답 유지 · 종료 시 누적 ×2`,
      chatText:
        room.status === 'augment' || room.status === 'countdown'
          ? `${user.nickname}님의 [${aug.name}]이(가) 자동 적용되었습니다`
          : defaultChat,
    }
  }

  if (aug.effectType === 'early_chosung') {
    const earlyRounds = rounds > 0 ? rounds : 3
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: earlyRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: earlyRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${earlyRounds}R · 본인만 초성 즉시 공개`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${earlyRounds}R 동안 본인에게만 초성이 즉시 보입니다`,
    }
  }

  if (aug.effectType === 'follow_answer') {
    const followRounds = rounds > 0 ? rounds : 2
    const windowMsRaw = Number(value.windowMs)
    const windowSecRaw = Number(value.windowSec)
    const windowMs = Number.isFinite(windowMsRaw) && windowMsRaw > 0
      ? Math.floor(windowMsRaw)
      : Number.isFinite(windowSecRaw) && windowSecRaw > 0
        ? Math.floor(windowSecRaw * 1000)
        : 2000
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: followRounds, windowMs },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: followRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${followRounds}R · 남이 맞힌 뒤 ${Math.round(windowMs / 1000)}초 안에 같은 답이면 인정`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'score_bonus') {
    const bonusRounds = rounds > 0 ? rounds : 3
    const bonusRaw = Number(value.bonus)
    const bonus = Number.isFinite(bonusRaw) && bonusRaw > 0 ? Math.floor(bonusRaw) : 1
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: bonusRounds, bonus },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: bonusRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${bonusRounds}R · 정답 시 +${bonus}`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'score_flat') {
    const amtRaw = Number(value.amount)
    const amount = Number.isFinite(amtRaw) ? Math.floor(amtRaw) : 1
    m.score += amount
    return {
      ok: true,
      hint: `[${aug.name}] ${amount >= 0 ? '+' : ''}${amount}점`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${amount >= 0 ? '+' : ''}${amount}점`,
    }
  }

  if (aug.effectType === 'flavor_announce') {
    const line = String(value.message || '').trim()
      || `${user.nickname}님의 친구 중에 진석이가 있답니다!`
    return {
      ok: true,
      hint: `[${aug.name}]`,
      chatText: line.includes('{nick}')
        ? line.replaceAll('{nick}', user.nickname)
        : line,
    }
  }

  if (aug.effectType === 'god_descend') {
    const chanceRaw = Number(value.chance)
    const chance = Number.isFinite(chanceRaw) && chanceRaw > 0 && chanceRaw <= 1 ? chanceRaw : 0.1
    const hit = Math.random() < chance
    if (hit) {
      const before = m.score
      m.score = before * 2
      return {
        ok: true,
        hint: `[${aug.name}] 신 강림! ${before} → ${m.score}점`,
        chatText: `${user.nickname}님의 [${aug.name}] …노맞의 신이 강림했다! 점수 ×2 (${before}→${m.score})`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] 뺨!`,
      chatText: `${user.nickname}님의 [${aug.name}] …실패. 신에게 뺨을 맞았습니다. 짝!`,
    }
  }

  if (aug.effectType === 'peek_next_hint') {
    const next = room.queue[room.index + 1]
    if (!next) {
      return {
        ok: false,
        hint: `[${aug.name}] 다음 라운드가 없습니다`,
        chatText: null,
      }
    }
    const titleH = next.titleChosung || '？'
    const artistH = next.artistChosung || '？'
    const genre = next.genre || '-'
    return {
      ok: true,
      hint: `[${aug.name}] 다음 곡 힌트\n장르: ${genre}\n제목: ${titleH}\n가수/커버/캐릭터: ${artistH}`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 다음 라운드 힌트를 훔쳐봤습니다`,
    }
  }

  if (aug.effectType === 'future_sight') {
    const lookRaw = Number(value.lookAhead ?? value.count)
    const lookAhead = Number.isFinite(lookRaw) && lookRaw > 0 ? Math.floor(lookRaw) : 5
    const pickRaw = Number(value.pick)
    const pick = Number.isFinite(pickRaw) && pickRaw > 0 ? Math.floor(pickRaw) : 3
    const upcoming = room.queue.slice(room.index + 1, room.index + 1 + lookAhead)
    if (!upcoming.length) {
      return {
        ok: false,
        hint: `[${aug.name}] 앞으로 확인할 라운드가 없습니다`,
        chatText: null,
      }
    }
    const shuffled = shuffleArray([...upcoming]).slice(0, Math.min(pick, upcoming.length))
    const lines = shuffled.map((q, i) => {
      const ans = formatTitleArtistAnswers(q)
      return `${i + 1}. ${ans || formatSlotAnswers(q)}`
    })
    return {
      ok: true,
      hint: `[${aug.name}] 앞 ${lookAhead}곡 중 ${shuffled.length}곡 (순서 랜덤 · 이번 R 종료 시 소멸)\n${lines.join('\n')}`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 앞 ${lookAhead}곡 중 ${shuffled.length}곡 정답을 훔쳐봤습니다 (순서 랜덤)`,
    }
  }

  if (aug.effectType === 'know_but_cant') {
    const knowRounds = rounds > 0 ? rounds : 1
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: knowRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: knowRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${knowRounds}R · 제목·가수 공개 · 정답 인정 안 됨 (채팅 OK)`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${knowRounds}R 동안 답을 알 수 있지만 정답은 인정되지 않습니다`,
    }
  }

  if (aug.effectType === 'coin_flip') {
    const winRaw = Number(value.win)
    const win = Number.isFinite(winRaw) && winRaw > 0 ? Math.floor(winRaw) : 2
    const hit = Math.random() < 0.5
    if (!hit) {
      return {
        ok: true,
        hint: `[${aug.name}] 꽝…`,
        chatText: `${user.nickname}님의 [${aug.name}] …꽝!`,
      }
    }
    m.score += win
    return {
      ok: true,
      hint: `[${aug.name}] 당첨! +${win}점`,
      chatText: `${user.nickname}님의 [${aug.name}] 당첨! +${win}점`,
    }
  }

  if (aug.effectType === 'last_place_bonus') {
    const bonusRaw = Number(value.bonus)
    const bonus = Number.isFinite(bonusRaw) && bonusRaw > 0 ? Math.floor(bonusRaw) : 3
    const scores = [...room.members.values()].map((x) => x.score)
    const min = Math.min(...scores)
    if (m.score > min) {
      return {
        ok: true,
        hint: `[${aug.name}] 꼴찌가 아니라서 발동 안 됨`,
        chatText: `${user.nickname}님의 [${aug.name}] …꼴찌가 아니라 실패`,
      }
    }
    m.score += bonus
    return {
      ok: true,
      hint: `[${aug.name}] 꼴찌 보너스 +${bonus}점`,
      chatText: `${user.nickname}님의 [${aug.name}]! 꼴찌 반란 +${bonus}점`,
    }
  }

  if (aug.effectType === 'score_steal') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const amtRaw = Number(value.amount)
    const amount = Number.isFinite(amtRaw) && amtRaw > 0 ? Math.floor(amtRaw) : 1
    const shield = takeReflectShield(intended, room.index)
    const thief = shield ? intended : m
    const victim = shield ? m : intended
    const reflected = !!shield
    victim.score -= amount
    thief.score += amount
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님이 대신 ${amount}점 뜯어감!`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님에게서 ${amount}점을 뜯었습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} −${amount} · 본인 +${amount}`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${victim.nickname}님에게서 ${amount}점을 뜯었습니다`,
    }
  }

  if (aug.effectType === 'steal_from_leader') {
    const amtRaw = Number(value.amount)
    const amount = Number.isFinite(amtRaw) && amtRaw > 0 ? Math.floor(amtRaw) : 1
    const others = [...room.members.values()].filter((x) => x.userId !== m.userId)
    if (!others.length) return { ok: false, hint: '뺏을 상대가 없습니다', chatText: null }
    others.sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'ko'))
    const leader = others[0]
    const shield = takeReflectShield(leader, room.index)
    const thief = shield ? leader : m
    const victim = shield ? m : leader
    const reflected = !!shield
    victim.score -= amount
    thief.score += amount
    if (reflected) {
      io.to(leader.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${leader.nickname}님이 대신 ${amount}점 가져감!`,
        chatText: `${leader.nickname}님의 [무지개 반사]! ${user.nickname}님에게서 ${amount}점을 뜯었습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] 선두 ${victim.nickname} −${amount} · 본인 +${amount}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 선두 ${victim.nickname}님에게서 ${amount}점을 뺏었습니다`,
    }
  }

  if (aug.effectType === 'extend_round') {
    if (room.status !== 'playing' && room.status !== 'duel') {
      return { ok: false, hint: '플레이 중에만 시간을 연장할 수 있습니다', chatText: null }
    }
    const secRaw = Number(value.seconds)
    const seconds = Number.isFinite(secRaw) && secRaw > 0 ? Math.min(30, Math.floor(secRaw)) : 10
    room.roundEndsAt += seconds * 1000
    room.roundDuration += seconds
    // 기존 타임아웃을 남은 시간에 맞게 다시 잡음
    if (room.timer) {
      clearTimeout(room.timer)
      room.timer = null
      const remaining = Math.max(0, room.roundEndsAt - Date.now())
      if (room.status === 'duel') {
        room.timer = setTimeout(() => endDuel(io, room, 'timeout'), remaining)
      } else {
        room.timer = setTimeout(() => endRound(io, room, 'timeout'), remaining)
      }
    }
    io.to(room.id).emit('round:extend', {
      endsAt: room.roundEndsAt,
      duration: room.roundDuration,
      addedSec: seconds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 라운드 +${seconds}초`,
      chatText: `${user.nickname}님이 [${aug.name}]! 남은 시간 +${seconds}초`,
    }
  }

  if (aug.effectType === 'force_skip') {
    if (room.status !== 'playing') {
      return { ok: false, hint: '플레이 중인 문제에만 쓸 수 있습니다', chatText: null }
    }
    const chargesRaw = Number(value.charges)
    let charges = Number.isFinite(chargesRaw) && chargesRaw > 0 ? Math.floor(chargesRaw) : 1
    charges -= 1
    endRound(io, room, 'skip')
    if (charges > 0) {
      const nextVal = { ...value, charges }
      m.heldAugmentEffectValue = JSON.stringify(nextVal)
      return {
        ok: true,
        hint: `[${aug.name}] 강제 스킵 · 남은 횟수 ${charges}`,
        chatText: `${user.nickname}님이 [${aug.name}]! 현재 문제를 강제 스킵합니다 (남은 ${charges}회)`,
        keepHeld: true,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] 이 문제를 강제 스킵했습니다`,
      chatText: `${user.nickname}님이 [${aug.name}]! 현재 문제를 강제 스킵합니다`,
    }
  }

  if (aug.effectType === 'auto_reveal_slot') {
    if (room.status !== 'playing') {
      return { ok: false, hint: '플레이 중에만 사용할 수 있습니다', chatText: null }
    }
    const q = room.queue[room.index]
    if (!q) return { ok: false, hint: '현재 문제가 없습니다', chatText: null }
    const openDone = q.slots.filter((s) => !s.hidden).every((s) => room.revealed[s.id])
    const candidates = q.slots.filter((s) => !room.revealed[s.id])
    if (!candidates.length) {
      return { ok: false, hint: `[${aug.name}] 남은 슬롯이 없습니다`, chatText: null }
    }
    const slot = candidates.find((s) => !s.hidden) || candidates[0]
    if (slot.hidden && !openDone && !hasHiddenRun(m, room.index, room)) {
      // 히든만 남았고 해금 전이면 실패로 두지 않고 히든도 허용? Spec: first unrevealed non-hidden else any
      // any unrevealed is ok
    }
    room.revealed[slot.id] = { answer: slot.answer, by: user.nickname, userId: user.id, at: Date.now() }
    let gain = answerScoreFor(m, room.index, slot.hidden, room)
    gain = riskyGainForAnswer(room, m, user.id, q, gain)
    gain = hiddenRunGainForAnswer(m, room.index, slot.hidden, gain, room)
    let starterBonus = slowStarterBonus(m, room.index, room)
    let flatBonus = scoreBonusFor(m, room.index, room) + politeSuffixBonus(m, room.index, room)
    if (!slot.hidden && hasHiddenRun(m, room.index, room)) {
      starterBonus = 0
      flatBonus = 0
    }
    if (gain < 0) {
      starterBonus = 0
      flatBonus = 0
    }
    const pointsShown = gain + starterBonus + flatBonus
    m.score += pointsShown
    m.roundScoreGain += pointsShown
    shareLinkedScoreGain(io, room, m, pointsShown)
    const wagerPts = tryResolveWagerWin(io, room, m)
    tryTriggerAccuseSleep(io, room, m)
    applyGabukiOnCorrect(io, room, m)
    applyFlameKimOnCorrect(io, room, m)
    bankAnswerProxyPoints(io, room, user.id, pointsShown)
    room.revealed[slot.id] = {
      answer: slot.answer,
      by: user.nickname,
      userId: user.id,
      at: Date.now(),
      points: pointsShown,
      wagerPts,
    }
    const allCleared = q.slots.every((s) => room.revealed[s.id])
    io.to(room.id).emit('answer:correct', {
      slotId: slot.id,
      label: slot.label,
      answer: slot.answer,
      by: user.nickname,
      userId: user.id,
      hidden: slot.hidden,
      points: pointsShown,
      allCleared,
    })
    io.to(room.id).emit('room:state', roomState(room))
    const nowOpenDone = q.slots.filter((s) => !s.hidden).every((s) => room.revealed[s.id])
    if (nowOpenDone) {
      const locked = q.slots.filter((s) => s.hidden && !room.revealed[s.id])
      if (locked.length) {
        io.to(room.id).emit('hidden:unlock', {
          slots: locked.map((s) => ({ id: s.id, label: s.label })),
        })
      }
    }
    if (allCleared) {
      endRound(io, room, 'cleared')
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${slot.label} 자동 정답! +${pointsShown}점`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${slot.label}을(를) 자동으로 맞혔습니다 (+${pointsShown})`,
    }
  }

  if (aug.effectType === 'donate_from_random') {
    const countRaw = Number(value.count)
    const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.min(5, Math.floor(countRaw)) : 5
    const amtRaw = Number(value.amount)
    const amount = Number.isFinite(amtRaw) && amtRaw > 0 ? Math.floor(amtRaw) : 1
    const gainRaw = Number(value.gain)
    const gain = Number.isFinite(gainRaw) && gainRaw > 0 ? Math.floor(gainRaw) : 1
    const victims = pickRandomOtherMembers(room, m.userId, count)
    if (!victims.length) {
      return {
        ok: false,
        hint: `[${aug.name}] 기부받을 다른 플레이어가 없습니다`,
        chatText: null,
      }
    }
    for (const v of victims) {
      v.score -= amount
      io.to(v.socketId).emit('augment:hint', {
        name: aug.name,
        hint: `[${aug.name}] ${user.nickname}님에게 ${amount}점 기부… (−${amount})`,
        durationMs: 0,
      })
    }
    m.score += gain
    const names = victims.map((v) => v.nickname).join('·')
    return {
      ok: true,
      hint: `[${aug.name}] ${names} 각 −${amount} · 본인 +${gain}`,
      chatText: `${user.nickname}님의 [${aug.name}]! ${names} 최대 5명에게 각 −${amount}점 · 본인 +${gain}점`,
    }
  }

  if (aug.effectType === 'pair_average') {
    const others = [...room.members.values()].filter((other) => other.userId !== m.userId)
    if (!others.length) return { ok: false, hint: '비교할 다른 플레이어가 없습니다', chatText: null }
    const higher = others
      .filter((other) => other.score > m.score)
      .sort((a, b) => a.score - b.score || a.nickname.localeCompare(b.nickname, 'ko'))[0]
    const lower = others
      .filter((other) => other.score < m.score)
      .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'ko'))[0]
    const intended = higher && lower
      ? (Math.random() < 0.5 ? higher : lower)
      : (higher || lower)
    if (!intended) {
      return { ok: true, hint: `[${aug.name}] 전원 동점이라 점수 변화 없음`, chatText: defaultChat }
    }
    const before = m.score
    const midpoint = Math.round((m.score + intended.score) / 2)
    m.score = midpoint
    const direction = intended.score > before ? '위' : '아래'
    return {
      ok: true,
      hint: `[${aug.name}] 가장 가까운 ${direction} 점수 ${intended.nickname}님 쪽으로 이동 · ${before} → ${midpoint}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 가장 가까운 ${direction} 점수와의 중간값 ${midpoint}점이 됐습니다`,
    }
  }

  if (aug.effectType === 'shuffle_queue' || aug.effectType === 'equalize_genre_remaining') {
    const result = await equalizeGenreRemaining(room)
    if (!result.ok) {
      return { ok: false, hint: result.hint, chatText: null }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${result.hint}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 남은 장르 곡 수를 평균에 맞췄습니다`,
    }
  }

  if (rounds > 0) {
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: value,
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: rounds,
    })
    const mult = Number(value.mult)
    if (aug.effectType === 'alien_qwerty_answer') {
      return {
        ok: true,
        hint: `[${aug.name}] 지금부터 ${rounds}R · 외계인 영타로 정답 공개`,
        chatText: `${user.nickname}님이 [${aug.name}]! 화성 외계인과 접촉했습니다 (지금부터 ${rounds}R)`,
      }
    }
    return {
      ok: true,
      hint: Number.isFinite(mult) && mult > 1
        ? `[${aug.name}] 지금부터 ${rounds}R · 점수 ×${mult}`
        : `[${aug.name}] 지금부터 ${rounds}라운드 동안 적용`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'equalize_scores') {
    const list = [...room.members.values()]
    const avg = list.length
      ? Math.round(list.reduce((s, x) => s + x.score, 0) / list.length)
      : 0
    for (const x of list) x.score = avg
    return {
      ok: true,
      hint: `점수가 ${avg}점으로 통일되었습니다`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'rank_jump_tie') {
    const ranked = [...room.members.values()].sort((a, b) => b.score - a.score)
    const myIdx = ranked.findIndex((x) => x.userId === m.userId)
    if (myIdx < 0 || ranked.length < 2) {
      return { ok: false, hint: '점프할 상대가 없습니다', chatText: null }
    }
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < ranked.length; i++) {
      if (i === myIdx) continue
      const dist = Math.abs(i - myIdx)
      // 거리 같으면 위 등수(앞 순위) 우선 — 점프 느낌
      if (dist < bestDist || (dist === bestDist && i < bestIdx)) {
        bestDist = dist
        bestIdx = i
      }
    }
    if (bestIdx < 0) {
      return { ok: false, hint: '점프할 상대가 없습니다', chatText: null }
    }
    const target = ranked[bestIdx]
    const before = m.score
    m.score = target.score
    return {
      ok: true,
      hint: `[${aug.name}] ${target.nickname}님과 동점! ${before} → ${m.score}점`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 점프! ${target.nickname}님과 ${m.score}점 동점`,
    }
  }

  if (aug.effectType === 'collect_piece') {
    const piece = String(value.piece || aug.name)
    const requires = Array.isArray(value.requires) ? value.requires.map(String) : []
    if (!requires.every((r) => m.collectedPieces.includes(r))) {
      return { ok: true, hint: `[${aug.name}] 아직 이전 조각이 없습니다`, chatText: defaultChat }
    }
    if (m.collectedPieces.includes(piece)) {
      return { ok: true, hint: `[${aug.name}] 이미 보유한 조각입니다`, chatText: defaultChat }
    }
    m.collectedPieces.push(piece)
    const setName = String(value.set || '')
    const setPieces = setName === 'eomjunshik' ? ['엄', '준', '식'] : [piece]
    const done = setPieces.every((p) => m.collectedPieces.includes(p))
    return {
      ok: true,
      hint: done
        ? `[엄·준·식] 완성! 서상원 깊티 대상`
        : `[${piece}] 획득 (${m.collectedPieces.filter((p) => setPieces.includes(p)).join('→')})`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'reveal_game_song') {
    const revealRounds = rounds > 0 ? rounds : 8
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: revealRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: revealRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${revealRounds}R · 게임 분야에서 정답 공개`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'swap_genre_counts') {
    const result = await swapExtremeGenreRemaining(room)
    return {
      ok: true,
      hint: result.hint,
      chatText: result.ok
        ? `${user.nickname}님이 [${aug.name}]으로 장르 잔량을 반전했습니다!`
        : defaultChat,
    }
  }

  if (aug.effectType === 'ban_genre') {
    const g = (genreName || '').trim()
    if (!g) return { ok: false, hint: '밴할 장르를 선택하세요', chatText: null }
    const result = await banGenreAndRedistribute(room, g)
    if (!result.ok) {
      return { ok: false, hint: result.hint, chatText: null }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${result.hint}`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${result.hint}`,
    }
  }

  if (aug.effectType === 'steal_held_augment') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) {
      return { ok: false, hint: '대상을 선택하세요', chatText: null }
    }
    if (!intended.heldAugmentId || !intended.heldAugmentName) {
      return {
        ok: false,
        hint: `[${aug.name}] ${intended.nickname}님은 보유 증강이 없습니다`,
        chatText: null,
      }
    }
    const shield = takeReflectShield(intended, room.index)
    if (shield) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 증강 강탈 실패`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    const stolen = {
      id: intended.heldAugmentId,
      name: intended.heldAugmentName,
      description: intended.heldAugmentDescription || '',
      effectType: intended.heldAugmentEffectType || '',
      effectValue: intended.heldAugmentEffectValue,
      imageUrl: intended.heldAugmentImageUrl,
      tier: intended.heldAugmentTier,
    }
    clearHeldAugment(intended)
    setHeldAugment(m, stolen)
    return {
      ok: true,
      hint: `[${aug.name}] ${intended.nickname}님의 「${stolen.name}」을(를) 가져왔습니다!`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님의 「${stolen.name}」을(를) 가져갔습니다`,
    }
  }

  return { ok: true, hint: `증강 [${aug.name}] 사용`, chatText: defaultChat }
}

function pickRandomOtherMember(room: Room, selfId: string): Member | null {
  const others = playerMembers(room).filter((x) => x.userId !== selfId && canReceiveTargetAugment(x, room))
  if (!others.length) return null
  return others[pickRandomIndex(others.length)]
}

function pickRandomOtherMembers(room: Room, selfId: string, count: number): Member[] {
  const others = playerMembers(room).filter((x) => x.userId !== selfId && canReceiveTargetAugment(x, room))
  if (!others.length || count <= 0) return []
  const shuffled = shuffleArray(others)
  return shuffled.slice(0, Math.min(count, shuffled.length))
}

function pickChaosAugments(pool: AugmentLike[], count: number): AugmentLike[] {
  const shuffled = shuffleArray(pool)
  if (shuffled.length >= count) return shuffled.slice(0, count)
  const out = [...shuffled]
  while (out.length < count && pool.length > 0) {
    out.push(pool[Math.floor(Math.random() * pool.length)])
  }
  return out
}

async function loadMemberProfile(userId: string, fallbackNickname: string) {
  const dbUser = await prisma.user.findUnique({ where: { id: userId } })
  return {
    nickname: dbUser?.nickname || fallbackNickname,
    avatarUrl: dbUser?.avatarUrl || null,
  }
}

function clearTimer(room: Room) {
  if (room.timer) {
    clearTimeout(room.timer)
    room.timer = null
  }
  for (const t of room.extraTimers) clearTimeout(t)
  room.extraTimers = []
}

function applyRoundStartBuffs(io: Server, room: Room) {
  const q = room.queue[room.index]
  if (!q) return
  flushPendingAugmentNotices(io, room)
  for (const m of room.members.values()) {
    // 트루먼 환상 중에는 진짜 곡 정답을 보여 주는 힌트만 숨긴다.
    if (isTrumanIllusion(m, room.index)) continue
    for (const b of activeBuffsAt(m, room.index, room)) {
      if (b.effectType === 'soft_chat_mute') {
        const muteSecRaw = Number(b.effectValue.muteSec)
        const muteSec = Number.isFinite(muteSecRaw) && muteSecRaw > 0 ? Math.floor(muteSecRaw) : 5
        m.chatMuteUntil = Date.now() + muteSec * 1000
        const t = setTimeout(() => {
          if (m.chatMuteUntil && m.chatMuteUntil <= Date.now()) m.chatMuteUntil = null
          io.to(room.id).emit('room:state', roomState(room))
        }, muteSec * 1000 + 80)
        room.extraTimers.push(t)
      }
      if (b.effectType === 'answer_block_others') {
        const blockMsRaw = Number(b.effectValue.blockMs)
        const blockMs = Number.isFinite(blockMsRaw) && blockMsRaw > 0 ? Math.floor(blockMsRaw) : 10000
        const { hit } = applyDomainExpansionPulse(io, room, m, b.name, blockMs, {
          allowReflect: b.startIndex === room.index,
          casterUser: { id: m.userId, nickname: m.nickname },
        })
        if (hit > 0) {
          const sec = Math.round(blockMs / 1000)
          io.to(room.id).emit('chat:message', {
            id: Date.now() + 22,
            userId: '',
            nickname: '시스템',
            text: b.startIndex === room.index
              ? `[${b.name}] 발동! 상위 ${hit}명 ${sec}초 정답 인정 안 됨 (남은 ${b.roundsLeft}R · 채팅 OK)`
              : `[${b.name}] 지속! 상위 ${hit}명 ${sec}초 정답 인정 안 됨 (남은 ${b.roundsLeft}R · 채팅 OK)`,
            system: true,
            at: Date.now(),
          })
        }
      }
      if (b.effectType === 'flash_answer') {
        const delaySec = Number(b.effectValue.delaySec) || 0
        const ms = Number(b.effectValue.ms)
        const durationMs = Number.isFinite(ms) && ms > 0 ? ms : 1000
        const emitHint = () => {
          if (room.status !== 'playing') return
          if (room.queue[room.index] !== q) return
          io.to(m.socketId).emit('augment:hint', {
            name: b.name,
            hint: formatSlotAnswers(q, hiddenUnlockedForQuestion(room, q)),
            durationMs,
          })
        }
        if (delaySec > 0) {
          const t = setTimeout(emitHint, delaySec * 1000)
          room.extraTimers.push(t)
        } else {
          emitHint()
        }
      }
      if (b.effectType === 'delayed_answer') {
        // 라운드 시작부터 타이핑 공개 (클라에서 1초/한글1 · 알파벳2)
        const delaySec = Number(b.effectValue.delaySec) || 0
        const emitHint = () => {
          if (room.status !== 'playing') return
          if (room.queue[room.index] !== q) return
          io.to(m.socketId).emit('augment:hint', {
            name: b.name,
            hint: formatSlotAnswersPlain(q, hiddenUnlockedForQuestion(room, q)),
            mode: 'typewriter',
            intervalMs: Number(b.effectValue.charIntervalMs) || 1000,
            durationMs: 0,
          })
        }
        if (delaySec > 0) {
          const t = setTimeout(emitHint, delaySec * 1000)
          room.extraTimers.push(t)
        } else {
          emitHint()
        }
      }
      if (b.effectType === 'reveal_game_song' && isGameGenre(q.genre)) {
        io.to(m.socketId).emit('augment:hint', {
          name: b.name,
          hint: formatSlotAnswers(q, hiddenUnlockedForQuestion(room, q)),
          durationMs: 0,
        })
      }
      if (b.effectType === 'know_but_cant') {
        io.to(m.socketId).emit('augment:hint', {
          name: b.name,
          hint: `[${b.name}] ${formatTitleArtistAnswers(q)} · 정답은 인정되지 않습니다`,
          durationMs: 0,
        })
      }
      if (b.effectType === 'alien_qwerty_answer') {
        io.to(m.socketId).emit('augment:hint', {
          name: b.name,
          hint: `외계인 통신 · ${formatAlienQwertyAnswers(q, true)}`,
          durationMs: 0,
        })
      }
    }
  }
}

async function prepareTrumanRoundAudio(room: Room) {
  for (const m of room.members.values()) {
    if (isTrumanIllusion(m, room.index) && m.sakuraDecoy) {
      await refreshTrumanDecoyForRound(room, m)
    }
  }
}

export function registerSocket(io: Server) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) return next(new Error('UNAUTHORIZED'))
      socket.data.user = verifyToken(token)
      next()
    } catch {
      next(new Error('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthUser

    socket.emit('lobby:rooms', publicRooms())

    socket.on('ping:rtt', (_payload, cb?: (res: unknown) => void) => {
      cb?.({ ok: true, t: Date.now() })
    })

    socket.on('room:list', () => {
      socket.emit('lobby:rooms', publicRooms())
    })

    socket.on('room:create', async (payload: {
      name?: string
      isPrivate?: boolean
      maxPlayers?: number
      genreCounts?: Record<string, number>
      answerMode?: 'title' | 'title_artist'
      augmentsEnabled?: boolean
      gameMode?: GameMode
      readingTargetScore?: number
      recentSongPenalty?: number
    }, cb?: (res: unknown) => void) => {
      const profile = await loadMemberProfile(user.id, user.nickname)
      const id = Math.random().toString(36).slice(2, 8)
      const genreBankCounts = await loadGenreBankCounts()
      const genreCounts = await clampGenreCounts(payload.genreCounts || { '한국노래': 20 })
      const gameMode: GameMode = payload.gameMode === 'reading' ? 'reading' : 'nomatch'
      const answerMode = gameMode === 'reading'
        ? 'title'
        : (payload.answerMode === 'title' ? 'title' : 'title_artist')
      const augmentsEnabled = gameMode === 'reading' ? false : payload.augmentsEnabled !== false
      const readingTargetScore = clampReadingTargetScore(payload.readingTargetScore ?? 50)
      const recentSongPenalty = clampRecentSongPenalty(
        payload.recentSongPenalty ?? DEFAULT_RECENT_SONG_PENALTY,
      )
      const room: Room = {
        id,
        name: payload.name?.trim() || `${profile.nickname}의 방`,
        hostId: user.id,
        isPrivate: !!payload.isPrivate,
        code: payload.isPrivate ? Math.random().toString(36).slice(2, 8).toUpperCase() : null,
        maxPlayers: Math.min(10, Math.max(2, payload.maxPlayers || 10)),
        genreCounts,
        genreBankCounts,
        answerMode,
        augmentsEnabled,
        gameMode,
        readingTargetScore,
        reading: null,
        recentQuestionIds: [],
        recentSongPenalty,
        members: new Map(),
        status: 'lobby',
        queue: [],
        index: 0,
        roundEndsAt: 0,
        roundStartedAt: 0,
        roundDuration: 40,
        skipVotes: new Set(),
        revealed: {},
        clearedHintSent: false,
        timer: null,
        extraTimers: [],
        lastAugmentAt: -1,
        augmentOfferLockedTier: null,
        augmentOfferEndsAt: 0,
        riskyBustApplied: new Set(),
        wagerSettled: new Set(),
        followAnswerWindow: {},
        followAnswerClaimed: {},
        lateAnswerClaimed: {},
        duel: null,
        pendingDuel: null,
        duelStarting: false,
        pendingAugmentNotices: [],
        chatIsolate: null,
      }
      attachMember(room, emptyMember(user.id, profile.nickname, profile.avatarUrl, socket.id))
      rooms.set(id, room)
      socket.join(id)
      io.emit('lobby:rooms', publicRooms())
      cb?.({ ok: true, room: roomState(room), code: room.code })
      socket.emit('room:state', roomState(room))
    })

    socket.on('room:join', async (payload: { roomId?: string; code?: string; asSpectator?: boolean }, cb?: (res: unknown) => void) => {
      let room: Room | undefined
      if (payload.code) {
        room = [...rooms.values()].find((r) => r.code === payload.code!.toUpperCase())
      } else if (payload.roomId) {
        room = rooms.get(payload.roomId)
      }
      if (!room) return cb?.({ ok: false, error: '방을 찾을 수 없습니다' })
      if (room.status !== 'lobby') return cb?.({ ok: false, error: '이미 시작된 방입니다' })
      if (room.members.size >= room.maxPlayers) return cb?.({ ok: false, error: '방이 가득 찼습니다' })

      const profile = await loadMemberProfile(user.id, user.nickname)
      room.genreBankCounts = await loadGenreBankCounts()
      room.genreCounts = await clampGenreCounts(room.genreCounts)
      const asSpectator = !!payload.asSpectator
      attachMember(room, emptyMember(user.id, profile.nickname, profile.avatarUrl, socket.id, { spectator: asSpectator }))
      socket.join(room.id)
      io.to(room.id).emit('room:state', roomState(room))
      io.emit('lobby:rooms', publicRooms())
      cb?.({ ok: true, room: roomState(room) })
    })

    socket.on('profile:sync', async (_payload, cb?: (res: unknown) => void) => {
      const profile = await loadMemberProfile(user.id, user.nickname)
      user.nickname = profile.nickname
      const room = findRoomByUser(user.id)
      if (room) {
        const m = room.members.get(user.id)
        if (m) {
          m.nickname = profile.nickname
          m.avatarUrl = profile.avatarUrl
          io.to(room.id).emit('room:state', roomState(room))
        }
      }
      cb?.({ ok: true, nickname: profile.nickname, avatarUrl: profile.avatarUrl })
    })

    socket.on('room:leave', () => leaveRoom(io, socket, user.id))

    socket.on('room:ready', () => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'lobby') return
      const m = room.members.get(user.id)
      if (!m || m.isSpectator) return
      m.ready = !m.ready
      io.to(room.id).emit('room:state', roomState(room))
    })

    socket.on('room:settings', async (payload: {
      genreCounts?: Record<string, number>
      maxPlayers?: number
      name?: string
      answerMode?: 'title' | 'title_artist'
      augmentsEnabled?: boolean
      gameMode?: GameMode
      readingTargetScore?: number
      recentSongPenalty?: number
    }) => {
      const room = findRoomByUser(user.id)
      if (!room || room.hostId !== user.id || room.status !== 'lobby') return
      if (payload.genreCounts) {
        room.genreBankCounts = await loadGenreBankCounts()
        room.genreCounts = await clampGenreCounts(payload.genreCounts)
      }
      if (payload.maxPlayers) room.maxPlayers = Math.min(10, Math.max(2, payload.maxPlayers))
      if (payload.name) room.name = payload.name
      if (payload.gameMode === 'reading' || payload.gameMode === 'nomatch') {
        room.gameMode = payload.gameMode
        if (room.gameMode === 'reading') {
          room.augmentsEnabled = false
          room.answerMode = 'title'
        }
      }
      if (typeof payload.readingTargetScore === 'number') {
        room.readingTargetScore = clampReadingTargetScore(payload.readingTargetScore)
      }
      if (typeof payload.recentSongPenalty === 'number') {
        room.recentSongPenalty = clampRecentSongPenalty(payload.recentSongPenalty)
      }
      if (room.gameMode !== 'reading') {
        if (payload.answerMode === 'title' || payload.answerMode === 'title_artist') {
          room.answerMode = payload.answerMode
        }
        if (typeof payload.augmentsEnabled === 'boolean') {
          room.augmentsEnabled = payload.augmentsEnabled
        }
      }
      io.to(room.id).emit('room:state', roomState(room))
    })

    socket.on('chat:message', (payload: { text?: string }) => {
      const text = payload.text?.trim()
      if (!text) return
      const room = findRoomByUser(user.id)
      if (!room) return
      if (room.gameMode === 'reading' && room.reading) {
        if (readingTryClaimFromChat(io, room, user.id, text, roomState as never)) {
          emitPlayerChat(io, room, {
            id: Date.now(),
            userId: user.id,
            nickname: user.nickname,
            text,
            at: Date.now(),
          })
          return
        }
      }
      const m = room.members.get(user.id)
      if (m && room.status === 'playing' && isChatMuted(m, room.index, room)) {
        const softName = (m.chatMuteUntil && m.chatMuteUntil > Date.now())
          ? (activeBuffsAt(m, room.index, room).find((b) => b.effectType === 'soft_chat_mute')?.name
            || m.chatMute?.byName || '쉬었음청년')
          : null
        io.to(m.socketId).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: softName
            ? `${softName} · 라운드 시작 직시 채팅·제출이 막혀 있습니다`
            : `${m.chatMute?.byName || '채팅·제출 금지'} · 지금은 채팅·제출이 불가합니다`,
          system: true,
          at: Date.now(),
        })
        return
      }
      // 야차룰: 관전자 채팅은 당사자에게 안 보임
      if (room.status === 'duel' && room.duel && !isDuelParticipant(room, user.id)) {
        emitSpectatorChat(io, room, {
          id: Date.now(),
          userId: user.id,
          nickname: user.nickname,
          text,
          at: Date.now(),
        })
        return
      }
      // 방 관전 멤버: 전원에게 보이되 spectator 표시
      if (m?.isSpectator) {
        io.to(room.id).emit('chat:message', {
          id: Date.now(),
          userId: user.id,
          nickname: user.nickname,
          text,
          at: Date.now(),
          spectator: true,
        })
        return
      }
      emitPlayerChat(io, room, {
        id: Date.now(),
        userId: user.id,
        nickname: user.nickname,
        text,
        at: Date.now(),
      })
    })

    
    socket.on('reading:accept', (_payload, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      const res = readingAccept(io, room, user.id, roomState as never)
      cb?.(res)
    })

    socket.on('reading:pass', (_payload, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      const res = readingPass(io, room, user.id, roomState as never)
      cb?.(res)
    })

    socket.on('reading:claim', (_payload, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      const res = readingClaim(io, room, user.id, roomState as never)
      cb?.(res)
    })

    socket.on('reading:vote', (payload: { vote?: 'yes' | 'no' }, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      if (payload?.vote !== 'yes' && payload?.vote !== 'no') return cb?.({ ok: false, error: '투표 값이 필요합니다' })
      const res = readingVote(io, room, user.id, payload.vote, roomState as never)
      cb?.(res)
    })

    socket.on('game:start', async (_payload, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room) return cb?.({ ok: false, error: '방 없음' })
      if (room.hostId !== user.id) return cb?.({ ok: false, error: '방장만 시작 가능' })
      if (room.status !== 'lobby') return cb?.({ ok: false, error: '이미 시작된 방입니다' })
      if (room.gameMode === 'reading' && playerCount(room) < 2) {
        return cb?.({ ok: false, error: '리딩방은 플레이어 최소 2명 필요합니다' })
      }
      if (playerCount(room) < 1) return cb?.({ ok: false, error: '플레이어가 없습니다' })

      room.genreBankCounts = await loadGenreBankCounts()
      room.genreCounts = await clampGenreCounts(room.genreCounts)
      const queue = await pickQuestions(room.genreCounts, {
        recentIds: room.recentQuestionIds || [],
        recentPenalty: room.recentSongPenalty,
      })
      if (queue.length === 0) return cb?.({ ok: false, error: '문제 은행이 비어 있습니다' })

      clearTimer(room)
      const modeForQueue = room.gameMode === 'reading' ? 'title' : (room.answerMode || 'title_artist')
      if (room.gameMode === 'reading') {
        room.augmentsEnabled = false
        room.answerMode = 'title'
      }
      room.queue = queue.map((q) => applyAnswerMode(q, modeForQueue))
      rememberQueueQuestions(room, room.queue)
      room.index = 0
      room.lastAugmentAt = -1
      room.duel = null
      room.pendingDuel = null
      room.duelStarting = false
      room.chatIsolate = null
      room.skipVotes = new Set()
      room.revealed = {}
      room.clearedHintSent = false
      room.riskyBustApplied = new Set()
      room.wagerSettled = new Set()
      room.followAnswerWindow = {}
      room.followAnswerClaimed = {}
      room.lateAnswerClaimed = {}
      room.reading = null
      for (const m of room.members.values()) {
        m.score = 0
        m.ready = false
        m.usedAugments = []
        m.offerSeenAugmentIds = []
        m.lastOfferCandidateIds = []
        m.activeBuffs = []
        m.collectedPieces = []
        m.chatMute = null
        m.chatMuteUntil = null
        m.answerDelay = null
        m.politeSuffix = null
        m.answerBlock = null
        m.answerBlockUntil = null
        m.answerBlockUntilBy = null
        m.audioDelayUntil = null
        m.duelEarlyChosung = false
        m.accuseMark = null
        m.gabuki = null
        m.answerProxy = null
        m.sakuraDecoy = null
        m.flameKim = null
        m.songMuteUntil = null
        m.roundScoreGain = 0
        clearHeldAugment(m)
      }
      if (room.gameMode === 'reading') {
        startReadingGame(io, room, roomState as never)
        cb?.({ ok: true })
        return
      }
      // 첫 곡은 3-2-1부터 · 증강은 20곡마다만 (시작 선택 없음)
      beginRoundCountdown(io, room)
      cb?.({ ok: true })
    })

    socket.on('answer:submit', (payload: { text?: string }) => {
      const text = payload.text?.trim()
      if (!text) return
      const room = findRoomByUser(user.id)
      if (!room || (room.status !== 'playing' && room.status !== 'duel')) return
      const self = room.members.get(user.id)
      if (!self) return
      // 관전: 채팅만 (정답 판정 없음)
      if (self.isSpectator) {
        if (room.status === 'duel' && room.duel) {
          emitSpectatorChat(io, room, {
            id: Date.now(),
            userId: user.id,
            nickname: user.nickname,
            text,
            at: Date.now(),
          })
        } else {
          io.to(room.id).emit('chat:message', {
            id: Date.now(),
            userId: user.id,
            nickname: user.nickname,
            text,
            at: Date.now(),
            spectator: true,
          })
        }
        return
      }

      if (room.gameMode === 'reading' && room.reading) {
        io.to(room.id).emit('chat:message', {
          id: Date.now(),
          userId: user.id,
          nickname: user.nickname,
          text,
          at: Date.now(),
        })
        if (readingTryClaimFromChat(io, room, user.id, text, roomState as never)) return
        readingTryAnswer(io, room, user.id, text, isAcceptedAnswer, roomState as never)
        return
      }

      // ── 야차룰 1v1 ──────────────────────────────────────────
      if (room.status === 'duel' && room.duel) {
        const duel = room.duel
        const isDuelist = user.id === duel.challengerId || user.id === duel.opponentId
        // 관전자 입력 → 관전 채팅만 (당사자에게 안 보임)
        if (!isDuelist) {
          emitSpectatorChat(io, room, {
            id: Date.now(),
            userId: user.id,
            nickname: user.nickname,
            text,
            at: Date.now(),
          })
          return
        }
        io.to(room.id).emit('chat:message', {
          id: Date.now(),
          userId: user.id,
          nickname: user.nickname,
          text,
          at: Date.now(),
        })
        const q = duel.question
        const slot = q?.slots?.[0]
        if (!slot || room.revealed[slot.id]) return
        if (!isAcceptedAnswer(text, slot.acceptNorms)) return

        room.revealed[slot.id] = { answer: slot.answer, by: user.nickname, userId: user.id, at: Date.now() }
        const loserId = user.id === duel.challengerId ? duel.opponentId : duel.challengerId
        const loser = room.members.get(loserId)
        if (loser) loser.score -= duel.penalty

        io.to(room.id).emit('answer:correct', {
          slotId: slot.id,
          label: slot.label,
          answer: slot.answer,
          by: user.nickname,
          userId: user.id,
          hidden: false,
          points: 0,
        })
        io.to(room.id).emit('chat:message', {
          id: Date.now() + 2,
          userId: '',
          nickname: '시스템',
          text: `야차룰! ${user.nickname}님 선빵! ${loser?.nickname || '상대'} −${duel.penalty}점`,
          system: true,
          at: Date.now(),
        })
        io.to(room.id).emit('room:state', roomState(room))
        endDuel(io, room, 'resolved')
        return
      }

      const memberSelf = room.members.get(user.id)
      if (memberSelf && isChatMuted(memberSelf, room.index, room)) {
        const softName = (memberSelf.chatMuteUntil && memberSelf.chatMuteUntil > Date.now())
          ? (activeBuffsAt(memberSelf, room.index, room).find((b) => b.effectType === 'soft_chat_mute')?.name
            || memberSelf.chatMute?.byName || '쉬었음청년')
          : null
        io.to(memberSelf.socketId).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: softName
            ? `${softName} · 라운드 시작 잠시 채팅·제출이 막혀 있습니다`
            : `${memberSelf.chatMute?.byName || '채팅·제출 금지'} · 지금은 채팅·제출이 불가합니다`,
          system: true,
          at: Date.now(),
        })
        return
      }
      const delayLeft = memberSelf ? answerDelayRemainingMs(room, memberSelf) : 0
      if (memberSelf && delayLeft > 0) {
        const sec = Math.ceil(delayLeft / 1000)
        const delayName = memberSelf.answerDelay?.byName || '잠깐만요'
        io.to(memberSelf.socketId).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: `${delayName}! ${sec}초 후에 정답을 입력할 수 있습니다`,
          system: true,
          at: Date.now(),
        })
        return
      }
      const q = room.queue[room.index]
      if (!q) return

      // 채팅으로도 방송 (코로나 격리 중이면 같은 조만)
      emitPlayerChat(io, room, {
        id: Date.now(),
        userId: user.id,
        nickname: user.nickname,
        text,
        at: Date.now(),
      })

      if (memberSelf && isAnswerBlocked(memberSelf, room.index, room)) {
        const block = answerBlockPublic(memberSelf, room.index, room)
        const blockName = block.answerBlockBy
          || (memberSelf.answerBlockUntil && memberSelf.answerBlockUntil > Date.now()
            ? '영역전개'
            : knowButCantBuff(memberSelf, room.index, room)?.name || '수면')
        const timed = !!(memberSelf.answerBlockUntil && memberSelf.answerBlockUntil > Date.now())
        const know = !!knowButCantBuff(memberSelf, room.index, room)
        io.to(memberSelf.socketId).emit('chat:message', {
          id: Date.now() + 1,
          userId: '',
          nickname: '시스템',
          text: know
            ? `${blockName}! 정답은 보이지만 인정되지 않습니다`
            : timed
              ? `${blockName}! 지금은 정답이 인정되지 않습니다 (채팅은 가능)`
              : `${blockName}! 이번 라운드 정답이 인정되지 않습니다 (채팅은 가능)`,
          system: true,
          at: Date.now(),
        })
        return
      }

      let scoreText = text
      if (memberSelf && isPoliteSuffixActive(memberSelf, room.index, room)) {
        const suffix = memberSelf.politeSuffix!.suffix || '입니다'
        const ruleName = memberSelf.politeSuffix!.byName || '예의바른청년'
        if (!text.trim().endsWith(suffix)) {
          io.to(memberSelf.socketId).emit('chat:message', {
            id: Date.now() + 1,
            userId: '',
            nickname: '시스템',
            text: `${ruleName}! 답 끝에 「${suffix}」를 붙여야 합니다`,
            system: true,
            at: Date.now(),
          })
          return
        }
        scoreText = text.trim().slice(0, -suffix.length).trim()
      }

      // 트루먼쇼 환상: 가짜 곡 슬롯만 채점 · 실제 점수/공개 미반영
      if (memberSelf && isTrumanIllusion(memberSelf, room.index) && memberSelf.sakuraDecoy) {
        const decoy = memberSelf.sakuraDecoy
        for (const slot of decoy.slots) {
          if (slot.hidden) continue
          if (decoy.fakeRevealed[slot.id]) continue
          if (!isAcceptedAnswer(scoreText, slot.acceptNorms)) continue
          decoy.fakeRevealed[slot.id] = true
          decoy.fakeScore += 1
          io.to(room.id).emit('chat:message', {
            id: Date.now() + 1,
            userId: '',
            nickname: '시스템',
            text: `${user.nickname}님이 ${slot.label}을(를) 맞혔습니다! +1점`,
            system: true,
            at: Date.now(),
          })
          // 피해자 화면 위 슬롯만 가짜 정답으로 갱신 (방 전체 answer:correct 없음)
          io.to(memberSelf.socketId).emit('illusion:correct', {
            slotId: slot.id,
            answer: slot.answer,
            label: slot.label,
            by: user.nickname,
          })
          io.to(room.id).emit('room:state', roomState(room))
          return
        }
        // 가짜 미매칭 · 진짜 곡 정답도 인정하지 않음
        return
      }

      const openDone = q.slots
        .filter((s) => !s.hidden)
        .every((s) => room.revealed[s.id])

      for (const slot of q.slots) {
        if (room.revealed[slot.id]) {
          const lateClaimed = room.lateAnswerClaimed[slot.id] || new Set<string>()
          // 차차차: 선답 직후 ~0.5초 안 동시·중복 정답이면 보유자가 우선 (선답자가 차차차면 도착 순 유지)
          const chaHeld = memberSelf ? chaChaHeld(memberSelf) : null
          const prevRev = room.revealed[slot.id]
          const prevMember = room.members.get(prevRev.userId)
          const revealAt = prevRev.at
            ?? room.followAnswerWindow[slot.id]?.at
            ?? 0
          if (
            chaHeld
            && revealAt > 0
            && prevRev.userId !== user.id
            && !chaChaHeld(prevMember)
            && Date.now() - revealAt <= chaHeld.windowMs + CHA_CHA_GRACE_MS
            && isAcceptedAnswer(scoreText, slot.acceptNorms)
          ) {
            const consumed = consumeChaChaCharge(memberSelf!)
            if (consumed) {
              const prevNick = prevRev.by
              revokeRevealedAnswerCredit(room, prevRev)

              let gain = answerScoreFor(memberSelf!, room.index, slot.hidden, room)
              gain = riskyGainForAnswer(room, memberSelf!, user.id, q, gain)
              gain = hiddenRunGainForAnswer(memberSelf!, room.index, slot.hidden, gain, room)
              let starterBonus = slowStarterBonus(memberSelf!, room.index, room)
              let flatBonus = scoreBonusFor(memberSelf!, room.index, room) + politeSuffixBonus(memberSelf!, room.index, room)
              if (!slot.hidden && hasHiddenRun(memberSelf!, room.index, room)) {
                starterBonus = 0
                flatBonus = 0
              }
              if (gain < 0) {
                starterBonus = 0
                flatBonus = 0
              }
              const pointsShown = gain + starterBonus + flatBonus
              memberSelf!.score += pointsShown
              memberSelf!.roundScoreGain += pointsShown
              shareLinkedScoreGain(io, room, memberSelf!, pointsShown)
              const wagerPts = tryResolveWagerWin(io, room, memberSelf!)
              tryTriggerAccuseSleep(io, room, memberSelf!)
              applyGabukiOnCorrect(io, room, memberSelf!)
              applyFlameKimOnCorrect(io, room, memberSelf!)
              bankAnswerProxyPoints(io, room, user.id, pointsShown)

              room.revealed[slot.id] = {
                answer: slot.answer,
                by: user.nickname,
                userId: user.id,
                at: revealAt,
                points: pointsShown,
                wagerPts,
              }
              if (room.followAnswerWindow[slot.id]) {
                room.followAnswerWindow[slot.id].byUserId = user.id
                room.followAnswerClaimed[slot.id] = new Set([user.id])
              }

              const leftNote = consumed.chargesLeft > 0 ? ` · 남은 ${consumed.chargesLeft}회` : ' · 소진'
              const allCleared = q.slots.every((s) => room.revealed[s.id])
              io.to(room.id).emit('answer:correct', {
                slotId: slot.id,
                label: slot.label,
                answer: slot.answer,
                by: user.nickname,
                userId: user.id,
                hidden: slot.hidden,
                points: pointsShown,
                allCleared,
              })
              io.to(room.id).emit('room:state', roomState(room))
              io.to(room.id).emit('chat:message', {
                id: Date.now() + 21,
                userId: '',
                nickname: '시스템',
                text: `${user.nickname}님 [${consumed.name}]! ${slot.label} 중복 정답 우선 처리 (+${pointsShown}) · ${prevNick}님 정답 취소${leftNote}`,
                system: true,
                at: Date.now(),
              })
              io.to(memberSelf!.socketId).emit('augment:hint', {
                name: consumed.name,
                hint: `[${consumed.name}] ${slot.label} 우선 정답! +${pointsShown}점${leftNote}`,
                durationMs: 2500,
              })
              break
            }
          }
          // 미룬이의 가호: 누가 먼저 맞힌 뒤라도 스킵 전까지 본인 정답을 1회 인정
          const lateBuff = memberSelf ? lateAnswerBuff(memberSelf, room.index, room) : null
          if (
            lateBuff
            && room.revealed[slot.id].userId !== user.id
            && !lateClaimed.has(user.id)
            && isAcceptedAnswer(scoreText, slot.acceptNorms)
          ) {
            lateClaimed.add(user.id)
            room.lateAnswerClaimed[slot.id] = lateClaimed

            let gain = answerScoreFor(memberSelf!, room.index, slot.hidden, room)
            gain = riskyGainForAnswer(room, memberSelf!, user.id, q, gain)
            gain = hiddenRunGainForAnswer(memberSelf!, room.index, slot.hidden, gain, room)
            let starterBonus = slowStarterBonus(memberSelf!, room.index, room)
            let flatBonus = scoreBonusFor(memberSelf!, room.index, room) + politeSuffixBonus(memberSelf!, room.index, room)
            if (!slot.hidden && hasHiddenRun(memberSelf!, room.index, room)) {
              starterBonus = 0
              flatBonus = 0
            }
            if (gain < 0) {
              starterBonus = 0
              flatBonus = 0
            }
            const pointsShown = gain + starterBonus + flatBonus
            memberSelf!.score += pointsShown
            memberSelf!.roundScoreGain += pointsShown
            shareLinkedScoreGain(io, room, memberSelf!, pointsShown)
            tryResolveWagerWin(io, room, memberSelf!)
            tryTriggerAccuseSleep(io, room, memberSelf!)
            applyGabukiOnCorrect(io, room, memberSelf!)
            applyFlameKimOnCorrect(io, room, memberSelf!)
            bankAnswerProxyPoints(io, room, user.id, pointsShown)
            io.to(room.id).emit('room:state', roomState(room))
            io.to(room.id).emit('chat:message', {
              id: Date.now() + 19,
              userId: '',
              nickname: '시스템',
              text: `${user.nickname}님 [${lateBuff.name}]! ${slot.label} 늦은 정답 인정 +${pointsShown}점`,
              system: true,
              at: Date.now(),
            })
            io.to(memberSelf!.socketId).emit('augment:hint', {
              name: lateBuff.name,
              hint: `[${lateBuff.name}] ${slot.label} 늦은 정답 인정! +${pointsShown}점`,
              durationMs: 2500,
            })
            break
          }
          // 보너스 타임: 선답 후 windowMs 안 추종 정답
          const win = room.followAnswerWindow[slot.id]
          if (!win) {
            // ping 때문에 “내 입력이 조금 늦게 도착해서” 기본 점수를 못 받은 것처럼 느끼는 문제 완화용:
            // 같은 슬롯의 정답인데 보너스 창이 열려있지 않으면, 점수는 안 주되 유저에게만 안내한다.
            if (!slot.hidden && memberSelf && isAcceptedAnswer(scoreText, slot.acceptNorms)) {
              io.to(memberSelf.socketId).emit('chat:message', {
                id: Date.now(),
                userId: '',
                nickname: '시스템',
                text: '이미 누군가 정답을 맞췄습니다.',
                system: true,
                at: Date.now(),
              })
            }
            continue
          }
          if (Date.now() - win.at > win.windowMs + FOLLOW_ANSWER_GRACE_MS) continue
          if (!memberSelf || !hasFollowAnswer(memberSelf, room.index, room)) continue
          if (win.byUserId === user.id) continue
          const claimed = room.followAnswerClaimed[slot.id] || new Set()
          if (claimed.has(user.id)) continue
          if (!isAcceptedAnswer(scoreText, win.acceptNorms)) continue

          claimed.add(user.id)
          room.followAnswerClaimed[slot.id] = claimed

          let gain = answerScoreFor(memberSelf, room.index, win.hidden, room)
          let starterBonus = 0
          let flatBonus = 0
          gain = riskyGainForAnswer(room, memberSelf, user.id, q, gain)
          gain = hiddenRunGainForAnswer(memberSelf, room.index, win.hidden, gain, room)
          starterBonus = slowStarterBonus(memberSelf, room.index, room)
          flatBonus = scoreBonusFor(memberSelf, room.index, room) + politeSuffixBonus(memberSelf, room.index, room)
          if (!win.hidden && hasHiddenRun(memberSelf, room.index, room)) {
            starterBonus = 0
            flatBonus = 0
          }
          const pointsShown = gain + starterBonus + flatBonus
          memberSelf.score += pointsShown
          memberSelf.roundScoreGain += pointsShown
          shareLinkedScoreGain(io, room, memberSelf, pointsShown)
          tryResolveWagerWin(io, room, memberSelf)
          tryTriggerAccuseSleep(io, room, memberSelf)
          applyGabukiOnCorrect(io, room, memberSelf)
          applyFlameKimOnCorrect(io, room, memberSelf)
          bankAnswerProxyPoints(io, room, user.id, pointsShown)

          const followBuff = activeBuffsAt(memberSelf, room.index).find((b) => b.effectType === 'follow_answer')
          const followName = followBuff?.name || '보너스 타임'
          io.to(room.id).emit('room:state', roomState(room))
          io.to(room.id).emit('chat:message', {
            id: Date.now() + 11,
            userId: '',
            nickname: '시스템',
            text: pointsShown > 0
              ? `${user.nickname}님 [${followName}]! ${win.label} 추가 인정 +${pointsShown}점`
              : `${user.nickname}님 [${followName}]! ${win.label} 추가 인정 (득점 없음)`,
            system: true,
            at: Date.now(),
          })
          io.to(memberSelf.socketId).emit('augment:hint', {
            name: followName,
            hint: `[${followName}] ${win.label} 추종 정답! +${pointsShown}점`,
            durationMs: 2500,
          })
          break
        }
        // 히든은 일반 슬롯을 모두 맞히기 전엔 채점하지 않음 (히든런 시전자 제외)
        if (slot.hidden && !openDone) {
          if (!(memberSelf && hasHiddenRun(memberSelf, room.index, room))) continue
        }
        const accepts = slot.acceptNorms
        if (isAcceptedAnswer(scoreText, accepts)) {
          const revealAt = Date.now()
          room.revealed[slot.id] = { answer: slot.answer, by: user.nickname, userId: user.id, at: revealAt }
          openFollowAnswerWindow(room, slot, user.id)
          // 제목을 남이 맞히면 점수가 2배 보유자에게 즉시 bust
          const isTitle = !slot.hidden && isTitleLikeLabel(slot.label)
          if (isTitle) {
            for (const other of room.members.values()) {
              if (other.userId === user.id) continue
              if (!hasRiskyDouble(other, room.index, room)) continue
              if (room.riskyBustApplied.has(other.userId)) continue
              room.riskyBustApplied.add(other.userId)
              other.score -= 1
              const buff = activeBuffsAt(other, room.index, room).find((b) => b.effectType === 'score_mult_risky')
              const name = buff?.name || '점수가 2배'
              io.to(room.id).emit('chat:message', {
                id: Date.now() + 5,
                userId: '',
                nickname: '시스템',
                text: `${other.nickname}님의 [${name}] 제목을 놓침! -1점 · 이후 맞춰도 -1점`,
                system: true,
                at: Date.now(),
              })
              io.to(other.socketId).emit('augment:hint', {
                name,
                hint: `[${name}] 다른 사람이 제목을 먼저 맞혀 -1점, 이후 정답도 -1점`,
                durationMs: 0,
              })
            }
          }
          const member = room.members.get(user.id)
          let gain = member ? answerScoreFor(member, room.index, slot.hidden, room) : (slot.hidden ? 3 : 1)
          let starterBonus = 0
          let flatBonus = 0
          let wagerPts = 0
          if (member) {
            gain = riskyGainForAnswer(room, member, user.id, q, gain)
            gain = hiddenRunGainForAnswer(member, room.index, slot.hidden, gain, room)
            starterBonus = slowStarterBonus(member, room.index, room)
            flatBonus = scoreBonusFor(member, room.index, room) + politeSuffixBonus(member, room.index, room)
            // 히든런 일반 슬롯 0점 규칙이 보너스도 막음
            if (!slot.hidden && hasHiddenRun(member, room.index, room)) {
              starterBonus = 0
              flatBonus = 0
            }
            // 점수가 2배 선점 실패: 보너스로 상쇄되지 않게
            if (gain < 0) {
              starterBonus = 0
              flatBonus = 0
            }
            member.score += gain + starterBonus + flatBonus
            member.roundScoreGain += gain + starterBonus + flatBonus
            shareLinkedScoreGain(io, room, member, gain + starterBonus + flatBonus)
            wagerPts = tryResolveWagerWin(io, room, member)
            tryTriggerAccuseSleep(io, room, member)
            applyGabukiOnCorrect(io, room, member)
            applyFlameKimOnCorrect(io, room, member)
          }
          // 대상이 실제로 얻은 점수(배율·보너스 포함)만큼 대리 적립
          const proxyBank = (member ? gain + starterBonus + flatBonus : gain)
          bankAnswerProxyPoints(io, room, user.id, proxyBank)
          const pointsShown = gain + starterBonus + flatBonus
          room.revealed[slot.id] = {
            answer: slot.answer,
            by: user.nickname,
            userId: user.id,
            at: revealAt,
            points: pointsShown,
            wagerPts,
          }
          const bonusNote = [
            starterBonus > 0 ? `슬로우 스타터 +${starterBonus}` : '',
            flatBonus > 0 ? `보너스 +${flatBonus}` : '',
          ].filter(Boolean).join(' · ')
          const allCleared = q.slots.every((s) => room.revealed[s.id])
          io.to(room.id).emit('answer:correct', {
            slotId: slot.id,
            label: slot.label,
            answer: slot.answer,
            by: user.nickname,
            userId: user.id,
            hidden: slot.hidden,
            points: pointsShown,
            allCleared,
          })
          io.to(room.id).emit('room:state', roomState(room))
          const zeroReason = member && hasHiddenRun(member, room.index) && !slot.hidden
            ? '히든런 · 일반 문제 득점 없음'
            : pointsShown < 0
              ? '점수가 2배 · -1점'
              : '점수가 2배 · 득점 없음'
          io.to(room.id).emit('chat:message', {
            id: Date.now() + 1,
            userId: '',
            nickname: '시스템',
            text: slot.hidden
              ? `${user.nickname}님이 히든 문제를 맞혔습니다! +${pointsShown}점${bonusNote ? ` (${bonusNote})` : ''}`
              : pointsShown > 0
                ? `${user.nickname}님이 ${slot.label}${josaUlReul(slot.label)} 맞혔습니다! +${pointsShown}점${bonusNote ? ` (${bonusNote})` : ''}`
                : pointsShown < 0
                  ? `${user.nickname}님이 ${slot.label}${josaUlReul(slot.label)} 맞혔습니다! ${pointsShown}점 (${zeroReason})`
                  : `${user.nickname}님이 ${slot.label}${josaUlReul(slot.label)} 맞혔습니다! (${zeroReason})`,
            system: true,
            at: Date.now(),
          })

          // 일반 슬롯 전부 맞춤 → 히든 해금
          const nowOpenDone = q.slots
            .filter((s) => !s.hidden)
            .every((s) => room.revealed[s.id])
          if (nowOpenDone) {
            const locked = q.slots.filter((s) => s.hidden && !room.revealed[s.id])
            if (locked.length) {
              io.to(room.id).emit('hidden:unlock', {
                slots: locked.map((s) => ({ id: s.id, label: s.label })),
              })
              io.to(room.id).emit('chat:message', {
                id: Date.now() + 2,
                userId: '',
                nickname: '시스템',
                text: `히든 문제 등장! 「${locked.map((s) => s.label).join(' / ')}」`,
                system: true,
                at: Date.now(),
              })
            }
          }
          break
        }
      }

      if (q.slots.every((s) => room.revealed[s.id])) {
        // 전부 맞춤 안내는 라운드당 1회만
        if (!room.clearedHintSent) {
          room.clearedHintSent = true
          io.to(room.id).emit('chat:message', {
            id: Date.now() + 3,
            userId: '',
            nickname: '시스템',
            text: '정답을 모두 맞혔습니다! 스킵하거나 시간이 지나면 다음 곡으로 갑니다',
            system: true,
            at: Date.now(),
          })
        }
      }
    })

    socket.on('round:skip', () => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'playing') return
      const self = room.members.get(user.id)
      if (!self || self.isSpectator) return
      if (room.skipVotes.has(user.id)) return
      room.skipVotes.add(user.id)
      const need = skipVotesNeeded(playerCount(room))
      io.to(room.id).emit('round:skip_update', { votes: room.skipVotes.size, need })
      if (room.skipVotes.size >= need) {
        endRound(io, room, 'skip')
      }
    })

    socket.on('augment:reroll', async (_payload, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'augment') return cb?.({ ok: false })
      const m = room.members.get(user.id)
      if (!m) return cb?.({ ok: false })
      const list = await getEnabledAugments()
      const shuffled = pickOfferCandidates(
        list,
        m.collectedPieces || [],
        3,
        room.augmentOfferLockedTier,
        {
          excludeIds: m.offerSeenAugmentIds,
          excludeNames: m.usedAugments,
        },
      )
      rememberOfferSeen(m, shuffled)
      cb?.({ ok: true, candidates: shuffled, lockedTier: room.augmentOfferLockedTier })
    })

    socket.on('augment:offer_done', async (payload: { augmentId?: string; gahoAugmentId?: string }) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'augment') return
      const m = room.members.get(user.id)
      if (!m || m.heldAugmentId) return
      const list = await getEnabledAugments()
      const pickOpts = { excludeNames: m.usedAugments }
      const pickFromLastOffer = () => {
        const fromOffer = (m.lastOfferCandidateIds || [])
          .map((id) => list.find((a) => a.id === id))
          .filter((a): a is CachedAugment => !!a && !m.usedAugments.includes(a.name))
        if (fromOffer.length) return fromOffer[pickRandomIndex(fromOffer.length)]
        return pickRandomFromOfferPool(
          list,
          m.collectedPieces,
          room.augmentOfferLockedTier,
          pickOpts,
        )
      }
      if (payload.augmentId) {
        const aug = list.find((a) => a.id === payload.augmentId)
        if (aug && aug.tier === '가호') return
        const nameBlocked = m.usedAugments.includes(aug?.name || '')
        // 오퍼에 뜬 카드는 그대로 보관 (등급 락과 어긋나 랜덤으로 바뀌던 버그 방지)
        const tierOk = !room.augmentOfferLockedTier
          || aug?.tier === room.augmentOfferLockedTier
        if (
          aug
          && !nameBlocked
          && isCollectPieceOfferable(aug, m.collectedPieces)
          && tierOk
        ) {
          assignHeldFromOfferPick(m, list, aug, payload.gahoAugmentId)
        } else {
          const fallback = pickFromLastOffer()
          if (!fallback) return
          assignHeldFromOfferPick(m, list, fallback)
        }
      } else {
        const pick = pickFromLastOffer()
        if (!pick) return
        assignHeldFromOfferPick(m, list, pick)
      }
      void finishAugmentIfReady(io, room)
    })

    socket.on('augment:gaho_candidates', async (_payload, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room) return cb?.({ ok: false })
      const m = room.members.get(user.id)
      // 증강 선택 중(가호선택 카드) 또는 플레이 중 보유 가호선택
      const offerPhase = room.status === 'augment'
      const playPhase = room.status === 'playing' && m?.heldAugmentEffectType === 'gaho_select'
      if (!offerPhase && !playPhase) return cb?.({ ok: false })
      if (!m) return cb?.({ ok: false })
      const list = await getEnabledAugments()
      const candidates = ensureGahoPickCandidates(m, list, 3)
      cb?.({
        ok: true,
        candidates,
        endsAt: offerPhase ? room.augmentOfferEndsAt : null,
        remainingSec: offerPhase
          ? Math.max(0, Math.ceil((room.augmentOfferEndsAt - Date.now()) / 1000))
          : null,
      })
    })

    socket.on('augment:use', async (payload?: {
      targetUserId?: string
      targetUserIds?: string[]
      gahoAugmentId?: string
      genreName?: string
    }) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'playing') return
      const m = room.members.get(user.id)
      if (!m || m.isSpectator) return
      if (!m?.heldAugmentId || !m.heldAugmentName || !m.heldAugmentEffectType) return
      // 자동 사용 / 피격 자동 발동 증강은 수동 사용 불가
      if (
        AUTO_APPLY_AUGMENT_TYPES.has(m.heldAugmentEffectType)
        || PASSIVE_HELD_AUGMENT_TYPES.has(m.heldAugmentEffectType)
        || AUTO_TRIGGER_HELD_AUGMENT_TYPES.has(m.heldAugmentEffectType)
      ) return
      const aug: AugmentLike = {
        name: m.heldAugmentName,
        description: m.heldAugmentDescription || '',
        effectType: m.heldAugmentEffectType,
        effectValue: m.heldAugmentEffectValue,
        imageUrl: m.heldAugmentImageUrl,
        tier: m.heldAugmentTier || undefined,
      }

      let hint: string | null = null
      let chatText = `${user.nickname}님이 증강 [${aug.name}]을(를) 사용했습니다`
      let usedCard: AugmentLike = aug
      let silentUse = false
      let excludeNotifyUserId: string | null = null

      if (aug.effectType === 'chaos_cast') {
        m.usedAugments.push(aug.name)
        clearHeldAugment(m)
        const all = await getEnabledAugments()
        // 모든 일반 등급에서 추첨. 가호와 가호를 고르는/등급을 바꾸는 래퍼만 제외.
        const pool = all.filter(
          (a) =>
            a.effectType !== 'chaos_cast'
            && a.effectType !== 'gaho_select'
            && a.effectType !== 'tier_upgrade'
            && a.tier !== '가호',
        )
        const picks = pickChaosAugments(pool, 2)
        const hintLines: string[] = []
        const publicChatLines: string[] = []
        const reservedChatLines: string[] = []
        for (const pick of picks) {
          let targetId: string | undefined
          let genrePick: string | undefined
          if (TARGET_AUGMENT_TYPES.has(pick.effectType)) {
            const eligible = [...room.members.values()].filter((other) => (
              other.userId !== m.userId
              && canReceiveTargetAugment(other, room)
              && (pick.effectType !== 'steal_held_augment' || !!other.heldAugmentId)
            ))
            const other = eligible.length
              ? eligible[pickRandomIndex(eligible.length)]
              : null
            if (!other) {
              hintLines.push(`[${pick.name}] 대상 없음 · 스킵`)
              continue
            }
            targetId = other.userId
          }
          if (GENRE_AUGMENT_TYPES.has(pick.effectType)) {
            const counts: Record<string, number> = {}
            for (const q of room.queue.slice(room.index + 1)) {
              counts[q.genre] = (counts[q.genre] || 0) + 1
            }
            const options = Object.entries(counts).filter(([, c]) => c > 0).map(([g]) => g)
            if (!options.length) {
              hintLines.push(`[${pick.name}] 밴할 장르 없음 · 스킵`)
              continue
            }
            genrePick = options[pickRandomIndex(options.length)]
          }
          const result = await applyAugmentEffect(io, room, m, user, pick, targetId, genrePick).catch((err) => {
            console.error('[chaos_cast] apply failed', pick.effectType, err)
            return { ok: false as const, hint: null, chatText: null, silent: false }
          })
          if (!result.ok) {
            hintLines.push(`[${pick.name}] 적용 실패`)
            continue
          }
          if (result.hint) hintLines.push(result.hint)
          if (result.silent) {
            // 트루먼쇼 등: 전원 채팅 생략
          } else if (result.chatText && NEXT_ROUND_PUBLIC_AUGMENT_TYPES.has(pick.effectType)) {
            room.pendingAugmentNotices.push({
              startIndex: room.index + 1,
              userId: user.id,
              nickname: user.nickname,
              name: pick.name,
              effectType: pick.effectType,
              description: pick.description,
              imageUrl: pick.imageUrl || null,
              tier: pick.tier,
              message: result.chatText,
            })
            reservedChatLines.push(result.chatText)
          } else if (result.chatText && result.excludeNotifyUserId) {
            for (const other of room.members.values()) {
              if (other.userId === result.excludeNotifyUserId) continue
              io.to(other.socketId).emit('chat:message', {
                id: Date.now() + 18,
                userId: '',
                nickname: '시스템',
                text: result.chatText,
                system: true,
                at: Date.now(),
              })
            }
          } else if (result.chatText) {
            publicChatLines.push(result.chatText)
          }
          // 혹시 상태 전이가 있으면 추가 효과 중단
          if (room.status !== 'playing') break
        }
        const names = picks.map((p) => p.name).join(' · ')
        hint = `[혼돈] ${names}\n${hintLines.join('\n')}`
        const publicTail = publicChatLines.length ? `\n${publicChatLines.join(' / ')}` : ''
        chatText = `${user.nickname}님의 [혼돈]! → ${names}${publicTail}`
        // 예약형은 시전자에게만 별도 안내 (전원 채팅은 발동 시)
        if (reservedChatLines.length) {
          io.to(m.socketId).emit('chat:message', {
            id: Date.now() + 17,
            userId: '',
            nickname: '시스템',
            text: `예약 완료 · 다음 라운드에 발동합니다 (본인만 표시) — ${reservedChatLines.join(' / ')}`,
            system: true,
            at: Date.now(),
            augmentCard: {
              name: aug.name,
              description: aug.description,
              imageUrl: aug.imageUrl || null,
              tier: aug.tier,
            },
          })
        }
      } else if (aug.effectType === 'gaho_select') {
        const gahoId = payload?.gahoAugmentId
        if (!gahoId) return
        const all = await getEnabledAugments()
        const locked = m.gahoPickIds || []
        if (locked.length && !locked.includes(gahoId)) return
        const pick = all.find((a) => a.id === gahoId && a.tier === '가호')
        if (!pick) return
        const pickAug: AugmentLike = {
          name: pick.name,
          description: pick.description,
          effectType: pick.effectType,
          effectValue: pick.effectValue,
          imageUrl: pick.imageUrl,
          tier: pick.tier,
        }
        const result = await applyAugmentEffect(io, room, m, user, pickAug)
        if (!result.ok) return
        m.usedAugments.push(aug.name)
        m.usedAugments.push(pick.name)
        clearHeldAugment(m)
        usedCard = pickAug
        hint = result.hint
          ? `[가호선택] ${pick.name}\n${result.hint}`
          : `[가호선택] ${pick.name}`
        chatText = result.chatText
          || `${user.nickname}님이 [가호선택]으로 [${pick.name}]을(를) 골랐습니다`
      } else if (aug.effectType === 'tier_upgrade') {
        // 선택 시점에 이미 치환됨 — 혹시 남아 있으면 즉시 보관만 교체 (컷신·채팅 없이)
        const all = await getEnabledAugments()
        const pick = pickTierUpgradeTarget(all, {
          effectType: aug.effectType,
          effectValue: aug.effectValue,
          tier: aug.tier || 'bronze',
        }, m.usedAugments)
        if (!pick) return
        setHeldAugment(m, pick)
        io.to(room.id).emit('room:state', roomState(room))
        return
      } else {
        if (TARGET_AUGMENT_TYPES.has(aug.effectType)) {
          const hasTarget = aug.effectType === 'sakura_decoy'
            ? !!payload?.targetUserIds?.length
            : !!payload?.targetUserId
          if (!hasTarget) {
            // 불꽃남자: 혼자면 대상 없이 사용 가능
            if (!(aug.effectType === 'flame_kim' && playerCount(room) < 2)) return
          }
        }
        if (GENRE_AUGMENT_TYPES.has(aug.effectType)) {
          if (!payload?.genreName) return
        }
        let result: Awaited<ReturnType<typeof applyAugmentEffect>>
        try {
          result = await applyAugmentEffect(
            io,
            room,
            m,
            user,
            aug,
            payload?.targetUserId,
            payload?.genreName,
            payload?.targetUserIds,
          )
        } catch (err) {
          console.error('[augment:use] apply failed', aug.effectType, err)
          io.to(m.socketId).emit('augment:hint', {
            name: aug.name,
            hint: `[${aug.name}] 적용 중 오류가 발생했습니다`,
            durationMs: 0,
          })
          return
        }
        if (!result.ok) {
          if (result.hint) {
            io.to(m.socketId).emit('augment:hint', {
              name: aug.name,
              hint: result.hint,
              durationMs: 0,
            })
          }
          return
        }
        m.usedAugments.push(aug.name)
        // 조커뽑기 성공 시 이미 강탈한 증강으로 held가 교체됨 — clear하면 날아감
        const stoleHeld = aug.effectType === 'steal_held_augment'
          && !!m.heldAugmentId
          && m.heldAugmentName !== aug.name
        if (!stoleHeld && !result.keepHeld) clearHeldAugment(m)
        if (result.keepHeld) {
          // 넘어가요 등: usedAugments에 아직 넣지 않음 — 위에서 push한 것 되돌림
          m.usedAugments.pop()
        }
        if (stoleHeld) {
          usedCard = {
            name: m.heldAugmentName || aug.name,
            description: m.heldAugmentDescription || aug.description,
            effectType: m.heldAugmentEffectType || aug.effectType,
            effectValue: m.heldAugmentEffectValue,
            imageUrl: m.heldAugmentImageUrl,
            tier: m.heldAugmentTier || undefined,
          }
        }
        hint = result.hint
        if (result.chatText) chatText = result.chatText
        if (result.silent) silentUse = true
        if (result.excludeNotifyUserId) excludeNotifyUserId = result.excludeNotifyUserId
      }

      const deferPublicNotice = !silentUse
        && usedCard.tier !== '가호'
        && (usedCard.tier || '').toLowerCase() !== 'gaho'
        && NEXT_ROUND_PUBLIC_AUGMENT_TYPES.has(aug.effectType)
        && !!chatText
      if (deferPublicNotice) {
        room.pendingAugmentNotices.push({
          startIndex: room.index + 1,
          userId: user.id,
          nickname: user.nickname,
          name: usedCard.name,
          effectType: aug.effectType,
          description: usedCard.description,
          imageUrl: usedCard.imageUrl || null,
          tier: usedCard.tier,
          message: chatText!,
        })
      }

      const emitToWatchers = (
        event: string,
        payload: Record<string, unknown>,
        opts?: { includeCasterAlways?: boolean },
      ) => {
        if (silentUse) return
        if (deferPublicNotice) {
          io.to(m.socketId).emit(event, payload)
          return
        }
        if (!excludeNotifyUserId) {
          io.to(room.id).emit(event, payload)
          return
        }
        for (const other of room.members.values()) {
          if (other.userId === excludeNotifyUserId) continue
          io.to(other.socketId).emit(event, payload)
        }
        if (opts?.includeCasterAlways && user.id === excludeNotifyUserId) {
          io.to(m.socketId).emit(event, payload)
        }
      }

      emitToWatchers('augment:used', {
        userId: user.id,
        nickname: user.nickname,
        name: usedCard.name,
        description: usedCard.description,
        imageUrl: usedCard.imageUrl || null,
        tier: usedCard.tier,
        message: deferPublicNotice
          ? `예약 완료 · 다음 라운드에 발동합니다 (본인만 표시)\n${chatText}`
          : chatText || `${user.nickname}님이 [${usedCard.name}]을(를) 사용했습니다`,
      })
      if (hint) {
        io.to(m.socketId).emit('augment:hint', {
          name: usedCard.name,
          hint,
          durationMs: 0,
        })
      }
      io.to(room.id).emit('room:state', roomState(room))
      if (chatText) {
        emitToWatchers('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: deferPublicNotice
            ? `예약 완료 · 다음 라운드에 발동합니다 (본인만 표시) — ${chatText}`
            : chatText,
          system: true,
          at: Date.now(),
          ...(silentUse
            ? {}
            : {
                augmentCard: {
                  name: usedCard.name,
                  description: usedCard.description,
                  imageUrl: usedCard.imageUrl || null,
                  tier: usedCard.tier,
                },
              }),
        })
      }
    })

    socket.on('disconnect', () => leaveRoom(io, socket, user.id))
  })
}

function findRoomByUser(userId: string) {
  const id = userRoomId.get(userId)
  if (!id) return undefined
  return rooms.get(id)
}

function leaveRoom(io: Server, socket: Socket, userId: string) {
  const room = findRoomByUser(userId)
  if (!room) return
  const nickname = room.members.get(userId)?.nickname || '?'
  const pendingHit = !!(
    room.pendingDuel
    && (userId === room.pendingDuel.challengerId || userId === room.pendingDuel.opponentId)
  )
  const duelHit = !!(room.status === 'duel' && room.duel && isDuelParticipant(room, userId))

  room.members.delete(userId)
  userRoomId.delete(userId)
  socket.leave(room.id)
  if (room.members.size === 0) {
    clearTimer(room)
    room.duel = null
    room.pendingDuel = null
    room.duelStarting = false
    rooms.delete(room.id)
  } else {
    if (room.hostId === userId) {
      room.hostId = [...room.members.keys()][0]
    }
    if (pendingHit) {
      room.pendingDuel = null
      room.duelStarting = false
      room.pendingAugmentNotices = room.pendingAugmentNotices.filter(
        (notice) => notice.effectType !== 'yacha_duel',
      )
      io.to(room.id).emit('chat:message', {
        id: Date.now(),
        userId: '',
        nickname: '시스템',
        text: `야차룰 상대(${nickname})가 나가 예약이 취소되었습니다`,
        system: true,
        at: Date.now(),
      })
    }
    if (duelHit && room.duel) {
      io.to(room.id).emit('chat:message', {
        id: Date.now(),
        userId: '',
        nickname: '시스템',
        text: `${nickname}님이 나가 야차룰이 종료되었습니다`,
        system: true,
        at: Date.now(),
      })
      endDuel(io, room, 'resolved')
    } else {
      io.to(room.id).emit('room:state', roomState(room))
    }
  }
  io.emit('lobby:rooms', publicRooms())
}

function startDuelRound(io: Server, room: Room) {
  const duel = room.duel
  if (!duel || !duel.question?.slots?.length) {
    room.duel = null
    room.duelStarting = false
    if (rooms.has(room.id) && room.status !== 'ended' && room.members.size > 0) {
      startRound(io, room)
    }
    return
  }
  if (!room.members.has(duel.challengerId) || !room.members.has(duel.opponentId)) {
    room.duel = null
    room.duelStarting = false
    io.to(room.id).emit('chat:message', {
      id: Date.now(),
      userId: '',
      nickname: '시스템',
      text: '야차룰 상대가 없어 취소되었습니다',
      system: true,
      at: Date.now(),
    })
    if (rooms.has(room.id) && room.status !== 'ended' && room.members.size > 0) {
      startRound(io, room)
    }
    return
  }
  clearTimer(room)
  room.duelStarting = false
  room.status = 'duel'
  room.skipVotes = new Set()
  room.revealed = {}
  const q = duel.question
  const duration = 30
  room.roundDuration = duration
  room.roundStartedAt = Date.now()
  room.roundEndsAt = room.roundStartedAt + duration * 1000

  const publicSlots: SlotPublic[] = q.slots.map((s) => ({
    id: s.id,
    label: s.label,
    revealed: false,
    hidden: false,
    unlocked: true,
    chosung: s.chosung || '',
  }))

  const a = room.members.get(duel.challengerId)?.nickname || '?'
  const b = room.members.get(duel.opponentId)?.nickname || '?'

  const challenger = room.members.get(duel.challengerId)
  const opponent = room.members.get(duel.opponentId)
  if (challenger) {
    challenger.duelEarlyChosung = !!duel.casterEarlyChosung
  }
  if (opponent && duel.targetAudioDelaySec > 0) {
    opponent.audioDelayUntil = Date.now() + duel.targetAudioDelaySec * 1000
  }

  io.to(room.id).emit('round:start', {
    index: room.index,
    total: room.queue.length,
    endsAt: room.roundEndsAt,
    duration,
    genre: q.genre,
    hasHidden: q.slots.some((s) => s.hidden),
    youtubeUrl: q.youtubeUrl,
    startSec: q.startSec,
    endSec: q.endSec,
    titleChosung: q.titleChosung,
    artistChosung: '',
    slots: publicSlots,
    duel: true,
    duelLabel: duel.byName,
    duelPenalty: duel.penalty,
    duelChallenger: a,
    duelOpponent: b,
  })
  io.to(room.id).emit('augment:used', {
    userId: duel.challengerId,
    nickname: a,
    name: duel.byName,
    description: `${a} vs ${b} · 제목만 · 패자 −${duel.penalty}`,
    imageUrl: null,
    tier: 'gold',
    message: `야차룰! ${a} vs ${b} · 시전자 초성 선공개 · 대상 ${duel.targetAudioDelaySec}초 노래 지연`,
  })
  io.to(room.id).emit('room:state', roomState(room))
  io.to(room.id).emit('chat:message', {
    id: Date.now(),
    userId: '',
    nickname: '시스템',
    text: `야차룰! ${a} vs ${b} · 제목만 · 먼저 못 맞히면 −${duel.penalty}점 · ${a} 초성 선공개 · ${b} ${duel.targetAudioDelaySec}초 지연`,
    system: true,
    at: Date.now(),
  })
  room.timer = setTimeout(() => endDuel(io, room, 'timeout'), duration * 1000)
}

/** 야차룰 종료 후 원래 곡·진행도 이어서 재개 */
function endDuel(io: Server, room: Room, reason: 'resolved' | 'timeout') {
  if (room.status !== 'duel' || !room.duel) return
  clearTimer(room)
  const duel = room.duel
  const q = duel.question

  if (reason === 'timeout') {
    // 둘 다 못 맞춤 → 둘 다 −penalty
    for (const id of [duel.challengerId, duel.opponentId]) {
      const m = room.members.get(id)
      if (m) m.score -= duel.penalty
    }
    io.to(room.id).emit('chat:message', {
      id: Date.now(),
      userId: '',
      nickname: '시스템',
      text: `야차룰 시간 종료! 둘 다 −${duel.penalty}점`,
      system: true,
      at: Date.now(),
    })
  }

  const reveal = q?.slots?.length
    ? buildRevealSlots(room, q, reason === 'timeout' ? 'timeout' : 'cleared')
    : []

  room.status = 'revealing'
  io.to(room.id).emit('round:reveal', { reason: reason === 'timeout' ? 'timeout' : 'cleared', slots: reveal, pauseSec: 3 })
  io.to(room.id).emit('room:state', roomState(room))

  const resumeIndex = duel.resumeIndex
  const savedRevealed = duel.savedRevealed
  const savedRemainingMs = duel.savedRemainingMs
  const savedRiskyBust = duel.savedRiskyBust
  const savedWagerSettled = duel.savedWagerSettled
  for (const id of [duel.challengerId, duel.opponentId]) {
    const m = room.members.get(id)
    if (!m) continue
    m.duelEarlyChosung = false
    m.audioDelayUntil = null
  }
  room.duel = null
  room.duelStarting = false
  room.index = resumeIndex
  room.timer = setTimeout(() => {
    if (!rooms.has(room.id) || room.members.size === 0 || room.status === 'ended') return
    if (room.duel || room.duelStarting) return
    resumeMainRoundAfterDuel(io, room, {
      revealed: savedRevealed,
      remainingMs: savedRemainingMs,
      riskyBust: savedRiskyBust,
      wagerSettled: savedWagerSettled,
    })
  }, 3000)
}

/** 야차 종료 후 본게임 라운드를 정답 진행도 유지한 채 재개 */
function resumeMainRoundAfterDuel(
  io: Server,
  room: Room,
  saved: {
    revealed: Record<string, {
      answer: string
      by: string
      userId: string
      at?: number
      points?: number
      wagerPts?: number
    }>
    remainingMs: number
    riskyBust: Set<string>
    wagerSettled: Set<string>
  },
) {
  clearTimer(room)
  if (room.index >= room.queue.length) {
    forceSettleTrumanIllusions(io, room)
    forceSettleAnswerProxies(io, room)
    room.status = 'ended'
    io.to(room.id).emit('game:end', {
      results: playerMembers(room)
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }

  // 증강 타이밍이면 그쪽 우선 (20곡마다 · 시작 제외)
  if (shouldOfferAugment(room)) {
    startRound(io, room)
    return
  }

  const q = room.queue[room.index]
  if (!q) {
    room.status = 'ended'
    io.to(room.id).emit('room:state', roomState(room))
    return
  }

  room.status = 'playing'
  room.skipVotes = new Set()
  room.revealed = { ...saved.revealed }
  room.riskyBustApplied = new Set(saved.riskyBust)
  room.wagerSettled = new Set(saved.wagerSettled)
  room.followAnswerWindow = {}
  room.followAnswerClaimed = {}
  room.lateAnswerClaimed = {}

  const remainingSec = Math.max(10, Math.ceil(saved.remainingMs / 1000))
  const duration = Math.max(remainingSec, 10)
  room.roundDuration = duration
  room.roundStartedAt = Date.now()
  room.roundEndsAt = room.roundStartedAt + duration * 1000

  const publicSlots: SlotPublic[] = q.slots.map((s) => {
    const rev = room.revealed[s.id]
    const openDone = q.slots.filter((x) => !x.hidden).every((x) => room.revealed[x.id])
    return {
      id: s.id,
      label: s.hidden ? (openDone || rev ? s.label : '히든') : s.label,
      revealed: !!rev,
      answer: rev?.answer,
      by: rev?.by,
      hidden: s.hidden,
      unlocked: !s.hidden || openDone || !!rev,
      chosung: s.chosung || '',
    }
  })

  void prepareTrumanRoundAudio(room).then(() => {
    if (room.status !== 'playing' || room.queue[room.index] !== q) return
    io.to(room.id).emit('round:start', {
      index: room.index,
      total: room.queue.length,
      endsAt: room.roundEndsAt,
      duration,
      genre: q.genre,
      hasHidden: q.slots.some((s) => s.hidden),
      youtubeUrl: q.youtubeUrl,
      startSec: q.startSec,
      endSec: q.endSec,
      titleChosung: q.titleChosung,
      artistChosung: q.artistChosung,
      slots: publicSlots,
    })
    io.to(room.id).emit('round:skip_update', { votes: 0, need: skipVotesNeeded(playerCount(room)) })
    for (const m of room.members.values()) {
      if (isTrumanIllusion(m, room.index)) emitIllusionRound(io, m)
    }
    io.to(room.id).emit('room:state', roomState(room))
    applyRoundStartBuffs(io, room)
  })

  // 이미 전부 맞힌 상태면 바로 종료
  if (q.slots.every((s) => room.revealed[s.id])) {
    endRound(io, room, 'cleared')
    return
  }

  room.timer = setTimeout(() => endRound(io, room, 'timeout'), duration * 1000)
}

function startRound(io: Server, room: Room) {
  clearTimer(room)
  // 야차 진행/부팅 중이면 본게임 라운드 시작으로 덮어쓰지 않음
  if (room.status === 'duel' || room.duelStarting) return
  if (room.index >= room.queue.length) {
    forceSettleTrumanIllusions(io, room)
    forceSettleAnswerProxies(io, room)
    room.status = 'ended'
    io.to(room.id).emit('game:end', {
      results: playerMembers(room)
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }

  // 20문제마다 증강 (시작 제외 · 방 설정에서 끈 경우 스킵)
  if (shouldOfferAugment(room)) {
    room.lastAugmentAt = room.index
    room.status = 'augment'
    io.to(room.id).emit('room:state', roomState(room))
    augmentCache = null
    getEnabledAugments().then((list) => {
      if (room.status !== 'augment') return
      const lockedTier = pickRandomOfferTier(list)
      room.augmentOfferLockedTier = lockedTier
      room.augmentOfferEndsAt = Date.now() + 20_000
      for (const m of room.members.values()) {
        // 미사용 보관 증강 소멸(임시 규칙)
        clearHeldAugment(m)
        if (m.isSpectator) continue
        // 새 증강 페이즈 → 리롤 시야 초기화 (이전에 뜬 카드는 다시 가능, 사용 증강은 계속 제외)
        m.offerSeenAugmentIds = []
        m.lastOfferCandidateIds = []
        const shuffled = pickOfferCandidates(
          list,
          m.collectedPieces,
          3,
          lockedTier,
          { excludeNames: m.usedAugments },
        )
        rememberOfferSeen(m, shuffled)
        io.to(m.socketId).emit('augment:offer', {
          candidates: shuffled,
          timeoutSec: 20,
          endsAt: room.augmentOfferEndsAt,
          rerolls: 1,
          lockedTier,
        })
      }
      io.to(room.id).emit('room:state', roomState(room))
      // 20초 후 미선택자 → 지금 화면에 뜬 3장 중 균등 랜덤
      clearTimer(room)
      room.timer = setTimeout(async () => {
        if (room.status !== 'augment') return
        const all = await getEnabledAugments()
        const byId = new Map(all.map((a) => [a.id, a]))
        for (const m of room.members.values()) {
          if (m.isSpectator) continue
          if (m.heldAugmentId) continue
          const fromOffer = (m.lastOfferCandidateIds || [])
            .map((id) => byId.get(id))
            .filter((a): a is CachedAugment => !!a)
          const pick = fromOffer.length
            ? fromOffer[pickRandomIndex(fromOffer.length)]
            : pickRandomFromOfferPool(
              all,
              m.collectedPieces,
              room.augmentOfferLockedTier,
              { excludeNames: m.usedAugments },
            )
          if (pick) assignHeldFromOfferPick(m, all, pick)
        }
        finishAugmentIfReady(io, room)
      }, 20_000)
    })
    return
  }

  // 예약된 야차룰 → 이번 곡 시작 직전에 발동 (종료 후 이 인덱스 라운드 재개)
  if (room.pendingDuel && !room.duel) {
    const pending = room.pendingDuel
    room.duelStarting = true
    void (async () => {
      const failStart = (msg: string) => {
        room.duelStarting = false
        room.pendingDuel = null
        room.duel = null
        room.pendingAugmentNotices = room.pendingAugmentNotices.filter(
          (notice) => notice.effectType !== 'yacha_duel',
        )
        if (!rooms.has(room.id) || room.members.size === 0 || room.status === 'ended') return
        io.to(room.id).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: msg,
          system: true,
          at: Date.now(),
        })
        startRound(io, room)
      }
      try {
        // 퇴장 등으로 예약이 이미 취소된 경우
        if (room.pendingDuel !== pending) {
          room.duelStarting = false
          if (!room.duel && rooms.has(room.id) && room.status !== 'ended' && room.members.size > 0) {
            startRound(io, room)
          }
          return
        }
        if (!room.members.has(pending.challengerId) || !room.members.has(pending.opponentId)) {
          failStart('야차룰 상대가 없어 취소되었습니다')
          return
        }
        const question = await pickDuelQuestion(room)
        if (room.pendingDuel !== pending) {
          room.duelStarting = false
          if (!room.duel && rooms.has(room.id) && room.status !== 'ended' && room.members.size > 0) {
            startRound(io, room)
          }
          return
        }
        if (!question?.slots?.length) {
          failStart('야차룰에 쓸 노래를 찾지 못해 취소되었습니다')
          return
        }
        if (!rooms.has(room.id) || room.status === 'ended' || room.members.size === 0) {
          room.duelStarting = false
          room.pendingDuel = null
          return
        }
        if (room.duel) {
          room.duelStarting = false
          room.pendingDuel = null
          return
        }
        if (!room.members.has(pending.challengerId) || !room.members.has(pending.opponentId)) {
          failStart('야차룰 상대가 없어 취소되었습니다')
          return
        }
        room.pendingDuel = null
        room.duel = {
          challengerId: pending.challengerId,
          opponentId: pending.opponentId,
          question,
          penalty: pending.penalty,
          byName: pending.byName,
          casterEarlyChosung: pending.casterEarlyChosung !== false,
          targetAudioDelaySec: pending.targetAudioDelaySec > 0 ? pending.targetAudioDelaySec : 5,
          resumeIndex: room.index,
          savedRevealed: {},
          savedRemainingMs: 40_000,
          savedRiskyBust: new Set(),
          savedWagerSettled: new Set(),
        }
        flushPendingAugmentNotices(io, room)
        startDuelRound(io, room)
      } catch (err) {
        console.error('[yacha_duel] pending start failed', err)
        failStart('야차룰 시작 중 오류로 취소되었습니다')
      }
    })()
    return
  }

  room.status = 'playing'
  room.skipVotes = new Set()
  room.revealed = {}
  room.clearedHintSent = false
  room.riskyBustApplied = new Set()
  room.wagerSettled = new Set()
  room.followAnswerWindow = {}
  room.followAnswerClaimed = {}
  room.lateAnswerClaimed = {}
  for (const m of room.members.values()) {
    m.roundScoreGain = 0
  }
  const q = room.queue[room.index]
  if (!q) {
    forceSettleTrumanIllusions(io, room)
    forceSettleAnswerProxies(io, room)
    room.status = 'ended'
    io.to(room.id).emit('game:end', {
      results: playerMembers(room)
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }
  const duration = 40
  room.roundDuration = duration
  room.roundStartedAt = Date.now()
  room.roundEndsAt = room.roundStartedAt + duration * 1000

  const publicSlots: SlotPublic[] = q.slots.map((s) => ({
    id: s.id,
    label: s.hidden ? '히든' : s.label,
    revealed: false,
    hidden: s.hidden,
    unlocked: !s.hidden,
    chosung: s.chosung || '',
  }))

  void prepareTrumanRoundAudio(room).then(() => {
    if (room.status !== 'playing' || room.queue[room.index] !== q) return
    io.to(room.id).emit('round:start', {
      index: room.index,
      total: room.queue.length,
      endsAt: room.roundEndsAt,
      duration,
      genre: q.genre,
      hasHidden: q.slots.some((s) => s.hidden),
      youtubeUrl: q.youtubeUrl,
      startSec: q.startSec,
      endSec: q.endSec,
      titleChosung: q.titleChosung,
      artistChosung: q.artistChosung,
      slots: publicSlots,
    })
    io.to(room.id).emit('round:skip_update', { votes: 0, need: skipVotesNeeded(playerCount(room)) })
    for (const m of room.members.values()) {
      if (isTrumanIllusion(m, room.index)) emitIllusionRound(io, m)
    }
    io.to(room.id).emit('room:state', roomState(room))
    applyRoundStartBuffs(io, room)
  })

  room.timer = setTimeout(() => endRound(io, room, 'timeout'), duration * 1000)
}

function buildRevealSlots(room: Room, q: QuestionRuntime, reason: 'cleared' | 'skip' | 'timeout') {
  const openSlots = q.slots.filter((s) => !s.hidden)
  // 일반(제목·가수 등)을 전부 맞혀 히든이 등장한 뒤에만 히든 슬롯을 공개 대상에 포함
  const hiddenUnlocked = openSlots.length === 0 || openSlots.every((s) => room.revealed[s.id])
  const out: Array<{ id: string; label: string; answer: string; by: string | null }> = []
  for (const s of q.slots) {
    const alreadySolved = !!room.revealed[s.id]
    if (s.hidden && !hiddenUnlocked && !alreadySolved) {
      // 접근조차 못한 히든: 질문·정답 모두 공개하지 않음
      continue
    }
    let answer = s.answer
    // 히든이 열린 뒤 스킵/타임아웃이면 실답 대신 초성만
    if (
      s.hidden
      && hiddenUnlocked
      && !alreadySolved
      && (reason === 'skip' || reason === 'timeout')
    ) {
      answer = (s.chosung || '').trim() || hintChosung(s.answer) || '？？？'
    }
    out.push({
      id: s.id,
      label: s.hidden ? (s.label || '히든') : s.label,
      answer,
      by: room.revealed[s.id]?.by || null,
    })
  }
  return out
}

function endRound(io: Server, room: Room, reason: 'cleared' | 'skip' | 'timeout') {
  // reveal / 다음 라운드 대기 중 중복 endRound 방지 (스킵 연타로 곡이 여러 개 넘어가던 버그)
  if (room.status !== 'playing') return
  clearTimer(room)
  room.status = 'revealing'
  room.skipVotes = new Set()

  const q = room.queue[room.index]
  if (!q) {
    room.status = 'ended'
    forceSettleTrumanIllusions(io, room)
    forceSettleAnswerProxies(io, room)
    io.to(room.id).emit('game:end', {
      results: playerMembers(room)
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }
  settleWaterGhost(io, room)
  settleComboClear(io, room)
  settleGabukiMiss(io, room)
  // 한입만/맞췄죠?: 버프 tick 전에 실패 결산 (1R 버프가 tick으로 사라지면 패널티 누락)
  settleWagerAnswers(io, room)
  for (const m of room.members.values()) {
    tickBuffsAfterRound(io, room, m, room.index)
  }
  tickChatIsolate(room, room.index)
  settleAllAnswerProxies(io, room)

  const reveal = buildRevealSlots(room, q, reason)

  io.to(room.id).emit('round:reveal', { reason, slots: reveal, pauseSec: 3 })
  io.to(room.id).emit('round:skip_update', { votes: 0, need: skipVotesNeeded(playerCount(room)) })
  // 맞췄죠?/대리 결산 점수 즉시 반영
  io.to(room.id).emit('room:state', roomState(room))
  room.index += 1
  room.timer = setTimeout(() => startRound(io, room), 3000)
}

/** 라운드 시작 전 3-2-1 (증강 OFF 시작 · 증강 선택 직후 공통) */
function beginRoundCountdown(io: Server, room: Room) {
  if (room.status === 'duel' || room.duelStarting) return
  if (room.index >= room.queue.length) {
    forceSettleTrumanIllusions(io, room)
    forceSettleAnswerProxies(io, room)
    room.status = 'ended'
    io.to(room.id).emit('game:end', {
      results: playerMembers(room)
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }
  clearTimer(room)
  room.status = 'countdown'
  const q = room.queue[room.index]
  io.to(room.id).emit('room:state', roomState(room))
  io.to(room.id).emit('round:countdown', {
    seconds: 3,
    endsAt: Date.now() + 3000,
    preview: q
      ? {
          index: room.index,
          total: room.queue.length,
          genre: q.genre,
          hasHidden: q.slots.some((s) => s.hidden),
          youtubeUrl: q.youtubeUrl,
          startSec: q.startSec,
          endSec: q.endSec,
        }
      : null,
  })
  room.timer = setTimeout(() => {
    if (room.status !== 'countdown') return
    startRound(io, room)
  }, 3000)
}

async function finishAugmentIfReady(io: Server, room: Room) {
  // 중복 호출 방지 (전원 선택 동시 / 타임아웃 레이스)
  if (room.status !== 'augment') return
  const allPicked = playerMembers(room).every((x) => x.heldAugmentId)
  if (!allPicked) {
    io.to(room.id).emit('room:state', roomState(room))
    return
  }
  clearTimer(room)
  // 즉시 잠금 — await 중 재진입으로 라운드가 두 번 시작되지 않게
  room.status = 'countdown'

  // 카운트다운을 먼저 올려 클라가 멈추지 않게 한 뒤, 자동 증강 적용
  beginRoundCountdown(io, room)

  try {
    for (const m of room.members.values()) {
      if (!m.heldAugmentEffectType || !AUTO_APPLY_AUGMENT_TYPES.has(m.heldAugmentEffectType) || !m.heldAugmentName) continue
      const aug: AugmentLike = {
        name: m.heldAugmentName,
        description: m.heldAugmentDescription || '',
        effectType: m.heldAugmentEffectType,
        effectValue: m.heldAugmentEffectValue,
        imageUrl: m.heldAugmentImageUrl,
        tier: m.heldAugmentTier || undefined,
      }
      const result = await applyAugmentEffect(io, room, m, { id: m.userId, nickname: m.nickname }, aug)
      if (!result.ok) continue
      m.usedAugments.push(aug.name)
      clearHeldAugment(m)
      if (result.hint) {
        io.to(m.socketId).emit('augment:hint', {
          name: aug.name,
          hint: result.hint,
          durationMs: 0,
        })
      }
      io.to(room.id).emit('augment:used', {
        userId: m.userId,
        nickname: m.nickname,
        name: aug.name,
        description: aug.description,
        imageUrl: aug.imageUrl || null,
        tier: aug.tier,
        message: result.chatText || `${m.nickname}님이 [${aug.name}]을(를) 사용했습니다`,
      })
      io.to(room.id).emit('chat:message', {
        id: Date.now() + Math.floor(Math.random() * 100),
        userId: '',
        nickname: '시스템',
        text: result.chatText || `${m.nickname}님의 [${aug.name}]이(가) 자동 적용되었습니다`,
        system: true,
        at: Date.now(),
        augmentCard: {
          name: aug.name,
          description: aug.description,
          imageUrl: aug.imageUrl || null,
          tier: aug.tier,
        },
      })
    }
    io.to(room.id).emit('room:state', roomState(room))
  } catch (err) {
    console.error('[finishAugmentIfReady] auto-apply failed', err)
    io.to(room.id).emit('room:state', roomState(room))
  }
}
