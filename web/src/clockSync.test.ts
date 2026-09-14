import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyClockSample,
  serverNow,
  getClockOffsetMs,
  getLastRttMs,
  getClockSampleCount,
  resetClockSync,
  noteClockGap,
  clockSyncStale,
} from './clockSync'

/**
 * 모듈 전역 상태를 쓰므로 매 테스트마다 초기화한다.
 * 헬퍼는 "서버가 클라보다 trueOffset 만큼 앞서 있고, 편도 지연이 oneWay" 인
 * 가상의 왕복 한 번을 만든다.
 */
function sample(opts: {
  t0: number
  trueOffset: number
  oneWayUp: number
  oneWayDown?: number
  serverBusy?: number
}) {
  const { t0, trueOffset, oneWayUp, serverBusy = 0 } = opts
  const oneWayDown = opts.oneWayDown ?? oneWayUp
  const t1 = t0 + oneWayUp + trueOffset
  const t2 = t1 + serverBusy
  const t3 = t2 - trueOffset + oneWayDown
  return { t0, t1, t2, t3 }
}

function feed(n: number, opts: Parameters<typeof sample>[0] & { stepMs?: number }) {
  const step = opts.stepMs ?? 1200
  let accepted = 0
  for (let i = 0; i < n; i += 1) {
    const s = sample({ ...opts, t0: opts.t0 + i * step })
    if (applyClockSample(s.t0, s.t1, s.t3, s.t2)) accepted += 1
  }
  return accepted
}

beforeEach(() => {
  resetClockSync()
})

describe('applyClockSample — 오프셋 추정', () => {
  it('대칭 지연이면 오프셋을 정확히 맞춘다', () => {
    const s = sample({ t0: 1_000_000, trueOffset: 5_000, oneWayUp: 30 })
    expect(applyClockSample(s.t0, s.t1, s.t3, s.t2)).toBe(true)
    expect(getClockOffsetMs()).toBe(5_000)
    expect(getLastRttMs()).toBe(60)
  })

  it('서버 처리시간을 네트워크 지연으로 세지 않는다', () => {
    // 왕복 60ms + 서버가 응답 만드는 데 300ms 쓴 경우
    const s = sample({ t0: 1_000_000, trueOffset: 0, oneWayUp: 30, serverBusy: 300 })
    applyClockSample(s.t0, s.t1, s.t3, s.t2)
    // RTT는 순수 네트워크 60ms 여야 한다 (360이 아니라)
    expect(getLastRttMs()).toBe(60)
    // 오프셋도 서버 지연에 밀리지 않아야 한다
    expect(getClockOffsetMs()).toBe(0)
  })

  it('구버전 서버(t2 없음)도 예전과 같은 결과를 낸다', () => {
    const s = sample({ t0: 1_000_000, trueOffset: 5_000, oneWayUp: 30 })
    // t2를 생략하면 t2 = t1 로 간주 = 기존 Cristian 식
    expect(applyClockSample(s.t0, s.t1, s.t3)).toBe(true)
    expect(getClockOffsetMs()).toBe(5_000)
  })

  it('serverNow가 보정된 시각을 준다', () => {
    const s = sample({ t0: Date.now(), trueOffset: 3_000, oneWayUp: 20 })
    applyClockSample(s.t0, s.t1, s.t3, s.t2)
    expect(Math.abs(serverNow() - (Date.now() + 3_000))).toBeLessThan(50)
  })
})

describe('지터 필터', () => {
  it('스파이크 샘플은 오프셋에 반영하지 않는다', () => {
    feed(4, { t0: 1_000_000, trueOffset: 1_000, oneWayUp: 20 })
    const before = getClockOffsetMs()
    const samplesBefore = getClockSampleCount()

    // 갑자기 2초 왕복 + 시계가 틀어진 것처럼 보이는 샘플
    const spike = sample({ t0: 1_010_000, trueOffset: 9_999, oneWayUp: 1_000 })
    expect(applyClockSample(spike.t0, spike.t1, spike.t3, spike.t2)).toBe(false)

    expect(getClockOffsetMs()).toBe(before)
    expect(getClockSampleCount()).toBe(samplesBefore)
    // 표시용 핑은 그래도 갱신된다
    expect(getLastRttMs()).toBe(2_000)
  })

  it('회선이 원래 느린 사람도 동기화된다 (예전 절대상한 버그)', () => {
    // 편도 250ms = 왕복 500ms 로 안정적인 해외/모바일 회선.
    // 예전 코드의 absoluteCap = max(450, best*1.5) 는 best가 300을 넘는 순간
    // rttLimit(best*1.8)보다 빡세져서 정상 샘플을 잘라냈다.
    const accepted = feed(6, { t0: 1_000_000, trueOffset: 4_000, oneWayUp: 250 })
    expect(accepted).toBe(6)
    expect(getClockOffsetMs()).toBeGreaterThan(300)
  })

  it('한 번의 운 좋은 저지연 샘플이 이후 샘플을 영구히 막지 않는다', () => {
    // 평소 400ms 왕복인 회선에 120ms 짜리 한 방이 섞인 경우
    feed(3, { t0: 1_000_000, trueOffset: 1_000, oneWayUp: 200 })
    const lucky = sample({ t0: 1_005_000, trueOffset: 1_000, oneWayUp: 60 })
    applyClockSample(lucky.t0, lucky.t1, lucky.t3, lucky.t2)
    // 이후 정상 샘플들이 결국 다시 받아들여져야 한다
    const accepted = feed(30, { t0: 1_010_000, trueOffset: 1_000, oneWayUp: 200 })
    expect(accepted).toBeGreaterThan(0)
  })

  it('말도 안 되는 RTT는 언제나 버린다', () => {
    feed(4, { t0: 1_000_000, trueOffset: 0, oneWayUp: 900 })
    const insane = sample({ t0: 1_010_000, trueOffset: 0, oneWayUp: 2_000 })
    expect(applyClockSample(insane.t0, insane.t1, insane.t3, insane.t2)).toBe(false)
  })
})

describe('끊김 복구', () => {
  it('오래 끊겼다 돌아오면 새 오프셋을 즉시 따라간다', () => {
    feed(6, { t0: 1_000_000, trueOffset: 0, oneWayUp: 20 })
    expect(Math.abs(getClockOffsetMs())).toBeLessThan(50)

    // 30초 자리를 비운 사이 기기 시계가 8초 밀렸다
    const after = sample({ t0: 1_040_000, trueOffset: 8_000, oneWayUp: 20 })
    applyClockSample(after.t0, after.t1, after.t3, after.t2)

    // 감쇠(48ms/샘플)에 묶이지 않고 한 번에 따라잡아야 한다
    expect(getClockOffsetMs()).toBe(8_000)
  })

  it('noteClockGap은 보정값은 유지하고 통계만 비운다', () => {
    feed(6, { t0: 1_000_000, trueOffset: 5_000, oneWayUp: 20 })
    const kept = getClockOffsetMs()
    expect(kept).toBeGreaterThan(4_000)

    noteClockGap()
    // 재동기화 중에도 기존 보정은 계속 적용된다
    expect(getClockOffsetMs()).toBe(kept)
    expect(getClockSampleCount()).toBe(0)

    // 다음 샘플이 곧바로 새 값으로 점프
    const s = sample({ t0: 2_000_000, trueOffset: 7_000, oneWayUp: 20 })
    applyClockSample(s.t0, s.t1, s.t3, s.t2)
    expect(getClockOffsetMs()).toBe(7_000)
  })

  it('resetClockSync는 전부 되돌린다', () => {
    feed(6, { t0: 1_000_000, trueOffset: 5_000, oneWayUp: 20 })
    resetClockSync()
    expect(getClockOffsetMs()).toBe(0)
    expect(getClockSampleCount()).toBe(0)
    expect(getLastRttMs()).toBeNull()
  })

  it('clockSyncStale은 표본이 없거나 오래되면 true', () => {
    expect(clockSyncStale()).toBe(true)
    const s = sample({ t0: Date.now(), trueOffset: 0, oneWayUp: 20 })
    applyClockSample(s.t0, s.t1, s.t3, s.t2)
    expect(clockSyncStale()).toBe(false)

    // 20초 전 표본만 있으면 오래된 것으로 본다
    const old = sample({ t0: Date.now() - 20_000, trueOffset: 0, oneWayUp: 20 })
    applyClockSample(old.t0, old.t1, old.t3, old.t2)
    expect(clockSyncStale()).toBe(true)
  })
})
