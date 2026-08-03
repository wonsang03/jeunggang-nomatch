import { useState, useEffect, useRef } from 'react'
import { useGame } from './GameContext'
import { serverNow } from './clockSync'

const C = {
  blue: '#5D8CD7',
  graphite: '#2A3340',
}
const F = {
  ui: '"Pretendard", "Noto Sans KR", system-ui, sans-serif',
}
function sk(accent?: string) {
  return {
    border: `2.5px solid ${C.graphite}`,
    boxShadow: accent ? `3px 3px 0 ${accent}` : `3px 3px 0 ${C.graphite}`,
  } as const
}

export function ytId(url: string) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)
  return m?.[1] || ''
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string
          width?: number
          height?: number
          host?: string
          playerVars?: Record<string, number | string>
          events?: {
            onReady?: (e: { target: YtPlayer }) => void
            onStateChange?: (e: { data: number; target: YtPlayer }) => void
            onError?: (e: { data: number }) => void
          }
        },
      ) => YtPlayer
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; CUED: number; BUFFERING: number; UNSTARTED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

type YtPlayer = {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (sec: number, allowSeekAhead: boolean) => void
  setVolume: (n: number) => void
  setPlaybackRate: (rate: number) => void
  getAvailablePlaybackRates: () => number[]
  getCurrentTime: () => number
  unMute: () => void
  mute: () => void
  destroy: () => void
  getPlayerState: () => number
  loadVideoById: (opts: string | { videoId: string; startSeconds?: number; endSeconds?: number }) => void
  cueVideoById: (opts: string | { videoId: string; startSeconds?: number; endSeconds?: number }) => void
}

export type { YtPlayer }

let ytApiPromise: Promise<void> | null = null
export function loadYtApi() {
  if (window.YT?.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
    // 이미 로드된 경우
    const check = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(check)
        resolve()
      }
    }, 50)
  })
  return ytApiPromise
}

export function HiddenYouTube({
  url,
  startSec,
  volume,
  durationSec,
  paused = false,
  playbackRate = 1,
  playLabel = '🎵 탭해서 노래 재생',
  audioUnlockAt = null,
  cutMute = false,
  roundEndsAt = null,
  roundDurationSec = null,
  loop = false,
  /** 값이 바뀔 때마다 강제 재킥 (라운드 시작 등) */
  playEpoch = 0,
}: {
  url: string
  startSec: number
  volume: number
  /** 있으면 start부터 이 초만큼만 재생 */
  durationSec?: number
  /** true면 일시정지 (컷신 등) */
  paused?: boolean
  /** YouTube 재생 배속 (지원 목록에 스냅) */
  playbackRate?: number
  playLabel?: string
  /** 슬로우 스타터: 이 시각 이후에만 들리기 시작 */
  audioUnlockAt?: number | null
  /** 전원을 꺼봤습니다: 즉시 끊기 */
  cutMute?: boolean
  roundEndsAt?: number | null
  roundDurationSec?: number | null
  /** true면 끝나면 startSec부터 다시 재생 (불꽃남자 BGM) */
  loop?: boolean
  playEpoch?: number | string
}) {
  const id = ytId(url)
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const rateRef = useRef(playbackRate)
  rateRef.current = playbackRate
  const volumeRef = useRef(volume)
  volumeRef.current = volume
  const unlockAtRef = useRef(audioUnlockAt)
  unlockAtRef.current = audioUnlockAt
  const cutMuteRef = useRef(cutMute)
  cutMuteRef.current = cutMute
  const loopRef = useRef(loop)
  loopRef.current = loop
  const endsAtRef = useRef(roundEndsAt)
  endsAtRef.current = roundEndsAt
  const roundDurRef = useRef(roundDurationSec)
  roundDurRef.current = roundDurationSec
  const startRef = useRef(0)
  const endRef = useRef<number | undefined>(undefined)
  const durationSecRef = useRef(durationSec)
  durationSecRef.current = durationSec
  const idRef = useRef(id)
  idRef.current = id
  const audioLockedRef = useRef(!!(audioUnlockAt && audioUnlockAt > serverNow()))
  const [blocked, setBlocked] = useState(false)
  const [ready, setReady] = useState(false)
  const start = Math.max(0, Math.floor(startSec))
  const end = durationSec && durationSec > 0 ? start + Math.floor(durationSec) : undefined
  startRef.current = start
  endRef.current = end

  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearMediaTimers = () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current)
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current)
    for (const t of retryTimersRef.current) clearTimeout(t)
    stopTimerRef.current = null
    delayTimerRef.current = null
    checkTimerRef.current = null
    retryTimersRef.current = []
  }

  const applyRate = (p: YtPlayer, desired: number) => {
    try {
      const available = typeof p.getAvailablePlaybackRates === 'function'
        ? p.getAvailablePlaybackRates()
        : [0.25, 0.5, 0.75, 1]
      let best = available[0] ?? 1
      let bestDist = Math.abs(best - desired)
      for (const a of available) {
        const d = Math.abs(a - desired)
        if (d < bestDist) {
          best = a
          bestDist = d
        }
      }
      p.setPlaybackRate(best)
    } catch { /* ignore */ }
  }

  const seekToRoundProgress = (p: YtPlayer) => {
    const endsAt = endsAtRef.current
    const dur = roundDurRef.current
    const s = startRef.current
    if (!endsAt || !dur || dur <= 0) return
    const roundStart = endsAt - dur * 1000
    const elapsedSec = Math.max(0, (serverNow() - roundStart) / 1000)
    const pos = s + elapsedSec * rateRef.current
    try {
      p.seekTo(pos, true)
    } catch { /* ignore */ }
  }

  /** 항상 뮤트로 재생 시작(자동재생 허용) → volume>0이면 언뮤트 */
  const syncPlayback = (p: YtPlayer, opts?: { seek?: boolean }) => {
    try {
      if (opts?.seek) {
        if (endsAtRef.current && roundDurRef.current && roundDurRef.current > 0) {
          seekToRoundProgress(p)
        } else {
          p.seekTo(startRef.current, true)
        }
      }
      applyRate(p, rateRef.current)
      // paused만 진짜 정지. cutMute/volume0 은 pause 하지 않음
      // (http 배포에서 pause 후 loadVideoById 자동재생이 번갈아 실패함)
      if (pausedRef.current || audioLockedRef.current) {
        p.pauseVideo()
        p.mute()
        p.setVolume(0)
        return
      }
      const vol = cutMuteRef.current ? 0 : Math.max(0, Math.min(100, volumeRef.current))
      p.setVolume(vol)
      p.mute()
      p.playVideo()
      if (vol > 0) {
        p.unMute()
        p.setVolume(vol)
      }
    } catch { /* ignore */ }
  }

  const loadOpts = (videoId: string) => {
    const opts: { videoId: string; startSeconds?: number; endSeconds?: number } = {
      videoId,
      startSeconds: startRef.current,
    }
    if (endRef.current != null) opts.endSeconds = endRef.current
    return opts
  }

  const kickPlayback = (p: YtPlayer) => {
    clearMediaTimers()
    const unlockAt = unlockAtRef.current
    const waitMs = unlockAt != null ? Math.max(0, unlockAt - serverNow()) : 0
    const run = () => {
      syncPlayback(p, { seek: true })
      const dur = durationSecRef.current
      if (dur && dur > 0 && !pausedRef.current) {
        stopTimerRef.current = setTimeout(() => {
          try { p.pauseVideo() } catch { /* ignore */ }
        }, dur * 1000)
      }
      // 자동재생이 한 박자 늦게 붙는 경우 대비 재시도
      for (const ms of [200, 500, 1000, 1800, 2800]) {
        const t = setTimeout(() => {
          if (pausedRef.current || audioLockedRef.current) return
          try {
            const st = p.getPlayerState()
            // -1 unstarted, 0 ended, 2 paused, 5 cued
            if (st === 1 || st === 3) {
              const vol = cutMuteRef.current ? 0 : volumeRef.current
              if (vol > 0) {
                p.unMute()
                p.setVolume(vol)
              } else {
                p.mute()
                p.setVolume(0)
              }
              setBlocked(false)
              return
            }
            syncPlayback(p, { seek: st === 0 || st === 5 || st === -1 || st === 2 })
          } catch { /* ignore */ }
        }, ms)
        retryTimersRef.current.push(t)
      }
      checkTimerRef.current = setTimeout(() => {
        if (pausedRef.current || audioLockedRef.current) return
        try {
          const st = p.getPlayerState()
          if (st !== 1 && st !== 3) setBlocked(true)
          else {
            const vol = cutMuteRef.current ? 0 : volumeRef.current
            if (vol > 0) {
              p.unMute()
              p.setVolume(vol)
            }
            setBlocked(false)
          }
        } catch {
          setBlocked(true)
        }
      }, 3200)
    }
    if (waitMs > 0) {
      audioLockedRef.current = true
      try {
        p.mute()
        p.pauseVideo()
        p.seekTo(startRef.current, true)
      } catch { /* ignore */ }
      delayTimerRef.current = setTimeout(() => {
        audioLockedRef.current = false
        run()
      }, waitMs)
    } else {
      audioLockedRef.current = false
      run()
    }
  }

  const switchVideo = (p: YtPlayer, videoId: string) => {
    setBlocked(false)
    try {
      p.loadVideoById(loadOpts(videoId))
    } catch {
      try {
        p.cueVideoById(loadOpts(videoId))
      } catch { /* ignore */ }
    }
    // load 직후 바로 play가 무시되는 경우가 있어 짧게 딜레이
    const t = setTimeout(() => kickPlayback(p), 120)
    retryTimersRef.current.push(t)
  }

  // 플레이어는 마운트 시 1회만 생성 — 라운드마다 destroy 하지 않음 (다음 곡 재생 실패 방지)
  useEffect(() => {
    if (!hostRef.current) return
    let cancelled = false
    let player: YtPlayer | null = null

    ;(async () => {
      await loadYtApi()
      if (cancelled || !hostRef.current || !window.YT) return
      const initialId = idRef.current
      if (!initialId) return

      hostRef.current.innerHTML = ''
      const mount = document.createElement('div')
      hostRef.current.appendChild(mount)

      const https = window.location.protocol === 'https:'
      player = new window.YT.Player(mount, {
        videoId: initialId,
        width: 200,
        height: 112,
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          enablejsapi: 1,
          ...(https ? { origin: window.location.origin } : {}),
        },
        events: {
          onReady: (e) => {
            if (cancelled) return
            playerRef.current = e.target
            setTimeout(() => {
              const iframe = hostRef.current?.querySelector('iframe')
              if (iframe) {
                iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
                iframe.setAttribute(
                  'allow',
                  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
                )
              }
            }, 0)
            // ready 후 아래 effect가 load/kick — 여기서 중복 play 하지 않음
            setReady(true)
          },
          onStateChange: (e) => {
            if (e.data === 0 && loopRef.current) {
              try {
                e.target.seekTo(startRef.current, true)
                e.target.playVideo()
                if (volumeRef.current > 0 && !pausedRef.current && !cutMuteRef.current) {
                  e.target.unMute()
                  e.target.setVolume(volumeRef.current)
                }
              } catch { /* ignore */ }
              return
            }
            if (e.data === 1) {
              setBlocked(false)
              if (!pausedRef.current && !audioLockedRef.current) {
                try {
                  const vol = cutMuteRef.current ? 0 : volumeRef.current
                  if (vol > 0) {
                    e.target.unMute()
                    e.target.setVolume(vol)
                  } else {
                    e.target.mute()
                    e.target.setVolume(0)
                  }
                } catch { /* ignore */ }
              }
            }
            // cued/unstarted/paused인데 재생해야 하면 한 번 더
            if (
              (e.data === 5 || e.data === -1 || e.data === 2)
              && !pausedRef.current
              && !audioLockedRef.current
            ) {
              const t = setTimeout(() => syncPlayback(e.target, { seek: e.data !== 2 }), 80)
              retryTimersRef.current.push(t)
            }
          },
          onError: () => {
            const p = playerRef.current
            const cur = idRef.current
            if (p && cur) {
              try {
                p.cueVideoById(loadOpts(cur))
                const t = setTimeout(() => kickPlayback(p), 200)
                retryTimersRef.current.push(t)
                return
              } catch { /* ignore */ }
            }
            setBlocked(true)
          },
        },
      })
    })()

    return () => {
      cancelled = true
      clearMediaTimers()
      try { player?.destroy() } catch { /* ignore */ }
      try { playerRef.current?.destroy() } catch { /* ignore */ }
      playerRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 1회만
  }, [])

  const lastLoadKeyRef = useRef('')
  // 곡/구간 변경 시 같은 플레이어에 새 영상 로드
  useEffect(() => {
    if (!id || !ready) return
    const p = playerRef.current
    if (!p) return
    const key = `${id}|${start}|${end ?? ''}|${audioUnlockAt ?? ''}|${durationSec ?? ''}`
    if (lastLoadKeyRef.current === key) return
    lastLoadKeyRef.current = key
    switchVideo(p, id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, start, end, durationSec, audioUnlockAt, ready])

  // 라운드 시작 등: 같은 영상이어도 강제 재생 킥
  useEffect(() => {
    if (!ready) return
    const p = playerRef.current
    if (!p || !id) return
    const t = setTimeout(() => kickPlayback(p), 80)
    retryTimersRef.current.push(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playEpoch, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    applyRate(p, playbackRate)
  }, [playbackRate, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    syncPlayback(p)
  }, [paused, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    // cutMute: pause 하지 말고 뮤트만 (자동재생 토큰 유지)
    syncPlayback(p, { seek: !cutMute && !loopRef.current })
  }, [cutMute, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready || paused || audioLockedRef.current) return
    try {
      const vol = cutMuteRef.current ? 0 : Math.max(0, Math.min(100, volume))
      p.setVolume(vol)
      if (vol <= 0) {
        p.mute()
        p.playVideo()
      } else {
        p.mute()
        p.playVideo()
        p.unMute()
        p.setVolume(vol)
      }
    } catch { /* ignore */ }
  }, [volume, ready, paused])

  const forcePlay = () => {
    const p = playerRef.current
    if (!p || !id) return
    audioLockedRef.current = false
    try {
      p.loadVideoById(loadOpts(id))
      p.seekTo(start, true)
      applyRate(p, rateRef.current)
      const vol = Math.max(0, Math.min(100, volume))
      p.setVolume(vol)
      if (vol <= 0) p.mute()
      else p.unMute()
      p.playVideo()
      setBlocked(false)
    } catch { /* ignore */ }
  }

  if (!id) return null

  return (
    <>
      {/* YouTube는 display:none / opacity≈0 이면 재생이 자주 막혀서, 화면 밖 1px로만 유지 */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: -2,
          bottom: -2,
          width: 1,
          height: 1,
          opacity: 1,
          pointerEvents: 'none',
          zIndex: -1,
          overflow: 'hidden',
        }}
      >
        <div ref={hostRef} style={{ width: 200, height: 112 }} />
      </div>
      {blocked && (
        <button
          type="button"
          onClick={forcePlay}
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            zIndex: 50,
            ...sk(C.blue),
            backgroundColor: C.blue,
            color: '#fff',
            fontFamily: F.ui,
            fontSize: 16,
            fontWeight: 800,
            padding: '12px 22px',
            cursor: 'pointer',
            border: `2.5px solid ${C.graphite}`,
          }}
        >
          {playLabel}
        </button>
      )}
    </>
  )
}

const FLAME_KIM_FALLBACK_URL = 'https://www.youtube.com/watch?v=x1PTr27NYds'
/** 증강 선택 화면 BGM */
const AUGMENT_SELECT_BGM_URL = 'https://www.youtube.com/watch?v=L422Qs3K6_I'
/** 진흙탕 싸움 기본 BGM (사과게임) */
const MUD_FIGHT_BGM_FALLBACK = 'https://www.youtube.com/watch?v=ZzHYbM0l4ec'

/**
 * 방 정답곡 + 트릭(진흙탕/세노 등) + 증강선택 BGM 을 한 플레이어로 유지.
 * (여러 YouTube iframe 이 동시에 뜨면 http IP 에서 재생이 깨짐)
 */
export function RoomSongPersistentBgm() {
  const { user, room, round, musicVolume } = useGame()
  const [now, setNow] = useState(() => serverNow())
  const [session, setSession] = useState<{
    url: string
    startSec: number
    endsAt: number | null
    duration: number
    index: number
  } | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!room || room.status === 'lobby' || room.status === 'ended') {
      setSession(null)
      return
    }
    if (round?.youtubeUrl) {
      const clipDur = Math.max(
        10,
        Math.floor(round.duration || ((round.endSec ?? 0) - (round.startSec ?? 0)) || 40),
      )
      setSession({
        url: round.youtubeUrl,
        startSec: round.startSec ?? 0,
        endsAt: round.endsAt ?? null,
        duration: clipDur,
        index: round.index,
      })
    }
  }, [
    room,
    room?.status,
    round?.index,
    round?.youtubeUrl,
    round?.startSec,
    round?.endSec,
    round?.endsAt,
    round?.duration,
  ])

  if (!user || !room || room.status === 'lobby' || room.status === 'ended') return null

  const me = room.members.find((m) => m.userId === user.id)
  const inDuel = room.status === 'duel'
  const myBuffs = me?.activeBuffs || []
  const deafMode = myBuffs.some((b) => b.active && (
    b.effectType === 'score_mult_hint_only' || b.effectType === 'mud_fight'
  ))
  const audioTrick = !inDuel ? (me?.audioTrick ?? null) : null
  const trickReplace = audioTrick?.mode === 'replace'
  const trickUrl = (audioTrick?.youtubeUrl || '').trim()
    || (trickReplace && audioTrick?.source === 'mud' ? MUD_FIGHT_BGM_FALLBACK : '')
  const trickStartSec = audioTrick?.startSec ?? 0
  const songPowerOff = !!(me?.songMuteUntil && now < me.songMuteUntil)
  const baseVol = songPowerOff ? 0 : musicVolume
  const inCountdown = room.status === 'countdown'
  const audibleRound = room.status === 'playing' || room.status === 'duel'
  const songPlaybackRate = (!inDuel && me?.playbackRate && me.playbackRate > 0 && me.playbackRate !== 1)
    ? me.playbackRate
    : 1

  // ── 증강 선택 화면: 같은 플레이어로 선택 BGM ─────────────────
  if (room.status === 'augment') {
    return (
      <HiddenYouTube
        key="yt-room-persistent"
        url={AUGMENT_SELECT_BGM_URL}
        startSec={0}
        volume={baseVol}
        durationSec={20}
        paused={false}
        playbackRate={1}
        playLabel="🎵 탭해서 증강 BGM 재생"
        cutMute={false}
        loop={false}
        playEpoch={`augment-${room.id || 'x'}`}
      />
    )
  }

  if (!session) return null

  // ── 진흙탕/세노/트루먼 등: 방곡 대신 트릭 URL ────────────────
  if (trickReplace && trickUrl && (audibleRound || inCountdown)) {
    const vol = audibleRound ? baseVol : 0
    return (
      <HiddenYouTube
        key="yt-room-persistent"
        url={trickUrl}
        startSec={trickStartSec}
        volume={vol}
        paused={false}
        playbackRate={1}
        playLabel="🎵 탭해서 증강 노래 재생"
        audioUnlockAt={null}
        cutMute={songPowerOff}
        roundEndsAt={audibleRound ? session.endsAt : null}
        roundDurationSec={session.duration}
        playEpoch={`trick-${audioTrick?.source}-${ytId(trickUrl)}-${session.index}-${room.status}`}
      />
    )
  }

  // ── 일반 방 정답곡 ───────────────────────────────────────────
  const roomPlayVolume = (deafMode && audioTrick?.source !== 'mud') ? 0 : baseVol
  const vol = audibleRound ? roomPlayVolume : 0

  return (
    <HiddenYouTube
      key="yt-room-persistent"
      url={session.url}
      startSec={session.startSec}
      volume={vol}
      paused={false}
      playbackRate={songPlaybackRate}
      audioUnlockAt={audibleRound && !inCountdown && me?.audioDelaySec ? (me.audioDelayUntil ?? null) : null}
      cutMute={songPowerOff}
      roundEndsAt={audibleRound ? session.endsAt : null}
      roundDurationSec={session.duration}
      playEpoch={`${session.index}-${room.status}-${audibleRound ? 'on' : 'off'}`}
    />
  )
}

/**
 * 불꽃남자 BGM: GameScreen 마운트와 분리.
 * 스킵·공개·증강 선택 화면으로 넘어가도 플레이어를 유지해 끊김/처음부터 재생을 막음.
 */
export function FlameKimOverlayBgm() {
  const { user, room, musicVolume } = useGame()
  const me = room?.members.find((m) => m.userId === user?.id)
  const [session, setSession] = useState<{ url: string; startSec: number } | null>(null)
  const [now, setNow] = useState(() => serverNow())

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!me || !room || room.status === 'lobby' || room.status === 'ended') {
      setSession(null)
      return
    }
    const stillHeld = !!(
      me.flameKimActive
      || me.flameKimPending
      || (me.flameKimRoundsLeft != null && me.flameKimRoundsLeft > 0)
    )
    if (!stillHeld) {
      setSession(null)
      return
    }
    // pending(다음 라운드 대기)에서는 아직 재생하지 않음
    if (!me.flameKimActive) return

    const fromTrick = me.audioTrick?.source === 'flame' ? me.audioTrick : null
    setSession((prev) => {
      if (prev) return prev
      return {
        url: fromTrick?.youtubeUrl || FLAME_KIM_FALLBACK_URL,
        startSec: fromTrick?.startSec ?? 10,
      }
    })
  }, [
    me,
    me?.flameKimActive,
    me?.flameKimPending,
    me?.flameKimRoundsLeft,
    me?.audioTrick,
    room,
    room?.status,
  ])

  if (!session || !room || room.status === 'lobby' || room.status === 'ended') return null

  const songPowerOff = !!(me?.songMuteUntil && now < me.songMuteUntil)
  const baseVol = songPowerOff ? 0 : musicVolume
  // 야차룰 중엔 볼륨만 끄고 플레이어는 유지 (돌아와도 이어 재생)
  const vol = room.status === 'duel'
    ? 0
    : Math.min(100, Math.round(baseVol * 2))

  return (
    <HiddenYouTube
      key="yt-trick-flame"
      url={session.url}
      startSec={session.startSec}
      volume={vol}
      paused={false}
      playbackRate={1}
      playLabel="🎵 탭해서 불꽃남자 재생"
      audioUnlockAt={null}
      cutMute={songPowerOff}
      loop
      roundEndsAt={null}
      roundDurationSec={null}
    />
  )
}
