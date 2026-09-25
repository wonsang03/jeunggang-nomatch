/**
 * 플레이어별 버프·디버프 판정 (지금 라운드에 무엇이 걸려 있는지, 점수 배율·보너스).
 * io 를 쓰지 않는다 — 알림·브로드캐스트는 socket.ts 가 한다.
 */
import { randomInt } from 'node:crypto'
import type { ActiveBuff, Member, QuestionRuntime, Room } from './gameTypes.js'
import { findTitleSlot } from './answerFormat.js'
import { findHeldByType, removeHeldById } from './heldAugments.js'
import { isPlayingMember } from './roomMembers.js'
import { buffApplies, parseEffectValue } from './roundRules.js'

export function activeBuffsAt(m: Member, roundIndex: number, _room?: Room | null) {
  return m.activeBuffs.filter((b) => buffApplies(b, roundIndex))
}

export function isAnswerProxyActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.answerProxy && roundIndex >= m.answerProxy.startIndex && m.answerProxy.roundsLeft > 0)
}

/** 맞췄죠?: 해당 라운드에 슬롯을 하나라도 맞히면 bonus, 아니면 penalty */
export function wagerBuffAt(m: Member, room: Room) {
  return activeBuffsAt(m, room.index, room).find((b) => b.effectType === 'wager_answer') || null
}

export function isGabukiActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.gabuki && roundIndex >= m.gabuki.startIndex && m.gabuki.roundsLeft > 0)
}

export function isChatMuted(m: Member, roundIndex: number, _room?: Room | null) {
  if (m.chatMuteUntil && m.chatMuteUntil > Date.now()) return true
  return !!(m.chatMute && roundIndex >= m.chatMute.startIndex && m.chatMute.roundsLeft > 0)
}

/** 디버프만 중첩 금지 (산데비스탄·스타카토 등 이득 증강은 겹칠 수 있음) */
export const DEBUFF_AUGMENT_TYPES = new Set([
  'mute_chat',
  'soft_chat_mute',
  'answer_delay',
  'answer_block',
  'answer_block_others',
  'muffled_answer',
  'polite_suffix',
  'named_decoy',
  'named_decoy_all',
  'sakura_decoy',
  'accuse_sleep',
  'gabuki_mark',
  'hide_hints',
  'audio_stutter',
  'audio_scramble',
  'hand_over_augment',
  'power_off_others',
  'party_music_others',
  'chat_isolate',
  'slow_playback',
  'answer_proxy',
  'score_steal',
  'rock_throw',
  'steal_chain',
  'yacha_duel',
  'flame_kim',
  // 진흙탕도 대상 곡을 BGM으로 갈아치우고 bonus를 0으로 만드는 디버프다.
  // 빠져 있으면 진흙탕 맞은 사람에게 눈찌르기가 겹쳐 소리도 초성도 없는 R이 된다.
  'mud_fight',
])

/** 이미 디버프(활성·예약)가 걸린 대상 → 타겟 디버프 추가 적용 불가 */
export function hasIncomingAugmentEffect(m: Member, room: Room): boolean {
  if ((m.activeBuffs || []).some((b) => (
    b.roundsLeft > 0
    && DEBUFF_AUGMENT_TYPES.has(b.effectType)
    // 본인이 건 진흙탕·코로나·영역전개는 자기 자신에겐 디버프가 아니다.
    // 이걸 빼면 시전자가 지속 R 동안 남의 디버프를 못 받는 무적이 된다.
    && b.usedByUserId !== m.userId
  ))) {
    return true
  }
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

/** 타겟 디버프 지목 가능 (플레이어 + 디버프 없음) */
export function canReceiveTargetAugment(m: Member, room: Room) {
  return isPlayingMember(m) && !hasIncomingAugmentEffect(m, room)
}

export function rejectBusyTarget(
  intended: Member | null | undefined,
  selfId: string,
  room: Room,
): { ok: false; hint: string | null; chatText: null } | null {
  if (!intended || intended.userId === selfId) return { ok: false, hint: null, chatText: null }
  if (intended.isSpectator) {
    return { ok: false, hint: '관전자에게는 증강을 사용할 수 없습니다', chatText: null }
  }
  if (hasIncomingAugmentEffect(intended, room)) {
    return { ok: false, hint: '이미 디버프가 적용 중인 대상입니다', chatText: null }
  }
  return null
}

export function isChatIsolateActive(room: Room, roundIndex = room.index) {
  const iso = room.chatIsolate
  return !!(iso && roundIndex >= iso.startIndex && iso.roundsLeft > 0)
}

export function isChatIsolatePending(room: Room) {
  return !!(room.chatIsolate && room.index < room.chatIsolate.startIndex)
}

/** 격리 조 번호 — 중간 입장 등으로 미배정이면 인원 적은 조에 넣고 기억한다 */
export function isolateGroupOf(iso: NonNullable<Room['chatIsolate']>, userId: string) {
  const cur = iso.groupByUserId[userId]
  if (cur === 0 || cur === 1) return cur
  const counts = [0, 0]
  for (const g of Object.values(iso.groupByUserId)) {
    if (g === 0 || g === 1) counts[g] += 1
  }
  const g = counts[0] <= counts[1] ? 0 : 1
  iso.groupByUserId[userId] = g
  return g
}

/** 조로룰: 이 방은 스킵(투표·강제) 불가 */
export function isNoSkipActive(room: Room, roundIndex = room.index) {
  const ns = room.noSkip
  return !!(ns && roundIndex >= ns.startIndex && ns.roundsLeft > 0)
}

export function tickNoSkip(room: Room, endedIndex: number) {
  const ns = room.noSkip
  if (!ns || endedIndex < ns.startIndex || ns.roundsLeft <= 0) return
  ns.roundsLeft -= 1
  if (ns.roundsLeft <= 0) room.noSkip = null
}

export function tickChatIsolate(room: Room, endedIndex: number) {
  const iso = room.chatIsolate
  if (!iso || endedIndex < iso.startIndex || iso.roundsLeft <= 0) return
  iso.roundsLeft -= 1
  if (iso.roundsLeft <= 0) room.chatIsolate = null
}

export function isAnswerDelayActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.answerDelay && roundIndex >= m.answerDelay.startIndex && m.answerDelay.roundsLeft > 0)
}

export function isPoliteSuffixActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.politeSuffix && roundIndex >= m.politeSuffix.startIndex && m.politeSuffix.roundsLeft > 0)
}

export function isAnswerBlocked(m: Member, roundIndex: number, room?: Room | null) {
  if (m.answerBlockUntil && m.answerBlockUntil > Date.now()) return true
  if (m.answerBlock && roundIndex >= m.answerBlock.startIndex && m.answerBlock.roundsLeft > 0) return true
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'know_but_cant')
}

export function knowButCantBuff(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'know_but_cant') || null
}

export function knowButCantPending(m: Member, roundIndex: number) {
  return m.activeBuffs.find((b) => b.effectType === 'know_but_cant' && roundIndex < b.startIndex) || null
}

export function answerBlockPublic(m: Member, roundIndex: number, room?: Room | null) {
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

export function hasEarlyChosung(m: Member, roundIndex: number, room?: Room | null) {
  if (m.duelEarlyChosung && room?.status === 'duel') return true
  if (activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'early_chosung')) return true
  // 만해: 고른 장르 곡에서만 초성 즉시
  const curGenre = (
    room?.status === 'duel' && room.duel?.question
      ? room.duel.question.genre
      : room?.queue?.[roundIndex]?.genre
  ) || ''
  if (
    curGenre.trim()
    && activeBuffsAt(m, roundIndex, room).some(
      (b) => b.effectType === 'genre_early_chosung'
        && String(b.effectValue.genre || '').trim() === curGenre.trim(),
    )
  ) return true
  const wager = activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'wager_answer')
  return !!(wager && wager.effectValue.earlyChosung)
}

/**
 * 남은 적용 구간 [from, to]. roundsLeft는 라운드가 끝날 때마다 줄어들므로
 * 이미 시작된 효과의 잔여 구간은 startIndex가 아니라 «현재 라운드»부터 센다.
 * (startIndex + roundsLeft로 계산하면 이미 진행된 효과의 마지막 라운드를 놓친다)
 */
export function buffActiveWindow(room: Room, startIndex: number, roundsLeft: number) {
  const from = Math.max(startIndex, room.index)
  return { from, to: from + roundsLeft - 1 }
}

/** 이번/지정 라운드에 노래 교체(진흙탕·디코이)가 겹치면 true — 풍악(오버레이)은 제외 */
export function hasReplaceAudioConflict(room: Room, atIndex: number) {
  const overlaps = (startIndex: number, roundsLeft: number) => {
    if (roundsLeft <= 0) return false
    const { from, to } = buffActiveWindow(room, startIndex, roundsLeft)
    return atIndex >= from && atIndex <= to
  }
  for (const m of room.members.values()) {
    for (const b of m.activeBuffs) {
      if (b.effectType !== 'mud_fight') continue
      if (overlaps(b.startIndex, b.roundsLeft)) return true
    }
    const d = m.sakuraDecoy
    if (d && overlaps(d.startIndex, d.roundsLeft)) return true
  }
  return false
}

export function answerDelayRemainingMs(room: Room, m: Member): number {
  if (!isAnswerDelayActive(m, room.index, room) || !m.answerDelay) return 0
  const unlockAt = room.roundStartedAt + m.answerDelay.delaySec * 1000
  return Math.max(0, unlockAt - Date.now())
}

export function answerScoreFor(m: Member, roundIndex: number, slotHidden = false, room?: Room | null) {
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

export function hasRiskyDouble(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'score_mult_risky')
}

export function hasHiddenRun(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'hidden_run')
}

/** 히든런: 일반 슬롯 0점, 히든은 baseGain × mult */
export function hiddenRunGainForAnswer(
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

/**
 * 점수가 2배: 제목을 남이 먼저 맞힌 상태면 이후 정답도 -1.
 * (선점 실패 시 즉시 -1은 제목 공개 시점에 이미 적용)
 */
export function riskyGainForAnswer(
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

export function isSakuraDecoyActive(m: Member, roundIndex: number, _room?: Room | null) {
  if (!(m.sakuraDecoy && roundIndex >= m.sakuraDecoy.startIndex && m.sakuraDecoy.roundsLeft > 0)) return false
  return true
}

/** 트루먼쇼 환상 모드 (가짜 곡 채점 · 가짜 점수 표시) */
export function isTrumanIllusion(m: Member, roundIndex: number) {
  return !!(
    m.sakuraDecoy
    && m.sakuraDecoy.mode === 'truman'
    && roundIndex >= m.sakuraDecoy.startIndex
    && m.sakuraDecoy.roundsLeft > 0
  )
}

export function displayScoreOf(m: Member, roundIndex: number) {
  if (isTrumanIllusion(m, roundIndex) && m.sakuraDecoy) {
    return m.score + m.sakuraDecoy.fakeScore
  }
  return m.score
}

export function isFlameKimActive(m: Member, roundIndex: number, _room?: Room | null) {
  return !!(m.flameKim && roundIndex >= m.flameKim.startIndex && m.flameKim.roundsLeft > 0)
}

/** 쪼아요~: 아직 끝까지 안 들은 벌칙 곡 (안전 시각이 지나면 스스로 해제) */
export function activePeckSong(m: Member) {
  const p = m.peckSong
  if (!p) return null
  if (p.hardEndsAt > 0 && p.hardEndsAt <= Date.now()) {
    m.peckSong = null
    return null
  }
  return p
}

export function playbackRateFor(m: Member, roundIndex: number, room?: Room | null): number | null {
  for (const b of activeBuffsAt(m, roundIndex, room)) {
    if (b.effectType === 'slow_playback') {
      const r = Number(b.effectValue.rate)
      if (Number.isFinite(r) && r > 0) return r
    }
  }
  return null
}

export function slowStarterDelaySec(m: Member, roundIndex: number, room?: Room | null): number | null {
  const b = activeBuffsAt(m, roundIndex, room).find((x) => x.effectType === 'slow_starter')
  if (!b) return null
  const n = Number(b.effectValue.delaySec)
  return Number.isFinite(n) && n > 0 ? n : 7
}

export function slowStarterBonus(m: Member, roundIndex: number, room?: Room | null): number {
  const b = activeBuffsAt(m, roundIndex, room).find((x) => x.effectType === 'slow_starter')
  if (!b) return 0
  const n = Number(b.effectValue.bonus)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2
}

/** 보너스 타임: 남이 맞힌 뒤 windowMs 안에 같은 답을 치면 추가 인정 */
export function hasFollowAnswer(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).some((b) => b.effectType === 'follow_answer')
}

/** 커뮤증: 정답이어도 successChance 확률로만 인정 */
export function muffledAnswerBuff(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'muffled_answer') || null
}

/** 인정 확률 (0~1) */
export function muffledSuccessChance(effectValue: Record<string, unknown>) {
  const raw = Number(effectValue.successChance)
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.3
}

/** true면 이번 정답은 «안 들린» 걸로 흘려보낸다 */
export function rollMuffledMiss(m: Member, roundIndex: number, room?: Room | null) {
  const b = muffledAnswerBuff(m, roundIndex, room)
  if (!b) return false
  // randomInt(1000)으로 0.1% 단위 추첨 · 성공 구간 밖이면 흘려보낸다
  return randomInt(1000) >= Math.round(muffledSuccessChance(b.effectValue) * 1000)
}

export function lateAnswerBuff(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'late_answer') || null
}

/** 차차차: 보유 중 · 선답 직후 windowMs 안 동시 입력이면 중복 정답에서 우선권 */
export function chaChaHeld(m: Member | null | undefined) {
  const card = findHeldByType(m, 'cha_cha_cha')
  if (!card) return null
  const value = parseEffectValue(card.effectValue)
  const chargesRaw = Number(value.charges)
  const charges = Number.isFinite(chargesRaw) && chargesRaw > 0 ? Math.floor(chargesRaw) : 0
  if (charges <= 0) return null
  const windowRaw = Number(value.windowMs)
  const windowMs = Number.isFinite(windowRaw) && windowRaw > 0 ? Math.floor(windowRaw) : 500
  return { card, name: card.name, charges, windowMs, value }
}

/** 핑/지터 완충 — 의도 창(0.5초)은 effectValue, 여기에 소량만 가산 */
export const CHA_CHA_GRACE_MS = 150

/** 차차차 1회 소모. 잔여 0이면 held 해제 */
export function consumeChaChaCharge(m: Member): { name: string; chargesLeft: number } | null {
  const held = chaChaHeld(m)
  if (!held) return null
  const chargesLeft = held.charges - 1
  if (chargesLeft > 0) {
    held.card.effectValue = JSON.stringify({ ...held.value, charges: chargesLeft, windowMs: held.windowMs })
  } else {
    m.usedAugments.push(held.name)
    removeHeldById(m, held.card.id)
  }
  return { name: held.name, chargesLeft }
}

export function followAnswerWindowMsForRoom(room: Room): number {
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

export function openFollowAnswerWindow(
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
export const FOLLOW_ANSWER_GRACE_MS = 250

/** 보너스 타임 등: 정답 시 추가 점수 */
export function scoreBonusFor(m: Member, roundIndex: number, room?: Room | null): number {
  let extra = 0
  for (const b of activeBuffsAt(m, roundIndex, room)) {
    if (b.effectType !== 'score_bonus' && b.effectType !== 'mud_fight') continue
    const n = Number(b.effectValue.bonus)
    if (Number.isFinite(n) && n > 0) extra += Math.floor(n)
  }
  return extra
}

/** 진조이니라 등: politeSuffix.bonus */
export function politeSuffixBonus(m: Member, roundIndex: number, room?: Room | null): number {
  if (!isPoliteSuffixActive(m, roundIndex, room) || !m.politeSuffix) return 0
  const n = Number(m.politeSuffix.bonus)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 무지개 반사: 활성 버프 또는 보유 중(지목 시 자동 사용) 실드 소모 */
export function takeReflectShield(m: Member, roundIndex: number): ActiveBuff | null {
  const idx = m.activeBuffs.findIndex(
    (b) => b.effectType === 'reflect_debuff' && buffApplies(b, roundIndex),
  )
  if (idx >= 0) {
    const [buff] = m.activeBuffs.splice(idx, 1)
    return buff
  }
  // 보유만 하고 아직 안 쓴 무지개 → 지목당하면 자동 사용
  const heldReflect = findHeldByType(m, 'reflect_debuff')
  if (heldReflect) {
    const value = parseEffectValue(heldReflect.effectValue)
    const roundsRaw = Number(value.rounds)
    const roundsLeft = Number.isFinite(roundsRaw) && roundsRaw > 0 ? Math.floor(roundsRaw) : 1
    const buff: ActiveBuff = {
      name: heldReflect.name,
      description: heldReflect.description || '',
      effectType: 'reflect_debuff',
      effectValue: value,
      imageUrl: heldReflect.imageUrl,
      usedByNickname: m.nickname,
      startIndex: roundIndex,
      roundsLeft,
    }
    m.usedAugments.push(heldReflect.name)
    removeHeldById(m, heldReflect.id)
    return buff
  }
  return null
}

export function alienQwertyBuff(m: Member, roundIndex: number, room?: Room | null) {
  return activeBuffsAt(m, roundIndex, room).find((b) => b.effectType === 'alien_qwerty_answer') || null
}

export type AudioTrick = {
  mode: 'replace' | 'overlay'
  youtubeUrl: string
  startSec: number
  endSec: number | null
  /** 같은 구간을 다시 틀어야 할 때 바뀌는 값 (간다드래프트 2회차) */
  epoch?: number
  label: string
  source: 'mud' | 'sakura' | 'flame' | 'party'
}

/** 방 노래를 «대체»하는 트릭 (트루먼 > 진흙탕 > 세노·에라모르겠다) */
export function resolveReplaceTrick(m: Member, room: Room): AudioTrick | null {
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
  return null
}

/**
 * 지금 들리는 노래와 «동시»에 흐르는 트릭 (풍악 > 불꽃남자).
 * 교체곡(진흙탕·세노·트루먼)이 걸려 있어도 오버레이는 같이 재생돼야 하므로
 * 교체 트릭과 별도 슬롯으로 내려보낸다.
 */
export function resolveOverlayTrick(m: Member, room: Room): AudioTrick | null {
  if (room.status === 'duel') return null
  // 풍악(본인 제외)·간다드래프트(전원): 방 곡 + 다른 곡 동시 재생
  for (const b of activeBuffsAt(m, room.index, room)) {
    if (b.effectType !== 'party_music_others' && b.effectType !== 'party_music_all') continue
    const youtubeUrl = String(b.effectValue.bgmUrl || b.effectValue.youtubeUrl || '').trim()
    if (!youtubeUrl) continue
    const startRaw = Number(b.effectValue.bgmStartSec ?? b.effectValue.startSec)
    const startSec = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0
    // 구간(endSec)이 지정돼 있으면 그 구간을 «1회만» 재생한다 (간다드래프트 등)
    const endRaw = Number(b.effectValue.bgmEndSec ?? b.effectValue.endSec)
    const endSec = Number.isFinite(endRaw) && endRaw > startSec ? Math.floor(endRaw) : null
    const epochRaw = Number(b.effectValue.epoch)
    return {
      mode: 'overlay',
      youtubeUrl,
      startSec,
      endSec,
      epoch: Number.isFinite(epochRaw) ? epochRaw : b.startIndex,
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
