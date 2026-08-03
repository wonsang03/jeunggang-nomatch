/**
 * 서버 시각 오프셋 추정 (Cristian's algorithm).
 * round endsAt / YouTube seek가 클라 Date.now() 대신 이 시각을 쓰도록 함.
 */

let offsetMs = 0
let sampleCount = 0
let lastRttMs: number | null = null
let lastSampleAt = 0

/** 추정 서버 시각 (ms) */
export function serverNow(): number {
  return Date.now() + offsetMs
}

export function getClockOffsetMs(): number {
  return offsetMs
}

export function getLastRttMs(): number | null {
  return lastRttMs
}

export function getClockSampleCount(): number {
  return sampleCount
}

/**
 * ping:rtt 응답으로 오프셋 갱신.
 * t0: 송신 시각, tServer: 서버 Date.now(), t1: 수신 시각
 */
export function applyClockSample(t0: number, tServer: number, t1: number): number {
  const rtt = Math.max(0, t1 - t0)
  lastRttMs = rtt
  lastSampleAt = t1
  // 한쪽 지연 ≈ RTT/2 → 수신 시점의 서버 시각 ≈ tServer + rtt/2
  const sampleOffset = tServer + rtt / 2 - t1

  // RTT가 큰 샘플은 가중 낮게 (지터·스파이크 완화)
  const quality = rtt <= 80 ? 1 : rtt <= 160 ? 0.7 : rtt <= 300 ? 0.4 : 0.2
  const baseAlpha = sampleCount < 4 ? 0.55 : 0.22
  const alpha = Math.min(0.7, baseAlpha * quality)

  offsetMs = sampleCount === 0
    ? sampleOffset
    : offsetMs + alpha * (sampleOffset - offsetMs)
  sampleCount += 1
  return offsetMs
}

export function resetClockSync() {
  offsetMs = 0
  sampleCount = 0
  lastRttMs = null
  lastSampleAt = 0
}

export function clockSyncStale(maxAgeMs = 12_000): boolean {
  return !lastSampleAt || Date.now() - lastSampleAt > maxAgeMs
}
