import type { Socket } from 'socket.io'
import type { ZodType } from 'zod'

/**
 * 소켓 핸들러 공통 방어막.
 *
 * 1) 스키마 검증 — 실패하면 핸들러를 호출하지 않는다.
 * 2) 레이트리밋 — 이벤트별 토큰 버킷. 초과분은 조용히 버린다.
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

class RateLimiter {
  private buckets = new Map<string, Bucket>()

  /** 허용되면 true. 초과면 false */
  take(key: string, rule: RateRule, now = Date.now()): boolean {
    let b = this.buckets.get(key)
    if (!b) {
      b = { tokens: rule.burst, last: now }
      this.buckets.set(key, b)
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
}

export type Cb = ((res: unknown) => void) | undefined

export type GuardedHandler<T> = (payload: T, cb: Cb) => void | Promise<void>

/**
 * 한 소켓 연결에 묶인 `on` 등록기를 만든다.
 * `who`는 로그용 식별자(유저 id 등).
 */
export function createSocketGuard(socket: Socket, who: string) {
  const limiter = new RateLimiter()

  function on<T>(
    event: string,
    schema: ZodType<T>,
    rule: RateRule,
    handler: GuardedHandler<T>,
  ) {
    socket.on(event, (rawPayload: unknown, rawCb?: unknown) => {
      const cb: Cb = typeof rawCb === 'function' ? (rawCb as (res: unknown) => void) : undefined

      if (!limiter.take(event, rule)) {
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
