/**
 * 서버 시각 오프셋 추정 (NTP식 4-타임스탬프 + 지터 필터).
 * round endsAt / YouTube seek가 클라 Date.now() 대신 이 시각을 쓰도록 함.
 *
 * 핑이 왔다 갔다 해도 오프셋이 같이 뛰면 사람마다 노래가 어긋남 →
 * RTT 나쁜 샘플은 표시용 핑만 갱신하고, 오프셋은 "좋은 샘플"만 반영.
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

/**
 * 표본이 이 시간 이상 끊기면(절전·백그라운드·재접속) 기존 오프셋을 믿을 수 없다.
 * 슬립에서 깨어난 기기는 시계가 통째로 밀려 있을 수 있는데, 평소 감쇠(48ms/샘플)로는
 * 1초 오차를 따라잡는 데 20샘플(=24초)이 걸린다. 그동안 노래가 어긋난 채로 플레이된다.
 */
const STALE_MS = 12_000

/** 한 샘플이 아무리 나빠도 이보다 크면 네트워크가 아니라 고장이다 */
const INSANE_RTT_MS = 3_000

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
 *
 * t0: 클라 송신, t1: 서버 수신, t2: 서버 송신, t3: 클라 수신
 * 서버가 t2를 안 보내던 구버전이면 t2 = t1 로 두며, 이때 식은 예전과 같아진다.
 *
 *   RTT    = (t3 - t0) - (t2 - t1)     ← 서버 처리시간을 뺀 순수 왕복 지연
 *   offset = ((t1 - t0) + (t2 - t3)) / 2
 *
 * 서버가 응답을 만드는 데 쓴 시간을 네트워크 지연으로 착각하지 않는 것이 핵심이다.
 * 서버가 바쁠수록(=DB 조회 중 등) 예전 식은 오프셋을 그만큼 뒤로 밀었다.
 *
 * @returns 오프셋 갱신에 쓰였으면 true (표시용 핑은 언제나 갱신)
 */
export function applyClockSample(t0: number, t1: number, t3: number, t2: number = t1): boolean {
  const roundTrip = Math.max(0, t3 - t0)
  const serverBusy = Math.max(0, t2 - t1)
  // 서버 처리시간이 왕복보다 길 수는 없다 (시계 이상 응답 방어)
  const rtt = Math.max(0, roundTrip - Math.min(serverBusy, roundTrip))
  lastRttMs = rtt

  const gapMs = lastSampleAt ? t3 - lastSampleAt : 0
  lastSampleAt = t3

  // 오래 끊겼다 돌아온 표본은 옛 통계와 섞으면 안 된다 (절전 복귀·재접속)
  if (sampleCount > 0 && gapMs > STALE_MS) {
    goodOffsets.length = 0
    bestRttMs = null
    // sampleCount를 0으로 되돌려 첫 샘플처럼 곧바로 따라잡게 한다
    sampleCount = 0
  }

  const sampleOffset = ((t1 - t0) + (t2 - t3)) / 2

  if (bestRttMs == null || rtt < bestRttMs) {
    bestRttMs = rtt
  } else {
    // 최저 RTT는 천천히 올라가게 (네트워크가 좋아진 뒤에도 옛 값에 묶이지 않게)
    // 주의: 이 갱신은 아래 게이트보다 **먼저** 와야 한다. 걸러진 샘플도 best를 밀어올려야
    // 한 번의 운 좋은 저지연 샘플이 이후 모든 정상 샘플을 영구히 막는 일이 없다.
    bestRttMs = bestRttMs * 0.98 + rtt * 0.02
  }

  // 지터/스파이크: 최근 best 대비 너무 느리면 오프셋 무시 (핑 UI만 갱신).
  // 기준이 상대값이므로 회선이 원래 느린 사람(모바일·해외)도 자기 기준으로 동기화된다.
  // 예전에는 여기에 max(450, best*1.5) 짜리 "절대 상한"이 하나 더 있었는데,
  // best가 300ms를 넘으면 그쪽이 rttLimit(best*1.8)보다 오히려 빡세져서
  // 느린 회선의 정상 샘플을 먼저 잘라냈다. 의도와 정반대라 걷어냈다.
  const rttLimit = Math.max(120, (bestRttMs ?? rtt) * 1.8)
  if (rtt > rttLimit || rtt > INSANE_RTT_MS) {
    return false
  }

  goodOffsets.push(sampleOffset)
  while (goodOffsets.length > GOOD_CAP) goodOffsets.shift()

  const target = median(goodOffsets)
  // 한 번에 크게 안 움직이게 감쇠 (사람마다 다르게 튀는 것 방지).
  // maxStep까지는 그대로 따라가고 초과분은 12%만 반영하므로, 실제 이동량은
  // maxStep보다 조금 더 크다 (delta 1초일 때 약 160ms).
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

/**
 * 오프셋 값은 유지하되 "다음 샘플을 즉시 반영"하도록 통계만 비운다.
 * 재접속·탭 복귀처럼 그동안 무슨 일이 있었는지 모르는 시점에 쓴다.
 * resetClockSync와 달리 offsetMs를 0으로 되돌리지 않으므로,
 * 재동기화되는 동안에도 (조금 틀릴지언정) 기존 보정이 계속 적용된다.
 */
export function noteClockGap() {
  if (!sampleCount) return
  goodOffsets.length = 0
  bestRttMs = null
  sampleCount = 0
  lastSampleAt = 0
}

export function clockSyncStale(maxAgeMs = STALE_MS): boolean {
  return !lastSampleAt || Date.now() - lastSampleAt > maxAgeMs
}
