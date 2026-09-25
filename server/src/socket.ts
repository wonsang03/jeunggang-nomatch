import type { Server, Socket } from 'socket.io'
import { randomInt } from 'node:crypto'
import { prisma } from './config.js'
import { verifyToken, type AuthUser } from './auth.js'
import { hintChosung, isAcceptedAnswer } from './answer.js'
import { loadGenreBankCounts } from './bankCache.js'
import { createSocketGuard, RATE } from './socketGuard.js'
import { markSongPlayed, pruneSongMemory } from './songPick.js'
import { saveGameRecord } from './records.js'
import { S } from './socketSchemas.js'
import type { Member, QuestionRuntime, Room, SlotPublic } from './gameTypes.js'
import { isTitleLikeLabel, josaUlReul, skipVotesNeeded } from './roundRules.js'
import {
  startReadingGame,
  readingAccept,
  readingPass,
  readingClaim,
  readingVote,
  readingTryAnswer,
  readingTryClaimFromChat,
  clampReadingTargetScore,
  type GameMode,
} from './readingMode.js'
import {
  MAX_HELD_AUGMENTS,
  heldList,
  heldCount,
  usableHeld,
  findHeldById,
  findHeldByType,
  addHeldAugment,
  removeHeldById,
  clearHeldAugment,
} from './heldAugments.js'
import {
  playerMembers,
  playerCount,
  connectedPlayerCount,
  MAX_SPECTATORS,
  spectatorCount,
  canJoinAsPlayer,
  canJoinAsSpectator,
  isDuelParticipant,
  emptyMember,
} from './roomMembers.js'
import {
  applyAnswerMode,
  hiddenUnlockedForQuestion,
  formatSlotAnswers,
  formatTitleArtistAnswers,
  formatAlienQwertyAnswers,
} from './answerFormat.js'
import {
  activeBuffsAt,
  isChatMuted,
  isNoSkipActive,
  tickNoSkip,
  tickChatIsolate,
  isPoliteSuffixActive,
  isAnswerBlocked,
  knowButCantBuff,
  answerBlockPublic,
  answerDelayRemainingMs,
  answerScoreFor,
  hasRiskyDouble,
  hasHiddenRun,
  hiddenRunGainForAnswer,
  riskyGainForAnswer,
  isTrumanIllusion,
  slowStarterBonus,
  hasFollowAnswer,
  muffledAnswerBuff,
  rollMuffledMiss,
  lateAnswerBuff,
  chaChaHeld,
  CHA_CHA_GRACE_MS,
  consumeChaChaCharge,
  openFollowAnswerWindow,
  FOLLOW_ANSWER_GRACE_MS,
  scoreBonusFor,
  politeSuffixBonus,
} from './memberBuffs.js'
import {
  ensureGahoPickCandidates,
  shouldOfferAugment,
  pickRandomOfferTier,
  isCollectPieceOfferable,
  offerExcludedTypes,
  pickOfferCandidatesRoomUnique,
  pickRandomFromOfferPool,
  rememberOfferSeen,
  pickTierUpgradeTarget,
  assignHeldFromOfferPick,
  clearAugmentCache,
  getEnabledAugments,
  type CachedAugment,
} from './augmentOffer.js'
import {
  setEndRoundHook,
  TARGET_AUGMENT_TYPES,
  GENRE_AUGMENT_TYPES,
  AUTO_APPLY_AUGMENT_TYPES,
  PASSIVE_HELD_AUGMENT_TYPES,
  AUTO_TRIGGER_HELD_AUGMENT_TYPES,
  NEXT_ROUND_PUBLIC_AUGMENT_TYPES,
  flushPendingAugmentNotices,
  applyAugmentEffect,
  type AugmentLike,
  emitAnswerRevealBuffHint,
} from './augmentEffects.js'
import { pickRandomIndex, shuffleArray } from './random.js'
import {
  clampGenreCounts,
  DEFAULT_RECENT_SONG_PENALTY,
  clampRecentSongPenalty,
  pickQuestions,
} from './questionQueue.js'
import {
  systemChat,
  emitPlayerChat,
  emitSpectatorChat,
  roomState,
  emitRoomState,
} from './roomBroadcast.js'
import {
  tickBuffsAfterRound,
  settleCrownBet,
  settleAnswerProxy,
  settleAllAnswerProxies,
  tryResolveWagerWin,
  settleWagerAnswers,
  applyGabukiOnCorrect,
  settleGabukiMiss,
  settleWaterGhost,
  settleComboClear,
  forceSettleAnswerProxies,
  applyDomainExpansionPulse,
  shareLinkedScoreGain,
  bankAnswerProxyPoints,
  revokeRevealedAnswerCredit,
  tryTriggerAccuseSleep,
  settleTrumanIllusion,
  forceSettleTrumanIllusions,
  applyFlameKimOnCorrect,
  type ScoreTransfer,
} from './roundSettlement.js'
import {
  isGameGenre,
  refreshTrumanDecoyForRound,
  emitIllusionRound,
  pickDuelQuestion,
} from './decoyTracks.js'

const rooms = new Map<string, Room>()

function publicRooms() {
  return [...rooms.values()]
    .filter((r) => !r.isPrivate && r.status === 'lobby')
    .map((r) => ({
      id: r.id,
      name: r.name,
      players: playerCount(r),
      spectators: spectatorCount(r),
      max: r.maxPlayers,
      maxSpectators: MAX_SPECTATORS,
      priv: r.isPrivate,
      genre: Object.keys(r.genreCounts)[0] || '전체',
      gameMode: r.gameMode || 'nomatch',
    }))
}

/**
 * 방 id·비공개 코드 생성.
 *
 * 예전에는 `Math.random().toString(36).slice(2,8)` 이었다. Math.random 은
 * 암호학적 난수가 아니라서(V8은 xorshift128+) 출력 몇 개만 관측하면 이후 값을
 * 예측할 수 있다. 비공개 방에서는 이 코드가 유일한 접근 통제 수단이므로
 * crypto 난수로 뽑는다. id 는 충돌하면 기존 방을 덮어써 버리므로 다시 뽑는다.
 */
const ROOM_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
/** 코드는 사람이 불러주고 받아적는다 — 헷갈리는 0/O/1/I/L 은 뺀다 */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomFrom(alphabet: string, length: number) {
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)]
  return out
}

function newRoomId() {
  for (let i = 0; i < 20; i += 1) {
    const id = randomFrom(ROOM_ID_ALPHABET, 6)
    if (!rooms.has(id)) return id
  }
  // 여기까지 왔으면 방이 비정상적으로 많은 것 — 길이를 늘려 확실히 피한다
  return randomFrom(ROOM_ID_ALPHABET, 10)
}

function newRoomCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = randomFrom(ROOM_CODE_ALPHABET, 6)
    if (![...rooms.values()].some((r) => r.code === code)) return code
  }
  return randomFrom(ROOM_CODE_ALPHABET, 10)
}

/**
 * 게임 중 연결이 끊긴 사람을 기다려 주는 시간.
 * 새로고침·터널 진입·앱 전환 정도는 여기 안에서 대부분 돌아온다.
 */
const RECONNECT_GRACE_MS = 90_000

/** userId → 유예 만료 타이머. 돌아오면 취소한다. */
const graceTimers = new Map<string, NodeJS.Timeout>()

function clearGrace(userId: string) {
  const t = graceTimers.get(userId)
  if (t) {
    clearTimeout(t)
    graceTimers.delete(userId)
  }
}
/** userId → roomId 빠른 조회 */
const userRoomId = new Map<string, string>()
/** 증강 사용 처리 중인 유저 — DB 대기 중 연타로 두 번 적용되는 것을 막는다 */
const augmentUseInFlight = new Set<string>()
const MAX_CHAT_LENGTH = 200
const MAX_ANSWER_LENGTH = 100
const MAX_ROOM_NAME_LENGTH = 30

/** 소켓 입력 문자열 방어 — 비문자열·초장문을 잘라낸다 */
function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.slice(0, maxLength).trim()
}

/** 방에서 고를 수 있는 채팅 색 개수 (실제 색상값은 클라이언트 팔레트) */
const CHAT_COLOR_COUNT = 10

/** 아직 아무도 안 쓴 색을 준다. 다 찼으면 null — 색을 겹쳐 주지 않는다. */
function pickFreeChatColor(room: Room, exceptUserId?: string) {
  const used = new Set<number>()
  for (const other of room.members.values()) {
    if (other.userId === exceptUserId || other.isSpectator) continue
    if (other.chatColor != null) used.add(other.chatColor)
  }
  for (let i = 0; i < CHAT_COLOR_COUNT; i += 1) {
    if (!used.has(i)) return i
  }
  return null
}

function attachMember(room: Room, m: Member) {
  room.members.set(m.userId, m)
  userRoomId.set(m.userId, room.id)
  // 들어오자마자 서로 구분되도록 남는 색을 하나 잡아준다 (본인이 바꿀 수 있음)
  if (m.chatColor == null) m.chatColor = pickFreeChatColor(room, m.userId)
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
          emitRoomState(io, room)
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
      if (b.effectType === 'flash_answer' || b.effectType === 'delayed_answer') {
        emitAnswerRevealBuffHint(io, room, m, b, q)
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

async function prepareTrumanRoundAudio(io: Server, room: Room) {
  for (const m of room.members.values()) {
    if (!isTrumanIllusion(m, room.index) || !m.sakuraDecoy) continue
    // 갱신 실패 시 refreshTrumanDecoyForRound는 지난 라운드 곡을 그대로 남기고
    // false만 돌려준다. youtubeUrl만 보면 첫 라운드 이후로는 항상 채워져 있어
    // 이 가드가 죽으므로 반환값으로 판단해야 한다.
    const refreshed = await refreshTrumanDecoyForRound(room, m)
    // 가짜 곡을 못 구하면 환상 상태로 두면 안 된다. 대상이 진짜 곡을 들으면서
    // 채점만 가짜 곡으로 되기 때문에 아예 맞힐 수 없는 라운드가 된다.
    if (!refreshed || !m.sakuraDecoy.youtubeUrl) {
      settleTrumanIllusion(io, room, m)
    }
  }
}

/**
 * 재접속한 소켓 하나에게 "지금 진행 중인 라운드"를 다시 보낸다.
 *
 * round:start 는 라운드 시작 순간에 한 번만 방송되므로, 중간에 들어온 소켓은
 * 그냥 두면 노래도 타이머도 없는 빈 화면을 본다. 이미 맞혀진 슬롯은 공개 상태로,
 * 남은 시간은 절대 시각(roundEndsAt)으로 그대로 넘긴다.
 */
function emitRoundSnapshot(io: Server, room: Room, socket: Socket, m: Member) {
  if (room.status !== 'playing' && room.status !== 'revealing' && room.status !== 'duel') return
  const q = room.queue[room.index]
  if (!q) return

  // 트루먼(환상) 대상은 진짜 곡이 아니라 가짜 곡을 보고 있어야 한다
  if (isTrumanIllusion(m, room.index)) {
    emitIllusionRound(io, m)
    return
  }

  const openSlots = q.slots.filter((sl) => !sl.hidden)
  const hiddenUnlocked = openSlots.length === 0 || openSlots.every((sl) => !!room.revealed[sl.id])
  const slots: SlotPublic[] = q.slots.map((sl) => {
    const rev = room.revealed[sl.id]
    return {
      id: sl.id,
      label: sl.hidden ? '히든' : sl.label,
      revealed: !!rev,
      hidden: sl.hidden,
      unlocked: sl.hidden ? hiddenUnlocked : true,
      chosung: sl.chosung || '',
      ...(rev ? { answer: rev.answer, by: rev.by } : {}),
    }
  })

  socket.emit('round:start', {
    index: room.index,
    total: room.queue.length,
    endsAt: room.roundEndsAt,
    duration: room.roundDuration,
    genre: q.genre,
    hasHidden: q.slots.some((sl) => sl.hidden),
    youtubeUrl: q.youtubeUrl,
    startSec: q.startSec,
    endSec: q.endSec,
    titleChosung: q.titleChosung,
    artistChosung: q.artistChosung,
    artistHint: q.artistHint || '',
    slots,
    ...(room.status === 'duel' && room.duel
      ? {
          duel: true,
          duelLabel: room.duel.byName,
          duelPenalty: room.duel.penalty,
        }
      : {}),
  })
  socket.emit('round:skip_update', {
    votes: room.skipVotes.size,
    need: skipVotesNeeded(connectedPlayerCount(room)),
  })
}

/**
 * 같은 계정이 다시 붙었을 때 원래 자리로 돌려놓는다.
 * 못 돌려놓을 상황(이미 유예가 끝나 방에서 빠졌거나 방이 사라졌거나)이면 false.
 */
function restoreMember(io: Server, socket: Socket, userId: string): boolean {
  const room = findRoomByUser(userId)
  const m = room?.members.get(userId)
  if (!room || !m) return false

  clearGrace(userId)
  const wasDisconnected = m.disconnectedAt != null
  m.disconnectedAt = null
  // socketId 를 갱신하지 않으면 증강 후보·개인 힌트 같은 1:1 emit 이 전부 죽은 소켓으로 간다
  m.socketId = socket.id
  socket.join(room.id)

  socket.emit('room:state', roomState(room, userId))
  emitRoundSnapshot(io, room, socket, m)

  if (wasDisconnected) {
    systemChat(io, room, `${m.nickname} 님이 돌아왔습니다`)
    emitRoomState(io, room)
  }
  return true
}

/**
 * 서버가 내려가기 직전에 진행 중인 방에 알린다.
 * 방 상태는 메모리에만 있으므로 재시작하면 판이 사라진다 — 적어도 왜 사라졌는지는 알려준다.
 * 타이머를 모두 끄는 이유: 종료 도중 라운드가 넘어가며 DB에 반쪽짜리 전적이 남는 걸 막는다.
 */
export function notifyShutdown(io: Server) {
  for (const room of rooms.values()) {
    clearTimer(room)
    if (room.status === 'lobby' || room.status === 'ended') continue
    systemChat(io, room, '서버가 재시작됩니다 · 잠시 후 다시 접속해 주세요')
  }
  io.emit('server:shutdown', { at: Date.now() })
}

export function registerSocket(io: Server) {
  setEndRoundHook(endRound)

  /**
   * 한 계정이 열 수 있는 동시 소켓 수.
   * 레이트리밋이 계정 단위가 되면서 "소켓을 더 열어 우회"는 막혔지만,
   * 연결 자체를 무한히 만드는 건 여전히 가능하므로 여기서도 상한을 둔다.
   * 새로고침·멀티탭·재연결 유예가 겹칠 수 있어 넉넉하게 잡는다.
   */
  const MAX_SOCKETS_PER_USER = 5

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) return next(new Error('UNAUTHORIZED'))
      const authUser = verifyToken(token)

      let open = 0
      for (const s of io.sockets.sockets.values()) {
        if ((s.data.user as AuthUser | undefined)?.id === authUser.id) open += 1
      }
      if (open >= MAX_SOCKETS_PER_USER) return next(new Error('TOO_MANY_CONNECTIONS'))

      socket.data.user = authUser
      next()
    } catch {
      next(new Error('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthUser
    // 모든 이벤트는 이 등록기를 거친다 — 스키마 검증 · 레이트리밋 · 예외 격리
    const { on } = createSocketGuard(socket, user.id)

    socket.emit('lobby:rooms', publicRooms())

    // 끊겼다 돌아온 경우 원래 방·점수·증강을 그대로 이어받는다.
    // (socket.io 자동 재연결과 새로고침 둘 다 여기로 들어온다)
    restoreMember(io, socket, user.id)

    // 클라이언트가 직접 요청하는 재동기화 (탭 복귀 등)
    on('room:resync', S.none, RATE.action, (_payload, cb) => {
      const ok = restoreMember(io, socket, user.id)
      cb?.({ ok })
    })

    on('ping:rtt', S.none, RATE.poll, (_payload, cb) => {
      // t1=요청 도착, t2=응답 송신. 둘을 나눠 보내야 클라가 서버 처리시간을
      // 네트워크 지연으로 오해하지 않는다 (NTP와 같은 4-타임스탬프 방식).
      // t 는 구버전 클라이언트 호환용 별칭.
      const t1 = Date.now()
      cb?.({ ok: true, t: t1, t1, t2: Date.now() })
    })

    on('room:list', S.none, RATE.poll, () => {
      socket.emit('lobby:rooms', publicRooms())
    })

    on('room:create', S.roomCreate, RATE.heavy, async (payload, cb) => {
      // 이전 방을 정리하지 않으면 그 방에 유령 멤버가 남아 인원·스킵 정족수가 틀어진다
      leaveRoom(io, socket, user.id)
      const profile = await loadMemberProfile(user.id, user.nickname)
      const id = newRoomId()
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
        name: cleanText(payload?.name, MAX_ROOM_NAME_LENGTH) || `${profile.nickname}의 방`,
        hostId: user.id,
        isPrivate: !!payload.isPrivate,
        code: payload.isPrivate ? newRoomCode() : null,
        maxPlayers: Math.min(10, Math.max(2, Math.floor(Number(payload.maxPlayers) || 10))),
        genreCounts,
        genreBankCounts,
        answerMode,
        augmentsEnabled,
        gameMode,
        readingTargetScore,
        reading: null,
        songLastPlayed: new Map(),
        gameSeq: 0,
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
        augmentOfferDealtIds: new Set(),
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
        unplayableReports: new Set(),
        noSkip: null,
      }
      attachMember(room, emptyMember(user.id, profile.nickname, profile.avatarUrl, socket.id))
      rooms.set(id, room)
      socket.join(id)
      io.emit('lobby:rooms', publicRooms())
      const state = roomState(room)
      cb?.({ ok: true, room: state, code: room.code })
      socket.emit('room:state', state)
    })

    on('room:join', S.roomJoin, RATE.action, async (payload, cb) => {
      let room: Room | undefined
      if (payload.code) {
        room = [...rooms.values()].find((r) => r.code === payload.code!.toUpperCase())
      } else if (payload.roomId) {
        room = rooms.get(payload.roomId)
      }
      if (!room) return cb?.({ ok: false, error: '방을 찾을 수 없습니다' })
      if (room.status !== 'lobby') return cb?.({ ok: false, error: '이미 시작된 방입니다' })
      // 비공개방은 초대코드로만 입장 (roomId만으로는 불가)
      if (room.isPrivate) {
        const given = (payload.code || '').trim().toUpperCase()
        if (!room.code || given !== room.code) {
          return cb?.({ ok: false, error: '초대 코드가 필요합니다' })
        }
      }
      const wantSpectator = !!payload.asSpectator
      let joinAsSpectator = wantSpectator
      if (wantSpectator) {
        if (!canJoinAsSpectator(room)) return cb?.({ ok: false, error: '관전 자리가 가득 찼습니다' })
      } else if (!canJoinAsPlayer(room)) {
        if (!canJoinAsSpectator(room)) return cb?.({ ok: false, error: '방이 가득 찼습니다' })
        joinAsSpectator = true
      }

      // 입장 가능 여부를 확인한 뒤에만 이전 방을 정리한다 (실패한 입장으로 원래 방에서 쫓겨나지 않게)
      if (findRoomByUser(user.id)?.id !== room.id) leaveRoom(io, socket, user.id)
      const profile = await loadMemberProfile(user.id, user.nickname)
      room.genreBankCounts = await loadGenreBankCounts()
      room.genreCounts = await clampGenreCounts(room.genreCounts)
      attachMember(room, emptyMember(user.id, profile.nickname, profile.avatarUrl, socket.id, { spectator: joinAsSpectator }))
      socket.join(room.id)
      const state = roomState(room)
      emitRoomState(io, room)
      io.emit('lobby:rooms', publicRooms())
      cb?.({ ok: true, room: state })
    })

    on('profile:sync', S.none, RATE.action, async (_payload, cb) => {
      const profile = await loadMemberProfile(user.id, user.nickname)
      user.nickname = profile.nickname
      const room = findRoomByUser(user.id)
      if (room) {
        const m = room.members.get(user.id)
        if (m) {
          m.nickname = profile.nickname
          m.avatarUrl = profile.avatarUrl
          emitRoomState(io, room)
        }
      }
      cb?.({ ok: true, nickname: profile.nickname, avatarUrl: profile.avatarUrl })
    })

    on('room:leave', S.none, RATE.action, () => {
      leaveRoom(io, socket, user.id)
    })

    /** 게임 종료 후 방을 유지한 채 대기실로 되돌린다 — 누구든 먼저 누르면 방 전체가 lobby로 */
    on('room:back_to_lobby', S.none, RATE.action, (_payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room) return cb?.({ ok: false, error: '방 없음' })
      if (room.status === 'lobby') return cb?.({ ok: true, room: roomState(room) })
      if (room.status !== 'ended') return cb?.({ ok: false, error: '게임이 아직 진행 중입니다' })
      clearTimer(room)
      room.status = 'lobby'
      room.queue = []
      room.index = 0
      room.duel = null
      room.pendingDuel = null
      room.duelStarting = false
      room.reading = null
      for (const m of room.members.values()) m.ready = false
      const state = roomState(room)
      emitRoomState(io, room)
      io.emit('lobby:rooms', publicRooms())
      cb?.({ ok: true, room: state })
    })

    on('room:ready', S.none, RATE.action, () => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'lobby') return
      const m = room.members.get(user.id)
      if (!m || m.isSpectator) return
      m.ready = !m.ready
      emitRoomState(io, room)
    })

    on('room:set_spectator', S.setSpectator, RATE.action, (payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room) return cb?.({ ok: false, error: '방 없음' })
      if (room.status !== 'lobby') return cb?.({ ok: false, error: '대기실에서만 변경할 수 있습니다' })
      const m = room.members.get(user.id)
      if (!m) return cb?.({ ok: false, error: '멤버 없음' })
      const wantSpectator = !!payload?.spectator
      if (m.isSpectator === wantSpectator) {
        return cb?.({ ok: true, room: roomState(room) })
      }
      if (wantSpectator) {
        if (!canJoinAsSpectator(room)) {
          return cb?.({ ok: false, error: '관전 자리가 가득 찼습니다' })
        }
        m.isSpectator = true
        m.ready = false
        clearHeldAugment(m)
      } else {
        if (!canJoinAsPlayer(room)) {
          return cb?.({ ok: false, error: '플레이어 자리가 가득 찼습니다' })
        }
        m.isSpectator = false
        m.ready = false
      }
      const state = roomState(room)
      emitRoomState(io, room)
      io.emit('lobby:rooms', publicRooms())
      cb?.({ ok: true, room: state })
    })

    /** 채팅 색 바꾸기 · 언제든 가능 · 관전자는 색 없음 */
    on('room:chat_color', S.chatColor, RATE.action, (payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room) return cb?.({ ok: false, error: '방 없음' })
      const m = room.members.get(user.id)
      if (!m) return cb?.({ ok: false, error: '멤버 없음' })
      if (m.isSpectator) return cb?.({ ok: false, error: '관전자는 채팅 색이 없습니다' })
      const raw = payload?.color
      if (raw == null) {
        m.chatColor = null
      } else {
        const n = Math.floor(Number(raw))
        if (!Number.isFinite(n) || n < 0 || n >= CHAT_COLOR_COUNT) {
          return cb?.({ ok: false, error: '없는 색입니다' })
        }
        // 색은 방 안에서 겹치지 않는다 (관전자는 색이 없으므로 제외)
        const taken = [...room.members.values()].some(
          (other) => other.userId !== user.id && !other.isSpectator && other.chatColor === n,
        )
        if (taken) return cb?.({ ok: false, error: '이미 다른 사람이 쓰는 색입니다' })
        m.chatColor = n
      }
      const state = roomState(room)
      emitRoomState(io, room)
      cb?.({ ok: true, room: state })
    })

    on('room:settings', S.roomSettings, RATE.action, async (payload) => {
      const room = findRoomByUser(user.id)
      if (!room || room.hostId !== user.id || room.status !== 'lobby') return
      if (payload.genreCounts) {
        room.genreBankCounts = await loadGenreBankCounts()
        room.genreCounts = await clampGenreCounts(payload.genreCounts)
      }
      if (Number.isFinite(payload.maxPlayers)) {
        room.maxPlayers = Math.min(10, Math.max(2, Math.floor(payload.maxPlayers!)))
      }
      const nextName = cleanText(payload?.name, MAX_ROOM_NAME_LENGTH)
      if (nextName) room.name = nextName
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
      if (typeof payload.isPrivate === 'boolean') {
        room.isPrivate = payload.isPrivate
        if (room.isPrivate) {
          if (!room.code) room.code = newRoomCode()
        } else {
          room.code = null
        }
        io.emit('lobby:rooms', publicRooms())
      }
      if (room.gameMode !== 'reading') {
        if (payload.answerMode === 'title' || payload.answerMode === 'title_artist') {
          room.answerMode = payload.answerMode
        }
        if (typeof payload.augmentsEnabled === 'boolean') {
          room.augmentsEnabled = payload.augmentsEnabled
        }
      }
      emitRoomState(io, room)
    })

    on('chat:message', S.text, RATE.chat, (payload) => {
      const text = cleanText(payload?.text, MAX_CHAT_LENGTH)
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

    
    on('reading:accept', S.none, RATE.action, (_payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      const res = readingAccept(io, room, user.id, roomState as never)
      cb?.(res)
    })

    on('reading:pass', S.none, RATE.action, (_payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      const res = readingPass(io, room, user.id, roomState as never)
      cb?.(res)
    })

    on('reading:claim', S.none, RATE.action, (_payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      const res = readingClaim(io, room, user.id, roomState as never)
      cb?.(res)
    })

    on('reading:vote', S.readingVote, RATE.action, (payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room?.reading) return cb?.({ ok: false, error: '리딩 진행 중이 아닙니다' })
      if (payload?.vote !== 'yes' && payload?.vote !== 'no') return cb?.({ ok: false, error: '투표 값이 필요합니다' })
      const res = readingVote(io, room, user.id, payload.vote, roomState as never)
      cb?.(res)
    })

    on('game:start', S.none, RATE.heavy, async (_payload, cb) => {
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
      // 뽑기 전에 판 번호를 올려야 직전 판에 나온 곡의 "나이"가 1판이 된다
      room.gameSeq += 1
      pruneSongMemory(room)
      const queue = await pickQuestions(room.genreCounts, {
        memory: room,
        recentPenalty: room.recentSongPenalty,
      })
      if (queue.length === 0) return cb?.({ ok: false, error: '문제 은행이 비어 있습니다' })

      clearTimer(room)
      const modeForQueue = room.gameMode === 'reading' ? 'title' : (room.answerMode || 'title_artist')
      if (room.gameMode === 'reading') {
        room.augmentsEnabled = false
        room.answerMode = 'title'
      }
      room.queue = queue.map((q) => applyAnswerMode(q, modeForQueue, room.gameMode !== 'reading'))
      room.index = 0
      room.lastAugmentAt = -1
      room.duel = null
      room.pendingDuel = null
      room.duelStarting = false
      room.chatIsolate = null
      room.noSkip = null
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
        m.peckSong = null
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

    on('answer:submit', S.text, RATE.chat, (payload) => {
      const text = cleanText(payload?.text, MAX_ANSWER_LENGTH)
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
        emitRoomState(io, room)
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
          emitRoomState(io, room)
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
              const transfers = [
                applyGabukiOnCorrect(io, room, memberSelf!),
                applyFlameKimOnCorrect(io, room, memberSelf!),
              ].filter((t): t is ScoreTransfer => !!t)
              bankAnswerProxyPoints(io, room, user.id, pointsShown)

              room.revealed[slot.id] = {
                answer: slot.answer,
                by: user.nickname,
                userId: user.id,
                at: revealAt,
                points: pointsShown,
                wagerPts,
                transfers,
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
              emitRoomState(io, room)
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
            emitRoomState(io, room)
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
          emitRoomState(io, room)
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
        // 목소리 작음: 맞는 답이어도 확률로 «안 들린» 걸로 흘려보낸다 (본인에게만 안내)
        if (
          memberSelf
          && isAcceptedAnswer(scoreText, accepts)
          && rollMuffledMiss(memberSelf, room.index, room)
        ) {
          const mb = muffledAnswerBuff(memberSelf, room.index, room)
          io.to(memberSelf.socketId).emit('chat:message', {
            id: Date.now() + 2,
            userId: '',
            nickname: '시스템',
            text: `${mb?.name ? `[${mb.name}] ` : ''}목소리가 작아서 안 들렸다`,
            system: true,
            at: Date.now(),
          })
          continue
        }
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
          const transfers: ScoreTransfer[] = []
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
            const gabukiT = applyGabukiOnCorrect(io, room, member)
            if (gabukiT) transfers.push(gabukiT)
            const flameT = applyFlameKimOnCorrect(io, room, member)
            if (flameT) transfers.push(flameT)
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
            transfers,
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
          emitRoomState(io, room)
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

    /**
     * 클라이언트가 "이 영상은 아무리 해도 안 나온다"고 보고한다.
     * 한 명만 그러면 그 사람 네트워크·확장프로그램 문제일 수 있으니 기다리고,
     * 과반이 같은 말을 하면 문제 자체가 깨진 것이므로 라운드를 넘긴다.
     * (그냥 두면 전원이 40초 무음을 보고만 있어야 한다)
     */
    on('question:unplayable', S.unplayable, RATE.action, (payload) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'playing') return
      const m = room.members.get(user.id)
      if (!m || m.isSpectator) return
      // 이미 넘어간 라운드에 대한 뒤늦은 보고는 버린다
      if (typeof payload.index === 'number' && payload.index !== room.index) return
      if (room.unplayableReports.has(user.id)) return
      room.unplayableReports.add(user.id)

      const q = room.queue[room.index]
      console.warn(
        `[question:unplayable] room=${room.id} index=${room.index} question=${q?.id} url=${q?.youtubeUrl} code=${payload.code} reports=${room.unplayableReports.size}`,
      )

      const need = skipVotesNeeded(connectedPlayerCount(room))
      if (room.unplayableReports.size >= need) {
        systemChat(io, room, '이 곡을 재생할 수 없어 다음 문제로 넘어갑니다')
        endRound(io, room, 'skip')
      }
    })

    on('round:skip', S.none, RATE.action, () => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'playing') return
      const self = room.members.get(user.id)
      if (!self || self.isSpectator) return
      if (room.skipVotes.has(user.id)) return
      if (isNoSkipActive(room)) {
        io.to(self.socketId).emit('augment:hint', {
          name: room.noSkip!.byName,
          hint: `[${room.noSkip!.byName}] 스킵할 수 없습니다 (남은 ${room.noSkip!.roundsLeft}R)`,
          durationMs: 0,
        })
        return
      }
      room.skipVotes.add(user.id)
      const need = skipVotesNeeded(connectedPlayerCount(room))
      io.to(room.id).emit('round:skip_update', { votes: room.skipVotes.size, need })
      if (room.skipVotes.size >= need) {
        endRound(io, room, 'skip')
      }
    })

    // 쪼아요~: 벌칙 곡을 끝까지 다 들었다고 클라가 알려줄 때만 해제된다
    on('augment:peck_done', S.peckDone, RATE.action, (payload) => {
      const room = findRoomByUser(user.id)
      if (!room) return
      const self = room.members.get(user.id)
      if (!self?.peckSong) return
      if (payload?.id && payload.id !== self.peckSong.id) return
      const byName = self.peckSong.byName
      self.peckSong = null
      io.to(self.socketId).emit('augment:hint', {
        name: byName,
        hint: `[${byName}] 다 들었습니다`,
        durationMs: 3000,
      })
      for (const member of room.members.values()) {
        io.to(member.socketId).emit('room:state', roomState(room, member.userId))
      }
    })

    on('augment:reroll', S.none, RATE.action, async (_payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'augment') return cb?.({ ok: false })
      const m = room.members.get(user.id)
      if (!m) return cb?.({ ok: false })
      const list = await getEnabledAugments()
      // 리롤도 남이 보고 있는 카드는 피한다 (없으면 그때만 재사용)
      const shuffled = pickOfferCandidatesRoomUnique(
        list,
        m.collectedPieces || [],
        3,
        room.augmentOfferLockedTier,
        {
          excludeIds: m.offerSeenAugmentIds,
          excludeNames: m.usedAugments,
          excludeTypes: offerExcludedTypes(room),
        },
        room.augmentOfferDealtIds,
      )
      rememberOfferSeen(m, shuffled)
      cb?.({ ok: true, candidates: shuffled, lockedTier: room.augmentOfferLockedTier })
    })

    on('augment:offer_done', S.offerDone, RATE.action, async (payload) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'augment') return
      const m = room.members.get(user.id)
      // 잠긴 카드(인수인계)도 «보유»다 — 그 페이즈는 통째로 건너뛴다
      if (!m || heldCount(m) > 0) return
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
        if (aug && aug.tier === 'prism') return
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

    on('augment:gaho_candidates', S.none, RATE.action, async (_payload, cb) => {
      const room = findRoomByUser(user.id)
      if (!room) return cb?.({ ok: false })
      const m = room.members.get(user.id)
      // 증강 선택 중(프리즘 선택 카드) 또는 플레이 중 보유 프리즘 선택
      const offerPhase = room.status === 'augment'
      const playPhase = room.status === 'playing' && !!findHeldByType(m, 'gaho_select')
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

    const handleAugmentUse = async (payload?: {
      augmentId?: string
      targetUserId?: string
      targetUserIds?: string[]
      gahoAugmentId?: string
      genreName?: string
    }) => {
      const room = findRoomByUser(user.id)
      if (!room || room.status !== 'playing') return
      const m = room.members.get(user.id)
      if (!m || m.isSpectator) return
      // 2칸이 될 수 있으므로 «어느 카드를 쓰는지»를 받는다 (안 주면 쓸 수 있는 첫 장)
      const usable = usableHeld(m)
      const card = (payload?.augmentId ? findHeldById(m, payload.augmentId) : null) || usable[0] || null
      if (!card || card.locked || !card.effectType) return
      const heldId = card.id
      // 자동 사용 / 피격 자동 발동 증강은 수동 사용 불가
      if (
        AUTO_APPLY_AUGMENT_TYPES.has(card.effectType)
        || PASSIVE_HELD_AUGMENT_TYPES.has(card.effectType)
        || AUTO_TRIGGER_HELD_AUGMENT_TYPES.has(card.effectType)
      ) return
      const aug: AugmentLike = {
        name: card.name,
        description: card.description || '',
        effectType: card.effectType,
        effectValue: card.effectValue,
        imageUrl: card.imageUrl,
        tier: card.tier || undefined,
      }

      let hint: string | null = null
      let chatText = `${user.nickname}님이 증강 [${aug.name}]을(를) 사용했습니다`
      let usedCard: AugmentLike = aug
      let silentUse = false
      let excludeNotifyUserId: string | null = null

      if (aug.effectType === 'chaos_cast') {
        // 보관형 혼돈: 즉시 2발이 아니라 «랜덤 2장을 뽑아 들고 있다가 원할 때» 쓴다.
        // 즉시 발동이던 시절엔 의미가 없어 빼놨던 카드(무지개 반사·차차차)도 이제 정상으로 뽑는다.
        const all = await getEnabledAugments()
        const chaosExcludedTypes = new Set(offerExcludedTypes(room))
        const heldNames = new Set(heldList(m).map((h) => h.name))
        const pool = all.filter(
          (a) =>
            a.effectType !== 'chaos_cast'
            && a.effectType !== 'gaho_select'
            && a.effectType !== 'tier_upgrade'
            // 자동 적용형(물귀신·콤보)은 증강 페이즈 끝에만 발동한다 — 지금 받아도 못 쓴다
            && !AUTO_APPLY_AUGMENT_TYPES.has(a.effectType)
            && !chaosExcludedTypes.has(a.effectType)
            && a.tier !== 'prism'
            && !m.usedAugments.includes(a.name)
            && !heldNames.has(a.name),
        )
        // 혼돈 카드가 빠지며 한 칸이 비므로 보통 2장이 다 들어간다.
        // 인수인계로 떠넘겨진 잠긴 카드가 껴 있으면 들어가는 만큼만 받는다.
        const space = Math.max(0, MAX_HELD_AUGMENTS - (heldCount(m) - 1))
        const picks = shuffleArray(pool).slice(0, space)
        if (!picks.length) {
          io.to(m.socketId).emit('augment:hint', {
            name: aug.name,
            hint: `[${aug.name}] 지금 뽑을 수 있는 증강이 없습니다`,
            durationMs: 0,
          })
          return
        }
        m.usedAugments.push(aug.name)
        removeHeldById(m, heldId)
        for (const pick of picks) addHeldAugment(m, pick)
        hint = `[${aug.name}] ${picks.map((x) => x.name).join(' · ')}\n원할 때 쓰세요`
        chatText = picks.length > 1
          ? `${user.nickname}님의 [${aug.name}]! 증강 ${picks.length}장을 뽑아 보관했습니다`
          : `${user.nickname}님의 [${aug.name}]! 증강 한 장을 뽑아 보관했습니다`
      } else if (aug.effectType === 'gaho_select') {
        const gahoId = payload?.gahoAugmentId
        if (!gahoId) return
        const all = await getEnabledAugments()
        const locked = m.gahoPickIds || []
        if (locked.length && !locked.includes(gahoId)) return
        const pick = all.find((a) => a.id === gahoId && a.tier === 'prism')
        if (!pick) return
        const pickAug: AugmentLike = {
          name: pick.name,
          description: pick.description,
          effectType: pick.effectType,
          effectValue: pick.effectValue,
          imageUrl: pick.imageUrl,
          tier: pick.tier,
        }
        // 대상/장르 선택이 더 필요하면 프리즘 선택만 소모하고 실제 카드로 보관한 뒤 UI에서 이어서
        const needsMorePick = TARGET_AUGMENT_TYPES.has(pick.effectType)
          || GENRE_AUGMENT_TYPES.has(pick.effectType)
        if (needsMorePick) {
          m.usedAugments.push(aug.name)
          removeHeldById(m, heldId)
          addHeldAugment(m, pick)
          m.gahoPickIds = null
          io.to(m.socketId).emit('augment:hint', {
            name: pick.name,
            hint: TARGET_AUGMENT_TYPES.has(pick.effectType)
              ? `[프리즘 선택] ${pick.name} · 대상을 선택해 사용하세요`
              : `[프리즘 선택] ${pick.name} · 장르를 선택해 사용하세요`,
            durationMs: 0,
          })
          emitRoomState(io, room)
          return
        }
        const result = await applyAugmentEffect(io, room, m, user, pickAug)
        if (!result.ok) {
          if (result.hint) {
            io.to(m.socketId).emit('augment:hint', {
              name: pick.name,
              hint: result.hint,
              durationMs: 0,
            })
          }
          return
        }
        m.usedAugments.push(aug.name)
        m.usedAugments.push(pick.name)
        clearHeldAugment(m)
        usedCard = pickAug
        hint = result.hint
          ? `[프리즘 선택] ${pick.name}\n${result.hint}`
          : `[프리즘 선택] ${pick.name}`
        chatText = result.chatText
          || `${user.nickname}님이 [프리즘 선택]으로 [${pick.name}]을(를) 골랐습니다`
      } else if (aug.effectType === 'tier_upgrade') {
        // 선택 시점에 이미 치환됨 — 혹시 남아 있으면 즉시 보관만 교체 (컷신·채팅 없이)
        const all = await getEnabledAugments()
        const pick = pickTierUpgradeTarget(all, {
          effectType: aug.effectType,
          effectValue: aug.effectValue,
          tier: aug.tier || 'bronze',
        }, m.usedAugments)
        if (!pick) return
        removeHeldById(m, heldId)
        addHeldAugment(m, pick)
        emitRoomState(io, room)
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
        if (result.keepHeld) {
          // 넘어가요 등: usedAugments에 아직 넣지 않음 — 위에서 push한 것 되돌림
          m.usedAugments.pop()
        } else {
          // 쓴 카드만 뺀다 — 옆 칸(혼돈으로 받은 다른 카드·강탈품)은 그대로 둔다
          removeHeldById(m, heldId)
        }
        // 조커뽑기: 사용 연출은 강탈해 온 카드로 보여준다
        if (result.usedCard) usedCard = result.usedCard
        hint = result.hint
        if (result.chatText) chatText = result.chatText
        if (result.silent) silentUse = true
        if (result.excludeNotifyUserId) excludeNotifyUserId = result.excludeNotifyUserId
      }

      const deferPublicNotice = !silentUse
        && usedCard.tier !== 'prism'
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
      if (aug.effectType === 'peck_song') {
        // 벌칙 재생 정보는 소켓별로 개인화 (당사자만 peckSong URL 수신)
        for (const member of room.members.values()) {
          io.to(member.socketId).emit('room:state', roomState(room, member.userId))
        }
      } else {
        emitRoomState(io, room)
      }
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
    }

    // 연타로 같은 증강이 두 번 적용되지 않게 유저당 1건만 처리한다
    on('augment:use', S.augmentUse, RATE.action, async (payload) => {
      if (augmentUseInFlight.has(user.id)) return
      augmentUseInFlight.add(user.id)
      try {
        await handleAugmentUse(payload)
      } finally {
        augmentUseInFlight.delete(user.id)
      }
    })

    socket.on('disconnect', () => {
      // 같은 계정이 다른 탭에서 방을 이어받았으면 socketId가 갱신돼 있다.
      // 그때 죽은 탭의 disconnect로 방에서 빼면 살아있는 탭이 유령이 된다.
      const room = findRoomByUser(user.id)
      const cur = room?.members.get(user.id)
      if (cur && cur.socketId !== socket.id) return
      augmentUseInFlight.delete(user.id)

      // 대기실·종료 상태면 잃을 게 없으니 바로 내보낸다
      if (!room || !cur || room.status === 'lobby' || room.status === 'ended') {
        leaveRoom(io, socket, user.id)
        return
      }

      // 게임 중: 점수·증강을 들고 자리를 비워둔 채 기다린다.
      // 여기서 바로 leaveRoom 하면 새로고침 한 번에 판이 통째로 날아간다.
      cur.disconnectedAt = Date.now()
      clearGrace(user.id)
      graceTimers.set(
        user.id,
        setTimeout(() => {
          graceTimers.delete(user.id)
          const r = findRoomByUser(user.id)
          const still = r?.members.get(user.id)
          // 그새 돌아왔으면 아무것도 하지 않는다
          if (!r || !still || still.disconnectedAt == null) return
          systemChat(io, r, `${still.nickname} 님이 돌아오지 않아 퇴장 처리했습니다`)
          leaveRoom(io, socket, user.id)
        }, RECONNECT_GRACE_MS),
      )

      const graceSec = Math.round(RECONNECT_GRACE_MS / 1000)
      systemChat(io, room, `${cur.nickname} 님의 연결이 끊겼습니다 · ${graceSec}초 안에 돌아오면 이어서 진행합니다`)
      emitRoomState(io, room)

      // 분모가 줄었으니 남은 사람들의 스킵 정족수를 다시 알리고, 이미 넘었으면 진행한다
      if (room.status === 'playing') {
        const need = skipVotesNeeded(connectedPlayerCount(room))
        io.to(room.id).emit('round:skip_update', { votes: room.skipVotes.size, need })
        if (room.skipVotes.size >= need) endRound(io, room, 'skip')
      }
    })
  })
}

function findRoomByUser(userId: string) {
  const id = userRoomId.get(userId)
  if (!id) return undefined
  return rooms.get(id)
}

/**
 * 나간 사람을 가리키던 증강 참조를 정리한다.
 * 그냥 두면 시전자·대상이 사라진 채 효과만 남아 아무도 못 받는 감점이 계속 발생한다.
 */
function cleanupReferencesToLeaver(io: Server, room: Room, userId: string) {
  room.skipVotes.delete(userId)
  room.wagerSettled.delete(userId)
  room.riskyBustApplied.delete(userId)
  if (room.chatIsolate) delete room.chatIsolate.groupByUserId[userId]

  for (const m of room.members.values()) {
    if (m.gabuki?.casterUserId === userId) {
      const name = m.gabuki.byName
      m.gabuki = null
      io.to(m.socketId).emit('augment:hint', {
        name,
        hint: `[${name}] 시전자가 나가 해제되었습니다`,
        durationMs: 0,
      })
    }
    if (m.flameKim?.targetUserId === userId) {
      m.flameKim = null
    }
    if (m.answerProxy?.targetUserId === userId) {
      // 대상이 사라지면 더 적립할 수 없으니 지금까지 모인 점수로 바로 결산한다.
      m.answerProxy.roundsLeft = 0
      settleAnswerProxy(io, room, m)
    }
    const shared = m.activeBuffs.filter(
      (b) => b.effectType === 'score_share' && String(b.effectValue.partnerId || '') === userId,
    )
    if (shared.length) {
      m.activeBuffs = m.activeBuffs.filter((b) => !shared.includes(b))
      io.to(m.socketId).emit('augment:hint', {
        name: shared[0].name,
        hint: `[${shared[0].name}] 상대가 나가 연결이 끊겼습니다`,
        durationMs: 0,
      })
    }
  }
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

  clearGrace(userId)
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
    cleanupReferencesToLeaver(io, room, userId)
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
    } else if (room.status !== 'lobby' && room.status !== 'ended' && playerCount(room) === 0) {
      // 관전자만 남으면 아무도 못 맞히는 라운드가 큐 끝까지 자동 재생된다.
      clearTimer(room)
      endGameAndBroadcast(io, room)
    } else if (room.status === 'playing' && room.skipVotes.size >= skipVotesNeeded(connectedPlayerCount(room))) {
      // 남은 인원 기준으로 정족수가 이미 찼으면 기다리지 않고 넘어간다.
      emitRoomState(io, room)
      endRound(io, room, 'skip')
    } else if (room.status === 'augment') {
      // 아직 안 고른 사람이 나갔으면 20초 타임아웃까지 기다릴 이유가 없다.
      void finishAugmentIfReady(io, room)
    } else {
      emitRoomState(io, room)
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
  emitRoomState(io, room)
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
  emitRoomState(io, room)

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
    endGameAndBroadcast(io, room)
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
    emitRoomState(io, room)
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

  emitRoundStart(io, room, q, duration, publicSlots)

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
    endGameAndBroadcast(io, room)
    return
  }

  // 20문제마다 증강 (시작 제외 · 방 설정에서 끈 경우 스킵)
  if (shouldOfferAugment(room)) {
    room.lastAugmentAt = room.index
    room.status = 'augment'
    emitRoomState(io, room)
    clearAugmentCache()
    getEnabledAugments().then((list) => {
      if (room.status !== 'augment') return
      const lockedTier = pickRandomOfferTier(list)
      room.augmentOfferLockedTier = lockedTier
      room.augmentOfferEndsAt = Date.now() + 20_000
      room.augmentOfferDealtIds = new Set()
      for (const m of room.members.values()) {
        // 미사용 보관 증강 소멸(임시 규칙)
        clearHeldAugment(m)
      }
      // 풀이 모자라 뒤쪽이 중복을 떠안는 일이 없게, 받는 순서를 매 페이즈 새로 섞는다
      for (const m of shuffleArray([...room.members.values()])) {
        if (m.isSpectator) continue
        // 새 증강 페이즈 → 리롤 시야 초기화 (이전에 뜬 카드는 다시 가능, 사용 증강은 계속 제외)
        m.offerSeenAugmentIds = []
        m.lastOfferCandidateIds = []
        const shuffled = pickOfferCandidatesRoomUnique(
          list,
          m.collectedPieces,
          3,
          lockedTier,
          { excludeNames: m.usedAugments, excludeTypes: offerExcludedTypes(room) },
          room.augmentOfferDealtIds,
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
      emitRoomState(io, room)
      // 20초 후 미선택자 → 지금 화면에 뜬 3장 중 균등 랜덤
      clearTimer(room)
      room.timer = setTimeout(async () => {
        if (room.status !== 'augment') return
        try {
          const all = await getEnabledAugments()
          const byId = new Map(all.map((a) => [a.id, a]))
          for (const m of room.members.values()) {
            if (m.isSpectator) continue
            if (heldCount(m) > 0) continue
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
          await finishAugmentIfReady(io, room)
        } catch (err) {
          console.error('[augment:offer] auto pick failed', err)
          if (room.status === 'augment') beginRoundCountdown(io, room)
        }
      }, 20_000)
    }, (err) => {
      // 증강 목록을 못 불러와도 방이 증강 화면에서 멈추지 않게 라운드를 진행한다
      console.error('[augment:offer] load failed', err)
      if (room.status === 'augment') beginRoundCountdown(io, room)
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
  room.unplayableReports.clear()
  for (const m of room.members.values()) {
    m.roundScoreGain = 0
  }
  const q = room.queue[room.index]
  if (!q) {
    endGameAndBroadcast(io, room)
    return
  }
  // 큐에 담긴 시점이 아니라 실제로 트는 시점에 기록한다 — 3곡만 듣고 접은 판의
  // 나머지 57곡까지 "최근에 나온 곡"이 되면 안 된다. 증강이 중간에 꽂은 곡도 여기서 잡힌다.
  markSongPlayed(room, q.id)
  systemChat(io, room, `--------${room.index + 1}R--------`)
  const duration = 40
  room.roundDuration = duration

  const publicSlots: SlotPublic[] = q.slots.map((s) => ({
    id: s.id,
    label: s.hidden ? '히든' : s.label,
    revealed: false,
    hidden: s.hidden,
    unlocked: !s.hidden,
    chosung: s.chosung || '',
  }))

  // 마감 시각 스탬프와 타이머 무장은 emitRoundStart 안에서, 실제 방송 직전에 한다.
  // 여기서 미리 찍으면 트루먼 트릭곡 준비(await)가 걸린 만큼 라운드가 조용히 짧아진다.
  emitRoundStart(io, room, q, duration, publicSlots)
}

/** 트루먼 트릭곡 준비를 기다린 뒤 라운드 시작을 방송한다. 준비가 실패해도 라운드는 진행한다. */
function emitRoundStart(
  io: Server,
  room: Room,
  q: QuestionRuntime,
  duration: number,
  publicSlots: SlotPublic[],
) {
  let broadcast1 = false
  const broadcast = () => {
    // 준비 완료와 안전망 타임아웃이 모두 도착해도 한 번만 시작한다
    if (broadcast1) return
    broadcast1 = true
    if (room.status !== 'playing' || room.queue[room.index] !== q) return

    // 모두가 같은 순간에 듣기 시작하도록, 방송하는 바로 그 시점을 라운드 시작으로 삼는다
    room.roundStartedAt = Date.now()
    room.roundEndsAt = room.roundStartedAt + duration * 1000
    room.timer = setTimeout(() => endRound(io, room, 'timeout'), duration * 1000)

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
      artistHint: q.artistHint || '',
      slots: publicSlots,
    })
    io.to(room.id).emit('round:skip_update', { votes: 0, need: skipVotesNeeded(connectedPlayerCount(room)) })
    for (const m of room.members.values()) {
      if (isTrumanIllusion(m, room.index)) emitIllusionRound(io, m)
    }
    emitRoomState(io, room)
    applyRoundStartBuffs(io, room)
  }
  // 준비가 오래 걸리거나 영영 안 끝나도 라운드는 시작돼야 한다
  const safety = setTimeout(() => {
    console.warn('[round:start] truman audio prepare 지연 — 먼저 시작합니다')
    broadcast()
  }, 1500)
  room.extraTimers.push(safety)
  prepareTrumanRoundAudio(io, room).then(
    () => {
      clearTimeout(safety)
      broadcast()
    },
    (err) => {
      clearTimeout(safety)
      console.error('[round:start] truman audio prepare failed', err)
      broadcast()
    },
  )
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
  // 영역전개·쉬었음청년은 「매 R 시작 N초」 펄스라 라운드가 끝나면 같이 끝나야 한다.
  // 해제는 extraTimers의 setTimeout이 하는데 clearTimer가 그걸 취소해 버리므로,
  // 라운드가 일찍 끝나면(스킵·전부 정답) 남은 차단 시간이 다음 라운드로 넘어간다.
  for (const m of room.members.values()) {
    m.chatMuteUntil = null
    m.answerBlockUntil = null
    m.answerBlockUntilBy = null
  }
  room.status = 'revealing'
  room.skipVotes = new Set()

  const q = room.queue[room.index]
  if (!q) {
    endGameAndBroadcast(io, room)
    return
  }
  settleWaterGhost(io, room)
  settleComboClear(io, room)
  settleGabukiMiss(io, room)
  // 한입만/맞췄죠?: 버프 tick 전에 실패 결산 (1R 버프가 tick으로 사라지면 패널티 누락)
  settleWagerAnswers(io, room)
  // roundScoreGain·roundsLeft를 보는 정산이라 tick보다 먼저 돌아야 한다
  settleCrownBet(io, room)
  for (const m of room.members.values()) {
    tickBuffsAfterRound(io, room, m, room.index)
  }
  tickChatIsolate(room, room.index)
  tickNoSkip(room, room.index)
  settleAllAnswerProxies(io, room)

  const reveal = buildRevealSlots(room, q, reason)

  io.to(room.id).emit('round:reveal', { reason, slots: reveal, pauseSec: 3 })
  io.to(room.id).emit('round:skip_update', { votes: 0, need: skipVotesNeeded(connectedPlayerCount(room)) })
  // 맞췄죠?/대리 결산 점수 즉시 반영
  emitRoomState(io, room)
  room.index += 1
  room.timer = setTimeout(() => startRound(io, room), 3000)
}

/** 라운드 시작 전 3-2-1 (증강 OFF 시작 · 증강 선택 직후 공통) */
/** 큐가 끝났을 때의 게임 종료 처리 — 미정산 증강을 결산하고 결과를 방송한다 */
function endGameAndBroadcast(io: Server, room: Room) {
  forceSettleTrumanIllusions(io, room)
  forceSettleAnswerProxies(io, room)
  room.status = 'ended'
  const results = playerMembers(room)
    .map((m) => ({ nickname: m.nickname, score: m.score, userId: m.userId }))
    .sort((a, b) => b.score - a.score)
  io.to(room.id).emit('game:end', { results })
  emitRoomState(io, room)

  // 전적 저장은 실패해도 결과 화면을 막지 않는다 (saveGameRecord 안에서 삼킨다)
  void saveGameRecord({
    roomName: room.name,
    gameMode: room.gameMode,
    answerMode: room.answerMode,
    totalRounds: room.index,
    entries: results,
  })
}

function beginRoundCountdown(io: Server, room: Room) {
  if (room.status === 'duel' || room.duelStarting) return
  if (room.index >= room.queue.length) {
    endGameAndBroadcast(io, room)
    return
  }
  clearTimer(room)
  room.status = 'countdown'
  const q = room.queue[room.index]
  emitRoomState(io, room)
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
  const allPicked = playerMembers(room).every((x) => heldCount(x) > 0)
  if (!allPicked) {
    emitRoomState(io, room)
    return
  }
  clearTimer(room)
  // 즉시 잠금 — await 중 재진입으로 라운드가 두 번 시작되지 않게
  room.status = 'countdown'

  // 카운트다운을 먼저 올려 클라가 멈추지 않게 한 뒤, 자동 증강 적용
  beginRoundCountdown(io, room)

  try {
    for (const m of room.members.values()) {
      const autoCard = heldList(m).find((h) => h.effectType && AUTO_APPLY_AUGMENT_TYPES.has(h.effectType))
      if (!autoCard || !autoCard.effectType) continue
      const aug: AugmentLike = {
        name: autoCard.name,
        description: autoCard.description || '',
        effectType: autoCard.effectType,
        effectValue: autoCard.effectValue,
        imageUrl: autoCard.imageUrl,
        tier: autoCard.tier || undefined,
      }
      const result = await applyAugmentEffect(io, room, m, { id: m.userId, nickname: m.nickname }, aug)
      if (!result.ok) continue
      m.usedAugments.push(aug.name)
      removeHeldById(m, autoCard.id)
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
    emitRoomState(io, room)
  } catch (err) {
    console.error('[finishAugmentIfReady] auto-apply failed', err)
    emitRoomState(io, room)
  }
}
