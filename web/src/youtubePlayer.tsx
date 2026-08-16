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
  /** 플레이어가 메타데이터를 받기 전에는 없을 수 있다 */
  getDuration?: () => number
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
    let check: ReturnType<typeof setInterval> | null = null
    let giveUp: ReturnType<typeof setTimeout> | null = null
    const done = () => {
      if (check) { clearInterval(check); check = null }
      if (giveUp) { clearTimeout(giveUp); giveUp = null }
      resolve()
    }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      done()
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
    // 이미 로드된 경우
    check = setInterval(() => {
      if (window.YT?.Player) done()
    }, 50)
    // 스크립트가 차단되면 폴링이 영원히 돌지 않게 포기 (다음 호출에서 재시도)
    giveUp = setTimeout(() => {
      if (check) { clearInterval(check); check = null }
      giveUp = null
      ytApiPromise = null
      resolve()
    }, 15_000)
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
  /** YouTube 영상 전체 길이(초) — endSec 없을 때 루프용 */
  const videoDurationRef = useRef(0)
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
  /** 비강제 drift seek 쿨다운 — 잦은 seek로 순간 무음되는 것 방지 */
  const lastSeekAtRef = useRef(0)
  /** recover에서 연속으로 멈춘 상태일 때만 hard kick (seek 중 잠깐 paused 오판 방지) */
  const badStateStreakRef = useRef(0)

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

  const applyWantedVolume = (p: YtPlayer) => {
    const vol = cutMuteRef.current ? 0 : Math.max(0, Math.min(100, volumeRef.current))
    p.setVolume(vol)
    if (vol > 0) {
      p.unMute()
      p.setVolume(vol)
    } else {
      p.mute()
    }
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
  const resolveClipLen = () => {
    const s = startRef.current
    const clipEnd = endRef.current
    if (clipEnd != null && clipEnd > s) return clipEnd - s
    if (durationSecRef.current && durationSecRef.current > 0) return durationSecRef.current
    const vd = videoDurationRef.current
    if (vd > s + 0.5) return vd - s
    return null
  }

  const clipSeekTarget = () => {
    const s = startRef.current
    const clipEnd = endRef.current
    const clipLen = resolveClipLen()
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
    // 루프 가능한 클립이면 끝으로 클램프하지 않음 (배속 시 끝에서 멈추는 원인)
    if (clipEnd != null && !(clipLen && clipLen > 0)) {
      target = Math.min(target, Math.max(s, clipEnd - 0.25))
    }
    return Math.max(s, target)
  }

  const ensureClipPosition = (p: YtPlayer, force = false) => {
    const s = startRef.current
    const hasRoundSync = !!(endsAtRef.current && roundDurRef.current && roundDurRef.current > 0)
    const hasClipEnd = endRef.current != null && endRef.current > s
    // 증강 선택·진흙탕 등 앰비언트: 라운드/클립 싱크 없으면 "시작보다 앞"만 보정.
    // force(탭 복귀)여도 이미 재생 중이면 seek 금지 — 창 전환 시 처음부터 반복되는 원인.
    if (!hasRoundSync && !hasClipEnd) {
      try {
        const cur = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : NaN
        if (!Number.isFinite(cur) || cur < s - 0.75) p.seekTo(s, true)
      } catch {
        try { p.seekTo(s, true) } catch { /* ignore */ }
      }
      return
    }
    const target = clipSeekTarget()
    try {
      const cur = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : NaN
      const tooEarly = !Number.isFinite(cur) || cur < s - 0.75
      // 핑 지터로 serverNow가 흔들려도 잦은 seek 방지 (seek마다 순간 무음)
      const drifted = Number.isFinite(cur) && Math.abs(cur - target) > 4.2
      const seekCooldownOk = force || Date.now() - lastSeekAtRef.current > 4500
      if ((force || tooEarly || drifted) && (force || tooEarly || seekCooldownOk)) {
        // force여도 이미 target 근처면 스킵
        if (force && Number.isFinite(cur) && Math.abs(cur - target) <= 2.5 && cur >= s - 0.25) {
          return
        }
        p.seekTo(target, true)
        lastSeekAtRef.current = Date.now()
      }
    } catch {
      try {
        p.seekTo(target, true)
        lastSeekAtRef.current = Date.now()
      } catch { /* ignore */ }
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
    try {
      const vd = typeof p.getDuration === 'function' ? p.getDuration() : 0
      if (Number.isFinite(vd) && vd > 1) videoDurationRef.current = vd
    } catch { /* ignore */ }
    const s0 = startRef.current
    const clipLen = resolveClipLen()
    // 클립 구간이 있으면 끝나면 start로 루프. loop만 있는 앰비언트는 recover(ENDED)로 재시작.
    if (!(clipLen && clipLen > 0)) return
    const len = clipLen
    let cur = startRef.current
    try {
      if (typeof p.getCurrentTime === 'function') cur = p.getCurrentTime()
    } catch { /* ignore */ }
    const into = Math.max(0, cur - s0)
    const remainVideo = Math.max(0.35, len - (into % len))
    // 배속 반영: 2배면 절반 시간에 클립 끝 → 벽시계도 절반
    const rate = Math.max(0.05, rateRef.current || 1)
    const remainMs = (remainVideo / rate) * 1000
    stopTimerRef.current = setTimeout(() => {
      if (pausedRef.current || audioLockedRef.current) return
      restartClipFromStart(p)
      scheduleClipLoop(p)
    }, remainMs)
  }

  /**
   * 재생 동기화.
   * 미시작/일시정지 → mute 후 play → unmute (자동재생 허용).
   * 이미 playing/buffering이면 mute 토글 없이 볼륨만 맞춤 (순간 무음 방지).
   */
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
      let st = -1
      try {
        st = typeof p.getPlayerState === 'function' ? p.getPlayerState() : -1
      } catch { /* ignore */ }
      // 1 playing, 3 buffering — 이미 살아 있으면 mute→unmute 스킵
      if (st === 1 || st === 3) {
        applyWantedVolume(p)
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
    const ambientOnly = () => {
      const s = startRef.current
      const hasRoundSync = !!(endsAtRef.current && roundDurRef.current && roundDurRef.current > 0)
      const hasClipEnd = endRef.current != null && endRef.current > s
      return !hasRoundSync && !hasClipEnd
    }
    const run = () => {
      syncPlayback(p, { seek: true, forceSeek: true })
      // 클립 끝 → 시작으로 루프 (라운드가 끝날 때까지)
      scheduleClipLoop(p)
      // 자동재생 재시도 + startSec 미적용 보정
      // 앰비언트(증강BGM·진흙탕): 재시도마다 forceSeek 하면 처음부터 계속 들림
      for (const ms of [200, 500, 1000, 1800, 2800]) {
        const t = setTimeout(() => {
          if (pausedRef.current || audioLockedRef.current) return
          try {
            const st = p.getPlayerState()
            // -1 unstarted, 0 ended, 2 paused, 5 cued
            if (st === 1 || st === 3) {
              if (!ambientOnly()) ensureClipPosition(p)
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
            // ended면 클립/앰비언트 루프
            if (st === 0) {
              restartClipFromStart(p)
              scheduleClipLoop(p)
              setBlocked(false)
              return
            }
            if (ambientOnly()) {
              // 이미 시작 지점 이후면 seek 없이 play만
              let cur = NaN
              try { cur = p.getCurrentTime() } catch { /* ignore */ }
              if (Number.isFinite(cur) && cur >= startRef.current - 0.25) {
                syncPlayback(p, { seek: false })
              } else {
                syncPlayback(p, { seek: true, forceSeek: true })
              }
            } else {
              syncPlayback(p, { seek: true, forceSeek: true })
            }
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
              // 라운드 중·클립·앰비언트·배속: 끝나면 다시 처음부터 (배속 시 영상 끝에 멈추던 문제 방지)
              const shouldLoop = loopRef.current
                || endRef.current != null
                || (durationSecRef.current && durationSecRef.current > 0)
                || !!endsAtRef.current
                || Math.abs((rateRef.current || 1) - 1) > 0.05
              if (shouldLoop) {
                restartClipFromStart(e.target)
                scheduleClipLoop(e.target)
              }
              return
            }
            if (e.data === 1) {
              setBlocked(false)
              try {
                const vd = typeof e.target.getDuration === 'function' ? e.target.getDuration() : 0
                if (Number.isFinite(vd) && vd > 1) videoDurationRef.current = vd
              } catch { /* ignore */ }
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
    // 배속 바뀌면 클립 루프 타이머도 다시 맞춤
    if (!pausedRef.current && !audioLockedRef.current) {
      scheduleClipLoop(p)
    }
  }, [playbackRate, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    syncPlayback(p)
  }, [paused, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    // cutMute: pause/seek 하지 말고 볼륨만 (자동재생 토큰·재생 위치 유지)
    syncPlayback(p)
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
  // (너무 자주 sync/seek 하면 오히려 들쑥날쑥해져서 간격·쿨다운을 넉넉히)
  useEffect(() => {
    if (!ready || !id) return
    badStateStreakRef.current = 0
    const recover = (forceSeek = false) => {
      const p = playerRef.current
      if (!p || pausedRef.current || audioLockedRef.current) return
      try {
        const st = typeof p.getPlayerState === 'function' ? p.getPlayerState() : -1
        // playing / buffering: 볼륨만 맞추고 끝. seek 중 잠깐 paused로 떨어지는 건 streak로 거름.
        if (st === 1 || st === 3) {
          badStateStreakRef.current = 0
          applyWantedVolume(p)
          if (forceSeek) ensureClipPosition(p, true)
          return
        }
        // -1 unstarted, 0 ended, 2 paused, 5 cued
        if (st === -1 || st === 0 || st === 2 || st === 5) {
          badStateStreakRef.current += 1
          // 탭 복귀·ended·unstarted는 즉시. 그 외 paused/cued는 2연속일 때만 kick
          const hard =
            forceSeek
            || st === 0
            || st === -1
            || badStateStreakRef.current >= 2
          if (!hard) {
            applyWantedVolume(p)
            return
          }
          badStateStreakRef.current = 0
          syncPlayback(p, { seek: true, forceSeek: forceSeek || st === 0 || st === -1 })
          scheduleClipLoop(p)
          setBlocked(false)
          return
        }
        applyWantedVolume(p)
      } catch { /* ignore */ }
    }

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        // 창 전환(2창 플레이) 시 forceSeek 하면 앰비언트 BGM이 처음부터 반복됨
        recover(false)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)

    const tick = setInterval(() => recover(false), 2800)
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
      const next = {
        url: round.youtubeUrl,
        startSec: start,
        endSec: end,
        endsAt: round.endsAt ?? null,
        roundDuration: roundDur,
        index: round.index,
      }
      // room:state 가 올 때마다 같은 값으로 새 객체를 넣으면 플레이어가 계속 리렌더된다
      setSession((cur) => {
        if (
          cur
          && cur.url === next.url
          && cur.startSec === next.startSec
          && cur.endSec === next.endSec
          && cur.endsAt === next.endsAt
          && cur.roundDuration === next.roundDuration
          && cur.index === next.index
        ) return cur
        return next
      })
    }
  }, [
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
  const inCountdown = room.status === 'countdown'
  const readingPreSolveMute = room.reading?.phase === 'pre_solve'
  const audibleRound = room.status === 'playing' || room.status === 'duel'
  const stutterOff = (() => {
    const st = me?.audioStutter
    if (!st || !audibleRound || inCountdown || !session) return false
    const onMs = Math.max(50, st.onMs || 1000)
    const offMs = Math.max(50, st.offMs || 1000)
    const cycle = onMs + offMs
    if (!session.endsAt || !session.roundDuration) return false
    const started = session.endsAt - session.roundDuration * 1000
    const elapsed = Math.max(0, now - started)
    return (elapsed % cycle) >= onMs
  })()
  const baseVol = (songPowerOff || stutterOff || round?.readingMuted || readingPreSolveMute) ? 0 : musicVolume
  const songPlaybackRate = (!inDuel && me?.playbackRate && me.playbackRate > 0 && me.playbackRate !== 1)
    ? me.playbackRate
    : 1

  // ── 증강 선택 화면: 같은 플레이어로 선택 BGM ─────────────────
  // durationSec/루프 재시작·라운드 싱크 넣지 않음 → 처음부터 반복 되감기 방지
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
  // revealing에서도 트릭 분기 유지 — 빠지면 방곡으로 switchVideo 되어 순간 끊김/무음
  if (trickReplace && trickUrl && (audibleRound || inCountdown || room.status === 'revealing')) {
    const vol = audibleRound ? baseVol : 0
    const ambientBgm = audioTrick?.source === 'mud'
    return (
      <HiddenYouTube
        key="yt-room-persistent"
        url={trickUrl}
        startSec={trickStartSec}
        endSec={ambientBgm ? null : trickEndSec}
        volume={vol}
        paused={false}
        playbackRate={1}
        playLabel="🎵 탭해서 증강 노래 재생"
        audioUnlockAt={null}
        cutMute={songPowerOff || cutMuteSong}
        // 진흙탕·풍악: 라운드 경과 seek 하면 영상 길이 넘기며 ENDED→처음부터 반복됨
        roundEndsAt={ambientBgm ? null : (audibleRound ? session.endsAt : null)}
        roundDurationSec={ambientBgm ? null : session.roundDuration}
        loop={ambientBgm}
        playEpoch={`trick-${audioTrick?.source}-${ytId(trickUrl)}-${session.index}`}
      />
    )
  }

  // ── 일반 방 정답곡 ───────────────────────────────────────────
  // countdown 중에도 같은 곡을 미리 로드(볼륨 0). playEpoch는 index만 —
  // status 바뀔 때마다 kick/seek 하면 수 초 무음이 남.
  // 리딩방은 phase마다 endsAt이 바뀌므로 playEpoch에 넣어 풀이 시작 시 처음부터.
  const roomPlayVolume = (deafMode && audioTrick?.source !== 'mud') ? 0 : baseVol
  const vol = audibleRound ? roomPlayVolume : 0
  const playEpoch = round?.reading
    ? `${session.index}-${session.endsAt ?? 0}`
    : session.index

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
      playEpoch={playEpoch}
    />
  )
}

/**
 * 오버레이 BGM (불꽃남자·풍악): 방 정답곡과 동시 재생.
 * GameScreen 마운트와 분리해 스킵·공개·증강 화면에서도 유지.
 */
export function FlameKimOverlayBgm() {
  const { user, room, musicVolume, gahoCutscene } = useGame()
  const me = room?.members.find((m) => m.userId === user?.id)
  const [session, setSession] = useState<{ url: string; startSec: number; source: string } | null>(null)
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
    const trick = me.audioOverlay
    const overlayActive = !!(trick && trick.youtubeUrl)
    const flameHeld = !!(
      me.flameKimActive
      || me.flameKimPending
      || (me.flameKimRoundsLeft != null && me.flameKimRoundsLeft > 0)
    )
    if (!overlayActive && !flameHeld) {
      setSession(null)
      return
    }
    // 불꽃남자 pending(다음 라운드 대기)만 있고 다른 오버레이 없으면 아직 재생하지 않음
    if (!overlayActive) {
      if (me.flameKimPending && !me.flameKimActive) return
      if (!me.flameKimActive) {
        setSession(null)
        return
      }
    }

    const url = (overlayActive ? trick!.youtubeUrl : '') || FLAME_KIM_FALLBACK_URL
    const startSec = overlayActive ? (trick!.startSec ?? 0) : 10
    const source = overlayActive ? trick!.source : 'flame'
    setSession((prev) => {
      if (prev && prev.url === url && prev.source === source) return prev
      return { url, startSec, source }
    })
  }, [
    me,
    me?.flameKimActive,
    me?.flameKimPending,
    me?.flameKimRoundsLeft,
    me?.audioOverlay,
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
  const label = session.source === 'party' ? '풍악' : '불꽃남자'

  return (
    <HiddenYouTube
      key={`yt-trick-overlay-${session.source}`}
      url={session.url}
      startSec={session.startSec}
      volume={vol}
      paused={false}
      playbackRate={1}
      playLabel={`🎵 탭해서 ${label} 재생`}
      audioUnlockAt={null}
      cutMute={songPowerOff || !!gahoCutscene}
      loop
      roundEndsAt={null}
      roundDurationSec={null}
      playEpoch={`overlay-${session.source}-${ytId(session.url)}`}
    />
  )
}
