/**
 * 증강 사용(발동) 처리 — effectType 별 효과 적용과 사용 알림.
 * 라운드 종료만은 socket.ts 가 갖고 있어서 부팅 때 setEndRoundHook 으로 주입받는다
 * (socket.ts ↔ 이 파일 순환 import 를 피하려고).
 */
import type { Server } from 'socket.io'
import {
  formatSlotAnswers,
  formatSlotAnswersPlain,
  formatTitleArtistAnswers,
  hiddenUnlockedForQuestion,
} from './answerFormat.js'
import { roomHasHiddenSlots } from './augmentOffer.js'
import { pickDecoyTrack, pickNamedTrack } from './decoyTracks.js'
import type { ActiveBuff, Member, QuestionRuntime, Room } from './gameTypes.js'
import {
  addHeldAugment,
  findHeldByName,
  hasHeldSpace,
  removeHeldById,
  usableHeld,
} from './heldAugments.js'
import {
  DEBUFF_AUGMENT_TYPES,
  answerScoreFor,
  canReceiveTargetAugment,
  hasHiddenRun,
  hasReplaceAudioConflict,
  hiddenRunGainForAnswer,
  isNoSkipActive,
  muffledSuccessChance,
  politeSuffixBonus,
  rejectBusyTarget,
  riskyGainForAnswer,
  scoreBonusFor,
  slowStarterBonus,
  takeReflectShield,
} from './memberBuffs.js'
import {
  banGenreAndRedistribute,
  equalizeGenreRemaining,
  swapExtremeGenreRemaining,
} from './questionQueue.js'
import { pickRandomIndex, shuffleArray } from './random.js'
import { emitRoomState } from './roomBroadcast.js'
import { connectedPlayerCount, isPlayingMember, playerCount, playerMembers } from './roomMembers.js'
import {
  applyFlameKimOnCorrect,
  applyGabukiOnCorrect,
  bankAnswerProxyPoints,
  shareLinkedScoreGain,
  tryResolveWagerWin,
  tryTriggerAccuseSleep,
} from './roundSettlement.js'
import { parseEffectValue, skipVotesNeeded } from './roundRules.js'

type EndRoundReason = 'cleared' | 'skip' | 'timeout'
let endRoundHook: ((io: Server, room: Room, reason: EndRoundReason) => void) | null = null

/** socket.ts 의 endRound 를 등록한다 (강제 스킵·한입만처럼 라운드를 끝내는 증강용) */
export function setEndRoundHook(fn: (io: Server, room: Room, reason: EndRoundReason) => void) {
  endRoundHook = fn
}

function endRound(io: Server, room: Room, reason: EndRoundReason) {
  if (!endRoundHook) throw new Error('endRound hook not registered')
  endRoundHook(io, room, reason)
}

/** 쪼아요~ 기본 벌칙 곡 (시드 effectValue.youtubeUrl 이 우선) */
export const PECK_SONG_URL = 'https://www.youtube.com/watch?v=SYacnl6MpSA'

export const TARGET_AUGMENT_TYPES = new Set([
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
  'zero_both',
  'muffled_answer',
  'accuse_sleep',
  'gabuki_mark',
  'steal_held_augment',
  'hand_over_augment',
  'flame_kim',
  'hide_hints',
  'audio_stutter',
  'audio_scramble',
  'score_share',
  'destroy_held_augment',
  // 쪼아요~는 디버프 중첩 금지에서 «빠져 있다» — 이미 걸린 사람·같은 사람에게도 계속 쓸 수 있다
  'peck_song',
])

export const GENRE_AUGMENT_TYPES = new Set(['ban_genre', 'genre_early_chosung'])

export const AUTO_APPLY_AUGMENT_TYPES = new Set(['water_ghost', 'combo_clear_double'])

/** 수동 사용 불가 · 지목당하면 자동 발동 */
export const PASSIVE_HELD_AUGMENT_TYPES = new Set(['reflect_debuff'])

/** 수동 사용 불가 · 조건 충족 시 자동 소모 (차차차 등) */
export const AUTO_TRIGGER_HELD_AUGMENT_TYPES = new Set(['cha_cha_cha'])

/** 적용하면 그 자리에서 라운드가 끝나는 증강 (혼돈은 이걸 마지막에 돌린다) */
export const ROUND_ENDING_AUGMENT_TYPES = new Set(['force_skip', 'auto_reveal_slot'])

/** 사용 시 예약되고 다음 라운드부터 실제 효과가 시작되는 공개형 증강 */
export const NEXT_ROUND_PUBLIC_AUGMENT_TYPES = new Set([
  'mute_chat',
  'soft_chat_mute',
  'polite_suffix',
  'answer_block',
  'muffled_answer',
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
  'audio_scramble',
  'score_share',
  'answer_block_others',
])

export type AugmentLike = {
  name: string
  description: string
  effectType: string
  effectValue: string | null
  imageUrl?: string | null
  tier?: string
}

export type ApplyAugmentResult = {
  ok: boolean
  hint: string | null
  chatText: string | null
  /** true면 방 전체 사용 연출·시스템 채팅 생략 (트루먼쇼 등) */
  silent?: boolean
  /** true면 held 소모·usedAugments 기록 생략 (넘어가요 잔여 충전 등) */
  keepHeld?: boolean
  /** 사용 연출에 띄울 카드를 바꾼다 (조커뽑기 → 강탈한 카드) */
  usedCard?: AugmentLike
  /** 지정 시 이 유저를 제외한 멤버에게만 사용 연출·채팅 전송 */
  excludeNotifyUserId?: string
}

export function formatActivatedAugmentMessage(message: string) {
  const activated = message
    .replace(/다음\s+(\d+)\s*R/g, '지금부터 $1R')
    .replace(/다음\s+라운드에/g, '이번 라운드에')
    .replace(/다음\s+라운드부터/g, '이번 라운드부터')
    .replace(/다음\s+라운드/g, '이번 라운드')
  return `발동! ${activated}`
}

export function flushPendingAugmentNotices(io: Server, room: Room) {
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
export async function applyAugmentEffect(
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

  // 관전자 지목은 증강 종류와 무관하게 막는다. 아래 중첩 검사(rejectBusyTarget)에만
  // 두면 기생수처럼 디버프가 아닌 타겟 증강이 관전자에게 걸려 영영 정산이 안 된다.
  if (TARGET_AUGMENT_TYPES.has(aug.effectType)) {
    const ids = targetUserIds?.length ? targetUserIds : (targetUserId ? [targetUserId] : [])
    for (const id of ids) {
      if (room.members.get(id)?.isSpectator) {
        return { ok: false, hint: '관전자는 지목할 수 없습니다', chatText: null }
      }
    }
  }

  // 디버프 타겟만 중첩 검사 (이득·강탈 등은 디버프 있어도 가능)
  if (TARGET_AUGMENT_TYPES.has(aug.effectType) && DEBUFF_AUGMENT_TYPES.has(aug.effectType)) {
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
        usedByUserId: m.userId,
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
      emitRoomState(io, room)
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

  // 목소리 작음: 대상의 정답이 확률로 «안 들린» 처리 (기본 50%)
  if (aug.effectType === 'muffled_answer') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const muffRounds = rounds > 0 ? rounds : 3
    const successChance = muffledSuccessChance(value)
    const pct = Math.round(successChance * 100)
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    const startIndex = room.index + 1
    victim.activeBuffs = victim.activeBuffs.filter((b) => b.effectType !== 'muffled_answer')
    victim.activeBuffs.push({
      name: reflected ? shield!.name : aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: muffRounds, successChance },
      imageUrl: aug.imageUrl || null,
      usedByNickname: reflected ? intended.nickname : user.nickname,
      usedByUserId: reflected ? intended.userId : m.userId,
      startIndex,
      roundsLeft: muffRounds,
    })
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${muffRounds}R · 정답 ${pct}%만 인정`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${muffRounds}R · 정답 ${pct}%만 인정`,
      chatText: `${victim.nickname}은 ${aug.name}입니다`,
    }
  }

  // 조로룰: 방 전체가 N라운드 동안 스킵 불가 (투표·강제 스킵 모두)
  if (aug.effectType === 'no_skip') {
    const noSkipRounds = rounds > 0 ? rounds : 3
    const startIndex = room.index
    room.noSkip = {
      startIndex,
      roundsLeft: noSkipRounds,
      byName: aug.name,
      byNickname: user.nickname,
    }
    // 이미 모인 표는 무효 — 안 그러면 과반이 차 있던 라운드가 그대로 넘어간다
    room.skipVotes = new Set()
    io.to(room.id).emit('round:skip_update', { votes: 0, need: skipVotesNeeded(connectedPlayerCount(room)) })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${noSkipRounds}R · 방 전체 스킵 불가`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${noSkipRounds}R 동안 이 방은 스킵할 수 없습니다`,
    }
  }

  // 간다드래프트: 본인 포함 전원에게 방 곡 + 지정 곡 동시 재생 · 충전 N회
  if (aug.effectType === 'party_music_all') {
    const partyRounds = rounds > 0 ? rounds : 1
    const youtubeUrl = String(value.youtubeUrl || '').trim()
    if (!youtubeUrl) return { ok: false, hint: '재생할 영상 주소가 없습니다', chatText: null }
    const startRaw = Number(value.startSec)
    const startSec = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0
    // 지정 구간이 있으면 그 구간만 1회 재생한다 — 여기서 빠뜨리면 클라가 끝까지 틀어버린다
    const endRaw = Number(value.endSec)
    const endSec = Number.isFinite(endRaw) && endRaw > startSec ? Math.floor(endRaw) : null
    // 같은 라운드에 2회차를 써도 구간이 다시 돌도록 매번 새 값을 준다
    const epoch = Date.now()
    // 즉시 — room:state의 audioOverlay로 바로 내려가 이번 라운드부터 겹쳐 재생된다
    const startIndex = room.index
    for (const other of room.members.values()) {
      if (other.isSpectator) continue
      other.activeBuffs = other.activeBuffs.filter(
        (b) => b.effectType !== 'party_music_others' && b.effectType !== 'party_music_all',
      )
      other.activeBuffs.push({
        name: aug.name,
        description: aug.description,
        effectType: aug.effectType,
        effectValue: { rounds: partyRounds, youtubeUrl, startSec, endSec, epoch },
        imageUrl: aug.imageUrl || null,
        usedByNickname: user.nickname,
        startIndex,
        roundsLeft: partyRounds,
      })
    }
    const chargesRaw = Number(value.charges)
    let charges = Number.isFinite(chargesRaw) && chargesRaw > 0 ? Math.floor(chargesRaw) : 1
    charges -= 1
    // 혼돈·자동 발동으로 들어오면 보유 슬롯에 카드가 없다 — 그땐 잔여 횟수를 기록하지 않는다
    const heldCard = findHeldByName(m, aug.name)
    const keepHeld = charges > 0 && !!heldCard
    if (keepHeld && heldCard) heldCard.effectValue = JSON.stringify({ ...value, charges })
    const leftNote = keepHeld ? ` · 남은 ${charges}회` : ''
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${partyRounds}R · 전원 방 곡과 동시 재생${leftNote}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${partyRounds}R 동안 전원에게 방 노래와 같이 들립니다${keepHeld ? ` (남은 ${charges}회)` : ''}`,
      keepHeld,
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
      usedByUserId: m.userId,
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
    // 관전자는 지목 대상이 아니므로 인원 계산에서 빼야 한다 (클라 판정과 동일)
    const solo = playerCount(room) < 2
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
    if (playerCount(room) < 2) {
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

  if (aug.effectType === 'audio_scramble') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const scrambleRounds = rounds > 0 ? rounds : 3
    const periodRaw = Number(value.periodMs)
    const periodMs = Number.isFinite(periodRaw) && periodRaw >= 1000 ? Math.floor(periodRaw) : 5000
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield
    const startIndex = room.index + 1
    // 점프 지점은 (seed · 라운드 · 구간번호)로 클라가 계산한다 — 서버가 매번 안 알려줘도
    // 새로고침·늦게 들어온 사람까지 같은 자리로 튄다 (스타카토와 같은 방식)
    const seed = 1 + Math.floor(Math.random() * 0xffffff)
    victim.activeBuffs = victim.activeBuffs.filter((b) => b.effectType !== 'audio_scramble')
    victim.activeBuffs.push({
      name: reflected ? shield!.name : aug.name,
      description: aug.description,
      effectType: 'audio_scramble',
      effectValue: { rounds: scrambleRounds, periodMs, seed },
      imageUrl: aug.imageUrl || null,
      usedByNickname: reflected ? intended.nickname : user.nickname,
      startIndex,
      roundsLeft: scrambleRounds,
    })
    const everySec = Math.round(periodMs / 100) / 10
    if (reflected) {
      io.to(intended.socketId).emit('augment:hint', {
        name: shield!.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 다음 ${scrambleRounds}R · ${everySec}초마다 구간 점프`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname} → 다음 ${scrambleRounds}R · ${everySec}초마다 구간 점프`,
      chatText: `${user.nickname}님이 [${aug.name}]으로 ${victim.nickname}님의 노래를 헤집었습니다! (다음 ${scrambleRounds}R · ${everySec}초마다 딴 데로 튐)`,
    }
  }

  if (aug.effectType === 'score_share') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    const shareRounds = rounds > 0 ? rounds : 5
    const startIndex = room.index + 1
    // 단방향 기생: 숙주가 득점할 때만 시전자가 같이 오른다. 시전자 득점은 숙주에게 안 간다.
    m.activeBuffs = m.activeBuffs.filter((b) => b.effectType !== 'score_share')
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: 'score_share',
      effectValue: { rounds: shareRounds, partnerId: intended.userId, partnerNickname: intended.nickname },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex,
      roundsLeft: shareRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] ${intended.nickname}님에게 기생 · 다음 ${shareRounds}R 동안 그 사람 득점만큼 나도 획득`,
      chatText: `${user.nickname}님이 [${aug.name}]! 다음 ${shareRounds}R 동안 ${intended.nickname}님이 얻는 점수를 같이 가져갑니다`,
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

  if (aug.effectType === 'peck_song') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    if (!isPlayingMember(intended)) {
      return { ok: false, hint: `[${aug.name}] 지금 지목할 수 없는 대상입니다`, chatText: null }
    }
    const youtubeUrl = String(value.youtubeUrl || '').trim() || PECK_SONG_URL
    const startRaw = Number(value.startSec)
    const startSec = Number.isFinite(startRaw) && startRaw > 0 ? Math.floor(startRaw) : 0
    const endRaw = Number(value.endSec)
    const endSec = Number.isFinite(endRaw) && endRaw > startSec ? Math.floor(endRaw) : null
    const maxRaw = Number(value.maxSec)
    // 구간 지정 곡은 그 길이 + 여유 5초를 안전장치로 쓴다
    const maxSec = Number.isFinite(maxRaw) && maxRaw > 0
      ? Math.floor(maxRaw)
      : (endSec != null ? endSec - startSec + 5 : 900)
    const songLabel = String(value.songLabel || '').trim() || aug.name
    // 무지개 반사: 되돌아오면 시전자가 대신 끝까지 듣는다
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    const reflected = !!shield

    const chargesRaw = Number(value.charges)
    let charges = Number.isFinite(chargesRaw) && chargesRaw > 0 ? Math.floor(chargesRaw) : 1
    charges -= 1
    // 혼돈·자동 발동으로 들어오면 보유 슬롯에 카드가 없다 — 그땐 잔여 횟수를 기록하지 않는다
    const heldCard = findHeldByName(m, aug.name)
    const keepHeld = charges > 0 && !!heldCard
    if (keepHeld && heldCard) heldCard.effectValue = JSON.stringify({ ...value, charges })
    const leftNote = keepHeld ? ` · 남은 ${charges}회` : ''

    const now = Date.now()
    // 라운드·스킵과 무관한 «곡 단위» 벌칙 — 이미 듣고 있어도 처음부터 다시 건다
    victim.peckSong = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      youtubeUrl,
      startSec,
      endSec,
      startedAt: now,
      hardEndsAt: now + maxSec * 1000,
      byName: aug.name,
      byNickname: reflected ? intended.nickname : user.nickname,
    }
    io.to(victim.socketId).emit('augment:hint', {
      name: reflected ? shield!.name : aug.name,
      hint: reflected
        ? `[무지개 반사] 「${songLabel}」을(를) 대신 끝까지 들어야 합니다`
        : `[${aug.name}] 「${songLabel}」 · 끝까지 다 들어야 합니다 (스킵해도 안 멈춤)`,
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
        hint: `[무지개 반사] 되돌아와서 본인이 「${songLabel}」을(를) 끝까지 듣습니다${leftNote}`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
        keepHeld,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${victim.nickname}에게만 「${songLabel}」 끝까지${leftNote}`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${victim.nickname}님에게만 「${songLabel}」을(를) 끝까지 들려줍니다${leftNote}`,
      keepHeld,
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
        usedByUserId: m.userId,
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
    // 히든이 없는 방(제목만·리딩)에서는 「일반 슬롯 0점」만 남아 득점이 완전히 막힌다
    if (!roomHasHiddenSlots(room)) {
      return {
        ok: false,
        hint: `[${aug.name}] 이 방에는 히든 문제가 없어 사용할 수 없습니다`,
        chatText: null,
      }
    }
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

  // 만해: 고른 장르 곡에서만 본인 초성 즉시 공개
  if (aug.effectType === 'genre_early_chosung') {
    const g = (genreName || '').trim()
    if (!g) return { ok: false, hint: '장르를 선택하세요', chatText: null }
    const earlyRounds = rounds > 0 ? rounds : 10
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: earlyRounds, genre: g },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      startIndex: room.index,
      roundsLeft: earlyRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${earlyRounds}R · 「${g}」 곡에서 본인만 초성 즉시 공개`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${earlyRounds}R 동안 「${g}」 곡에서 본인에게만 초성이 즉시 보입니다`,
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

  // 후루베 유라유라: 본인 점수를 버리고 대상 점수도 0으로
  if (aug.effectType === 'zero_both') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) return { ok: false, hint: null, chatText: null }
    // 본인도 같이 0이 되는 자폭기라 무지개 반사로 막히지 않는다 (takeReflectShield 호출 안 함)
    const selfLost = m.score
    const targetLost = intended.score
    m.score = 0
    intended.score = 0
    io.to(intended.socketId).emit('augment:hint', {
      name: aug.name,
      hint: `[${aug.name}] ${user.nickname}님과 함께 0점이 되었습니다 (−${targetLost})`,
      durationMs: 0,
    })
    return {
      ok: true,
      hint: `[${aug.name}] 본인 −${selfLost} · ${intended.nickname} −${targetLost} · 둘 다 0점`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님과 사이좋게 0점이 되었습니다 (본인 −${selfLost} · ${intended.nickname} −${targetLost})`,
    }
  }

  if (aug.effectType === 'steal_from_leader') {
    const amtRaw = Number(value.amount)
    const amount = Number.isFinite(amtRaw) && amtRaw > 0 ? Math.floor(amtRaw) : 1
    const others = playerMembers(room).filter((x) => x.userId !== m.userId)
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

  if (aug.effectType === 'force_skip') {
    if (room.status !== 'playing') {
      return { ok: false, hint: '플레이 중인 문제에만 쓸 수 있습니다', chatText: null }
    }
    // 조로룰: 방 전체 스킵 금지 — 강제 스킵도 막는다 (충전도 소모하지 않음)
    if (isNoSkipActive(room)) {
      return { ok: false, hint: `[${room.noSkip!.byName}] 지금은 스킵할 수 없습니다`, chatText: null }
    }
    const chargesRaw = Number(value.charges)
    let charges = Number.isFinite(chargesRaw) && chargesRaw > 0 ? Math.floor(chargesRaw) : 1
    charges -= 1
    endRound(io, room, 'skip')
    // 혼돈·자동 발동으로 들어오면 보유 슬롯에 카드가 없다 — 없는 카드에 잔여 횟수를 쓰면 유령 데이터가 된다
    const heldCard = findHeldByName(m, aug.name)
    if (charges > 0 && heldCard) {
      const nextVal = { ...value, charges }
      heldCard.effectValue = JSON.stringify(nextVal)
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
    emitRoomState(io, room)
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

  // 내가 왕이 될 상인가: 기간 종료 시 1등이면 +win, 아니면 -lose (settleCrownBet에서 정산)
  if (aug.effectType === 'crown_bet') {
    const betRounds = rounds > 0 ? rounds : 3
    const winRaw = Number(value.win)
    const win = Number.isFinite(winRaw) && winRaw > 0 ? Math.floor(winRaw) : 5
    const loseRaw = Number(value.lose)
    const lose = Number.isFinite(loseRaw) && loseRaw > 0 ? Math.floor(loseRaw) : 3
    m.activeBuffs = m.activeBuffs.filter((b) => b.effectType !== 'crown_bet')
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { rounds: betRounds, win, lose },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      usedByUserId: m.userId,
      startIndex: room.index,
      roundsLeft: betRounds,
    })
    return {
      ok: true,
      hint: `[${aug.name}] ${betRounds}R 뒤 1등이면 +${win}, 아니면 -${lose}`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${betRounds}라운드 뒤 1등이면 +${win}점, 아니면 -${lose}점`,
    }
  }

  // 손모가지: 대상의 보유 증강을 강탈이 아니라 파괴한다
  if (aug.effectType === 'destroy_held_augment') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) {
      return { ok: false, hint: '대상을 선택하세요', chatText: null }
    }
    if (!usableHeld(intended).length) {
      return {
        ok: false,
        hint: `[${aug.name}] ${intended.nickname}님은 보유 증강이 없습니다`,
        chatText: null,
      }
    }
    const shield = takeReflectShield(intended, room.index)
    const victim = shield ? m : intended
    // 2칸이 다 찼으면 어느 걸 부술지는 랜덤 (잠긴 카드는 이미 죽은 카드라 제외)
    const victimCards = usableHeld(victim).filter((h) => h.name !== aug.name)
    const lost = victimCards.length ? victimCards[pickRandomIndex(victimCards.length)] : null
    if (!lost) {
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님이 튕겨냈지만 부술 증강이 없었습니다`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다`,
      }
    }
    const lostName = lost.name
    removeHeldById(victim, lost.id)
    io.to(victim.socketId).emit('augment:hint', {
      name: aug.name,
      hint: `[${aug.name}] 보유 증강 [${lostName}]이(가) 부서졌습니다`,
      durationMs: 0,
    })
    if (shield) {
      return {
        ok: true,
        hint: `[무지개 반사] ${intended.nickname}님에게 튕겨 내 [${lostName}]이(가) 부서졌습니다`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${lostName}]이(가) 대신 부서졌습니다`,
      }
    }
    return {
      ok: true,
      hint: `[${aug.name}] ${intended.nickname}님의 [${lostName}]을(를) 부쉈습니다`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님의 보유 증강을 부쉈습니다`,
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
    const list = playerMembers(room)
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
    const ranked = playerMembers(room).sort((a, b) => b.score - a.score)
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

  // 점수 배율 계열 (점수가 2배 · 묻고 더블로가 · 리신 · 청각X)
  // answerScoreFor 가 activeBuffs 를 보는데 여기 분기가 없어서 버프가 아예 안 쌓이고
  // 마지막 fallthrough 로 빠져 「사용됨」만 뜨고 효과는 0이었다.
  if (
    aug.effectType === 'score_mult'
    || aug.effectType === 'score_mult_no_hint'
    || aug.effectType === 'score_mult_hint_only'
  ) {
    const multRaw = Number(value.mult)
    const mult = Number.isFinite(multRaw) && multRaw > 1 ? multRaw : 2
    const multRounds = rounds > 0 ? rounds : 3
    m.activeBuffs.push({
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { ...value, rounds: multRounds, mult },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      usedByUserId: m.userId,
      startIndex: room.index,
      roundsLeft: multRounds,
    })
    const tradeOff = aug.effectType === 'score_mult_no_hint'
      ? ' · 힌트/초성 없음'
      : aug.effectType === 'score_mult_hint_only'
        ? ' · 노래 안 들림'
        : (value.excludeHidden ? ' · 히든 슬롯 제외' : '')
    return {
      ok: true,
      hint: `[${aug.name}] 지금부터 ${multRounds}R · 점수 ×${mult}${tradeOff}`,
      chatText: `${user.nickname}님이 [${aug.name}]! 지금부터 ${multRounds}R 점수 ×${mult}${tradeOff}`,
    }
  }

  // 정답 공개 가호 (서상원=순간 공개 / 신동혁=한 글자씩)
  if (aug.effectType === 'flash_answer' || aug.effectType === 'delayed_answer') {
    const revealRounds = rounds > 0 ? rounds : 1
    const buff: ActiveBuff = {
      name: aug.name,
      description: aug.description,
      effectType: aug.effectType,
      effectValue: { ...value, rounds: revealRounds },
      imageUrl: aug.imageUrl || null,
      usedByNickname: user.nickname,
      usedByUserId: m.userId,
      startIndex: room.index,
      roundsLeft: revealRounds,
    }
    m.activeBuffs.push(buff)
    // 라운드 시작 훅은 이미 지났으므로 이번 라운드 분은 여기서 바로 쏜다
    const curQ = room.queue[room.index]
    if (curQ && room.status === 'playing') emitAnswerRevealBuffHint(io, room, m, buff, curQ)
    const delaySec = Number(value.delaySec) || 0
    const when = delaySec > 0 ? `시작 ${delaySec}초 후` : '라운드 시작 시'
    return {
      ok: true,
      hint: aug.effectType === 'flash_answer'
        ? `[${aug.name}] 지금부터 ${revealRounds}R · ${when} 정답이 잠깐 보입니다`
        : `[${aug.name}] 지금부터 ${revealRounds}R · ${when} 정답이 한 글자씩 보입니다`,
      chatText: defaultChat,
    }
  }

  // 인수인계: 내 보유 증강 한 장을 상대에게 떠넘긴다.
  // 받은 사람은 그 카드를 «쓸 수 없고», 다음 증강 선택 때 다른 보관 증강과 같이 사라진다.
  if (aug.effectType === 'hand_over_augment') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) {
      return { ok: false, hint: '대상을 선택하세요', chatText: null }
    }
    // 넘길 카드 = 인수인계를 뺀 내 카드. 그런 게 없으면 인수인계 자체를 떠넘긴다
    const mine = usableHeld(m).filter((h) => h.name !== aug.name)
    const card = mine.length ? mine[pickRandomIndex(mine.length)] : findHeldByName(m, aug.name)
    if (!card) return { ok: false, hint: `[${aug.name}] 넘길 증강이 없습니다`, chatText: null }
    const shield = takeReflectShield(intended, room.index)
    if (shield) {
      // 되돌아오면 넘기려던 카드가 내 손에서 그대로 잠긴다
      card.locked = true
      card.lockedByNickname = intended.nickname
      io.to(intended.socketId).emit('augment:hint', {
        name: shield.name,
        hint: `[무지개 반사] ${user.nickname}님의 [${aug.name}]을(를) 되돌려보냈습니다`,
        durationMs: 0,
      })
      return {
        ok: true,
        hint: `[무지개 반사] 「${card.name}」이(가) 내 손에서 잠겼습니다`,
        chatText: `${intended.nickname}님의 [무지개 반사]! ${user.nickname}님의 [${aug.name}]이(가) 되돌아갔습니다!`,
      }
    }
    if (!hasHeldSpace(intended)) {
      return {
        ok: false,
        hint: `[${aug.name}] ${intended.nickname}님의 보유 칸이 가득 찼습니다`,
        chatText: null,
      }
    }
    removeHeldById(m, card.id)
    addHeldAugment(intended, {
      id: card.id,
      name: card.name,
      description: card.description,
      effectType: card.effectType || '',
      effectValue: card.effectValue,
      imageUrl: card.imageUrl,
      tier: card.tier,
    }, { locked: true, lockedByNickname: user.nickname })
    io.to(intended.socketId).emit('augment:hint', {
      name: aug.name,
      hint: `[${aug.name}] ${user.nickname}님이 「${card.name}」을(를) 떠넘겼습니다 · 사용 불가 · 다음 증강 선택 때 사라집니다`,
      durationMs: 0,
    })
    return {
      ok: true,
      hint: `[${aug.name}] ${intended.nickname}님에게 「${card.name}」을(를) 떠넘겼습니다`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님에게 「${card.name}」을(를) 떠넘겼습니다 (받은 사람은 못 씁니다)`,
    }
  }

  if (aug.effectType === 'steal_held_augment') {
    const intended = targetUserId ? room.members.get(targetUserId) : null
    if (!intended || intended.userId === m.userId) {
      return { ok: false, hint: '대상을 선택하세요', chatText: null }
    }
    if (!usableHeld(intended).length) {
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
    const pool = usableHeld(intended)
    const stolen = pool[pickRandomIndex(pool.length)]
    // 내 조커뽑기 카드는 사용 처리 «뒤»에 빠진다 — 칸이 없으면 먼저 비워야 강탈품이 들어간다
    if (!hasHeldSpace(m)) {
      const self = findHeldByName(m, aug.name)
      if (self) removeHeldById(m, self.id)
    }
    if (!hasHeldSpace(m)) {
      return { ok: false, hint: `[${aug.name}] 보유 칸이 가득 찼습니다`, chatText: null }
    }
    removeHeldById(intended, stolen.id)
    addHeldAugment(m, {
      id: stolen.id,
      name: stolen.name,
      description: stolen.description,
      effectType: stolen.effectType || '',
      effectValue: stolen.effectValue,
      imageUrl: stolen.imageUrl,
      tier: stolen.tier,
    })
    return {
      ok: true,
      hint: `[${aug.name}] ${intended.nickname}님의 「${stolen.name}」을(를) 가져왔습니다!`,
      chatText: `${user.nickname}님이 [${aug.name}]! ${intended.nickname}님의 「${stolen.name}」을(를) 가져갔습니다`,
      usedCard: {
        name: stolen.name,
        description: stolen.description,
        effectType: stolen.effectType || '',
        effectValue: stolen.effectValue,
        imageUrl: stolen.imageUrl,
        tier: stolen.tier || undefined,
      },
    }
  }

  // 여기까지 왔다 = 이 effectType 처리 분기가 없다.
  // 예전엔 ok:true 로 흘려보내서 증강만 소모되고 아무 일도 안 일어났다 (혼돈에서 특히 티가 남).
  console.warn('[augment] 처리되지 않은 effectType', aug.effectType, aug.name)
  return {
    ok: false,
    hint: `[${aug.name}] 아직 적용할 수 없는 증강입니다`,
    chatText: null,
  }
}

export function pickRandomOtherMember(room: Room, selfId: string): Member | null {
  const others = playerMembers(room).filter((x) => x.userId !== selfId && canReceiveTargetAugment(x, room))
  if (!others.length) return null
  return others[pickRandomIndex(others.length)]
}

export function pickRandomOtherMembers(room: Room, selfId: string, count: number): Member[] {
  const others = playerMembers(room).filter((x) => x.userId !== selfId && canReceiveTargetAugment(x, room))
  if (!others.length || count <= 0) return []
  const shuffled = shuffleArray(others)
  return shuffled.slice(0, Math.min(count, shuffled.length))
}

export function pickChaosAugments(pool: AugmentLike[], count: number): AugmentLike[] {
  const shuffled = shuffleArray(pool)
  if (shuffled.length >= count) return shuffled.slice(0, count)
  const out = [...shuffled]
  while (out.length < count && pool.length > 0) {
    out.push(pool[Math.floor(Math.random() * pool.length)])
  }
  return out
}

/**
 * 서상원의 가호(flash_answer) · 신동혁의 가호(delayed_answer) 정답 공개 힌트.
 * 라운드 시작뿐 아니라 「사용한 그 라운드」에도 쏴야 해서 헬퍼로 분리했다.
 */
export function emitAnswerRevealBuffHint(
  io: Server,
  room: Room,
  m: Member,
  b: ActiveBuff,
  q: QuestionRuntime,
) {
  const delaySec = Number(b.effectValue.delaySec) || 0
  const fire = () => {
    if (room.status !== 'playing') return
    if (room.queue[room.index] !== q) return
    if (b.effectType === 'flash_answer') {
      const ms = Number(b.effectValue.ms)
      io.to(m.socketId).emit('augment:hint', {
        name: b.name,
        hint: formatSlotAnswers(q, hiddenUnlockedForQuestion(room, q)),
        durationMs: Number.isFinite(ms) && ms > 0 ? ms : 1000,
      })
      return
    }
    // delayed_answer — 클라에서 타자기처럼 한 글자씩
    io.to(m.socketId).emit('augment:hint', {
      name: b.name,
      hint: formatSlotAnswersPlain(q, hiddenUnlockedForQuestion(room, q)),
      mode: 'typewriter',
      intervalMs: Number(b.effectValue.charIntervalMs) || 1000,
      durationMs: 0,
    })
  }
  if (delaySec > 0) {
    room.extraTimers.push(setTimeout(fire, delaySec * 1000))
  } else {
    fire()
  }
}
