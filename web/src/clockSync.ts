/**
 * 서버 시각 오프셋 추정 (Cristian's algorithm + 지터 필터).
 * round endsAt / YouTube seek가 클라 Date.now() 대신 이 시각을 쓰도록 함.
 *
 * 핑이 왔다 갔다 해도 오프셋이 같이 뛰면 사람마다 노래가 어긋남 →
 * RTT 나쁜 샘플은 표시용 핑만 갱신하고, 오프셋은 “좋은 샘플”만 반영.
 */

let offsetMs = 0
let sampleCount = 0
let lastRttMs: number | null = null
let lastSampleAt = 0
/** 관측한 최저 RTT (최근) — 이보다 훨씬 느린 샘플은 오프셋에 안 씀 */
let bestRttMs: number | null = null
/** 최근 좋은 오프셋 샘플 (중앙값용) */
const goodOffsets: number[] = []
const GOOD_CAP = 9

function median(nums: number[]): number {
  if (!nums.length) return 0
  const a = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2
}

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
 * @returns 갱신에 쓰였으면 true (표시용 핑은 항상 lastRtt 갱신)
 */
export function applyClockSample(t0: number, tServer: number, t1: number): boolean {
  const rtt = Math.max(0, t1 - t0)
  lastRttMs = rtt
  lastSampleAt = t1

  // 한쪽 지연 ≈ RTT/2 (대칭 가정)
  const sampleOffset = tServer + rtt / 2 - t1

  if (bestRttMs == null || rtt < bestRttMs) {
    bestRttMs = rtt
  } else {
    // 최저 RTT는 천천히 올라가게 (네트워크가 좋아진 뒤에도 옛 값에 묶이지 않게)
    bestRttMs = bestRttMs * 0.98 + rtt * 0.02
  }

  // 지터/스파이크: 최근 best 대비 너무 느리면 오프셋 무시 (핑 UI만 갱신)
  const rttLimit = Math.max(120, (bestRttMs ?? rtt) * 1.8)
  if (rtt > rttLimit || rtt > 450) {
    return false
  }

  goodOffsets.push(sampleOffset)
  while (goodOffsets.length > GOOD_CAP) goodOffsets.shift()

  const target = median(goodOffsets)
  // 한 번에 많이 안 움직임 (사람마다 다르게 튀는 것 방지)
  // 재생 중에도 샘플은 모으되, 한 번에 크게 안 움직임(다음 곡에서만 체감)
  const maxStep = sampleCount < 3 ? 160 : 48
  const delta = target - offsetMs
  if (sampleCount === 0) {
    offsetMs = target
  } else {
    const step = Math.sign(delta) * Math.min(Math.abs(delta), maxStep)
    offsetMs += step + (delta - step) * 0.12
  }
  sampleCount += 1
  return true
}

export function resetClockSync() {
  offsetMs = 0
  sampleCount = 0
  lastRttMs = null
  lastSampleAt = 0
  bestRttMs = null
  goodOffsets.length = 0
}

export function clockSyncStale(maxAgeMs = 12_000): boolean {
  return !lastSampleAt || Date.now() - lastSampleAt > maxAgeMs
}
