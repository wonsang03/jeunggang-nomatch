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
  endSec: endSecProp,
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
  /** 문제은행 종료 초 — 있으면 이 지점에서 컷 */
  endSec?: number | null
  volume: number
  /** 있으면 start부터 이 초만큼만 재생 (endSec 없을 때) */
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
  /** 라운드 타이머 동기화용 종료 시각 (클립 endSec 과 별개) */
  roundEndsAt?: number | null
  /** 라운드 타이머 길이(초) — late join seek용. 클립 길이와 다름 */
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
  const start = Math.max(0, Math.floor(Number(startSec) || 0))
  const endFromProp = endSecProp != null && Number.isFinite(Number(endSecProp))
    ? Math.floor(Number(endSecProp))
    : null
  const end = endFromProp != null && endFromProp > start
    ? endFromProp
    : (durationSec && durationSec > 0 ? start + Math.floor(durationSec) : undefined)
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

  /** 문제은행 start~end + 라운드 경과(클립 길이로 모듈러 → 루프 동기화) */
  const clipSeekTarget = () => {
    const s = startRef.current
    const clipEnd = endRef.current
    const clipLen = clipEnd != null && clipEnd > s ? clipEnd - s : null
    const endsAt = endsAtRef.current
    const dur = roundDurRef.current
    let target = s
    if (endsAt && dur && dur > 0) {
      const roundStart = endsAt - dur * 1000
      const elapsedSec = Math.max(0, (serverNow() - roundStart) / 1000) * rateRef.current
      if (clipLen && clipLen > 0) {
        target = s + (elapsedSec % clipLen)
      } else {
        target = s + elapsedSec
      }
    }
    if (clipEnd != null) target = Math.min(target, Math.max(s, clipEnd - 0.25))
    return Math.max(s, target)
  }

  const ensureClipPosition = (p: YtPlayer, force = false) => {
    const s = startRef.current
    const hasRoundSync = !!(endsAtRef.current && roundDurRef.current && roundDurRef.current > 0)
    const hasClipEnd = endRef.current != null && endRef.current > s
    // 증강 선택 BGM 등: 라운드/클립 싱크가 없으면 "시작보다 앞"만 보정.
    // target=startSec 인 채로 재생 경과를 drift로 오판하면 ~3초마다 처음으로 되감김.
    if (!hasRoundSync && !hasClipEnd) {
      try {
        const cur = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : NaN
        if (force || !Number.isFinite(cur) || cur < s - 0.75) p.seekTo(s, true)
      } catch {
        try { p.seekTo(s, true) } catch { /* ignore */ }
      }
      return
    }
    const target = clipSeekTarget()
    try {
      const cur = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : NaN
      const tooEarly = !Number.isFinite(cur) || cur < s - 0.75
      // 핑 지터로 serverNow가 약간 흔들려도 잦은 seek 방지 (사람마다 들썩임)
      const drifted = Number.isFinite(cur) && Math.abs(cur - target) > 2.8
      if (force || tooEarly || drifted) p.seekTo(target, true)
    } catch {
      try { p.seekTo(target, true) } catch { /* ignore */ }
    }
  }

  const restartClipFromStart = (p: YtPlayer) => {
    if (pausedRef.current || audioLockedRef.current) return
    try {
      p.seekTo(startRef.current, true)
      applyRate(p, rateRef.current)
      const vol = cutMuteRef.current ? 0 : Math.max(0, Math.min(100, volumeRef.current))
      p.setVolume(vol)
      if (vol > 0) {
        p.unMute()
      } else {
        p.mute()
      }
      p.playVideo()
    } catch { /* ignore */ }
  }

  const scheduleClipLoop = (p: YtPlayer) => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    if (pausedRef.current) return
    const clipEnd = endRef.current
    const s0 = startRef.current
    const clipLen = clipEnd != null && clipEnd > s0
      ? clipEnd - s0
      : (durationSecRef.current && durationSecRef.current > 0 ? durationSecRef.current : null)
    // 클립 구간이 있으면 끝나면 start로 루프. loop 플래그만 있어도 전체 루프.
    if (!(clipLen && clipLen > 0) && !loopRef.current) return
    const len = clipLen && clipLen > 0 ? clipLen : 0
    if (len <= 0) return
    let cur = startRef.current
    try {
      if (typeof p.getCurrentTime === 'function') cur = p.getCurrentTime()
    } catch { /* ignore */ }
    const into = Math.max(0, cur - s0)
    const remain = Math.max(0.4, len - (into % len))
    stopTimerRef.current = setTimeout(() => {
      if (pausedRef.current || audioLockedRef.current) return
      restartClipFromStart(p)
      scheduleClipLoop(p)
    }, remain * 1000)
  }

  /** 항상 뮤트로 재생 시작(자동재생 허용) → volume>0이면 언뮤트 */
  const syncPlayback = (p: YtPlayer, opts?: { seek?: boolean; forceSeek?: boolean }) => {
    try {
      if (opts?.seek) ensureClipPosition(p, !!opts.forceSeek)
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

  /**
   * YouTube endSeconds 는 ENDED 이벤트로 라운드 전환과 충돌해
   * http(IP) 배포에서 곡이 번갈아 안 들리는 원인이 됨 → 클립 끝은 JS 타이머만 사용
   */
  const loadOpts = (videoId: string) => ({
    videoId,
    startSeconds: startRef.current,
  })

  const kickPlayback = (p: YtPlayer) => {
    clearMediaTimers()
    const unlockAt = unlockAtRef.current
    const waitMs = unlockAt != null ? Math.max(0, unlockAt - serverNow()) : 0
    const run = () => {
      syncPlayback(p, { seek: true, forceSeek: true })
      // 클립 끝 → 시작으로 루프 (라운드가 끝날 때까지)
      scheduleClipLoop(p)
      // 자동재생 재시도 + startSec 미적용 보정
      for (const ms of [200, 500, 1000, 1800, 2800]) {
        const t = setTimeout(() => {
          if (pausedRef.current || audioLockedRef.current) return
          try {
            const st = p.getPlayerState()
            // -1 unstarted, 0 ended, 2 paused, 5 cued
            if (st === 1 || st === 3) {
              ensureClipPosition(p)
              scheduleClipLoop(p)
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
            // ended면 클립 루프
            if (st === 0) {
              restartClipFromStart(p)
              scheduleClipLoop(p)
              setBlocked(false)
              return
            }
            syncPlayback(p, { seek: true, forceSeek: true })
            scheduleClipLoop(p)
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
            ensureClipPosition(p)
            scheduleClipLoop(p)
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

  const lastLoadKeyRef = useRef('')
  const lastKickAtRef = useRef(0)

  const switchVideo = (p: YtPlayer, videoId: string) => {
    setBlocked(false)
    try {
      p.loadVideoById(loadOpts(videoId))
    } catch {
      try {
        p.cueVideoById(loadOpts(videoId))
      } catch { /* ignore */ }
    }
    const t = setTimeout(() => {
      lastKickAtRef.current = Date.now()
      kickPlayback(p)
    }, 120)
    retryTimersRef.current.push(t)
  }

  // 플레이어는 마운트 시 1회만 생성 — 라운드마다 destroy 하지 않음
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
      const startAt = startRef.current
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
          start: startAt,
          // end 는 YouTube API에 넣지 않음 (JS 클립 루프만 — http에서 번갈아 재생 실패 방지)
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
            setReady(true)
          },
          onStateChange: (e) => {
            if (e.data === 0) {
              if (loopRef.current || endRef.current != null || (durationSecRef.current && durationSecRef.current > 0)) {
                restartClipFromStart(e.target)
                scheduleClipLoop(e.target)
              }
              return
            }
            if (e.data === 1) {
              setBlocked(false)
              if (!pausedRef.current && !audioLockedRef.current) {
                ensureClipPosition(e.target)
                scheduleClipLoop(e.target)
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
            if (
              (e.data === 5 || e.data === -1 || e.data === 2)
              && !pausedRef.current
              && !audioLockedRef.current
            ) {
              const t = setTimeout(() => {
                syncPlayback(e.target, { seek: e.data !== 2, forceSeek: true })
                scheduleClipLoop(e.target)
              }, 80)
              retryTimersRef.current.push(t)
            }
          },
          onError: (e) => {
            if (e.data === 101 || e.data === 150 || e.data === 153) {
              setBlocked(true)
              return
            }
            const curP = playerRef.current
            const cur = idRef.current
            if (curP && cur) {
              try {
                curP.cueVideoById(loadOpts(cur))
                const t = setTimeout(() => kickPlayback(curP), 200)
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
  // 단, 방금 load(switchVideo)로 이미 kick 했으면 스킵 → 이중 시작/브금 2번 방지
  useEffect(() => {
    if (!ready) return
    const p = playerRef.current
    if (!p || !id) return
    if (Date.now() - lastKickAtRef.current < 400) return
    const t = setTimeout(() => {
      lastKickAtRef.current = Date.now()
      kickPlayback(p)
    }, 80)
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
      // 볼륨만 바뀐 경우(카운트다운→플레이  unmute) 재로드/seek 없이 재생 유지
      if (vol <= 0) {
        p.mute()
      } else {
        p.unMute()
        p.setVolume(vol)
        const st = typeof p.getPlayerState === 'function' ? p.getPlayerState() : -1
        if (st !== 1 && st !== 3) p.playVideo()
      }
    } catch { /* ignore */ }
  }, [volume, ready, paused])

  // 탭 전환·버퍼 끊김·뮤트 잔존으로 "갑자기 안 들림" 복구
  useEffect(() => {
    if (!ready || !id) return
    const recover = (forceSeek = false) => {
      const p = playerRef.current
      if (!p || pausedRef.current || audioLockedRef.current) return
      try {
        const st = typeof p.getPlayerState === 'function' ? p.getPlayerState() : -1
        const wantVol = cutMuteRef.current ? 0 : Math.max(0, Math.min(100, volumeRef.current))
        // -1 unstarted, 0 ended, 2 paused, 5 cued
        if (st === -1 || st === 0 || st === 2 || st === 5) {
          syncPlayback(p, { seek: true, forceSeek: forceSeek || st === 0 || st === -1 })
          scheduleClipLoop(p)
          setBlocked(false)
          return
        }
        if (wantVol > 0) {
          p.unMute()
          p.setVolume(wantVol)
        } else {
          p.mute()
          p.setVolume(0)
        }
        if (st !== 1 && st !== 3) {
          p.playVideo()
        }
      } catch { /* ignore */ }
    }

    const onVis = () => {
      if (document.visibilityState === 'visible') recover(true)
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)

    const tick = setInterval(() => recover(false), 1500)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
      clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id])

  // blocked 오버레이가 떠 있어도 주기적으로 자동 재시도 (클릭 전 무음 완화)
  useEffect(() => {
    if (!ready || !blocked || !id) return
    const t = setInterval(() => {
      const p = playerRef.current
      if (!p || pausedRef.current || audioLockedRef.current) return
      try {
        kickPlayback(p)
      } catch { /* ignore */ }
    }, 2500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, ready, id])

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
  const { user, room, round, musicVolume, gahoCutscene } = useGame()
  const cutMuteSong = !!gahoCutscene
  const [now, setNow] = useState(() => serverNow())
  const [session, setSession] = useState<{
    url: string
    startSec: number
    endSec: number
    endsAt: number | null
    /** 라운드 타이머 길이(보통 40) — late join 싱크용 */
    roundDuration: number
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
      const start = Math.max(0, Math.floor(round.startSec ?? 0))
      const endRaw = Math.floor(round.endSec ?? 0)
      const end = endRaw > start ? endRaw : start + 40
      const roundDur = Math.max(10, Math.floor(round.duration || 40))
      setSession({
        url: round.youtubeUrl,
        startSec: start,
        endSec: end,
        endsAt: round.endsAt ?? null,
        roundDuration: roundDur,
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
  const trickEndSec = audioTrick?.endSec != null && audioTrick.endSec > trickStartSec
    ? audioTrick.endSec
    : null
  const songPowerOff = !!(me?.songMuteUntil && now < me.songMuteUntil)
  const baseVol = songPowerOff ? 0 : musicVolume
  const inCountdown = room.status === 'countdown'
  const audibleRound = room.status === 'playing' || room.status === 'duel'
  const songPlaybackRate = (!inDuel && me?.playbackRate && me.playbackRate > 0 && me.playbackRate !== 1)
    ? me.playbackRate
    : 1

  // ── 증강 선택 화면: 같은 플레이어로 선택 BGM ─────────────────
  // durationSec/루프 재시작 넣지 않음 → 20초 시점에 처음부터 다시 들려 "2번" 재생되는 문제 방지
  if (room.status === 'augment') {
    return (
      <HiddenYouTube
        key="yt-room-persistent"
        url={AUGMENT_SELECT_BGM_URL}
        startSec={0}
        volume={baseVol}
        paused={false}
        playbackRate={1}
        playLabel="🎵 탭해서 증강 BGM 재생"
        cutMute={cutMuteSong}
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
        endSec={trickEndSec}
        volume={vol}
        paused={false}
        playbackRate={1}
        playLabel="🎵 탭해서 증강 노래 재생"
        audioUnlockAt={null}
        cutMute={songPowerOff || cutMuteSong}
        roundEndsAt={audibleRound ? session.endsAt : null}
        roundDurationSec={session.roundDuration}
        playEpoch={`trick-${audioTrick?.source}-${ytId(trickUrl)}-${session.index}`}
      />
    )
  }

  // ── 일반 방 정답곡 ───────────────────────────────────────────
  // countdown 중에도 같은 곡을 미리 로드(볼륨 0). playEpoch는 index만 —
  // status 바뀔 때마다 kick/seek 하면 수 초 무음이 남.
  const roomPlayVolume = (deafMode && audioTrick?.source !== 'mud') ? 0 : baseVol
  const vol = audibleRound ? roomPlayVolume : 0

  return (
    <HiddenYouTube
      key="yt-room-persistent"
      url={session.url}
      startSec={session.startSec}
      endSec={session.endSec}
      volume={vol}
      paused={false}
      playbackRate={songPlaybackRate}
      audioUnlockAt={audibleRound && !inCountdown && me?.audioDelaySec ? (me.audioDelayUntil ?? null) : null}
      cutMute={songPowerOff || cutMuteSong}
      roundEndsAt={audibleRound ? session.endsAt : null}
      roundDurationSec={session.roundDuration}
      playEpoch={session.index}
    />
  )
}

/**
 * 불꽃남자 BGM: GameScreen 마운트와 분리.
 * 스킵·공개·증강 선택 화면으로 넘어가도 플레이어를 유지해 끊김/처음부터 재생을 막음.
 */
export function FlameKimOverlayBgm() {
  const { user, room, musicVolume, gahoCutscene } = useGame()
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
      cutMute={songPowerOff || !!gahoCutscene}
      loop
      roundEndsAt={null}
      roundDurationSec={null}
    />
  )
}
