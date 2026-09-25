/**
 * 방 상태 직렬화(room:state — 보는 사람마다 가릴 건 가림)와 채팅 송신.
 * 코로나 격리 · 야차룰 관전 채팅처럼 받는 사람을 고르는 규칙도 여기 둔다.
 */
import type { Server } from 'socket.io'
import { hangulToQwertyMistype } from './answer.js'
import { buildSpoilBySlot, findArtistSlots, findTitleSlot } from './answerFormat.js'
import type { Member, Room } from './gameTypes.js'
import { heldList } from './heldAugments.js'
import {
  DEBUFF_AUGMENT_TYPES,
  activeBuffsAt,
  activePeckSong,
  alienQwertyBuff,
  answerBlockPublic,
  answerDelayRemainingMs,
  displayScoreOf,
  hasEarlyChosung,
  hasHiddenRun,
  hasIncomingAugmentEffect,
  isAnswerDelayActive,
  isAnswerProxyActive,
  isChatIsolateActive,
  isChatIsolatePending,
  isChatMuted,
  isFlameKimActive,
  isGabukiActive,
  isNoSkipActive,
  isPoliteSuffixActive,
  isSakuraDecoyActive,
  isTrumanIllusion,
  isolateGroupOf,
  knowButCantBuff,
  playbackRateFor,
  resolveOverlayTrick,
  resolveReplaceTrick,
  slowStarterDelaySec,
} from './memberBuffs.js'
import { clampRecentSongPenalty } from './questionQueue.js'
import { MAX_SPECTATORS, isDuelParticipant } from './roomMembers.js'
import { readingRoomPatch } from './readingMode.js'
import { buffApplies } from './roundRules.js'

export function systemChat(io: Server, room: Room, text: string) {
  io.to(room.id).emit('chat:message', {
    id: Date.now() + Math.floor(Math.random() * 1000),
    userId: '',
    nickname: '시스템',
    text,
    system: true,
    at: Date.now(),
  })
}

/** 플레이어 채팅 · 코로나 격리 중이면 같은 조에게만 전달 */
export function emitPlayerChat(
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
  const payload = { ...msg, id: nextChatId() }
  if (!isChatIsolateActive(room) || msg.system) {
    io.to(room.id).emit('chat:message', payload)
    return
  }
  const iso = room.chatIsolate!
  const group = isolateGroupOf(iso, msg.userId)
  for (const other of room.members.values()) {
    // 관전자는 격리 대상이 아니다. 조가 없다고 그냥 빼면 채팅이 통째로 안 보인다.
    if (other.isSpectator) {
      io.to(other.socketId).emit('chat:message', payload)
      continue
    }
    // 수신자도 미배정일 수 있다 (격리 후 입장) — 여기서 조를 확정한다
    if (isolateGroupOf(iso, other.userId) === group) {
      io.to(other.socketId).emit('chat:message', payload)
    }
  }
}

/** 야차룰 관전 채팅 — 대결 당사자에게는 안 보냄 */
export function emitSpectatorChat(
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

let chatIdSeq = 0

export function nextChatId() {
  chatIdSeq += 1
  return Date.now() * 1000 + (chatIdSeq % 1000)
}

export function roomState(room: Room, viewerUserId?: string) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    status: room.status,
    maxPlayers: room.maxPlayers,
    maxSpectators: MAX_SPECTATORS,
    isPrivate: !!room.isPrivate,
    /** 방 멤버에게만 전달 · 비공개방 초대코드 (로비 목록에는 안 나감) */
    code: room.isPrivate ? room.code : null,
    genreCounts: room.genreCounts,
    genreBankCounts: room.genreBankCounts || {},
    answerMode: room.answerMode || 'title_artist',
    augmentsEnabled: room.augmentsEnabled !== false,
    recentSongPenalty: clampRecentSongPenalty(room.recentSongPenalty),
    noSkipActive: isNoSkipActive(room),
    noSkipBy: isNoSkipActive(room) ? room.noSkip!.byName : null,
    noSkipRoundsLeft: isNoSkipActive(room) ? room.noSkip!.roundsLeft : null,
    ...readingRoomPatch(room, viewerUserId),
    upcomingGenreCounts: (() => {
      // 큐가 길어도 배열 복사 없이 센다 (roomState는 매우 자주 만들어진다)
      const counts: Record<string, number> = {}
      for (let i = room.index + 1; i < room.queue.length; i += 1) {
        const genre = room.queue[i].genre
        counts[genre] = (counts[genre] || 0) + 1
      }
      return counts
    })(),
    members: [...room.members.values()].map((m) => {
      const block = answerBlockPublic(m, room.index, room)
      const spoilQ = room.queue[room.index]
      // 트루먼에게 진짜 곡 정답 힌트를 보내 환상이 깨지는 중첩을 방지한다.
      const truman = isTrumanIllusion(m, room.index)
      /**
       * 스포일러는 본인에게만 보여야 한다.
       *
       * 예전에는 이 값이 members[] 안에 담긴 채 방 전체로 브로드캐스트됐다.
       * 클라이언트가 `me?.knowSpoilTitle` 로 자기 것만 읽고 있었을 뿐이라,
       * 증강이 없는 사람도 소켓 페이로드에서 남의 칸을 열면 정답이 그대로 보였다.
       * 뷰어가 지정되지 않은 브로드캐스트에서는 아무에게도 채우지 않는다.
       */
      const spoilVisible = viewerUserId != null && m.userId === viewerUserId
      const spoilActive = spoilVisible && !!(spoilQ && room.status !== 'duel' && !truman && knowButCantBuff(m, room.index, room))
      const alienActive = spoilVisible && !!(spoilQ && room.status !== 'duel' && !truman && !spoilActive && alienQwertyBuff(m, room.index, room))
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
      /** 끊겨서 유예 중 — UI에서 흐리게 표시 */
      disconnected: m.disconnectedAt != null,
      chatColor: m.isSpectator ? null : (m.chatColor ?? null),
      augmentBusy: !m.isSpectator && hasIncomingAugmentEffect(m, room),
      /** 보유 슬롯 (최대 2칸) · effectValue는 내려보내지 않는다 */
      heldAugments: m.isSpectator ? [] : heldList(m).map((h) => ({
        id: h.id,
        name: h.name,
        description: h.description,
        imageUrl: h.imageUrl,
        effectType: h.effectType,
        tier: h.tier,
        locked: !!h.locked,
        lockedByNickname: h.lockedByNickname || null,
      })),
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
      audioScramble: (() => {
        if (room.status === 'duel') return null
        const b = activeBuffsAt(m, room.index, room).find((x) => x.effectType === 'audio_scramble')
        if (!b) return null
        const periodRaw = Number(b.effectValue.periodMs)
        const seedRaw = Number(b.effectValue.seed)
        return {
          periodMs: Number.isFinite(periodRaw) && periodRaw >= 1000 ? Math.floor(periodRaw) : 5000,
          seed: Number.isFinite(seedRaw) && seedRaw > 0 ? Math.floor(seedRaw) : 1,
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
      audioTrick: resolveReplaceTrick(m, room),
      audioOverlay: resolveOverlayTrick(m, room),
      /** 쪼아요~ 벌칙 곡 · 라운드/스킵과 무관하게 곡이 끝날 때까지 재생 */
      peckSong: (() => {
        const p = activePeckSong(m)
        if (!p) return null
        // 재생 URL은 당사자만 — 남에게 보내면 클라 버그 시 전원에게 들릴 수 있다
        if (viewerUserId && viewerUserId !== m.userId) return null
        return {
          id: p.id,
          youtubeUrl: p.youtubeUrl,
          startSec: p.startSec,
          endSec: p.endSec,
          startedAt: p.startedAt,
          byName: p.byName,
          byNickname: p.byNickname,
        }
      })(),
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
      // 발동 전에는 대상 닉네임 비공개 (적용 칸 미리보기 방지)
      flameKimTarget: (room.status !== 'duel' && isFlameKimActive(m, room.index, room))
        ? (m.flameKim?.targetNickname || null)
        : null,
      flameKimBy: m.flameKim?.byName || null,
      answerProxyActive: (isAnswerProxyActive(m, room.index)
        || !!(m.answerProxy && room.index < m.answerProxy.startIndex)),
      answerProxyPending: !!(m.answerProxy && room.index < m.answerProxy.startIndex),
      answerProxyPendingScore: m.answerProxy?.pendingScore ?? 0,
      answerProxyRoundsLeft: m.answerProxy?.roundsLeft ?? null,
      activeBuffs: m.activeBuffs
        .filter((b) => {
          // 다음 R 예약 디버프는 roomState에 안 실어 대상이 미리 확인하지 못함.
          // 단 본인이 건 것(영역전개·코로나·진흙탕)은 남겨야 시전자가 발동 여부를 안다.
          if (
            room.index < b.startIndex
            && DEBUFF_AUGMENT_TYPES.has(b.effectType)
            && b.usedByUserId !== m.userId
          ) return false
          return true
        })
        .map((b) => {
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

/** 이번 라운드에 정답 스포일러를 보고 있어야 하는 사람인가 */
export function hasSpoiler(room: Room, m: Member) {
  const q = room.queue[room.index]
  if (!q || room.status === 'duel') return false
  if (isTrumanIllusion(m, room.index)) return false
  return !!(knowButCantBuff(m, room.index, room) || alienQwertyBuff(m, room.index, room))
}

/**
 * room:state 브로드캐스트.
 *
 * 스포일러 보유자에게만 개인화된 상태를 따로 보낸다. 보유자가 없으면 예전처럼
 * 한 번만 쏜다 — roomState 는 매우 자주 만들어지므로 평상시 비용을 늘리지 않는
 * 게 중요하다. (보유자가 있는 라운드에서만 인원수만큼 직렬화가 더 든다.)
 */
export function emitRoomState(io: Server, room: Room) {
  const holders = [...room.members.values()].filter((m) => m.socketId && hasSpoiler(room, m))
  if (holders.length === 0) {
    io.to(room.id).emit('room:state', roomState(room))
    return
  }
  io.to(room.id).except(holders.map((m) => m.socketId)).emit('room:state', roomState(room))
  for (const m of holders) {
    io.to(m.socketId).emit('room:state', roomState(room, m.userId))
  }
}
