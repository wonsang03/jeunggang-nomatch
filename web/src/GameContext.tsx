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

export type PublicRoom = {
  id: string
  name: string
  players: number
  max: number
  priv: boolean
  genre: string
}

export type ActiveBuffPublic = {
  name: string
  description?: string
  effectType: string
  imageUrl?: string | null
  usedByNickname?: string
  mult?: number | null
  rate?: number | null
  startIndex: number
  roundsLeft: number
  pending: boolean
  active: boolean
}

export type RoomMember = {
  userId: string
  nickname: string
  avatarUrl?: string | null
  ready: boolean
  score: number
  isHost: boolean
  heldAugmentId: string | null
  heldAugmentName: string | null
  heldAugmentDescription?: string | null
  heldAugmentImageUrl?: string | null
  heldAugmentEffectType?: string | null
  usedAugments: string[]
  activeBuffs?: ActiveBuffPublic[]
  /** 감옥 등 */
  chatMuted?: boolean
  chatMutePending?: boolean
  chatMuteBy?: string | null
  chatMuteByNickname?: string | null
  chatMuteStartIndex?: number | null
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
  /** 쉬었음청년 */
  answerBlocked?: boolean
  answerBlockPending?: boolean
  answerBlockRoundsLeft?: number | null
  answerBlockBy?: string | null
  /** 나이거 뭔지 알아: 본인만 보는 제목·가수 */
  knowSpoilTitle?: string | null
  knowSpoilArtist?: string | null
  /** 범인은 당신이야: 감시 중 */
  accuseWatchPending?: boolean
  accuseWatchActive?: boolean
  accuseWatchBy?: string | null
  /** 산데비스탄 등: 현재 라운드 재생 배속 */
  playbackRate?: number | null
  /** 슬로우 스타터: 라운드 시작 후 N초 동안 무음 */
  audioDelaySec?: number | null
  audioDelayUntil?: number | null
  /** 트루먼쇼: 대상만 다른 곡 */
  decoyYoutubeUrl?: string | null
  decoyStartSec?: number | null
  sakuraActive?: boolean
  sakuraScoreMult?: number | null
  sakuraBy?: string | null
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
  genreCounts: Record<string, number>
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
}

export type RoundSlot = {
  id: string
  label: string
  revealed: boolean
  hidden?: boolean
  unlocked?: boolean
  answer?: string
  by?: string
}

export type RoundInfo = {
  index: number
  total: number
  endsAt: number
  duration: number
  genre: string
  youtubeUrl: string
  startSec: number
  endSec: number
  titleChosung: string
  artistChosung: string
  slots: RoundSlot[]
  duel?: boolean
  duelLabel?: string
  duelPenalty?: number
  duelChallenger?: string
  duelOpponent?: string
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
  rerolls: number
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
  skip: { votes: number; need: number }
  skipVoted: boolean
  augmentOffer: AugmentOffer | null
  augmentHint: string | null
  results: GameResult[] | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, nickname: string) => Promise<void>
  logout: () => void
  updateProfile: (nickname: string) => Promise<void>
  uploadAvatar: (imageBase64: string) => Promise<void>
  removeAvatar: () => Promise<void>
  createRoom: (opts?: { name?: string; isPrivate?: boolean; maxPlayers?: number; genreCounts?: Record<string, number> }) => Promise<void>
  joinRoom: (opts: { roomId?: string; code?: string }) => Promise<void>
  leaveRoom: () => void
  setReady: () => void
  updateSettings: (payload: { genreCounts?: Record<string, number>; maxPlayers?: number; name?: string }) => void
  startGame: () => Promise<void>
  sendChat: (text: string) => void
  submitAnswer: (text: string) => void
  voteSkip: () => void
  pickAugment: (augmentId: string | null) => void
  rerollAugment: () => Promise<void>
  useAugment: (payload?: { targetUserId?: string; gahoAugmentId?: string; genreName?: string }) => void
  fetchGahoCandidates: () => Promise<Array<AugmentItem & { description?: string }>>
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
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatMsg[]>([])
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [startCountdown, setStartCountdown] = useState<number | null>(null)
  const [skip, setSkip] = useState({ votes: 0, need: 1 })
  const [skipVoted, setSkipVoted] = useState(false)
  const [augmentOffer, setAugmentOffer] = useState<AugmentOffer | null>(null)
  const [augmentHint, setAugmentHint] = useState<string | null>(null)
  const [results, setResults] = useState<GameResult[] | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typewriterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      }
      if (st.status === 'playing' || st.status === 'duel' || st.status === 'revealing' || st.status === 'ended' || st.status === 'lobby') {
        setStartCountdown(null)
      }
    })
    s.on('chat:message', (msg: ChatMsg) => setChats((c) => [...c.slice(-200), msg]))
    s.on('round:countdown', (payload: {
      seconds?: number
      preview?: {
        index: number
        total: number
        genre: string
        youtubeUrl: string
        startSec: number
        endSec: number
        titleChosung?: string
        artistChosung?: string
      } | null
    }) => {
      const sec = Math.max(1, Math.floor(Number(payload?.seconds) || 3))
      setAugmentOffer(null)
      setStartCountdown(sec)
      // 이전 라운드 곡이 다시 나오지 않게 지우고, 다음 곡만 뮤트로 프리로드
      const p = payload?.preview
      if (p?.youtubeUrl) {
        setRound({
          index: p.index,
          total: p.total,
          endsAt: Date.now() + sec * 1000,
          duration: sec,
          genre: p.genre,
          youtubeUrl: p.youtubeUrl,
          startSec: p.startSec,
          endSec: p.endSec,
          titleChosung: p.titleChosung || '',
          artistChosung: p.artistChosung || '',
          slots: [],
        })
      } else {
        setRound(null)
      }
      playSfx('countdown')
    })
    s.on('round:start', (info: RoundInfo) => {
      clearTypewriter()
      setStartCountdown(null)
      setRound(info)
      setSkip({ votes: 0, need: 1 })
      setSkipVoted(false)
      setAugmentOffer(null)
      setAugmentHint(null)
      playSfx('roundStart')
    })
    // 증강 선택 진입 시 이전 라운드 곡 상태 제거 (잘못 재생·곡 스킵처럼 보이는 버그 방지)
    s.on('augment:offer', (offer: AugmentOffer) => {
      setRound(null)
      setStartCountdown(null)
      setAugmentOffer(offer)
      playSfx('augment')
    })
    s.on('answer:correct', (payload: { slotId: string; answer: string; by: string }) => {
      playSfx('correct')
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
    s.on('hidden:unlock', (payload: { slots: Array<{ id: string; label: string }> }) => {
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
      playSfx(payload.reason === 'skip' ? 'skip' : 'reveal')
      setSkipVoted(true)
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
    s.on('augment:used', () => {
      playSfx('augmentUse')
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
      if (p.mode === 'typewriter') {
        startTypewriter(p.hint, p.intervalMs || 1000)
        return
      }
      setAugmentHint(p.hint)
      const ms = p.durationMs ?? 0
      if (ms > 0) {
        setTimeout(() => {
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
      setAugmentOffer(null)
    })

    return () => {
      clearTypewriter()
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
    const measure = () => {
      const s = getSocket()
      if (!s?.connected) return
      const start = Date.now()
      s.timeout(4000).emit('ping:rtt', {}, (err: Error | null) => {
        if (!err) setPingMs(Date.now() - start)
      })
    }
    measure()
    const id = window.setInterval(measure, 3000)
    return () => window.clearInterval(id)
  }, [connected])

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
    setResults(null)
    setConnected(false)
    setPingMs(null)
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

  const joinRoom = async (opts: { roomId?: string; code?: string }) => {
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
    setAugmentOffer(null)
    setResults(null)
  }

  const setReady = () => getSocket()?.emit('room:ready')
  const updateSettings = (payload: { genreCounts?: Record<string, number>; maxPlayers?: number; name?: string }) =>
    getSocket()?.emit('room:settings', payload)

  const startGame = async () => {
    const res = await emitAck<{ ok: boolean; error?: string }>('game:start', {})
    if (!res.ok) throw new Error(res.error || '시작 실패')
  }

  const sendChat = (text: string) => getSocket()?.emit('chat:message', { text })
  const submitAnswer = (text: string) => getSocket()?.emit('answer:submit', { text })
  const voteSkip = () => {
    if (skipVoted) return
    if (room?.status !== 'playing') return
    setSkipVoted(true)
    getSocket()?.emit('round:skip')
  }
  const pickAugment = (augmentId: string | null) => {
    getSocket()?.emit('augment:offer_done', { augmentId })
    setAugmentOffer(null)
  }
  const rerollAugment = async () => {
    const res = await emitAck<{ ok: boolean; candidates?: AugmentItem[] }>('augment:reroll', {})
    if (res.ok && res.candidates) {
      setAugmentOffer((o) => (o ? { ...o, candidates: res.candidates!, rerolls: Math.max(0, o.rerolls - 1) } : o))
    }
  }
  const useAugment = (payload?: { targetUserId?: string; gahoAugmentId?: string; genreName?: string }) =>
    getSocket()?.emit('augment:use', payload || {})
  const fetchGahoCandidates = async () => {
    const res = await emitAck<{
      ok: boolean
      candidates?: Array<AugmentItem & { description?: string }>
    }>('augment:gaho_candidates', {})
    return res.ok && res.candidates ? res.candidates : []
  }
  const clearResults = () => setResults(null)

  // 증강 후 3·2·1 로컬 틱
  useEffect(() => {
    if (startCountdown == null || startCountdown <= 1) return
    const t = window.setTimeout(() => {
      setStartCountdown((n) => {
        if (n == null || n <= 1) return n
        playSfx('countdown')
        return n - 1
      })
    }, 1000)
    return () => window.clearTimeout(t)
  }, [startCountdown])

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
      skip,
      skipVoted,
      augmentOffer,
      augmentHint,
      results,
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
      updateSettings,
      startGame,
      sendChat,
      submitAnswer,
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
      skip,
      skipVoted,
      augmentOffer,
      augmentHint,
      results,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGame() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useGame requires GameProvider')
  return ctx
}
