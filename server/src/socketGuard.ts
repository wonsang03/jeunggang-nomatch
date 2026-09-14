import type { Socket } from 'socket.io'
import type { ZodType } from 'zod'

/**
 * 소켓 핸들러 공통 방어막.
 *
 * 1) 스키마 검증 — 실패하면 핸들러를 호출하지 않는다.
 * 2) 레이트리밋 — 계정+이벤트별 토큰 버킷. 초과분은 조용히 버린다.
 *    (예전에는 연결마다 새 버킷이었다. 소켓을 N개 열면 허용량이 N배가 돼서
 *     사실상 제한이 없었다. 지금은 계정 단위라 탭을 여러 개 열어도 합산된다.)
 * 3) 예외 격리 — sync·async 어느 쪽에서 터져도 프로세스를 죽이지 않고
 *    해당 호출만 실패시킨다. (index.ts의 uncaughtException 훅은 exit(1)을 하므로
 *    핸들러 예외가 그대로 올라가면 방 하나의 버그가 서버 전체를 내린다.)
 *
 * cb가 있으면 실패 사유를 돌려주고, 없으면 서버 로그에만 남긴다.
 */

export type RateRule = {
  /** 버킷 최대 토큰 수 = 순간 허용 횟수 */
  burst: number
  /** 토큰 1개가 다시 차는 데 걸리는 ms */
  refillMs: number
}

/** 자주 쓰는 프리셋 */
export const RATE = {
  /** 채팅·정답처럼 사람이 연타할 수 있는 것 */
  chat: { burst: 12, refillMs: 400 } as RateRule,
  /** 버튼 클릭류 */
  action: { burst: 8, refillMs: 500 } as RateRule,
  /** 방 생성·게임 시작처럼 무거운 것 */
  heavy: { burst: 3, refillMs: 3000 } as RateRule,
  /** 목록 조회·핑 */
  poll: { burst: 20, refillMs: 250 } as RateRule,
} as const

type Bucket = { tokens: number; last: number }

/**
 * 프로세스 전역 버킷. 키는 `${who}:${event}` — 즉 계정 단위로 센다.
 * 연결 단위로 두면 소켓만 더 열어서 얼마든 우회할 수 있었다.
 */
const buckets = new Map<string, Bucket>()

/**
 * 허용되면 true. 초과면 false.
 * 소켓 밖(HTTP 라우트)에서도 같은 구현을 쓰도록 내보낸다.
 */
export function takeToken(key: string, rule: RateRule, now = Date.now()): boolean {
  let b = buckets.get(key)
  if (!b) {
    b = { tokens: rule.burst, last: now }
    buckets.set(key, b)
  }
  const gained = Math.floor((now - b.last) / rule.refillMs)
  if (gained > 0) {
    b.tokens = Math.min(rule.burst, b.tokens + gained)
    b.last = now
  }
  if (b.tokens <= 0) return false
  b.tokens -= 1
  return true
}

/**
 * 전역 Map 이라 접속한 계정 수만큼 쌓인다. 오래 안 건드린 버킷은 버린다.
 * (버킷이 사라져도 다음 요청에서 가득 찬 상태로 다시 생기므로 안전하다.)
 */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000
const BUCKET_IDLE_MS = 30 * 60 * 1000
setInterval(() => {
  const cutoff = Date.now() - BUCKET_IDLE_MS
  for (const [key, b] of buckets) {
    if (b.last < cutoff) buckets.delete(key)
  }
  // 테스트·종료를 붙잡지 않도록
}, SWEEP_INTERVAL_MS).unref()

export type Cb = ((res: unknown) => void) | undefined

export type GuardedHandler<T> = (payload: T, cb: Cb) => void | Promise<void>

/**
 * 한 소켓 연결에 묶인 `on` 등록기를 만든다.
 * `who`는 레이트리밋 버킷의 주인이자 로그 식별자다 — 유저 id 를 넘긴다.
 * 같은 `who` 는 연결이 몇 개든 같은 버킷을 나눠 쓴다.
 */
export function createSocketGuard(socket: Socket, who: string) {
  function on<T>(
    event: string,
    schema: ZodType<T>,
    rule: RateRule,
    handler: GuardedHandler<T>,
  ) {
    socket.on(event, (rawPayload: unknown, rawCb?: unknown) => {
      const cb: Cb = typeof rawCb === 'function' ? (rawCb as (res: unknown) => void) : undefined

      if (!takeToken(`${who}:${event}`, rule)) {
        cb?.({ ok: false, error: '너무 빠릅니다. 잠시 후 다시 시도해 주세요' })
        return
      }

      const parsed = schema.safeParse(rawPayload)
      if (!parsed.success) {
        // 클라이언트 버그와 공격을 구분할 수 없으므로 로그만 남기고 조용히 거절한다
        console.warn(`[socket:${event}] 잘못된 페이로드 (user=${who}):`, parsed.error.issues[0]?.message)
        cb?.({ ok: false, error: '잘못된 요청입니다' })
        return
      }

      try {
        const ret = handler(parsed.data, cb)
        if (ret && typeof (ret as Promise<void>).catch === 'function') {
          ;(ret as Promise<void>).catch((err) => {
            console.error(`[socket:${event}] 처리 실패 (user=${who})`, err)
            cb?.({ ok: false, error: '처리 중 오류가 발생했습니다' })
          })
        }
      } catch (err) {
        console.error(`[socket:${event}] 처리 실패 (user=${who})`, err)
        cb?.({ ok: false, error: '처리 중 오류가 발생했습니다' })
      }
    })
  }

  return { on }
}
