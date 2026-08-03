import type { Server, Socket } from 'socket.io'
import { prisma } from './config.js'
import { verifyToken, type AuthUser } from './auth.js'
import { extractYoutubeId, normalizeAnswer, hintChosung, expandArtistAccepts, hangulToQwertyMistype, isAcceptedAnswer } from './answer.js'
import { parseTagsJson } from './tags.js'

type SlotPublic = {
  id: string
  label: string
  revealed: boolean
  hidden: boolean
  unlocked: boolean
  answer?: string
  by?: string
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
  /** 가호선택: 고정 3장 후보 (리롤 없음) */
  gahoPickIds: string[] | null
  activeBuffs: ActiveBuff[]
  /** 엄→준→식 등 다단계 수집 */
  collectedPieces: string[]
  /** 감옥 등: 다음 라운드부터 채팅/제출 금지 */
  chatMute: { startIndex: number; roundsLeft: number; byName: string; byNickname: string } | null
  /** 님아 매너좀: 라운드 시작 후 N초까지 제출 불가 */
  answerDelay: {
    startIndex: number
    roundsLeft: number
    delaySec: number
    byName: string
    byNickname: string
  } | null
  /** 예의바른청년: 답 끝에 suffix 필수 */
  politeSuffix: {
    startIndex: number
    roundsLeft: number
    suffix: string
    byName: string
    byNickname: string
  } | null
  /** 쉬었음청년: 정답 인정 불가 (채팅은 가능) */
  answerBlock: {
    startIndex: number
    roundsLeft: number
    byName: string
    byNickname: string
  } | null
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
  /** 트루먼쇼: 다른 곡 재생 + 정답 시 배율 */
  sakuraDecoy: {
    youtubeUrl: string
    startSec: number
    startIndex: number
    roundsLeft: number
    scoreMult: number
    byName: string
    byNickname: string
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
  members: Map<string, Member>
  status: 'lobby' | 'playing' | 'revealing' | 'augment' | 'countdown' | 'duel' | 'ended'
  queue: QuestionRuntime[]
  index: number
  roundEndsAt: number
  roundStartedAt: number
  roundDuration: number
  skipVotes: Set<string>
  revealed: Record<string, { answer: string; by: string; userId: string }>
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
  /** 야차룰 1v1 */
  duel: {
    challengerId: string
    opponentId: string
    question: QuestionRuntime
    penalty: number
    byName: string
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

function activeBuffsAt(m: Member, roundIndex: number) {
  return m.activeBuffs.filter((b) => buffApplies(b, roundIndex))
}

function tickBuffsAfterRound(m: Member, endedIndex: number) {
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
  if (m.sakuraDecoy && endedIndex >= m.sakuraDecoy.startIndex && m.sakuraDecoy.roundsLeft > 0) {
    m.sakuraDecoy.roundsLeft -= 1
    if (m.sakuraDecoy.roundsLeft <= 0) m.sakuraDecoy = null
  }
  if (m.flameKim && endedIndex >= m.flameKim.startIndex && m.flameKim.roundsLeft > 0) {
    m.flameKim.roundsLeft -= 1
    if (m.flameKim.roundsLeft <= 0) m.flameKim = null
  }
}

function isAnswerProxyActive(m: Member, roundIndex: number) {
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
function wagerBuffAt(m: Member, roundIndex: number) {
  return activeBuffsAt(m, roundIndex).find((b) => b.effectType === 'wager_answer') || null
}

/** 정답 즉시 성공 결산. 적용된 보너스 점수 반환 */
function tryResolveWagerWin(io: Server, room: Room, m: Member): number {
  if (room.wagerSettled.has(m.userId)) return 0
  const b = wagerBuffAt(m, room.index)
  if (!b) return 0
  const bonus = Number(b.effectValue.bonus)
  const winPts = Number.isFinite(bonus) ? bonus : 5
  room.wagerSettled.add(m.userId)
  m.score += winPts
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

/** 라운드 종료: 아직 성공 결산 안 된 맞췄죠? → 실패 패널티 */
function settleWagerAnswers(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (room.wagerSettled.has(m.userId)) continue
    const b = wagerBuffAt(m, room.index)
    if (!b) continue
    const penalty = Number(b.effectValue.penalty)
    const losePts = Number.isFinite(penalty) ? penalty : 5
    room.wagerSettled.add(m.userId)
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

function isGabukiActive(m: Member, roundIndex: number) {
  return !!(m.gabuki && roundIndex >= m.gabuki.startIndex && m.gabuki.roundsLeft > 0)
}

/** 가불기: 대상이 정답을 맞히면 시전자에게 hitPenalty 이전 */
function applyGabukiOnCorrect(io: Server, room: Room, victim: Member) {
  if (!isGabukiActive(victim, room.index) || !victim.gabuki) return
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
      ? `${victim.nickname}님의 [가불기]! −${amt} → ${caster.nickname}님 +${amt}`
      : `${victim.nickname}님의 [가불기]! −${amt}점`,
    system: true,
    at: Date.now(),
  })
  io.to(victim.socketId).emit('augment:hint', {
    name: g.byName,
    hint: `[가불기] 정답 · −${amt}점${caster ? ` → ${caster.nickname}` : ''}`,
    durationMs: 0,
  })
}

/** 가불기: 해당 라운드에 정답을 한 번도 못 맞히면 missPenalty 이전 */
function settleGabukiMiss(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (!isGabukiActive(m, room.index) || !m.gabuki) continue
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
        ? `${m.nickname}님의 [가불기] 미득점! −${amt} → ${caster.nickname}님 +${amt}`
        : `${m.nickname}님의 [가불기] 미득점! −${amt}점`,
      system: true,
      at: Date.now(),
    })
    io.to(m.socketId).emit('augment:hint', {
      name: g.byName,
      hint: `[가불기] 이번 라운드 정답 없음 · −${amt}점`,
      durationMs: 0,
    })
  }
}

/** 물귀신: 이번 라운드 점수를 전부 못 맞히면 맞춘 플레이어 각 −1 */
function settleWaterGhost(io: Server, room: Room) {
  const q = room.queue[room.index]
  if (!q || q.slots.length === 0) return

  for (const m of room.members.values()) {
    const b = activeBuffsAt(m, room.index).find((x) => x.effectType === 'water_ghost')
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
    const pen = Number.isFinite(penRaw) && penRaw > 0 ? Math.floor(penRaw) : 1
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
    io.to(room.id).emit('chat:message', {
      id: Date.now() + Math.floor(Math.random() * 100),
      userId: '',
      nickname: '시스템',
      text: `${m.nickname}님의 [${b.name}]! ${names.join('·')} −${pen}점`,
      system: true,
      at: Date.now(),
    })
    io.to(m.socketId).emit('augment:hint', {
      name: b.name,
      hint: `[${b.name}] 원정! 맞춘 플레이어 −${pen}`,
      durationMs: 0,
    })
  }
}

/** 콤보: 해당 라운드 전 슬롯을 본인이 맞히면 이번 라운드 득점만큼 추가(=×2) */
function settleComboClear(io: Server, room: Room) {
  const q = room.queue[room.index]
  if (!q || q.slots.length === 0) return

  for (const m of room.members.values()) {
    const b = activeBuffsAt(m, room.index).find((x) => x.effectType === 'combo_clear_double')
    if (!b) continue
    const gotAll = q.slots.every((s) => room.revealed[s.id]?.userId === m.userId)
    if (!gotAll) {
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: `[${b.name}] 콤보 실패 (전부 맞히지 못함)`,
        durationMs: 0,
      })
      continue
    }
    const earned = Math.max(0, Math.floor(m.roundScoreGain))
    if (earned <= 0) {
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: `[${b.name}] 전부 맞춤 · 추가 배율 점수 없음`,
        durationMs: 0,
      })
      continue
    }
    m.score += earned
    io.to(room.id).emit('chat:message', {
      id: Date.now() + Math.floor(Math.random() * 100),
      userId: '',
      nickname: '시스템',
      text: `${m.nickname}님의 [${b.name}]! 전부 정답 · 라운드 점수 ×2 (+${earned})`,
      system: true,
      at: Date.now(),
    })
    io.to(m.socketId).emit('augment:hint', {
      name: b.name,
      hint: `[${b.name}] 콤보! 라운드 점수 ×2 (+${earned})`,
      durationMs: 0,
    })
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

/** 대상이 득점했을 때 대리 시전자들에게 적립 */
function bankAnswerProxyPoints(io: Server, room: Room, targetUserId: string, gain: number) {
  if (gain <= 0) return
  for (const m of room.members.values()) {
    if (!isAnswerProxyActive(m, room.index)) continue
    if (m.answerProxy!.targetUserId !== targetUserId) continue
    m.answerProxy!.pendingScore += gain
    io.to(m.socketId).emit('augment:hint', {
      name: m.answerProxy!.byName,
      hint: `[${m.answerProxy!.byName}] 대리 적립 +${gain} (누적 ${m.answerProxy!.pendingScore})`,
      durationMs: 2500,
    })
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
    hint: `[${mark.byName}] 정답! 다음 라운드는 수면(정답 불가)`,
    durationMs: 0,
  })
  io.to(room.id).emit('chat:message', {
    id: Date.now() + 8,
    userId: '',
    nickname: '시스템',
    text: `${m.nickname}님 [${mark.byName}] 발동! 다음 라운드 수면(정답 불가)`,
    system: true,
    at: Date.now(),
  })
}

function isChatMuted(m: Member, roundIndex: number) {
  return !!(m.chatMute && roundIndex >= m.chatMute.startIndex && m.chatMute.roundsLeft > 0)
}

function isAnswerDelayActive(m: Member, roundIndex: number) {
  return !!(m.answerDelay && roundIndex >= m.answerDelay.startIndex && m.answerDelay.roundsLeft > 0)
}

function isPoliteSuffixActive(m: Member, roundIndex: number) {
  return !!(m.politeSuffix && roundIndex >= m.politeSuffix.startIndex && m.politeSuffix.roundsLeft > 0)
}

function isAnswerBlocked(m: Member, roundIndex: number) {
  if (m.answerBlock && roundIndex >= m.answerBlock.startIndex && m.answerBlock.roundsLeft > 0) return true
  return activeBuffsAt(m, roundIndex).some((b) => b.effectType === 'know_but_cant')
}

function knowButCantBuff(m: Member, roundIndex: number) {
  return activeBuffsAt(m, roundIndex).find((b) => b.effectType === 'know_but_cant') || null
}

function knowButCantPending(m: Member, roundIndex: number) {
  return m.activeBuffs.find((b) => b.effectType === 'know_but_cant' && roundIndex < b.startIndex) || null
}

function answerBlockPublic(m: Member, roundIndex: number) {
  const classicActive = !!(m.answerBlock && roundIndex >= m.answerBlock.startIndex && m.answerBlock.roundsLeft > 0)
  const classicPending = !!(m.answerBlock && roundIndex < m.answerBlock.startIndex)
  const know = knowButCantBuff(m, roundIndex)
  const knowPend = knowButCantPending(m, roundIndex)
  return {
    answerBlocked: classicActive || !!know,
    answerBlockPending: classicPending || !!knowPend,
    answerBlockRoundsLeft: classicActive
      ? m.answerBlock!.roundsLeft
      : know
        ? know.roundsLeft
        : classicPending
          ? m.answerBlock!.roundsLeft
          : knowPend?.roundsLeft ?? null,
    answerBlockBy: classicActive || classicPending
      ? (m.answerBlock!.byName || null)
      : (know?.name || knowPend?.name || null),
  }
}

function isGameGenre(genre: string) {
  const g = (genre || '').toLowerCase()
  return g.includes('메이플') || g.includes('리겜') || g.includes('게임')
}

function answerDelayRemainingMs(room: Room, m: Member): number {
  if (!isAnswerDelayActive(m, room.index) || !m.answerDelay) return 0
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

function answerScoreFor(m: Member, roundIndex: number) {
  let mult = 1
  for (const b of activeBuffsAt(m, roundIndex)) {
    if (
      b.effectType === 'score_mult'
      || b.effectType === 'score_mult_no_hint'
      || b.effectType === 'score_mult_hint_only'
      || b.effectType === 'score_mult_risky'
    ) {
      const n = Number(b.effectValue.mult)
      if (Number.isFinite(n) && n > mult) mult = n
    }
  }
  if (isSakuraDecoyActive(m, roundIndex)) {
    const n = m.sakuraDecoy!.scoreMult
    if (Number.isFinite(n) && n > mult) mult = n
  }
  return Math.max(1, Math.floor(mult))
}

function hasRiskyDouble(m: Member, roundIndex: number) {
  return activeBuffsAt(m, roundIndex).some((b) => b.effectType === 'score_mult_risky')
}

function hasHiddenRun(m: Member, roundIndex: number) {
  return activeBuffsAt(m, roundIndex).some((b) => b.effectType === 'hidden_run')
}

/** 히든런: 일반 슬롯 0점, 히든만 ×mult */
function hiddenRunGainForAnswer(
  m: Member,
  roundIndex: number,
  slotHidden: boolean,
  baseGain: number,
): number {
  if (!hasHiddenRun(m, roundIndex)) return baseGain
  if (!slotHidden) return 0
  const buff = activeBuffsAt(m, roundIndex).find((b) => b.effectType === 'hidden_run')
  const n = Number(buff?.effectValue.mult)
  return Math.max(1, Math.floor(Number.isFinite(n) ? n : 3))
}

function isTitleLikeLabel(label: string) {
  return label.includes('제목') || label.includes('게임')
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
    || q.slots.find((s) => !s.hidden && !s.label.includes('가수'))
    || null
}

function findArtistSlots(q: QuestionRuntime) {
  return q.slots.filter((s) => !s.hidden && s.label.includes('가수'))
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
  if (!hasRiskyDouble(m, room.index)) return baseGain
  const titleSlot = findTitleSlot(q)
  if (!titleSlot) return baseGain
  const titleRev = room.revealed[titleSlot.id]
  if (!titleRev || titleRev.userId === userId) return baseGain
  return -1
}

function isSakuraDecoyActive(m: Member, roundIndex: number) {
  return !!(m.sakuraDecoy && roundIndex >= m.sakuraDecoy.startIndex && m.sakuraDecoy.roundsLeft > 0)
}

function isFlameKimActive(m: Member, roundIndex: number) {
  return !!(m.flameKim && roundIndex >= m.flameKim.startIndex && m.flameKim.roundsLeft > 0)
}

/** 방 노래와 분리된 증강 트릭 오디오 (클라 이중 플레이어용) */
function resolveAudioTrick(m: Member, room: Room): {
  mode: 'replace' | 'overlay'
  youtubeUrl: string
  startSec: number
  label: string
  source: 'mud' | 'sakura' | 'flame'
} | null {
  if (room.status === 'duel') return null
  for (const b of activeBuffsAt(m, room.index)) {
    if (b.effectType !== 'mud_fight') continue
    const youtubeUrl = String(b.effectValue.bgmUrl || b.effectValue.youtubeUrl || '').trim()
    if (!youtubeUrl) continue
    const startRaw = Number(b.effectValue.bgmStartSec)
    return {
      mode: 'replace',
      youtubeUrl,
      startSec: Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0,
      label: b.name || '진흙탕 싸움',
      source: 'mud',
    }
  }
  // 세노·트루먼·에라모르겠다 등: 대상에게 강제곡 (방 곡 대체)
  if (isSakuraDecoyActive(m, room.index) && m.sakuraDecoy) {
    return {
      mode: 'replace',
      youtubeUrl: m.sakuraDecoy.youtubeUrl,
      startSec: m.sakuraDecoy.startSec,
      label: m.sakuraDecoy.byName || '다른 곡',
      source: 'sakura',
    }
  }
  // 불꽃남자: 방 곡 + 트릭 곡 오버레이
  if (isFlameKimActive(m, room.index) && m.flameKim) {
    return {
      mode: 'overlay',
      youtubeUrl: m.flameKim.youtubeUrl,
      startSec: m.flameKim.startSec,
      label: m.flameKim.byName || '불꽃남자김상원',
      source: 'flame',
    }
  }
  return null
}

/** 불꽃남자김상원: 시전자 정답 시 대상 점수 감소 (시전자 본인 득점은 그대로) */
function applyFlameKimOnCorrect(io: Server, room: Room, caster: Member) {
  if (!isFlameKimActive(caster, room.index) || !caster.flameKim) return
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

async function pickDecoyTrack(room: Room): Promise<{ youtubeUrl: string; startSec: number } | null> {
  // 트루먼쇼: 이번 판 큐에 없는 문제은행 곡만 (이미 나온/나올 곡 반복 방지)
  const usedIds = new Set(room.queue.map((q) => q.id))
  const usedYt = new Set(
    room.queue
      .map((q) => extractYoutubeId(q.youtubeUrl))
      .filter((id): id is string => !!id),
  )
  const list = await prisma.question.findMany({ where: { enabled: true } })
  const unused = list.filter((q) => {
    if (usedIds.has(q.id)) return false
    const yt = extractYoutubeId(q.youtubeUrl)
    if (yt && usedYt.has(yt)) return false
    return true
  })
  const pool = unused.length
    ? unused
    : list.filter((q) => {
        const yt = extractYoutubeId(q.youtubeUrl)
        const cur = room.queue[room.index]
        const curYt = cur ? extractYoutubeId(cur.youtubeUrl) : null
        return !!yt && yt !== curYt
      })
  if (!pool.length) return null
  const q = pool[Math.floor(Math.random() * pool.length)]
  return { youtubeUrl: q.youtubeUrl, startSec: q.startSec }
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

/** 야차룰: 큐에 없는 새 곡 · 제목 슬롯만 */
async function pickDuelQuestion(room: Room): Promise<QuestionRuntime | null> {
  const excludeIds = new Set(room.queue.map((q) => q.id))
  const currentYt = room.queue[room.index] ? extractYoutubeId(room.queue[room.index].youtubeUrl) : null
  const list = await prisma.question.findMany({
    where: { enabled: true },
    include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
  })
  const preferred = list.filter((q) => !excludeIds.has(q.id) && extractYoutubeId(q.youtubeUrl) !== currentYt)
  const pool = (preferred.length ? preferred : list.filter((q) => extractYoutubeId(q.youtubeUrl) !== currentYt))
    .slice()
    .sort(() => Math.random() - 0.5)
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
}

function playbackRateFor(m: Member, roundIndex: number): number | null {
  for (const b of activeBuffsAt(m, roundIndex)) {
    if (b.effectType === 'slow_playback') {
      const r = Number(b.effectValue.rate)
      if (Number.isFinite(r) && r > 0) return r
    }
  }
  return null
}

function slowStarterDelaySec(m: Member, roundIndex: number): number | null {
  const b = activeBuffsAt(m, roundIndex).find((x) => x.effectType === 'slow_starter')
  if (!b) return null
  const n = Number(b.effectValue.delaySec)
  return Number.isFinite(n) && n > 0 ? n : 7
}

function slowStarterBonus(m: Member, roundIndex: number): number {
  const b = activeBuffsAt(m, roundIndex).find((x) => x.effectType === 'slow_starter')
  if (!b) return 0
  const n = Number(b.effectValue.bonus)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

/** 보너스 타임: 남이 맞힌 뒤 windowMs 안에 같은 답을 치면 추가 인정 */
function hasFollowAnswer(m: Member, roundIndex: number) {
  return activeBuffsAt(m, roundIndex).some((b) => b.effectType === 'follow_answer')
}

function followAnswerWindowMsForRoom(room: Room): number {
  let ms = 2000
  for (const m of room.members.values()) {
    for (const b of activeBuffsAt(m, room.index)) {
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
  if (![...room.members.values()].some((m) => hasFollowAnswer(m, room.index))) return
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

/** 보너스 타임 등: 정답 시 추가 점수 */
function scoreBonusFor(m: Member, roundIndex: number): number {
  let extra = 0
  for (const b of activeBuffsAt(m, roundIndex)) {
    if (b.effectType !== 'score_bonus' && b.effectType !== 'mud_fight') continue
    const n = Number(b.effectValue.bonus)
    if (Number.isFinite(n) && n > 0) extra += Math.floor(n)
  }
  return extra
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

function formatSlotAnswers(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .map((s) => `${s.hidden ? (s.label || '히든') : s.label}: ${s.answer}`)
    .join(' / ')
}

/** 제목·가수만 (나이거 뭔지 알아) */
function formatTitleArtistAnswers(q: QuestionRuntime) {
  const parts: string[] = []
  const title = findTitleSlot(q)
  if (title) parts.push(`제목: ${title.answer}`)
  for (const artist of findArtistSlots(q)) {
    parts.push(`가수: ${artist.answer}`)
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

/** 제목/가수 라벨 없이 답만 (타이핑 공개용) */
function formatSlotAnswersPlain(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .map((s) => stripParenHint(s.answer))
    .filter(Boolean)
    .join('\n')
}

/** 일론 머스크의 가호: 외계인 영타 표기 */
function formatAlienQwertyAnswers(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .map((s) => `${s.hidden ? (s.label || '히든') : s.label}: ${hangulToQwertyMistype(s.answer)}`)
    .join(' / ')
}

function alienQwertyBuff(m: Member, roundIndex: number) {
  return activeBuffsAt(m, roundIndex).find((b) => b.effectType === 'alien_qwerty_answer') || null
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
): Member {
  return {
    userId,
    nickname,
    avatarUrl,
    ready: false,
    score: 0,
    socketId,
    heldAugmentId: null,
    heldAugmentName: null,
    heldAugmentDescription: null,
    heldAugmentImageUrl: null,
    heldAugmentEffectType: null,
    heldAugmentEffectValue: null,
    heldAugmentTier: null,
    usedAugments: [],
    offerSeenAugmentIds: [],
    gahoPickIds: null,
    activeBuffs: [],
    collectedPieces: [],
    chatMute: null,
    answerDelay: null,
    politeSuffix: null,
    answerBlock: null,
    accuseMark: null,
    gabuki: null,
    answerProxy: null,
    sakuraDecoy: null,
    flameKim: null,
    songMuteUntil: null,
    roundScoreGain: 0,
  }
}

/** 선택 화면용 — 설명 숨김 (게임 중 사용 버튼 호버에서만 공개) */
function toOfferAugment(a: {
  id: string
  name: string
  effectType: string
  tier: string
  imageUrl?: string | null
}) {
  return {
    id: a.id,
    name: a.name,
    effectType: a.effectType,
    tier: a.tier,
    imageUrl: a.imageUrl || null,
  }
}

/** 가호선택 후보 3장 (설명 없음 · 리롤 없음) */
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

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

function pickRandomOfferTier(
  list: Array<{ tier: string }>,
): OfferTier {
  const available = (['bronze', 'silver', 'gold'] as const).filter((t) =>
    list.some((a) => a.tier === t),
  )
  if (!available.length) return 'bronze'
  return available[Math.floor(Math.random() * available.length)]
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
  const pool = filterOfferPool(list, collectedPieces, lockedTier, opts)
  const picked: typeof pool = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()

  for (const a of shuffleArray(pool)) {
    if (seenIds.has(a.id) || seenNames.has(a.name)) continue
    seenIds.add(a.id)
    seenNames.add(a.name)
    picked.push(a)
    if (picked.length >= count) break
  }
  // 이름 중복 피하느라 부족하면 id만 유니크로 채움
  if (picked.length < count) {
    for (const a of shuffleArray(pool)) {
      if (seenIds.has(a.id)) continue
      seenIds.add(a.id)
      picked.push(a)
      if (picked.length >= count) break
    }
  }
  return picked.map(toOfferAugment)
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
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)]
  const nonGaho = list.filter((a) => a.tier !== '가호')
  return nonGaho[Math.floor(Math.random() * nonGaho.length)]
    || list[Math.floor(Math.random() * list.length)]
}

/** 오퍼에 띄운 후보 id를 이번 페이즈 시야에 기록 (리롤 제외용) */
function rememberOfferSeen(m: Member, candidates: Array<{ id: string }>) {
  const set = new Set(m.offerSeenAugmentIds)
  for (const c of candidates) set.add(c.id)
  m.offerSeenAugmentIds = [...set]
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
  return finalPool[Math.floor(Math.random() * finalPool.length)]
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
      : pickPool[Math.floor(Math.random() * pickPool.length)]
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
    }))
}

function roomState(room: Room) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    status: room.status,
    maxPlayers: room.maxPlayers,
    genreCounts: room.genreCounts,
    genreBankCounts: room.genreBankCounts || {},
    upcomingGenreCounts: (() => {
      const counts: Record<string, number> = {}
      for (const q of room.queue.slice(room.index + 1)) {
        counts[q.genre] = (counts[q.genre] || 0) + 1
      }
      return counts
    })(),
    members: [...room.members.values()].map((m) => {
      const block = answerBlockPublic(m, room.index)
      const spoilQ = room.queue[room.index]
      const spoilActive = !!(spoilQ && room.status !== 'duel' && knowButCantBuff(m, room.index))
      const alienActive = !!(spoilQ && room.status !== 'duel' && !spoilActive && alienQwertyBuff(m, room.index))
      return {
      userId: m.userId,
      nickname: m.nickname,
      avatarUrl: m.avatarUrl,
      ready: m.ready,
      score: m.score,
      isHost: m.userId === room.hostId,
      heldAugmentId: m.heldAugmentId,
      heldAugmentName: m.heldAugmentName,
      heldAugmentDescription: m.heldAugmentDescription,
      heldAugmentImageUrl: m.heldAugmentImageUrl,
      heldAugmentEffectType: m.heldAugmentEffectType,
      heldAugmentTier: m.heldAugmentTier,
      usedAugments: m.usedAugments,
      chatMuted: isChatMuted(m, room.index),
      chatMutePending: !!(m.chatMute && room.index < m.chatMute.startIndex),
      chatMuteBy: m.chatMute?.byName || null,
      chatMuteByNickname: m.chatMute?.byNickname || null,
      chatMuteStartIndex: m.chatMute?.startIndex ?? null,
      answerDelayed: answerDelayRemainingMs(room, m) > 0,
      answerDelaySec: isAnswerDelayActive(m, room.index) ? m.answerDelay!.delaySec : null,
      answerDelayUnlockAt: isAnswerDelayActive(m, room.index)
        ? room.roundStartedAt + m.answerDelay!.delaySec * 1000
        : null,
      answerDelayPending: !!(m.answerDelay && room.index < m.answerDelay.startIndex),
      answerDelayRoundsLeft: m.answerDelay?.roundsLeft ?? null,
      answerDelayBy: m.answerDelay?.byName || null,
      politeActive: isPoliteSuffixActive(m, room.index),
      politePending: !!(m.politeSuffix && room.index < m.politeSuffix.startIndex),
      politeSuffix: isPoliteSuffixActive(m, room.index) ? m.politeSuffix!.suffix : null,
      politeRoundsLeft: m.politeSuffix?.roundsLeft ?? null,
      politeBy: m.politeSuffix?.byName || null,
      answerBlocked: block.answerBlocked,
      answerBlockPending: block.answerBlockPending,
      answerBlockRoundsLeft: block.answerBlockRoundsLeft,
      answerBlockBy: block.answerBlockBy,
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
      alienQwertyActive: alienActive,
      accuseWatchPending: !!(m.accuseMark && room.index < m.accuseMark.watchIndex),
      accuseWatchActive: !!(m.accuseMark && room.index === m.accuseMark.watchIndex),
      accuseWatchBy: m.accuseMark?.byName || null,
      gabukiActive: isGabukiActive(m, room.index),
      gabukiPending: !!(m.gabuki && room.index < m.gabuki.startIndex),
      gabukiRoundsLeft: m.gabuki?.roundsLeft ?? null,
      gabukiBy: m.gabuki?.byName || null,
      playbackRate: room.status === 'duel' ? 1 : playbackRateFor(m, room.index),
      audioDelaySec: room.status === 'duel' ? null : slowStarterDelaySec(m, room.index),
      audioDelayUntil: (() => {
        if (room.status === 'duel') return null
        const d = slowStarterDelaySec(m, room.index)
        return d != null ? room.roundStartedAt + d * 1000 : null
      })(),
      songMuteUntil: m.songMuteUntil && m.songMuteUntil > Date.now() ? m.songMuteUntil : null,
      /** 방 노래와 분리된 트릭 오디오 · mode=replace면 방 곡 음소거, overlay면 동시 재생 */
      audioTrick: resolveAudioTrick(m, room),
      decoyYoutubeUrl: (() => {
        if (room.status === 'duel') return null
        if (isSakuraDecoyActive(m, room.index)) return m.sakuraDecoy!.youtubeUrl
        if (isFlameKimActive(m, room.index)) return m.flameKim!.youtubeUrl
        return null
      })(),
      decoyStartSec: (() => {
        if (room.status === 'duel') return null
        if (isSakuraDecoyActive(m, room.index)) return m.sakuraDecoy!.startSec
        if (isFlameKimActive(m, room.index)) return m.flameKim!.startSec
        return null
      })(),
      sakuraActive: room.status === 'duel' ? false : isSakuraDecoyActive(m, room.index),
      sakuraScoreMult: room.status === 'duel' ? null : (isSakuraDecoyActive(m, room.index) ? m.sakuraDecoy!.scoreMult : null),
      sakuraBy: room.status === 'duel' ? null : (isSakuraDecoyActive(m, room.index) ? m.sakuraDecoy!.byName : null),
      flameKimActive: room.status === 'duel' ? false : isFlameKimActive(m, room.index),
      flameKimPending: !!(m.flameKim && room.index < m.flameKim.startIndex),
      flameKimRoundsLeft: m.flameKim?.roundsLeft ?? null,
      flameKimTarget: m.flameKim?.targetNickname || null,
      flameKimBy: m.flameKim?.byName || null,
      answerProxyActive: isAnswerProxyActive(m, room.index)
        || !!(m.answerProxy && room.index < m.answerProxy.startIndex),
      answerProxyPending: !!(m.answerProxy && room.index < m.answerProxy.startIndex),
      answerProxyPendingScore: m.answerProxy?.pendingScore ?? 0,
      answerProxyRoundsLeft: m.answerProxy?.roundsLeft ?? null,
      activeBuffs: m.activeBuffs.map((b) => {
        const multRaw = Number(b.effectValue.mult)
        const rateRaw = Number(b.effectValue.rate)
        const bgmUrl = String(b.effectValue.bgmUrl || '').trim() || null
        const bgmStartRaw = Number(b.effectValue.bgmStartSec)
        return {
          name: b.name,
          description: b.description,
          effectType: b.effectType,
          imageUrl: b.imageUrl || null,
          usedByNickname: b.usedByNickname,
          mult: Number.isFinite(multRaw) && multRaw > 1 ? multRaw : null,
          rate: Number.isFinite(rateRaw) && rateRaw > 0 && rateRaw !== 1 ? rateRaw : null,
          bgmUrl: buffApplies(b, room.index) ? bgmUrl : null,
          bgmStartSec: buffApplies(b, room.index) && Number.isFinite(bgmStartRaw) && bgmStartRaw >= 0
            ? Math.floor(bgmStartRaw)
            : null,
          startIndex: b.startIndex,
          roundsLeft: b.roundsLeft,
          pending: room.index < b.startIndex,
          active: buffApplies(b, room.index),
        }
      }),
    }
    }),
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
  for (const g of genres) out[g.name] = byId.get(g.id) || 0
  return out
}

async function clampGenreCounts(counts: Record<string, number>): Promise<Record<string, number>> {
  const bank = await loadGenreBankCounts()
  const out: Record<string, number> = {}
  for (const [name, n] of Object.entries(counts || {})) {
    const max = bank[name] ?? 0
    const v = Math.max(0, Math.min(max, Math.floor(Number(n) || 0)))
    if (v > 0 || name in bank) out[name] = v
  }
  for (const name of Object.keys(bank)) {
    if (out[name] == null) out[name] = 0
  }
  return out
}

async function pickQuestions(genreCounts: Record<string, number>): Promise<QuestionRuntime[]> {
  const out: QuestionRuntime[] = []
  const usedIds = new Set<string>()
  const usedYt = new Set<string>()

  const entries = Object.entries(genreCounts).filter(([, count]) => count > 0)
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
    const shuffled = row.list.sort(() => Math.random() - 0.5)
    let picked = 0
    for (const q of shuffled) {
      if (picked >= row.count) break
      if (usedIds.has(q.id)) continue
      const yt = extractYoutubeId(q.youtubeUrl)
      if (yt && usedYt.has(yt)) continue
      usedIds.add(q.id)
      if (yt) usedYt.add(yt)
      picked += 1
      out.push(toQuestionRuntime(q))
    }
  }
  return out.sort(() => Math.random() - 0.5)
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
    || q.slots.find((s) => !s.hidden && !s.label.includes('가수'))
    || q.slots.find((s) => !s.hidden)
  const artistSlots = q.slots.filter((s) => !s.hidden && s.label.includes('가수'))
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
      const isArtist = s.label.includes('가수')
      const expanded = isArtist ? expandArtistAccepts(s.answer, accepts) : accepts
      const acceptNorms = [...new Set([s.answer, ...expanded].map(normalizeAnswer))]
      return {
        id: s.id,
        label: s.label,
        answer: s.answer,
        accepts: expanded,
        acceptNorms,
        hidden: s.hidden,
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
  for (const q of pool.sort(() => Math.random() - 0.5)) {
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
  upcoming = [...upcoming, ...extras].sort(() => Math.random() - 0.5)

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
    const pool = [...(byGenre.get(g) || [])].sort(() => Math.random() - 0.5)
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
      for (const q of bank.sort(() => Math.random() - 0.5)) {
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
    ...nextUpcoming.sort(() => Math.random() - 0.5),
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

  let receivers = [...new Set(keep.map((q) => q.genre))]
  if (receivers.length === 0) {
    receivers = Object.entries(room.genreCounts)
      .filter(([g, c]) => g !== genre && Number(c) > 0)
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
    for (const q of bank.sort(() => Math.random() - 0.5)) {
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
    ...[...keep, ...extras].sort(() => Math.random() - 0.5),
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
    const shuffled = [...list].sort(() => Math.random() - 0.5)
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
    for (const q of bank.sort(() => Math.random() - 0.5)) {
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
    ...[...same, ...keepOthers, ...extras].sort(() => Math.random() - 0.5),
  ]

  const short = extras.length < removed ? ` (은행 부족 ${extras.length}/${removed})` : ''
  return {
    ok: true,
    hint: `미안하다 함지자 · 「${genre}」 +${extras.length} ← ${removeParts.join(' · ')}${short}`,
  }
}

const TARGET_AUGMENT_TYPES = new Set([
  'mute_chat',
  'slow_playback',
  'answer_proxy',
  'sakura_decoy',
  'named_decoy',
  'answer_delay',
  'yacha_duel',
  'polite_suffix',
  'answer_block',
  'rock_throw',
  'steal_chain',
  'score_steal',
  'pair_average',
  'accuse_sleep',
  'gabuki_mark',
  'steal_held_augment',
  'flame_kim',
])

const GENRE_AUGMENT_TYPES = new Set(['ban_genre'])

const AUTO_APPLY_AUGMENT_TYPES = new Set(['water_ghost', 'combo_clear_double'])
/** 수동 사용 불가 · 지목당하면 자동 발동 */
const PASSIVE_HELD_AUGMENT_TYPES = new Set(['reflect_debuff'])

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
): Promise<ApplyAugmentResult> {
  const value = parseEffectValue(aug.effectValue)
  const rounds = Number(value.rounds) || 0
  const defaultChat = `${user.nickname}님이 증강 [${aug.name}]을(를) 사용했습니다`

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
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 ${muteRounds}R 채팅·제출 금지!`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${muteRounds}라운드 채팅·제출 금지`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님을 가뒀습니다! (다음 ${muteRounds}R 채팅·제출 금지)`,
    }
  }

  if (aug.effectType === 'power_off_others') {
    const secRaw = Number(value.seconds)
    const seconds = Number.isFinite(secRaw) && secRaw > 0 ? Math.min(60, secRaw) : 10
    const until = Date.now() + seconds * 1000
    let hit = 0
    for (const other of room.members.values()) {
      if (other.userId === m.userId) continue
      other.songMuteUntil = until
      hit += 1
      // 즉시 하드컷 (room:state 대기 없이)
      io.to(other.socketId).emit('song:power_off', { until, seconds })
    }
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
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님에게 예의를 요구했습니다! (다음 ${politeRounds}R · 「${suffix}」)`,
    }
  }

  if (aug.effectType === 'answer_block') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const blockRounds = rounds > 0 ? rounds : 1
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
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${blockRounds}R 정답 불가`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${blockRounds}R 정답 인정 안 됨`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님을 쉬게 했습니다! (다음 ${blockRounds}R 정답 불가)`,
    }
  }

  if (aug.effectType === 'answer_block_others') {
    const blockRounds = rounds > 0 ? rounds : 1
    let hit = 0
    let reflectedCount = 0
    for (const other of room.members.values()) {
      if (other.userId === m.userId) continue
      const shield = takeReflectShield(other, room.index)
      const victim = shield ? m : other
      if (shield) {
        reflectedCount += 1
        io.to(other.socketId).emit('augment:hint', {
          name: shield.name,
          hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
          durationMs: 0,
        })
      }
      victim.answerBlock = {
        startIndex: room.index + 1,
        roundsLeft: blockRounds,
        byName: shield ? shield.name : aug.name,
        byNickname: shield ? other.nickname : user.nickname,
      }
      hit += 1
    }
    if (hit <= 0) {
      return { ok: false, hint: '적용할 상대가 없습니다', chatText: null }
    }
    return {
      ok: true,
      hint: reflectedCount
        ? `[${aug.name}] 상대 ${hit}명 · 다음 ${blockRounds}R 정답 불가 (반사 ${reflectedCount})`
        : `[${aug.name}] 상대 ${hit}명 · 다음 ${blockRounds}R 정답 불가 (채팅 OK)`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다른 플레이어는 다음 ${blockRounds}R 동안 정답을 맞힐 수 없습니다`,
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
      hint: `[${aug.name}] ${victim.nickname} · 다음 R 정답 시 → 그 다음 R 수면`,
      chatText: `${user.nickname}님이 [${aug.name}] ${victim.nickname}님을 지목했습니다! (다음 라운드 정답 시 수면)`,
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
    const flameRounds = 3
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
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님에게 매너를 요청했습니다! (다음 ${delayRounds}R · ${delaySec}초 딜레이)`,
    }
  }

  if (aug.effectType === 'yacha_duel') {
    if (room.duel || room.pendingDuel) {
      return { ok: false, hint: '이미 야차룰이 예약·진행 중입니다', chatText: null }
    }
    if (room.status !== 'playing' && room.status !== 'revealing' && room.status !== 'countdown') {
      return { ok: false, hint: '지금은 야차룰을 시작할 수 없습니다', chatText: null }
    }
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const shield = takeReflectShield(intended, room.index)
    const challenger = shield ? intended : m
    const opponent = shield ? m : intended
    const reflected = !!shield
    const penaltyRaw = Number(value.penalty)
    const penalty = Number.isFinite(penaltyRaw) && penaltyRaw > 0 ? Math.floor(penaltyRaw) : 5
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
    }
    return {
      ok: true,
      hint: reflected
        ? `[무지개 반사] 다음 라운드 야차룰! ${challenger.nickname} vs ${opponent.nickname} · 패자 −${penalty}`
        : `[${aug.name}] 다음 라운드에 적용 · ${challenger.nickname} vs ${opponent.nickname} · 패자 −${penalty}`,
      chatText: reflected
        ? `${intended.nickname}님의 [무지개 반사]! 다음 라운드 야차룰! ${challenger.nickname} vs ${opponent.nickname} (제목만 · 패자 −${penalty})`
        : `${user.nickname}님이 [${aug.name}]! 다음 라운드에 ${challenger.nickname} vs ${opponent.nickname} (제목만 · 패자 −${penalty})`,
    }
  }

  if (aug.effectType === 'slow_playback') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const minRaw = Number(value.rateMin)
    const maxRaw = Number(value.rateMax)
    const rateMin = Number.isFinite(minRaw) ? minRaw : 0.2
    const rateMax = Number.isFinite(maxRaw) ? maxRaw : 0.5
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
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님에게 산데비스탄을 꽂았습니다! (다음 ${slowRounds}R · ×${rate})`,
    }
  }

  if (aug.effectType === 'sakura_decoy' || aug.effectType === 'named_decoy') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const titleKey = String(value.titleIncludes || '').trim() || '연애서큘레이션'
    const decoy = aug.effectType === 'named_decoy'
      ? await pickNamedTrack(room, titleKey, {
          youtubeUrl: String(value.youtubeUrl || ''),
          startSec: Number(value.startSec),
        })
      : await pickDecoyTrack(room)
    if (!decoy) {
      return {
        ok: false,
        hint: aug.effectType === 'named_decoy'
          ? `[${aug.name}] 문제은행에 「${titleKey}」이(가) 없습니다`
          : null,
        chatText: null,
      }
    }
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    const multDefault = aug.effectType === 'named_decoy' ? 1 : 3
    const multRaw = Number(value.scoreMult)
    const mult = Number.isFinite(multRaw) && multRaw > 0 ? Math.floor(multRaw) : multDefault
    const sakuraRounds = rounds > 0 ? rounds : (aug.effectType === 'named_decoy' ? 1 : 2)
    // 상대 지정 디코이: 다음 라운드부터
    const startIndex = room.index + 1
    const songLabel = aug.effectType === 'named_decoy' ? titleKey : '다른 곡'
    const multHint = mult > 1 ? ` · 정답 시 ×${mult}` : ''
    const whenHint = `다음 ${sakuraRounds}R `
    victim.sakuraDecoy = {
      youtubeUrl: decoy.youtubeUrl,
      startSec: decoy.startSec,
      startIndex,
      roundsLeft: sakuraRounds,
      scoreMult: mult,
      byName: reflected ? shield!.name : aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
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
    const startIndex = room.index
    const songLabel = String(value.songLabel || '').trim() || titleKey
    for (const other of room.members.values()) {
      other.sakuraDecoy = {
        youtubeUrl: decoy.youtubeUrl,
        startSec: decoy.startSec,
        startIndex,
        roundsLeft: sakuraRounds,
        scoreMult: mult,
        byName: aug.name,
        byNickname: user.nickname,
      }
      io.to(other.socketId).emit('augment:hint', {
        name: aug.name,
        hint: `[${aug.name}] 지금부터 ${sakuraRounds}R 「${songLabel}」이(가) 재생됩니다`,
        durationMs: 0,
      })
    }
    return {
      ok: true,
      hint: `[${aug.name}] 전원 · 지금부터 ${sakuraRounds}R 「${songLabel}」`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${sakuraRounds}R 동안 전원에게 「${songLabel}」이(가) 재생됩니다`,
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
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: wagerRounds, bonus: winPts, penalty: losePts },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index + 1,
      roundsLeft: wagerRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${wagerRounds}R · 정답 시 +${winPts} / 실패 시 −${losePts}`,
      chatText: defaultChat,
    }
  }

  if (aug.effectType === 'mud_fight') {
    const mudRounds = rounds > 0 ? rounds : 1
    const bonusRaw = Number(value.bonus)
    const bonus = Number.isFinite(bonusRaw) && bonusRaw > 0 ? Math.floor(bonusRaw) : 3
    const bgmUrl = String(value.bgmUrl || value.youtubeUrl || '').trim()
      || 'https://www.youtube.com/watch?v=ZzHYbM0l4ec'
    const startRaw = Number(value.bgmStartSec ?? value.startSec)
    const bgmStartSec = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0
    // 다음 라운드부터 · 전원 BGM/초성 · +보너스는 시전자만
    const startIndex = room.index + 1
    for (const other of room.members.values()) {
      // 기존 진흙탕이 있으면 교체
      other.activeBuffs = other.activeBuffs.filter((b) => b.effectType !== 'mud_fight')
      const isCaster = other.userId === m.userId
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
    }
    return {
      ok: true,
      hint: `[${aug.name}] 다음 ${mudRounds}R · 전원 BGM·초성 · 본인 정답 +${bonus}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다음 ${mudRounds}R 전원 노래 대신 BGM·초성 · ${user.nickname}님만 정답 시 +${bonus}`,
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
    const bonus = Number.isFinite(bonusRaw) && bonusRaw > 0 ? Math.floor(bonusRaw) : 1
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

  if (aug.effectType === 'water_ghost') {
    const ghostRounds = rounds > 0 ? rounds : 1
    const penRaw = Number(value.penalty)
    const penalty = Number.isFinite(penRaw) && penRaw > 0 ? Math.floor(penRaw) : 1
    // 증강 선택 자동 / 플레이 중(혼돈 등) 모두 → 해당 시점의 이번 라운드
    const startIndex = room.index
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: ghostRounds, penalty },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: ghostRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 이번 ${ghostRounds}R · 점수 미완 시 맞춘 사람 각 −${penalty}`,
      chatText:
        room.status === 'augment' || room.status === 'countdown'
          ? `${user.nickname}님의 [${aug.name}]이(가) 자동 적용되었습니다`
          : defaultChat,
    }
  }

  if (aug.effectType === 'combo_clear_double') {
    const comboRounds = rounds > 0 ? rounds : 1
    const startIndex = room.index
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: comboRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: comboRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 이번 ${comboRounds}R · 전부 맞히면 라운드 점수 ×2`,
      chatText:
        room.status === 'augment' || room.status === 'countdown'
          ? `${user.nickname}님의 [${aug.name}]이(가) 자동 적용되었습니다`
          : defaultChat,
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
    const bonusRounds = rounds > 0 ? rounds : 2
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
      hint: `[${aug.name}] 다음 곡 힌트\n장르: ${genre}\n제목: ${titleH}\n가수: ${artistH}`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 다음 라운드 힌트를 훔쳐봤습니다`,
    }
  }

  if (aug.effectType === 'future_sight') {
    const lookRaw = Number(value.lookAhead ?? value.count)
    const lookAhead = Number.isFinite(lookRaw) && lookRaw > 0 ? Math.floor(lookRaw) : 3
    const upcoming = room.queue.slice(room.index + 1, room.index + 1 + lookAhead)
    if (!upcoming.length) {
      return {
        ok: false,
        hint: `[${aug.name}] 앞으로 확인할 라운드가 없습니다`,
        chatText: null,
      }
    }
    // 순서 랜덤 · 몇 번째 라운드인지는 숨김
    const shuffled = shuffleArray([...upcoming])
    const lines = shuffled.map((q, i) => {
      const ans = formatTitleArtistAnswers(q)
      return `${i + 1}. ${ans || formatSlotAnswers(q)}`
    })
    return {
      ok: true,
      hint: `[${aug.name}] 앞으로 ${shuffled.length}곡 정답 (순서 랜덤 · 이번 R 종료 시 소멸)\n${lines.join('\n')}`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 앞으로 ${shuffled.length}라운드 정답을 훔쳐봤습니다 (순서 랜덤)`,
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
      hint: `[${aug.name}] 지금부터 ${knowRounds}R · 제목·가수 공개 · 정답 불가`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${knowRounds}R 답을 알지만 맞힐 수 없습니다`,
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

  if (aug.effectType === 'donate_from_random') {
    const countRaw = Number(value.count)
    const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 3
    const amtRaw = Number(value.amount)
    const amount = Number.isFinite(amtRaw) && amtRaw > 0 ? Math.floor(amtRaw) : 1
    const victims = pickRandomOtherMembers(room, m.userId, count)
    if (!victims.length) {
      return {
        ok: false,
        hint: `[${aug.name}] 기부받을 다른 플레이어가 없습니다`,
        chatText: null,
      }
    }
    let gained = 0
    for (const v of victims) {
      v.score -= amount
      gained += amount
      io.to(v.socketId).emit('augment:hint', {
        name: aug.name,
        hint: `[${aug.name}] ${user.nickname}님에게 ${amount}점 기부… (−${amount})`,
        durationMs: 0,
      })
    }
    m.score += gained
    const names = victims.map((v) => v.nickname).join('·')
    return {
      ok: true,
      hint: `[${aug.name}] ${names} 각 −${amount} · 본인 +${gained}`,
      chatText: `${user.nickname}님의 [${aug.name}]! ${names}에게서 각 ${amount}점 기부받아 +${gained}점`,
    }
  }

  if (aug.effectType === 'pair_average') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const shield = takeReflectShield(intended, room.index)
    const a = shield ? intended : m
    const b = shield ? m : intended
    const reflected = !!shield
    const avg = Math.round((a.score + b.score) / 2)
    a.score = avg
    b.score = avg
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${a.nickname}·${b.nickname} ${avg}점으로 통일`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${a.nickname}·${b.nickname} ${avg}점 통일`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${intended.nickname}와 ${avg}점으로 통일`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님과 ${avg}점 통일`,
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
    const revealRounds = rounds > 0 ? rounds : 5
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
      hint: `[${aug.name}] 지금부터 ${revealRounds}R · 게임 장르면 정답 공개`,
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
    const chanceRaw = Number(value.hitChance)
    const hitChance = Number.isFinite(chanceRaw) && chanceRaw > 0 && chanceRaw <= 1 ? chanceRaw : 0.5
    if (Math.random() >= hitChance) {
      const missRatioRaw = Number(value.missBoostRatio)
      const missRatio =
        Number.isFinite(missRatioRaw) && missRatioRaw > 0 && missRatioRaw <= 1 ? missRatioRaw : 0.2
      const result = await boostAttemptedGenreFromOthers(room, g, missRatio)
      return {
        ok: true,
        hint: `[${aug.name}] 실패! 미안하다 함지자 발동 · ${result.hint}`,
        chatText: `밴픽에 실패했습니다! 미안하다 함지자가 발동됩니다! ${result.hint}`,
      }
    }
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

  return { ok: true, hint: `증강 [${aug.name}] 사용`, chatText: defaultChat }
}

function pickRandomOtherMember(room: Room, selfId: string): Member | null {
  const others = [...room.members.values()].filter((x) => x.userId !== selfId)
  if (!others.length) return null
  return others[Math.floor(Math.random() * others.length)]
}

function pickRandomOtherMembers(room: Room, selfId: string, count: number): Member[] {
  const others = [...room.members.values()].filter((x) => x.userId !== selfId)
  if (!others.length || count <= 0) return []
  const shuffled = [...others].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, shuffled.length))
}

function pickChaosAugments(pool: AugmentLike[], count: number): AugmentLike[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
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
  for (const m of room.members.values()) {
    for (const b of activeBuffsAt(m, room.index)) {
      if (b.effectType === 'flash_answer') {
        const delaySec = Number(b.effectValue.delaySec) || 0
        const ms = Number(b.effectValue.ms)
        const durationMs = Number.isFinite(ms) && ms > 0 ? ms : 1000
        const emitHint = () => {
          if (room.status !== 'playing') return
          if (room.queue[room.index] !== q) return
          io.to(m.socketId).emit('augment:hint', {
            name: b.name,
            hint: formatSlotAnswers(q, true),
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
            hint: formatSlotAnswersPlain(q, true),
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
          hint: formatSlotAnswers(q, true),
          durationMs: 0,
        })
      }
      if (b.effectType === 'know_but_cant') {
        io.to(m.socketId).emit('augment:hint', {
          name: b.name,
          hint: `${formatTitleArtistAnswers(q)} · 정답 제출 불가`,
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
    }, cb?: (res: unknown) => void) => {
      const profile = await loadMemberProfile(user.id, user.nickname)
      const id = Math.random().toString(36).slice(2, 8)
      const genreBankCounts = await loadGenreBankCounts()
      const genreCounts = await clampGenreCounts(payload.genreCounts || { '한국노래': 20 })
      const room: Room = {
        id,
        name: payload.name?.trim() || `${profile.nickname}의 방`,
        hostId: user.id,
        isPrivate: !!payload.isPrivate,
        code: payload.isPrivate ? Math.random().toString(36).slice(2, 8).toUpperCase() : null,
        maxPlayers: Math.min(10, Math.max(2, payload.maxPlayers || 10)),
        genreCounts,
        genreBankCounts,
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
        duel: null,
        pendingDuel: null,
      }
      attachMember(room, emptyMember(user.id, profile.nickname, profile.avatarUrl, socket.id))
      rooms.set(id, room)
      socket.join(id)
      io.emit('lobby:rooms', publicRooms())
      cb?.({ ok: true, room: roomState(room), code: room.code })
      socket.emit('room:state', roomState(room))
    })

    socket.on('room:join', async (payload: { roomId?: string; code?: string }, cb?: (res: unknown) => void) => {
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
      attachMember(room, emptyMember(user.id, profile.nickname, profile.avatarUrl, socket.id))
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
      if (!m) return
      m.ready = !m.ready
      io.to(room.id).emit('room:state', roomState(room))
    })

    socket.on('room:settings', async (payload: { genreCounts?: Record<string, number>; maxPlayers?: number; name?: string }) => {
      const room = findRoomByUser(user.id)
      if (!room || room.hostId !== user.id || room.status !== 'lobby') return
      if (payload.genreCounts) {
        room.genreBankCounts = await loadGenreBankCounts()
        room.genreCounts = await clampGenreCounts(payload.genreCounts)
      }
      if (payload.maxPlayers) room.maxPlayers = Math.min(10, Math.max(2, payload.maxPlayers))
      if (payload.name) room.name = payload.name
      io.to(room.id).emit('room:state', roomState(room))
    })

    socket.on('chat:message', (payload: { text?: string }) => {
      const text = payload.text?.trim()
      if (!text) return
      const room = findRoomByUser(user.id)
      if (!room) return
      const m = room.members.get(user.id)
      if (m && room.status === 'playing' && isChatMuted(m, room.index)) {
        io.to(m.socketId).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: `채팅 금지 중${m.chatMute?.byName ? ` (${m.chatMute.byName})` : ''}`,
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
      io.to(room.id).emit('chat:message', {
        id: Date.now(),
        userId: user.id,
        nickname: user.nickname,
        text,
        at: Date.now(),
      })
    })

    socket.on('game:start', async (_payload, cb?: (res: unknown) => void) => {
      const room = findRoomByUser(user.id)
      if (!room) return cb?.({ ok: false, error: '방 없음' })
      if (room.hostId !== user.id) return cb?.({ ok: false, error: '방장만 시작 가능' })
      if (room.status !== 'lobby') return cb?.({ ok: false, error: '이미 시작된 방입니다' })
      if (room.members.size < 1) return cb?.({ ok: false, error: '인원 부족' })

      room.genreBankCounts = await loadGenreBankCounts()
      room.genreCounts = await clampGenreCounts(room.genreCounts)
      const queue = await pickQuestions(room.genreCounts)
      if (queue.length === 0) return cb?.({ ok: false, error: '문제 은행이 비어 있습니다' })

      clearTimer(room)
      room.queue = queue
      room.index = 0
      room.lastAugmentAt = -1
      room.duel = null
      room.pendingDuel = null
      room.skipVotes = new Set()
      room.revealed = {}
      room.clearedHintSent = false
      room.riskyBustApplied = new Set()
      room.wagerSettled = new Set()
      room.followAnswerWindow = {}
      room.followAnswerClaimed = {}
      for (const m of room.members.values()) {
        m.score = 0
        m.ready = false
        m.usedAugments = []
        m.offerSeenAugmentIds = []
        m.activeBuffs = []
        m.collectedPieces = []
        m.chatMute = null
        m.answerDelay = null
        m.politeSuffix = null
        m.answerBlock = null
        m.accuseMark = null
        m.gabuki = null
        m.answerProxy = null
        m.sakuraDecoy = null
        m.flameKim = null
        m.songMuteUntil = null
        m.roundScoreGain = 0
        clearHeldAugment(m)
      }
      // startRound가 augment/playing으로 상태를 올림 (playing 선-emit으로 화면 깜빡임 방지)
      startRound(io, room)
      cb?.({ ok: true })
    })

    socket.on('answer:submit', (payload: { text?: string }) => {
      const text = payload.text?.trim()
      if (!text) return
      const room = findRoomByUser(user.id)
      if (!room || (room.status !== 'playing' && room.status !== 'duel')) return

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
        const slot = q.slots[0]
        if (!slot || room.revealed[slot.id]) return
        if (!isAcceptedAnswer(text, slot.acceptNorms)) return

        room.revealed[slot.id] = { answer: slot.answer, by: user.nickname, userId: user.id }
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
      if (memberSelf && isChatMuted(memberSelf, room.index)) {
        io.to(memberSelf.socketId).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: `감옥! 이번 라운드는 채팅·제출 금지${memberSelf.chatMute?.byName ? ` (${memberSelf.chatMute.byName})` : ''}`,
          system: true,
          at: Date.now(),
        })
        return
      }
      const delayLeft = memberSelf ? answerDelayRemainingMs(room, memberSelf) : 0
      if (memberSelf && delayLeft > 0) {
        const sec = Math.ceil(delayLeft / 1000)
        io.to(memberSelf.socketId).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: `님아 매너좀! ${sec}초 후에 정답을 입력할 수 있습니다`,
          system: true,
          at: Date.now(),
        })
        return
      }
      const q = room.queue[room.index]
      if (!q) return

      // 채팅으로도 방송
      io.to(room.id).emit('chat:message', {
        id: Date.now(),
        userId: user.id,
        nickname: user.nickname,
        text,
        at: Date.now(),
      })

      if (memberSelf && isAnswerBlocked(memberSelf, room.index)) {
        const blockName = answerBlockPublic(memberSelf, room.index).answerBlockBy || '쉬었음청년'
        io.to(memberSelf.socketId).emit('chat:message', {
          id: Date.now() + 1,
          userId: '',
          nickname: '시스템',
          text: `${blockName}! 이번 라운드는 정답이 인정되지 않습니다`,
          system: true,
          at: Date.now(),
        })
        return
      }

      let scoreText = text
      if (memberSelf && isPoliteSuffixActive(memberSelf, room.index)) {
        const suffix = memberSelf.politeSuffix!.suffix || '입니다'
        if (!text.trim().endsWith(suffix)) {
          io.to(memberSelf.socketId).emit('chat:message', {
            id: Date.now() + 1,
            userId: '',
            nickname: '시스템',
            text: `예의바른청년! 답 끝에 「${suffix}」를 붙여야 합니다`,
            system: true,
            at: Date.now(),
          })
          return
        }
        scoreText = text.trim().slice(0, -suffix.length).trim()
      }

      const openDone = q.slots
        .filter((s) => !s.hidden)
        .every((s) => room.revealed[s.id])

      for (const slot of q.slots) {
        if (room.revealed[slot.id]) {
          // 보너스 타임: 선답 후 windowMs 안 추종 정답
          const win = room.followAnswerWindow[slot.id]
          if (!win) continue
          if (Date.now() - win.at > win.windowMs) continue
          if (!memberSelf || !hasFollowAnswer(memberSelf, room.index)) continue
          if (win.byUserId === user.id) continue
          const claimed = room.followAnswerClaimed[slot.id] || new Set()
          if (claimed.has(user.id)) continue
          if (!isAcceptedAnswer(scoreText, win.acceptNorms)) continue

          claimed.add(user.id)
          room.followAnswerClaimed[slot.id] = claimed

          let gain = answerScoreFor(memberSelf, room.index)
          let starterBonus = 0
          let flatBonus = 0
          gain = riskyGainForAnswer(room, memberSelf, user.id, q, gain)
          gain = hiddenRunGainForAnswer(memberSelf, room.index, win.hidden, gain)
          starterBonus = slowStarterBonus(memberSelf, room.index)
          flatBonus = scoreBonusFor(memberSelf, room.index)
          if (!win.hidden && hasHiddenRun(memberSelf, room.index)) {
            starterBonus = 0
            flatBonus = 0
          }
          const pointsShown = gain + starterBonus + flatBonus
          memberSelf.score += pointsShown
          memberSelf.roundScoreGain += pointsShown
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
        // 히든은 일반 슬롯(제목·가수 등)을 모두 맞히기 전엔 채점하지 않음
        if (slot.hidden && !openDone) continue
        const accepts = slot.acceptNorms
        if (isAcceptedAnswer(scoreText, accepts)) {
          room.revealed[slot.id] = { answer: slot.answer, by: user.nickname, userId: user.id }
          openFollowAnswerWindow(room, slot, user.id)
          // 제목을 남이 맞히면 점수가 2배 보유자에게 즉시 bust
          const isTitle = !slot.hidden && isTitleLikeLabel(slot.label)
          if (isTitle) {
            for (const other of room.members.values()) {
              if (other.userId === user.id) continue
              if (!hasRiskyDouble(other, room.index)) continue
              if (room.riskyBustApplied.has(other.userId)) continue
              room.riskyBustApplied.add(other.userId)
              other.score -= 1
              const buff = activeBuffsAt(other, room.index).find((b) => b.effectType === 'score_mult_risky')
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
          let gain = member ? answerScoreFor(member, room.index) : 1
          let starterBonus = 0
          let flatBonus = 0
          if (member) {
            gain = riskyGainForAnswer(room, member, user.id, q, gain)
            gain = hiddenRunGainForAnswer(member, room.index, slot.hidden, gain)
            starterBonus = slowStarterBonus(member, room.index)
            flatBonus = scoreBonusFor(member, room.index)
            // 히든런 일반 슬롯 0점 규칙이 보너스도 막음
            if (!slot.hidden && hasHiddenRun(member, room.index)) {
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
            tryResolveWagerWin(io, room, member)
            tryTriggerAccuseSleep(io, room, member)
            applyGabukiOnCorrect(io, room, member)
            applyFlameKimOnCorrect(io, room, member)
          }
          // 대상이 실제로 얻은 점수(배율·보너스 포함)만큼 대리 적립
          const proxyBank = (member ? gain + starterBonus + flatBonus : gain)
          bankAnswerProxyPoints(io, room, user.id, proxyBank)
          const pointsShown = gain + starterBonus + flatBonus
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
      if (room.skipVotes.has(user.id)) return
      room.skipVotes.add(user.id)
      const need = Math.floor(room.members.size / 2) + 1
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
      const pickRandom = () => pickRandomFromOfferPool(
        list,
        m.collectedPieces,
        room.augmentOfferLockedTier,
        pickOpts,
      )
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
          const fallback = pickRandom()
          if (!fallback) return
          assignHeldFromOfferPick(m, list, fallback)
        }
      } else {
        const pick = pickRandom()
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
      gahoAugmentId?: string
      genreName?: string
    }) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'playing') return
      const m = room.members.get(user.id)
      if (!m?.heldAugmentId || !m.heldAugmentName || !m.heldAugmentEffectType) return
      // 자동 사용 / 피격 자동 발동 증강은 수동 사용 불가
      if (
        AUTO_APPLY_AUGMENT_TYPES.has(m.heldAugmentEffectType)
        || PASSIVE_HELD_AUGMENT_TYPES.has(m.heldAugmentEffectType)
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

      if (aug.effectType === 'chaos_cast') {
        m.usedAugments.push(aug.name)
        clearHeldAugment(m)
        const all = await getEnabledAugments()
        // 야차·가호선택·가호티어는 혼돈에서 제외
        const pool = all.filter(
          (a) =>
            a.effectType !== 'chaos_cast'
            && a.effectType !== 'yacha_duel'
            && a.effectType !== 'gaho_select'
            && a.effectType !== 'tier_upgrade'
            && a.tier !== '가호',
        )
        const picks = pickChaosAugments(pool, 2)
        const hintLines: string[] = []
        const chatLines: string[] = []
        for (const pick of picks) {
          let targetId: string | undefined
          let genrePick: string | undefined
          if (TARGET_AUGMENT_TYPES.has(pick.effectType)) {
            const other = pickRandomOtherMember(room, m.userId)
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
            genrePick = options[Math.floor(Math.random() * options.length)]
          }
          const result = await applyAugmentEffect(io, room, m, user, pick, targetId, genrePick)
          if (!result.ok) {
            hintLines.push(`[${pick.name}] 적용 실패`)
            continue
          }
          if (result.hint) hintLines.push(result.hint)
          if (result.chatText) chatLines.push(result.chatText)
          // 혹시 상태 전이가 있으면 추가 효과 중단
          if (room.status !== 'playing') break
        }
        const names = picks.map((p) => p.name).join(' · ')
        hint = `[혼돈] ${names}\n${hintLines.join('\n')}`
        chatText = `${user.nickname}님의 [혼돈]! → ${names}${chatLines.length ? `\n${chatLines.join(' / ')}` : ''}`
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
      } else if (aug.effectType === 'steal_held_augment') {
        const intended = payload?.targetUserId ? room.members.get(payload.targetUserId) : null
        if (!intended || intended.userId === m.userId) return
        if (!intended.heldAugmentId || !intended.heldAugmentName) {
          io.to(m.socketId).emit('augment:hint', {
            name: aug.name,
            hint: `[${aug.name}] ${intended.nickname}님은 보유 증강이 없습니다`,
            durationMs: 0,
          })
          return
        }
        const shield = takeReflectShield(intended, room.index)
        if (shield) {
          m.usedAugments.push(aug.name)
          clearHeldAugment(m)
          io.to(intended.socketId).emit('augment:hint', {
            name: shield.name,
            hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
            durationMs: 0,
          })
          hint = `[무지개 반사] ${intended.nickname}님에게 튕겨 증강 강탈 실패`
          chatText = `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`
        } else {
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
          m.usedAugments.push(aug.name)
          clearHeldAugment(m)
          setHeldAugment(m, stolen)
          usedCard = {
            name: stolen.name,
            description: stolen.description,
            effectType: stolen.effectType,
            effectValue: stolen.effectValue,
            imageUrl: stolen.imageUrl,
            tier: stolen.tier || undefined,
          }
          hint = `[조커뽑기] ${intended.nickname}님의 「${stolen.name}」을(를) 가져왔습니다!`
          chatText = `${user.nickname}님이 [조커뽑기]! ${intended.nickname}님의 「${stolen.name}」을(를) 가져갔습니다`
        }
      } else {
        if (TARGET_AUGMENT_TYPES.has(aug.effectType)) {
          if (!payload?.targetUserId) {
            // 불꽃남자: 혼자면 대상 없이 사용 가능
            if (!(aug.effectType === 'flame_kim' && room.members.size < 2)) return
          }
        }
        if (GENRE_AUGMENT_TYPES.has(aug.effectType)) {
          if (!payload?.genreName) return
        }
        const result = await applyAugmentEffect(
          io,
          room,
          m,
          user,
          aug,
          payload?.targetUserId,
          payload?.genreName,
        )
        if (!result.ok) return
        m.usedAugments.push(aug.name)
        clearHeldAugment(m)
        hint = result.hint
        if (result.chatText) chatText = result.chatText
      }

      io.to(room.id).emit('augment:used', {
        userId: user.id,
        nickname: user.nickname,
        name: usedCard.name,
        description: usedCard.description,
        imageUrl: usedCard.imageUrl || null,
        tier: usedCard.tier,
      })
      if (hint) {
        io.to(m.socketId).emit('augment:hint', {
          name: usedCard.name,
          hint,
          durationMs: 0,
        })
      }
      io.to(room.id).emit('room:state', roomState(room))
      io.to(room.id).emit('chat:message', {
        id: Date.now(),
        userId: '',
        nickname: '시스템',
        text: chatText,
        system: true,
        at: Date.now(),
        augmentCard: {
          name: usedCard.name,
          description: usedCard.description,
          imageUrl: usedCard.imageUrl || null,
          tier: usedCard.tier,
        },
      })
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
  room.members.delete(userId)
  userRoomId.delete(userId)
  socket.leave(room.id)
  if (room.members.size === 0) {
    clearTimer(room)
    rooms.delete(room.id)
  } else {
    if (room.hostId === userId) {
      room.hostId = [...room.members.keys()][0]
    }
    io.to(room.id).emit('room:state', roomState(room))
  }
  io.emit('lobby:rooms', publicRooms())
}

function startDuelRound(io: Server, room: Room) {
  const duel = room.duel
  if (!duel) return
  clearTimer(room)
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
  }))

  const a = room.members.get(duel.challengerId)?.nickname || '?'
  const b = room.members.get(duel.opponentId)?.nickname || '?'

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
  io.to(room.id).emit('room:state', roomState(room))
  io.to(room.id).emit('chat:message', {
    id: Date.now(),
    userId: '',
    nickname: '시스템',
    text: `야차룰! ${a} vs ${b} · 제목만 · 먼저 못 맞히면 −${duel.penalty}점`,
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

  const reveal = q.slots.map((s) => ({
    id: s.id,
    label: s.label,
    answer: s.answer,
    by: room.revealed[s.id]?.by || null,
  }))

  room.status = 'revealing'
  io.to(room.id).emit('round:reveal', { reason: reason === 'timeout' ? 'timeout' : 'cleared', slots: reveal, pauseSec: 3 })
  io.to(room.id).emit('room:state', roomState(room))

  const resumeIndex = duel.resumeIndex
  const savedRevealed = duel.savedRevealed
  const savedRemainingMs = duel.savedRemainingMs
  const savedRiskyBust = duel.savedRiskyBust
  const savedWagerSettled = duel.savedWagerSettled
  room.duel = null
  room.index = resumeIndex
  room.timer = setTimeout(() => {
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
    revealed: Record<string, { answer: string; by: string; userId: string }>
    remainingMs: number
    riskyBust: Set<string>
    wagerSettled: Set<string>
  },
) {
  clearTimer(room)
  if (room.index >= room.queue.length) {
    forceSettleAnswerProxies(io, room)
    room.status = 'ended'
    io.to(room.id).emit('game:end', {
      results: [...room.members.values()]
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }

  // 증강 타이밍이면 그쪽 우선
  if (room.index % 10 === 0 && room.lastAugmentAt !== room.index) {
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
    }
  })

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
  io.to(room.id).emit('room:state', roomState(room))
  applyRoundStartBuffs(io, room)

  // 이미 전부 맞힌 상태면 바로 종료
  if (q.slots.every((s) => room.revealed[s.id])) {
    endRound(io, room, 'cleared')
    return
  }

  room.timer = setTimeout(() => endRound(io, room, 'timeout'), duration * 1000)
}

function startRound(io: Server, room: Room) {
  clearTimer(room)
  if (room.index >= room.queue.length) {
    forceSettleAnswerProxies(io, room)
    room.status = 'ended'
    io.to(room.id).emit('game:end', {
      results: [...room.members.values()]
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }

  // 시작 시(0) + 10문제마다 증강
  if (room.index % 10 === 0 && room.lastAugmentAt !== room.index) {
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
        // 새 증강 페이즈 → 리롤 시야 초기화 (이전에 뜬 카드는 다시 가능, 사용 증강은 계속 제외)
        m.offerSeenAugmentIds = []
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
      // 20초 후 미선택자 랜덤 배정
      clearTimer(room)
      room.timer = setTimeout(async () => {
        if (room.status !== 'augment') return
        const all = await getEnabledAugments()
        for (const m of room.members.values()) {
          if (m.heldAugmentId) continue
          const pick = pickRandomFromOfferPool(
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
    room.pendingDuel = null
    void (async () => {
      const question = await pickDuelQuestion(room)
      if (!question) {
        io.to(room.id).emit('chat:message', {
          id: Date.now(),
          userId: '',
          nickname: '시스템',
          text: '야차룰에 쓸 노래를 찾지 못해 취소되었습니다',
          system: true,
          at: Date.now(),
        })
        startRound(io, room)
        return
      }
      if (room.status === 'ended' || room.duel) {
        startRound(io, room)
        return
      }
      room.duel = {
        challengerId: pending.challengerId,
        opponentId: pending.opponentId,
        question,
        penalty: pending.penalty,
        byName: pending.byName,
        resumeIndex: room.index,
        savedRevealed: {},
        savedRemainingMs: 40_000,
        savedRiskyBust: new Set(),
        savedWagerSettled: new Set(),
      }
      startDuelRound(io, room)
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
  for (const m of room.members.values()) {
    m.roundScoreGain = 0
  }
  const q = room.queue[room.index]
  if (!q) {
    forceSettleAnswerProxies(io, room)
    room.status = 'ended'
    io.to(room.id).emit('game:end', {
      results: [...room.members.values()]
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
  }))

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
  io.to(room.id).emit('room:state', roomState(room))
  applyRoundStartBuffs(io, room)

  room.timer = setTimeout(() => endRound(io, room, 'timeout'), duration * 1000)
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
    forceSettleAnswerProxies(io, room)
    io.to(room.id).emit('game:end', {
      results: [...room.members.values()]
        .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
        .sort((a, b) => b.score - a.score),
    })
    io.to(room.id).emit('room:state', roomState(room))
    return
  }
  settleWaterGhost(io, room)
  settleComboClear(io, room)
  settleGabukiMiss(io, room)
  for (const m of room.members.values()) {
    tickBuffsAfterRound(m, room.index)
  }
  settleAllAnswerProxies(io, room)

  const reveal = q.slots.map((s) => ({
    id: s.id,
    label: s.label,
    answer: s.answer,
    by: room.revealed[s.id]?.by || null,
  }))

  io.to(room.id).emit('round:reveal', { reason, slots: reveal, pauseSec: 3 })
  io.to(room.id).emit('round:skip_update', { votes: 0, need: Math.floor(room.members.size / 2) + 1 })
  // 맞췄죠?/대리 결산 점수 즉시 반영
  io.to(room.id).emit('room:state', roomState(room))
  room.index += 1
  room.timer = setTimeout(() => startRound(io, room), 3000)
}

async function finishAugmentIfReady(io: Server, room: Room) {
  // 중복 호출 방지 (전원 선택 동시 / 타임아웃 레이스)
  if (room.status !== 'augment') return
  const allPicked = [...room.members.values()].every((x) => x.heldAugmentId)
  if (!allPicked) {
    io.to(room.id).emit('room:state', roomState(room))
    return
  }
  clearTimer(room)
  // 즉시 잠금 — await 중 재진입으로 라운드가 두 번 시작되지 않게
  room.status = 'countdown'

  const beginCountdown = () => {
    if (room.status !== 'countdown') return
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
    clearTimer(room)
    room.timer = setTimeout(() => {
      if (room.status !== 'countdown') return
      startRound(io, room)
    }, 3000)
  }

  // 카운트다운을 먼저 올려 클라가 멈추지 않게 한 뒤, 자동 증강 적용
  beginCountdown()

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
