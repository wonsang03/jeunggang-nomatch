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
          playerVars?: Record<string, number | string>
          events?: {
            onReady?: (e: { target: YtPlayer }) => void
            onStateChange?: (e: { data: number; target: YtPlayer }) => void
            onError?: (e: { data: number }) => void
          }
        },
      ) => YtPlayer
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
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
  const audioLockedRef = useRef(!!(audioUnlockAt && audioUnlockAt > serverNow()))
  const [blocked, setBlocked] = useState(false)
  const [ready, setReady] = useState(false)
  const start = Math.max(0, Math.floor(startSec))
  const end = durationSec && durationSec > 0 ? start + Math.floor(durationSec) : undefined

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
    if (!endsAt || !dur || dur <= 0) return
    const roundStart = endsAt - dur * 1000
    const elapsedSec = Math.max(0, (serverNow() - roundStart) / 1000)
    const pos = start + elapsedSec * rateRef.current
    try {
      p.seekTo(pos, true)
    } catch { /* ignore */ }
  }

  /** 항상 뮤트로 재생 시작(자동재생 허용) → volume>0이면 언뮤트 */
  const syncPlayback = (p: YtPlayer, opts?: { seek?: boolean }) => {
    try {
      if (opts?.seek) {
        // 라운드 공용 endsAt이 있으면 경과 시간에 맞춰 맞춤 (클라 로딩 차이 보정)
        if (endsAtRef.current && roundDurRef.current && roundDurRef.current > 0) {
          seekToRoundProgress(p)
        } else {
          p.seekTo(start, true)
        }
      }
      applyRate(p, rateRef.current)
      if (pausedRef.current || audioLockedRef.current || cutMuteRef.current) {
        p.pauseVideo()
        p.mute()
        p.setVolume(0)
        return
      }
      const vol = Math.max(0, Math.min(100, volumeRef.current))
      p.setVolume(vol)
      // 먼저 뮤트 재생으로 확보한 뒤, 볼륨 있으면 언뮤트
      p.mute()
      p.playVideo()
      if (vol > 0) {
        p.unMute()
        p.setVolume(vol)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!id || !hostRef.current) return
    let cancelled = false
    let player: YtPlayer | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null
    let delayTimer: ReturnType<typeof setTimeout> | null = null
    let checkTimer: ReturnType<typeof setTimeout> | null = null

    ;(async () => {
      await loadYtApi()
      if (cancelled || !hostRef.current || !window.YT) return
      hostRef.current.innerHTML = ''
      const mount = document.createElement('div')
      hostRef.current.appendChild(mount)

      player = new window.YT.Player(mount, {
        videoId: id,
        width: 320,
        height: 180,
        playerVars: {
          autoplay: 1,
          mute: 1,
          start,
          ...(end != null ? { end } : {}),
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return
            playerRef.current = e.target
            const unlockAt = unlockAtRef.current
            const waitMs = unlockAt != null ? Math.max(0, unlockAt - serverNow()) : 0
            const kick = () => {
              if (cancelled) return
              syncPlayback(e.target, { seek: true })
              if (durationSec && durationSec > 0 && !pausedRef.current) {
                stopTimer = setTimeout(() => {
                  try { e.target.pauseVideo() } catch { /* ignore */ }
                }, durationSec * 1000)
              }
              checkTimer = setTimeout(() => {
                if (cancelled || pausedRef.current || audioLockedRef.current) return
                try {
                  const st = e.target.getPlayerState()
                  // 1=playing, 3=buffering
                  if (st !== 1 && st !== 3) setBlocked(true)
                  else if (volumeRef.current > 0) {
                    // 재생 중인데 소리만 막힌 경우 대비
                    e.target.unMute()
                    e.target.setVolume(volumeRef.current)
                  }
                } catch {
                  setBlocked(true)
                }
              }, 1000)
            }
            if (waitMs > 0) {
              audioLockedRef.current = true
              try {
                e.target.mute()
                e.target.pauseVideo()
                e.target.seekTo(start, true)
              } catch { /* ignore */ }
              delayTimer = setTimeout(() => {
                audioLockedRef.current = false
                kick()
              }, waitMs)
            } else {
              kick()
            }
            setReady(true)
          },
          onStateChange: (e) => {
            // 0 = ended
            if (e.data === 0 && loopRef.current) {
              try {
                e.target.seekTo(start, true)
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
              if (!pausedRef.current && !audioLockedRef.current && volumeRef.current > 0) {
                try {
                  e.target.unMute()
                  e.target.setVolume(volumeRef.current)
                } catch { /* ignore */ }
              }
              // 재생 중 추가 seek 없음 — 시작 시 한 번만 맞춤 (끊김 방지)
            }
          },
          onError: () => setBlocked(true),
        },
      })
      setTimeout(() => {
        const iframe = hostRef.current?.querySelector('iframe')
        if (iframe) {
          iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
          iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share')
        }
      }, 0)
    })()

    return () => {
      cancelled = true
      if (stopTimer) clearTimeout(stopTimer)
      if (delayTimer) clearTimeout(delayTimer)
      if (checkTimer) clearTimeout(checkTimer)
      try { player?.destroy() } catch { /* ignore */ }
      playerRef.current = null
      setReady(false)
    }
  }, [id, start, end, durationSec, audioUnlockAt])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    applyRate(p, playbackRate)
  }, [playbackRate, ready])

  // 재생 중 soft seek 제거 — 시계는 증강 선택 때 맞추고, 곡은 onReady 시 한 번만 위치 맞춤

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    syncPlayback(p)
  }, [paused, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    if (cutMute) {
      try {
        p.pauseVideo()
        p.mute()
        p.setVolume(0)
      } catch { /* ignore */ }
      return
    }
    // 끊김 해제: 루프 BGM(불꽃남자)은 seek 없이 이어서, 그 외는 라운드 경과에 맞춤
    try {
      if (!loopRef.current) seekToRoundProgress(p)
      applyRate(p, rateRef.current)
      if (pausedRef.current || audioLockedRef.current) {
        p.pauseVideo()
        p.mute()
        return
      }
      const vol = Math.max(0, Math.min(100, volumeRef.current))
      p.setVolume(vol)
      p.mute()
      p.playVideo()
      if (vol > 0) {
        p.unMute()
        p.setVolume(vol)
      }
    } catch { /* ignore */ }
  }, [cutMute, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready || paused || audioLockedRef.current || cutMuteRef.current) return
    try {
      const vol = Math.max(0, Math.min(100, volume))
      p.setVolume(vol)
      if (vol <= 0) p.mute()
      else {
        p.unMute()
        p.playVideo()
      }
    } catch { /* ignore */ }
  }, [volume, ready, paused])

  const forcePlay = () => {
    const p = playerRef.current
    if (!p) return
    audioLockedRef.current = false
    try {
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
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          bottom: 0,
          width: 320,
          height: 180,
          opacity: 0.001,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
        }}
      >
        <div ref={hostRef} />
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
      key={`yt-trick-flame-${ytId(session.url)}`}
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
