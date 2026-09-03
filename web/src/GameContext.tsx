import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, clearAuth, getStoredUser, setAuth, updateStoredUser, type AuthUser } from './api'
import { connectSocket, disconnectSocket, getSocket } from './socket'
import { playSfx, setSfxVolume as applySfxVolume } from './sfx'
import { applyClockSample, resetClockSync, serverNow } from './clockSync'

export type GameMode = 'nomatch' | 'reading'

export type ReadingPublic = {
  phase: 'decide' | 'claim' | 'vote' | 'pre_solve' | 'solve' | 'reveal'
  turnIndex: number
  turnOrder: string[]
  offeredUserId: string
  offeredNickname: string
  solverId: string | null
  solverNickname: string | null
  phaseEndsAt: number
  votersHear: boolean
  solverHears: boolean
  voteCounts: { yes: number; no: number } | null
  lastResult: {
    solved: boolean
    solverNickname: string
    title: string
    voterPayouts: Array<{ userId: string; nickname: string; vote: 'yes' | 'no'; odds: '정배' | '역배' | '동배'; gain: number }>
  } | null
  questionIndex: number
  questionTotal: number
  targetScore?: number
}

export type PublicRoom = {
  id: string
  name: string
  players: number
  max: number
  spectators?: number
  maxSpectators?: number
  priv: boolean
  genre: string
  gameMode?: GameMode
}

export type ActiveBuffPublic = {
  name: string
  description?: string
  effectType: string
  imageUrl?: string | null
  usedByNickname?: string
  mult?: number | null
  rate?: number | null
  bgmUrl?: string | null
  bgmStartSec?: number | null
  startIndex: number
  roundsLeft: number
  pending: boolean
  active: boolean
  /** 트루먼쇼로 시간 정지된 버프 */
  frozen?: boolean
}

export type AudioTrick = {
  mode: 'replace' | 'overlay'
  youtubeUrl: string
  startSec: number
  endSec?: number | null
  label: string
  source: 'mud' | 'sakura' | 'flame' | 'party'
}

export type RoomMember = {
  userId: string
  nickname: string
  avatarUrl?: string | null
  ready: boolean
  score: number
  isHost: boolean
  /** 관전: 채팅만 */
  isSpectator?: boolean
  /** 채팅 색 인덱스 (0~9 · 관전자는 null) */
  chatColor?: number | null
  /** 이미 디버프 적용 중 → 타겟 디버프 불가 */
  augmentBusy?: boolean
  heldAugmentId: string | null
  heldAugmentName: string | null
  heldAugmentDescription?: string | null
  heldAugmentImageUrl?: string | null
  heldAugmentEffectType?: string | null
  heldAugmentTier?: string | null
  usedAugments: string[]
  activeBuffs?: ActiveBuffPublic[]
  /** 쉬었음청년 등: 채팅·제출 차단 */
  chatMuted?: boolean
  chatMutePending?: boolean
  chatMuteBy?: string | null
  chatMuteByNickname?: string | null
  chatMuteStartIndex?: number | null
  chatMuteUntil?: number | null
  /** 영역전개 등: 시한 정답 차단 종료 시각 */
  answerBlockUntil?: number | null
  /** 코로나: 채팅방 분리(격리) */
  chatIsolated?: boolean
  chatIsolatePending?: boolean
  chatIsolateGroup?: number | null
  chatIsolateBy?: string | null
  chatIsolateRoundsLeft?: number | null
  /** 보너스 타임·올인: 본인만 초성 즉시 */
  earlyChosungActive?: boolean
  /** 히든런: 시전자만 히든 미리보기 */
  hiddenPreview?: boolean
  /** 님아 매너좀 */
  answerDelayed?: boolean
  answerDelaySec?: number | null
  answerDelayUnlockAt?: number | null
  answerDelayPending?: boolean
  answerDelayRoundsLeft?: number | null
  answerDelayBy?: string | null
  /** 예의바른청년 */
  politeActive?: boolean
  politePending?: boolean
  politeSuffix?: string | null
  politeRoundsLeft?: number | null
  politeBy?: string | null
  /** 진조이니라 등: 정답 시 추가 점수 */
  politeBonus?: number | null
  /** 쉬었음청년 */
  answerBlocked?: boolean
  answerBlockPending?: boolean
  answerBlockRoundsLeft?: number | null
  answerBlockBy?: string | null
  /** 나이거 뭔지 알아: 본인만 보는 제목·가수/커버/캐릭터 */
  knowSpoilTitle?: string | null
  knowSpoilArtist?: string | null
  /** 슬롯 id → 스포일 (일론=전 슬롯·히든 영타 / 나이거=비전 슬롯 평문) */
  knowSpoilSlots?: Record<string, string> | null
  /** 일론 머스크의 가호: 영타 표기 스포일 */
  alienQwertyActive?: boolean
  /** 범인은 당신이야: 감시 중 */
  accuseWatchPending?: boolean
  accuseWatchActive?: boolean
  accuseWatchBy?: string | null
  /** 가불기 */
  gabukiActive?: boolean
  gabukiPending?: boolean
  gabukiRoundsLeft?: number | null
  gabukiBy?: string | null
  /** 불꽃남자김상원 */
  flameKimActive?: boolean
  flameKimPending?: boolean
  flameKimRoundsLeft?: number | null
  flameKimTarget?: string | null
  flameKimBy?: string | null
  /** 산데비스탄·알레그로 등: 현재 라운드 재생 배속 */
  playbackRate?: number | null
  /** 스타카토 계열: 1초 켜 / 1초 꺼 */
  audioStutter?: { onMs: number; offMs: number; byName?: string } | null
  /** 눈찌르기·리신: 힌트 숨김 */
  hintsHidden?: boolean
  hintsHiddenBy?: string | null
  /** 슬로우 스타터: 라운드 시작 후 N초 동안 무음 */
  audioDelaySec?: number | null
  audioDelayUntil?: number | null
  /** 전원을 꺼봤습니다: 이 시각까지 노래 음소거 */
  songMuteUntil?: number | null
  /**
   * 방 노래를 대체하는 트릭 오디오 (세노·트루먼·진흙탕 등 · 방 곡 음소거)
   */
  audioTrick?: AudioTrick | null
  /**
   * 지금 들리는 노래와 동시에 흐르는 트릭 (불꽃남자·풍악).
   * 교체곡이 걸려 있어도 같이 재생되므로 audioTrick과 별도 슬롯이다.
   */
  audioOverlay?: AudioTrick | null
  /** @deprecated audioTrick 사용 · 호환용 */
  decoyYoutubeUrl?: string | null
  decoyStartSec?: number | null
  sakuraActive?: boolean
  sakuraScoreMult?: number | null
  sakuraBy?: string | null
  /** 트루먼쇼 환상 모드 (가짜 점수) */
  sakuraTruman?: boolean
  trumanIllusion?: boolean
  trumanFakeScore?: number
  scoreReal?: number
  /** 신속정확대리 진행 중(대상 비공개) */
  answerProxyActive?: boolean
  answerProxyPending?: boolean
  answerProxyPendingScore?: number
  answerProxyRoundsLeft?: number | null
}

export type AugmentCardInfo = {
  name: string
  description: string
  imageUrl?: string | null
  tier?: string
}

export type ChatMsg = {
  id: number
  userId: string
  nickname: string
  text: string
  system?: boolean
  /** 야차룰 관전 전용 채팅 (당사자에게는 서버가 안 보냄) */
  spectator?: boolean
  at: number
  augmentCard?: AugmentCardInfo | null
}

export type RoomState = {
  id: string
  name: string
  hostId: string
  status: 'lobby' | 'playing' | 'revealing' | 'augment' | 'countdown' | 'duel' | 'ended'
  maxPlayers: number
  maxSpectators?: number
  genreCounts: Record<string, number>
  /** 문제은행 장르별 보유 수 — 대기실 슬라이더 max */
  genreBankCounts?: Record<string, number>
  /** 제목만 | 제목+가수 */
  answerMode?: 'title' | 'title_artist'
  /** false면 증강 선택 없음 */
  augmentsEnabled?: boolean
  gameMode?: GameMode
  readingTargetScore?: number
  /** 0=끔 · >0=최근곡 제외 (기본 1) */
  recentSongPenalty?: number
  reading?: ReadingPublic | null
  /** 앞으로 나올 곡(현재 제외) 장르별 잔량 */
  upcomingGenreCounts?: Record<string, number>
  members: RoomMember[]
  duel?: {
    challengerId: string
    opponentId: string
    challengerNickname: string
    opponentNickname: string
    penalty: number
    byName: string
  } | null
  /** 다음 라운드 시작 시 발동 예정인 야차룰 */
  pendingDuel?: {
    challengerId: string
    opponentId: string
    challengerNickname: string
    opponentNickname: string
    penalty: number
    byName: string
  } | null
  /** 이전 클라이언트 호환용. 트루먼쇼는 더 이상 다른 증강을 정지하지 않음 */
  augmentPaused?: boolean
}

export type RoundSlot = {
  id: string
  label: string
  revealed: boolean
  hidden?: boolean
  unlocked?: boolean
  answer?: string
  by?: string
  /** 초성 힌트 (슬롯 단위 · 라벨 키워드 무관) */
  chosung?: string
}

export type RoundInfo = {
  index: number
  total: number
  endsAt: number
  duration: number
  genre: string
  /** 히든 슬롯 포함 여부 (장르 색 등) */
  hasHidden?: boolean
  youtubeUrl: string
  startSec: number
  endSec: number
  titleChosung: string
  artistChosung: string
  /** 제목만 모드 가수 힌트 (한국·일본·해외 장르만 · 정답 대상 아님) */
  artistHint?: string
  slots: RoundSlot[]
  duel?: boolean
  duelLabel?: string
  duelPenalty?: number
  duelChallenger?: string
  duelOpponent?: string
  reading?: boolean
  readingMuted?: boolean
}

export type AugmentItem = {
  id: string
  name: string
  description?: string
  tier: string
  effectType: string
  imageUrl?: string | null
}

export type AugmentOffer = {
  candidates: AugmentItem[]
  timeoutSec: number
  /** 서버 기준 선택 마감 시각 (ms). 있으면 남은 시간 동기화용 */
  endsAt?: number
  rerolls: number
  /** 이번 오퍼 단일 등급: bronze | silver | gold */
  lockedTier?: string | null
}

export type GameResult = { nickname: string; score: number; userId: string }

type GameCtx = {
  user: AuthUser | null
  connected: boolean
  pingMs: number | null
  musicVolume: number
  sfxVolume: number
  setMusicVolume: (n: number) => void
  setSfxVolume: (n: number) => void
  rooms: PublicRoom[]
  room: RoomState | null
  roomCode: string | null
  chats: ChatMsg[]
  round: RoundInfo | null
  /** 증강 선택 후 노래 시작 전 카운트다운 남은 초 (null이면 없음) */
  startCountdown: number | null
  /** 서버 시각 기준 카운트다운 종료 시각 */
  countdownEndsAt: number | null
  skip: { votes: number; need: number }
  skipVoted: boolean
  augmentOffer: AugmentOffer | null
  augmentHint: string | null
  results: GameResult[] | null
  /** 추정 서버 시각 (핑 오프셋 반영) */
  serverNow: () => number
  /** 시계 샘플 횟수 (증강 중 싱크 표시용) */
  clockSamples: number
  /** 트루먼쇼 폭로 연출 */
  trumanReveal: { name: string; fakeScore: number; realScore: number } | null
  clearTrumanReveal: () => void
  /** 가호 사용 시 전원 컷신 */
  gahoCutscene: {
    name: string
    description: string
    imageUrl?: string | null
    nickname: string
    tier?: string
  } | null
  clearGahoCutscene: () => void
  /** 가호를 제외한 증강의 전원용 간단 사용 알림 */
  augmentNotice: {
    name: string
    nickname: string
    message: string
  } | null
  clearAugmentNotice: () => void
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, nickname: string) => Promise<void>
  logout: () => void
  updateProfile: (nickname: string) => Promise<void>
  uploadAvatar: (imageBase64: string) => Promise<void>
  removeAvatar: () => Promise<void>
  createRoom: (opts?: {
    name?: string
    isPrivate?: boolean
    maxPlayers?: number
    genreCounts?: Record<string, number>
    answerMode?: 'title' | 'title_artist'
    augmentsEnabled?: boolean
    gameMode?: GameMode
    readingTargetScore?: number
    recentSongPenalty?: number
  }) => Promise<void>
  joinRoom: (opts: { roomId?: string; code?: string; asSpectator?: boolean }) => Promise<void>
  leaveRoom: () => void
  setReady: () => void
  setSpectator: (spectator: boolean) => Promise<void>
  setChatColor: (color: number | null) => Promise<void>
  updateSettings: (payload: {
    genreCounts?: Record<string, number>
    maxPlayers?: number
    name?: string
    answerMode?: 'title' | 'title_artist'
    augmentsEnabled?: boolean
    gameMode?: GameMode
    readingTargetScore?: number
    recentSongPenalty?: number
  }) => void
  startGame: () => Promise<void>
  sendChat: (text: string) => void
  submitAnswer: (text: string) => void
  readingAccept: () => void
  readingPass: () => void
  readingClaim: () => void
  readingVote: (vote: 'yes' | 'no') => void
  voteSkip: () => void
  pickAugment: (augmentId: string | null, gahoAugmentId?: string | null) => void
  rerollAugment: () => Promise<void>
  useAugment: (payload?: { targetUserId?: string; targetUserIds?: string[]; gahoAugmentId?: string; genreName?: string }) => void
  fetchGahoCandidates: () => Promise<{
    candidates: Array<AugmentItem & { description?: string }>
    endsAt: number | null
    remainingSec: number | null
  }>
  clearResults: () => void
}

const Ctx = createContext<GameCtx | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())
  const [connected, setConnected] = useState(false)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [musicVolume, setMusicVolumeState] = useState(() => getStoredUser()?.musicVolume ?? 70)
  const [sfxVolume, setSfxVolumeState] = useState(() => getStoredUser()?.sfxVolume ?? 55)
  const [rooms, setRooms] = useState<PublicRoom[]>([])
  const [room, setRoom] = useState<RoomState | null>(null)
  /** 소켓 핸들러에서 최신 방 정보를 stale closure 없이 읽기 위한 미러 */
  const roomRef = useRef<RoomState | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatMsg[]>([])
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [startCountdown, setStartCountdown] = useState<number | null>(null)
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null)
  const [clockSamples, setClockSamples] = useState(0)
  const [skip, setSkip] = useState({ votes: 0, need: 1 })
  const [skipVoted, setSkipVoted] = useState(false)
  const [augmentOffer, setAugmentOffer] = useState<AugmentOffer | null>(null)
  const [augmentHint, setAugmentHint] = useState<string | null>(null)
  const [trumanReveal, setTrumanReveal] = useState<{ name: string; fakeScore: number; realScore: number } | null>(null)
  const [gahoCutscene, setGahoCutscene] = useState<{
    name: string
    description: string
    imageUrl?: string | null
    nickname: string
    tier?: string
  } | null>(null)
  const [augmentNotice, setAugmentNotice] = useState<{
    name: string
    nickname: string
    message: string
  } | null>(null)
  const [results, setResults] = useState<GameResult[] | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typewriterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const augmentNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const augmentHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 트루먼 환상 중: 위 슬롯은 가짜 곡 기준 · 진짜 answer:correct 무시 */
  const illusionActiveRef = useRef(false)

  useEffect(() => {
    roomRef.current = room
  }, [room])

  const clearTypewriter = useCallback(() => {
    if (typewriterTimer.current) {
      clearTimeout(typewriterTimer.current)
      typewriterTimer.current = null
    }
  }, [])

  const startTypewriter = useCallback((full: string, intervalMs = 1000) => {
    clearTypewriter()
    setAugmentHint('')
    let i = 0
    const skipSpaces = () => {
      while (i < full.length && /\s/.test(full[i])) i += 1
    }
    const tick = () => {
      skipSpaces()
      if (i >= full.length) {
        setAugmentHint(full)
        typewriterTimer.current = null
        return
      }
      // 알파벳이면 한 틱에 최대 2글자, 그 외(한글 등)는 1글자
      let take = 1
      if (/[A-Za-z]/.test(full[i])) {
        take = 1
        if (i + 1 < full.length && /[A-Za-z]/.test(full[i + 1])) take = 2
      }
      i += take
      skipSpaces() // 글자 뒤 띄어쓰기도 바로
      setAugmentHint(full.slice(0, i))
      if (i >= full.length) {
        typewriterTimer.current = null
        return
      }
      typewriterTimer.current = setTimeout(tick, intervalMs)
    }
    tick()
  }, [clearTypewriter])

  const applyVolumes = useCallback((music: number, sfx: number) => {
    setMusicVolumeState(music)
    setSfxVolumeState(sfx)
    applySfxVolume(sfx / 100)
  }, [])

  const persistVolumes = useCallback((music: number, sfx: number) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const data = await api<{ user: AuthUser }>('/api/auth/settings', {
          method: 'PATCH',
          body: JSON.stringify({ musicVolume: music, sfxVolume: sfx }),
        })
        updateStoredUser(data.user)
        setUser(data.user)
      } catch {
        // 네트워크 실패 시 로컬 값은 유지
      }
    }, 400)
  }, [])

  const setMusicVolume = useCallback((n: number) => {
    const music = Math.max(0, Math.min(100, Math.round(n)))
    setMusicVolumeState(music)
    persistVolumes(music, sfxVolume)
  }, [persistVolumes, sfxVolume])

  const setSfxVolume = useCallback((n: number) => {
    const sfx = Math.max(0, Math.min(100, Math.round(n)))
    setSfxVolumeState(sfx)
    applySfxVolume(sfx / 100)
    persistVolumes(musicVolume, sfx)
  }, [persistVolumes, musicVolume])

  useEffect(() => {
    applySfxVolume(sfxVolume / 100)
  }, [sfxVolume])

  useEffect(() => {
    if (!user) return
    // 로그인 상태면 서버 설정으로 동기화 (방 이동과 무관)
    api<{ user: AuthUser }>('/api/auth/me')
      .then((data) => {
        updateStoredUser(data.user)
        setUser(data.user)
        applyVolumes(data.user.musicVolume, data.user.sfxVolume)
      })
      .catch(() => {})
  }, [user?.id, applyVolumes])


  const bindSocket = useCallback(() => {
    const s = connectSocket()
    if (!s) return

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)
    if (s.connected) setConnected(true)

    s.on('lobby:rooms', (list: PublicRoom[]) => setRooms(list))
    s.on('room:state', (st: RoomState) => {
      setRoom(st)
      if (st.status === 'augment') {
        setRound(null)
        setStartCountdown(null)
        setCountdownEndsAt(null)
      }
      if (st.status === 'playing' || st.status === 'duel' || st.status === 'revealing' || st.status === 'ended' || st.status === 'lobby') {
        setStartCountdown(null)
        setCountdownEndsAt(null)
      }
    })
    s.on('song:power_off', (p: { until?: number; seconds?: number }) => {
      const until = typeof p?.until === 'number' ? p.until : Date.now() + (Number(p?.seconds) || 10) * 1000
      setRoom((prev) => {
        if (!prev) return prev
        const uid = getStoredUser()?.id
        if (!uid) return prev
        return {
          ...prev,
          members: prev.members.map((m) =>
            m.userId === uid ? { ...m, songMuteUntil: until } : m,
          ),
        }
      })
    })
    s.on('song:power_off_end', () => {
      setRoom((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          members: prev.members.map((m) => ({ ...m, songMuteUntil: null })),
        }
      })
    })
    s.on('chat:message', (msg: ChatMsg) => setChats((c) => {
      // 동일 id / 짧은 시간 동일 본문 중복 방지 (본인 화면만 복제되는 현상)
      if (c.some((x) => x.id === msg.id)) return c
      const last = c[c.length - 1]
      if (
        last
        && last.userId === msg.userId
        && last.text === msg.text
        && !!last.system === !!msg.system
        && Math.abs((last.at || 0) - (msg.at || 0)) < 80
      ) {
        return c
      }
      return [...c.slice(-200), msg]
    }))
    s.on('round:countdown', (payload: {
      seconds?: number
      endsAt?: number
      preview?: {
        index: number
        total: number
        genre: string
        hasHidden?: boolean
        youtubeUrl: string
        startSec: number
        endSec: number
        titleChosung?: string
        artistChosung?: string
      } | null
    }) => {
      const sec = Math.max(1, Math.floor(Number(payload?.seconds) || 3))
      const endsAt = typeof payload?.endsAt === 'number'
        ? payload.endsAt
        : serverNow() + sec * 1000
      setAugmentOffer(null)
      setCountdownEndsAt(endsAt)
      setStartCountdown(Math.max(1, Math.ceil((endsAt - serverNow()) / 1000)))
      // 이전 라운드 곡이 다시 나오지 않게 지우고, 다음 곡만 뮤트로 프리로드
      const p = payload?.preview
      if (p?.youtubeUrl) {
        const clipDur = Math.max(10, Math.floor((p.endSec ?? 0) - (p.startSec ?? 0)) || 40)
        setRound({
          index: p.index,
          total: p.total,
          // 카운트다운 종료 시각(endsAt)과 별개로, 곡 길이는 클립 길이로 둔다
          endsAt,
          duration: clipDur,
          genre: p.genre,
          hasHidden: !!p.hasHidden,
          youtubeUrl: p.youtubeUrl,
          startSec: p.startSec,
          endSec: p.endSec,
          // 카운트다운 프리로드용 — 초성·가수 힌트는 round:start 때 공개
          titleChosung: '',
          artistChosung: '',
          artistHint: '',
          slots: [],
        })
      } else {
        setRound(null)
      }
      playSfx('countdown')
    })
    s.on('round:start', (info: RoundInfo) => {
      clearTypewriter()
      illusionActiveRef.current = false
      setStartCountdown(null)
      setCountdownEndsAt(null)
      // skip_update 오기 전에도 절반(올림) 기준으로 표시
      setSkip({ votes: 0, need: Math.max(1, Math.ceil((roomRef.current?.members?.length ?? 1) / 2)) })
      // room:state 지연 시 countdown vol=0이 남는 것 방지 — status를 먼저 playing으로
      setRoom((r) => {
        if (!r || r.status === 'lobby' || r.status === 'ended') return r
        if (r.status === 'playing' || r.status === 'duel') return r
        return { ...r, status: 'playing' }
      })
      setRound(info)
      setSkipVoted(false)
      setAugmentOffer(null)
      setAugmentHint(null)
      playSfx('roundStart')
    })
    s.on('illusion:round', (payload: {
      slots: RoundSlot[]
      genre?: string
      titleChosung?: string
      artistChosung?: string
    }) => {
      illusionActiveRef.current = true
      setRound((r) => {
        if (!r) return r
        return {
          ...r,
          slots: payload.slots || [],
          genre: payload.genre || r.genre,
          titleChosung: payload.titleChosung ?? '',
          artistChosung: payload.artistChosung ?? '',
          artistHint: '',
          hasHidden: false,
        }
      })
    })
    s.on('round:extend', (payload: { endsAt: number; duration: number; addedSec?: number }) => {
      setRound((r) => {
        if (!r) return r
        return {
          ...r,
          endsAt: payload.endsAt,
          duration: payload.duration,
        }
      })
    })
    // 증강 선택 진입 시 이전 라운드 곡 상태 제거 (잘못 재생·곡 스킵처럼 보이는 버그 방지)
    s.on('augment:offer', (offer: AugmentOffer) => {
      setRound(null)
      setStartCountdown(null)
      setCountdownEndsAt(null)
      setAugmentOffer(offer)
      playSfx('augment')
      // 시계 샘플은 augmentOffer를 보고 400ms 간격으로 도는 측정 effect가 모은다.
      // 여기서 또 쏘면 요청이 겹쳐 RTT가 스스로 부풀고, 방을 나가도 남은 타이머가 계속 발사된다.
    })
    s.on('answer:correct', (payload: { slotId: string; answer: string; by: string; allCleared?: boolean }) => {
      // 환상 중엔 진짜 문제 정답 공개를 화면에 반영하지 않음
      if (illusionActiveRef.current) return
      // 슬롯 하나여도 「둘 다 맞춤」팡파르로 통일
      playSfx('allCorrect')
      setRound((r) => {
        if (!r) return r
        return {
          ...r,
          slots: r.slots.map((sl) =>
            sl.id === payload.slotId
              ? { ...sl, revealed: true, answer: payload.answer, by: payload.by }
              : sl,
          ),
        }
      })
    })
    s.on('illusion:correct', (payload: { slotId: string; answer: string; label?: string; by: string }) => {
      playSfx('allCorrect')
      setRound((r) => {
        if (!r) return r
        return {
          ...r,
          slots: r.slots.map((sl) =>
            sl.id === payload.slotId
              ? { ...sl, revealed: true, answer: payload.answer, by: payload.by, label: payload.label || sl.label }
              : sl,
          ),
        }
      })
    })
    s.on('truman:reveal', (payload: { name?: string; fakeScore?: number; realScore?: number }) => {
      illusionActiveRef.current = false
      playSfx('augment')
      setTrumanReveal({
        name: payload.name || '트루먼쇼',
        fakeScore: typeof payload.fakeScore === 'number' ? payload.fakeScore : 0,
        realScore: typeof payload.realScore === 'number' ? payload.realScore : 0,
      })
    })
    s.on('truman:fake_correct', () => {
      // 구버전 호환 · 신규는 illusion:correct
      playSfx('allCorrect')
    })
    s.on('hidden:unlock', (payload: { slots: Array<{ id: string; label: string }> }) => {
      if (illusionActiveRef.current) return
      playSfx('augment')
      setRound((r) => {
        if (!r) return r
        const ids = new Set(payload.slots.map((x) => x.id))
        return {
          ...r,
          slots: r.slots.map((sl) =>
            ids.has(sl.id) ? { ...sl, unlocked: true, label: payload.slots.find((x) => x.id === sl.id)?.label || sl.label } : sl,
          ),
        }
      })
    })
    s.on('round:reveal', (payload: { reason?: string; slots: Array<{ id: string; answer: string; by: string | null }> }) => {
      playSfx(
        payload.reason === 'skip' ? 'skip'
          : payload.reason === 'cleared' ? 'allCorrect'
            : 'reveal',
      )
      setSkipVoted(true)
      // 환상 중엔 진짜 곡 정답 공개 스킵 (가짜 슬롯 유지)
      if (illusionActiveRef.current) return
      setRound((r) => {
        if (!r) return r
        return {
          ...r,
          slots: r.slots.map((sl) => {
            const found = payload.slots.find((x) => x.id === sl.id)
            if (!found) return sl
            return { ...sl, revealed: true, answer: found.answer, by: found.by || undefined }
          }),
        }
      })
    })
    s.on('round:skip_update', (p: { votes: number; need: number }) => setSkip(p))
    s.on('augment:used', (p?: {
      userId?: string
      nickname?: string
      name?: string
      description?: string
      imageUrl?: string | null
      tier?: string
      message?: string
    }) => {
      const tier = (p?.tier || '').toLowerCase()
      const isGaho = tier === '가호' || tier === 'gaho'
      if (isGaho && p?.name) {
        playSfx('gaho')
        setGahoCutscene({
          name: p.name,
          description: p.description || '',
          imageUrl: p.imageUrl ?? null,
          nickname: p.nickname || '누군가',
          tier: p.tier,
        })
        return
      }
      playSfx('augmentUse')
      if (p?.name) {
        if (augmentNoticeTimer.current) clearTimeout(augmentNoticeTimer.current)
        setAugmentNotice({
          name: p.name,
          nickname: p.nickname || '누군가',
          message: p.message || `${p.nickname || '누군가'}님이 [${p.name}]을(를) 사용했습니다`,
        })
        // AugmentUseNotice 의 페이드아웃(3.4s)과 맞춘다
        augmentNoticeTimer.current = setTimeout(() => {
          setAugmentNotice(null)
          augmentNoticeTimer.current = null
        }, 3400)
      }
    })
    s.on('augment:hint', (p: {
      userId?: string
      hint: string | null
      name?: string
      durationMs?: number
      mode?: string
      intervalMs?: number
    }) => {
      if (!p.hint) return
      clearTypewriter()
      // 이전 힌트의 자동 해제 타이머가 살아 있으면 새 힌트를 지워버린다
      if (augmentHintTimer.current) {
        clearTimeout(augmentHintTimer.current)
        augmentHintTimer.current = null
      }
      if (p.mode === 'typewriter') {
        startTypewriter(p.hint, p.intervalMs || 1000)
        return
      }
      setAugmentHint(p.hint)
      const ms = p.durationMs ?? 0
      if (ms > 0) {
        augmentHintTimer.current = setTimeout(() => {
          augmentHintTimer.current = null
          setAugmentHint((cur) => (cur === p.hint ? null : cur))
        }, ms)
      }
    })
    s.on('game:end', (p: { results: GameResult[] }) => {
      playSfx('gameEnd')
      clearTypewriter()
      setResults(p.results)
      setRound(null)
      setStartCountdown(null)
      setCountdownEndsAt(null)
      setAugmentOffer(null)
    })

    return () => {
      clearTypewriter()
      if (augmentNoticeTimer.current) clearTimeout(augmentNoticeTimer.current)
      if (augmentHintTimer.current) {
        clearTimeout(augmentHintTimer.current)
        augmentHintTimer.current = null
      }
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      s.removeAllListeners()
    }
  }, [clearTypewriter, startTypewriter])

  useEffect(() => {
    if (!user) {
      disconnectSocket()
      setConnected(false)
      setPingMs(null)
      return
    }
    return bindSocket()
  }, [user?.id, bindSocket])

  useEffect(() => {
    if (!connected) {
      setPingMs(null)
      return
    }
    const measure = (updateClock: boolean) => {
      const s = getSocket()
      if (!s?.connected) return
      const t0 = Date.now()
      s.timeout(2500).emit('ping:rtt', {}, (err: Error | null, res?: { t?: number }) => {
        if (err) return
        const t1 = Date.now()
        const rtt = t1 - t0
        setPingMs((prev) => (prev == null ? rtt : Math.round(prev * 0.5 + rtt * 0.5)))
        // 재생 중에도 오프셋은 갱신(다음 곡에 반영). seek는 플레이어가 serverNow만 쓰므로 지금 곡은 안 건드림.
        if (updateClock && typeof res?.t === 'number') {
          if (applyClockSample(t0, res.t, t1)) {
            setClockSamples((n) => n + 1)
          }
        }
      })
    }
    if (augmentOffer) {
      measure(true)
      const id = window.setInterval(() => measure(true), 400)
      return () => window.clearInterval(id)
    }
    // 플레이 중: 오프셋도 계속 맞춤(다음 곡용) · 핑은 더 자주
    measure(true)
    const id = window.setInterval(() => measure(true), 1200)
    return () => window.clearInterval(id)
  }, [connected, augmentOffer])

  // 서버 endsAt 기준 카운트다운 (사람마다 로컬 틱 어긋남 완화)
  useEffect(() => {
    if (countdownEndsAt == null) return
    let lastShown: number | null = null
    const tick = () => {
      const left = Math.max(0, Math.ceil((countdownEndsAt - serverNow()) / 1000))
      if (left <= 0) return
      if (lastShown != null && left < lastShown) playSfx('countdown')
      lastShown = left
      setStartCountdown(left)
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [countdownEndsAt])

  const login = async (username: string, password: string) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setAuth(data.token, data.user)
    setUser(data.user)
    applyVolumes(data.user.musicVolume, data.user.sfxVolume)
  }

  const register = async (username: string, password: string, nickname: string) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, nickname }),
    })
    setAuth(data.token, data.user)
    setUser(data.user)
    applyVolumes(data.user.musicVolume, data.user.sfxVolume)
  }

  const logout = () => {
    clearAuth()
    disconnectSocket()
    setUser(null)
    setRoom(null)
    setRooms([])
    setChats([])
    setRound(null)
    setStartCountdown(null)
    setCountdownEndsAt(null)
    setResults(null)
    setConnected(false)
    setPingMs(null)
    resetClockSync()
    setClockSamples(0)
    applyVolumes(70, 55)
  }

  const updateProfile = async (nickname: string) => {
    const data = await api<{ token: string; user: AuthUser }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ nickname }),
    })
    disconnectSocket()
    setConnected(false)
    setAuth(data.token, data.user)
    setUser(data.user)
    // user 변경으로 소켓 재연결 후 방 멤버 정보 동기화
    setTimeout(() => getSocket()?.emit('profile:sync', {}), 500)
  }

  const uploadAvatar = async (imageBase64: string) => {
    const data = await api<{ user: AuthUser }>('/api/auth/avatar', {
      method: 'POST',
      body: JSON.stringify({ imageBase64 }),
    })
    updateStoredUser(data.user)
    setUser(data.user)
    getSocket()?.emit('profile:sync', {})
  }

  const removeAvatar = async () => {
    const data = await api<{ user: AuthUser }>('/api/auth/avatar', { method: 'DELETE' })
    updateStoredUser(data.user)
    setUser(data.user)
    getSocket()?.emit('profile:sync', {})
  }
  const emitAck = <T,>(event: string, payload?: unknown) =>
    new Promise<T>((resolve, reject) => {
      const s = getSocket()
      if (!s) return reject(new Error('소켓 미연결'))
      s.timeout(8000).emit(event, payload ?? {}, (err: Error | null, res: T) => {
        if (err) reject(err)
        else resolve(res)
      })
    })

  const createRoom = async (opts = {}) => {
    const res = await emitAck<{ ok: boolean; room?: RoomState; code?: string | null; error?: string }>('room:create', opts)
    if (!res.ok || !res.room) throw new Error(res.error || '방 생성 실패')
    setRoom(res.room)
    setRoomCode(res.code || null)
    setChats([])
    setResults(null)
  }

  const joinRoom = async (opts: { roomId?: string; code?: string; asSpectator?: boolean }) => {
    const res = await emitAck<{ ok: boolean; room?: RoomState; error?: string }>('room:join', opts)
    if (!res.ok || !res.room) throw new Error(res.error || '입장 실패')
    setRoom(res.room)
    setChats([])
    setResults(null)
  }

  const leaveRoom = () => {
    getSocket()?.emit('room:leave')
    setRoom(null)
    setRoomCode(null)
    setChats([])
    setRound(null)
    setStartCountdown(null)
    setCountdownEndsAt(null)
    setAugmentOffer(null)
    setResults(null)
  }

  const setReady = () => getSocket()?.emit('room:ready')
  const setSpectator = async (spectator: boolean) => {
    const res = await emitAck<{ ok: boolean; room?: RoomState; error?: string }>('room:set_spectator', { spectator })
    if (!res.ok) throw new Error(res.error || '역할 변경 실패')
    if (res.room) setRoom(res.room)
  }
  const setChatColor = async (color: number | null) => {
    const res = await emitAck<{ ok: boolean; room?: RoomState; error?: string }>('room:chat_color', { color })
    if (!res.ok) throw new Error(res.error || '색 변경 실패')
    if (res.room) setRoom(res.room)
  }
  const updateSettings = (payload: {
    genreCounts?: Record<string, number>
    maxPlayers?: number
    name?: string
    answerMode?: 'title' | 'title_artist'
    augmentsEnabled?: boolean
    gameMode?: GameMode
    readingTargetScore?: number
    recentSongPenalty?: number
  }) =>
    getSocket()?.emit('room:settings', payload)

  const startGame = async () => {
    const res = await emitAck<{ ok: boolean; error?: string }>('game:start', {})
    if (!res.ok) throw new Error(res.error || '시작 실패')
  }

  const sendChat = (text: string) => getSocket()?.emit('chat:message', { text })
  const submitAnswer = (text: string) => getSocket()?.emit('answer:submit', { text })
  const readingAccept = () => {
    const s = getSocket()
    if (!s) return
    s.emit('reading:accept', {}, (res?: { ok?: boolean; error?: string }) => {
      if (res && res.ok === false) console.warn('[reading]', res.error)
    })
  }
  const readingPass = () => {
    const s = getSocket()
    if (!s) return
    s.emit('reading:pass', {}, (res?: { ok?: boolean; error?: string }) => {
      if (res && res.ok === false) console.warn('[reading]', res.error)
    })
  }
  const readingClaim = () => {
    const s = getSocket()
    if (!s) return
    s.emit('reading:claim', {}, (res?: { ok?: boolean; error?: string }) => {
      if (res && res.ok === false) console.warn('[reading]', res.error)
    })
  }
  const readingVote = (vote: 'yes' | 'no') => {
    const s = getSocket()
    if (!s) return
    s.emit('reading:vote', { vote }, (res?: { ok?: boolean; error?: string }) => {
      if (res && res.ok === false) console.warn('[reading]', res.error)
    })
  }
  const voteSkip = () => {
    if (skipVoted) return
    if (room?.status !== 'playing') return
    setSkipVoted(true)
    playSfx('skipVote')
    getSocket()?.emit('round:skip')
  }
  // 증강 화면의 마감 타이머 effect가 deps로 쓴다 — identity가 바뀌면 타이머가 계속 재시작된다
  const pickAugment = useCallback((augmentId: string | null, gahoAugmentId?: string | null) => {
    getSocket()?.emit('augment:offer_done', {
      augmentId,
      ...(gahoAugmentId ? { gahoAugmentId } : {}),
    })
    setAugmentOffer(null)
  }, [])
  const rerollAugment = async () => {
    const res = await emitAck<{ ok: boolean; candidates?: AugmentItem[]; lockedTier?: string | null }>(
      'augment:reroll',
      {},
    )
    if (res.ok && res.candidates) {
      setAugmentOffer((o) =>
        o
          ? {
              ...o,
              candidates: res.candidates!,
              rerolls: Math.max(0, o.rerolls - 1),
              lockedTier: res.lockedTier ?? o.lockedTier,
            }
          : o,
      )
    }
  }
  const useAugment = (payload?: { targetUserId?: string; targetUserIds?: string[]; gahoAugmentId?: string; genreName?: string }) =>
    getSocket()?.emit('augment:use', payload || {})
  const fetchGahoCandidates = async () => {
    const res = await emitAck<{
      ok: boolean
      candidates?: Array<AugmentItem & { description?: string }>
      endsAt?: number | null
      remainingSec?: number | null
    }>('augment:gaho_candidates', {})
    if (!res.ok || !res.candidates) {
      return { candidates: [], endsAt: null, remainingSec: null }
    }
    return {
      candidates: res.candidates,
      endsAt: res.endsAt ?? null,
      remainingSec: res.remainingSec ?? null,
    }
  }
  const clearResults = () => setResults(null)
  const clearTrumanReveal = () => setTrumanReveal(null)
  const clearGahoCutscene = () => setGahoCutscene(null)
  const clearAugmentNotice = () => {
    if (augmentNoticeTimer.current) clearTimeout(augmentNoticeTimer.current)
    augmentNoticeTimer.current = null
    setAugmentNotice(null)
  }

  const value = useMemo(
    () => ({
      user,
      connected,
      pingMs,
      musicVolume,
      sfxVolume,
      setMusicVolume,
      setSfxVolume,
      rooms,
      room,
      roomCode,
      chats,
      round,
      startCountdown,
      countdownEndsAt,
      skip,
      skipVoted,
      augmentOffer,
      augmentHint,
      results,
      trumanReveal,
      clearTrumanReveal,
      gahoCutscene,
      clearGahoCutscene,
      augmentNotice,
      clearAugmentNotice,
      serverNow,
      clockSamples,
      login,
      register,
      logout,
      updateProfile,
      uploadAvatar,
      removeAvatar,
      createRoom,
      joinRoom,
      leaveRoom,
      setReady,
      setSpectator,
      setChatColor,
      updateSettings,
      startGame,
      sendChat,
      submitAnswer,
      readingAccept,
      readingPass,
      readingClaim,
      readingVote,
      voteSkip,
      pickAugment,
      rerollAugment,
      useAugment,
      fetchGahoCandidates,
      clearResults,
    }),
    [
      user,
      connected,
      pingMs,
      musicVolume,
      sfxVolume,
      setMusicVolume,
      setSfxVolume,
      rooms,
      room,
      roomCode,
      chats,
      round,
      startCountdown,
      countdownEndsAt,
      skip,
      skipVoted,
      augmentOffer,
      augmentHint,
      results,
      trumanReveal,
      gahoCutscene,
      augmentNotice,
      clockSamples,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGame() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useGame requires GameProvider')
  return ctx
}
