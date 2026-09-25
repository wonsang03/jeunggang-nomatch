/**
 * 라운드 종료·정답 시점의 증강 결산 (왕관 내기·대리·가불기·물귀신·콤보·트루먼 등)과
 * 점수 공유·이체 보조 함수. 버프 판정은 memberBuffs.ts, 알림은 roomBroadcast.ts 를 쓴다.
 */
import type { Server } from 'socket.io'
import type { ActiveBuff, Member, Room } from './gameTypes.js'
import {
  activeBuffsAt,
  isAnswerProxyActive,
  isFlameKimActive,
  isGabukiActive,
  takeReflectShield,
  wagerBuffAt,
} from './memberBuffs.js'
import { emitRoomState, systemChat } from './roomBroadcast.js'
import { playerMembers } from './roomMembers.js'

export function tickBuffsAfterRound(
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

/** 내가 왕이 될 상인가: 기간 마지막 라운드에 1등 여부로 정산 (tick 전에 호출) */
export function settleCrownBet(io: Server, room: Room) {
  for (const m of room.members.values()) {
    const b = m.activeBuffs.find((x) => x.effectType === 'crown_bet' && room.index >= x.startIndex)
    if (!b || b.roundsLeft > 1) continue
    const win = Number(b.effectValue.win) || 5
    const lose = Number(b.effectValue.lose) || 3
    const top = Math.max(...playerMembers(room).map((p) => p.score))
    const isKing = m.score >= top
    m.score += isKing ? win : -lose
    io.to(m.socketId).emit('augment:hint', {
      name: b.name,
      hint: isKing ? `[${b.name}] 왕이 되었다! +${win}점` : `[${b.name}] 상이 아니었다... -${lose}점`,
      durationMs: 0,
    })
    systemChat(io, room, isKing
      ? `${m.nickname}님의 [${b.name}] 성공! 1등을 지켜 +${win}점`
      : `${m.nickname}님의 [${b.name}] 실패! 1등이 아니라 -${lose}점`)
  }
}

/** 대리 기간 종료 시 적립 점수 결산. 대상 닉네임은 공개하지 않음 */
export function settleAnswerProxy(io: Server, room: Room, m: Member) {
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

export function settleAllAnswerProxies(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (m.answerProxy && m.answerProxy.roundsLeft <= 0) {
      settleAnswerProxy(io, room, m)
    }
  }
}

/** 정답 즉시 성공 결산. 적용된 보너스 점수 반환 */
export function tryResolveWagerWin(io: Server, room: Room, m: Member): number {
  if (room.wagerSettled.has(m.userId)) return 0
  const b = wagerBuffAt(m, room)
  if (!b) return 0
  const bonus = Number(b.effectValue.bonus)
  const winPts = Number.isFinite(bonus) ? bonus : 5
  room.wagerSettled.add(m.userId)
  m.score += winPts
  // 콤보(누적 ×2)는 roundScoreGain을 모으므로 성공 보너스도 라운드 획득분에 포함시킨다.
  m.roundScoreGain += winPts
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
export function settleWagerAnswers(io: Server, room: Room) {
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

/** 가불기: 대상이 정답을 맞히면 시전자에게 hitPenalty 이전 */
export function applyGabukiOnCorrect(io: Server, room: Room, victim: Member): ScoreTransfer | null {
  if (!isGabukiActive(victim, room.index, room) || !victim.gabuki) return null
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
  return {
    fromUserId: victim.userId,
    toUserId: caster && caster.userId !== victim.userId ? caster.userId : null,
    amount: amt,
  }
}

/** 가불기: 해당 라운드에 정답을 한 번도 못 맞히면 missPenalty 이전 */
export function settleGabukiMiss(io: Server, room: Room) {
  const correctIds = roundCorrectUserIds(room)
  for (const m of room.members.values()) {
    if (!isGabukiActive(m, room.index, room) || !m.gabuki) continue
    if (correctIds.has(m.userId)) continue
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

/**
 * 이번 라운드에 정답을 인정받은 사람들.
 * room.revealed에는 슬롯별 선답자만 남아서, 미룬이(늦은 정답)·보너스 타임(추종 정답)으로
 * 득점한 사람이 「못 맞힌 사람」으로 취급되던 문제가 있었다.
 */
export function roundCorrectUserIds(room: Room) {
  const ids = new Set<string>()
  for (const r of Object.values(room.revealed)) {
    if (r.userId) ids.add(r.userId)
  }
  for (const s of Object.values(room.lateAnswerClaimed)) {
    for (const id of s) ids.add(id)
  }
  for (const s of Object.values(room.followAnswerClaimed)) {
    for (const id of s) ids.add(id)
  }
  return ids
}

/** 물귀신: 이번 라운드 점수를 전부 못 맞히면 맞춘 플레이어 각 −penalty, 본인 +gain */
export function settleWaterGhost(io: Server, room: Room) {
  const q = room.queue[room.index]
  if (!q || q.slots.length === 0) return

  const correctIds = roundCorrectUserIds(room)
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
    for (const id of correctIds) {
      if (id !== m.userId) scorers.add(id)
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
export function settleComboClear(io: Server, room: Room) {
  const q = room.queue[room.index]
  if (!q || q.slots.length === 0) return

  const correctIds = roundCorrectUserIds(room)
  for (const m of room.members.values()) {
    const b = activeBuffsAt(m, room.index, room).find((x) => x.effectType === 'combo_clear_double')
    if (!b) continue
    if (!correctIds.has(m.userId)) {
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
export function forceSettleAnswerProxies(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (!m.answerProxy) continue
    m.answerProxy.roundsLeft = 0
    settleAnswerProxy(io, room, m)
  }
}

/** 영역전개: 시전자보다 점수 높은 인원에게 시한 정답 차단 */
export function applyDomainExpansionPulse(
  io: Server,
  room: Room,
  caster: Member,
  byName: string,
  blockMs: number,
  opts?: { allowReflect?: boolean; casterUser?: { id: string; nickname: string } },
) {
  const higherRanked = playerMembers(room).filter(
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
    emitRoomState(io, room)
  }, blockMs + 80)
  room.extraTimers.push(t)
  return { hit, reflectedCount }
}

/** 기생수를 걸고 `host`에게 붙어 있는 시전자들 (단방향 · 숙주는 아무 이득 없음) */
export function parasitesOf(room: Room, host: Member) {
  const out: Array<{ member: Member; buff: ActiveBuff }> = []
  for (const m of room.members.values()) {
    if (m.userId === host.userId) continue
    const buff = activeBuffsAt(m, room.index, room).find(
      (b) => b.effectType === 'score_share' && String(b.effectValue.partnerId || '') === host.userId,
    )
    if (buff) out.push({ member: m, buff })
  }
  return out
}

/** 기생수: 숙주가 득점하면 시전자도 같은 점수를 얻는다 (재공유 없음) */
export function shareLinkedScoreGain(io: Server, room: Room, from: Member, amount: number) {
  if (amount <= 0) return
  for (const { member, buff } of parasitesOf(room, from)) {
    member.score += amount
    member.roundScoreGain += amount
    io.to(room.id).emit('chat:message', {
      id: Date.now() + 21,
      userId: '',
      nickname: '시스템',
      text: `${member.nickname}님 [${buff.name}]! ${from.nickname}님 득점만큼 +${amount}점`,
      system: true,
      at: Date.now(),
    })
    io.to(member.socketId).emit('augment:hint', {
      name: buff.name,
      hint: `[${buff.name}] ${from.nickname}님 득점 흡수 +${amount}`,
      durationMs: 2500,
    })
  }
}

/** 차차차 등: 기생수로 흡수한 점수 회수 (채팅 없음) */
export function reverseShareLinkedScoreGain(room: Room, from: Member, amount: number) {
  if (amount <= 0) return
  for (const { member } of parasitesOf(room, from)) {
    member.score -= amount
    member.roundScoreGain -= amount
  }
}

/** 대상이 득점했을 때 대리 시전자들에게 적립 */
export function bankAnswerProxyPoints(io: Server, room: Room, targetUserId: string, gain: number) {
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
export function reverseBankAnswerProxyPoints(room: Room, targetUserId: string, gain: number) {
  if (gain <= 0) return
  for (const m of room.members.values()) {
    if (!isAnswerProxyActive(m, room.index, room)) continue
    if (m.answerProxy!.targetUserId !== targetUserId) continue
    m.answerProxy!.pendingScore = Math.max(0, m.answerProxy!.pendingScore - gain)
  }
}

/** 정답과 함께 일어난 점수 이전 기록 (가불기·불꽃남자) */
export type ScoreTransfer = { fromUserId: string; toUserId: string | null; amount: number }

/** 선답 점수·맞췄죠? 보너스·점수 이전 회수 (차차차 중복 정답 우선 처리) */
export function revokeRevealedAnswerCredit(room: Room, rev: {
  userId: string
  points?: number
  wagerPts?: number
  transfers?: ScoreTransfer[]
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
    victim.roundScoreGain -= wagerPts
    reverseShareLinkedScoreGain(room, victim, wagerPts)
    room.wagerSettled.delete(rev.userId)
  }
  // 취소된 정답 때문에 오간 가불기·불꽃남자 감점도 같이 되돌린다.
  for (const t of rev.transfers || []) {
    if (!(t.amount > 0)) continue
    const from = room.members.get(t.fromUserId)
    if (from) from.score += t.amount
    const to = t.toUserId ? room.members.get(t.toUserId) : null
    if (to) to.score -= t.amount
  }
}

/** 범인은 당신이야: 감시 라운드 정답 → 다음 라운드 수면 */
export function tryTriggerAccuseSleep(io: Server, room: Room, m: Member) {
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
  emitRoomState(io, room)
}

/** 트루먼쇼 종료: 가짜 점수 무효 공개 · 실제 점수는 그대로 */
export function settleTrumanIllusion(io: Server, room: Room, m: Member) {
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

export function forceSettleTrumanIllusions(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (!m.sakuraDecoy || m.sakuraDecoy.mode !== 'truman') continue
    settleTrumanIllusion(io, room, m)
  }
}

/** 불꽃남자김상원: 시전자 정답 시 대상 점수 감소 (시전자 본인 득점은 그대로) */
export function applyFlameKimOnCorrect(io: Server, room: Room, caster: Member): ScoreTransfer | null {
  if (!isFlameKimActive(caster, room.index, room) || !caster.flameKim) return null
  const f = caster.flameKim
  const victim = room.members.get(f.targetUserId)
  if (!victim || victim.userId === caster.userId) return null
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
  return { fromUserId: victim.userId, toUserId: null, amount: amt }
}
