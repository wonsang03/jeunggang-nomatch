import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client'
import jwt from 'jsonwebtoken'
import { createSocketGuard, RATE } from './socketGuard.js'
import { S } from './socketSchemas.js'

/**
 * 회귀 방지: 클라이언트가 보낸 아무 값이나 핸들러에 그대로 들어가던 시절에는
 * `{ code: 123 }` 한 번으로 `payload.code.toUpperCase()` 가 터졌고,
 * index.ts의 uncaughtException 훅이 프로세스를 내렸다. 즉 누구나 서버를 껐다.
 * 여기서는 가드가 (1) 쓰레기 페이로드를 막고 (2) 핸들러 예외를 격리하고
 * (3) 연타를 제한하는지 실제 소켓으로 확인한다.
 */

const SECRET = 'test-secret'

let httpServer: HttpServer
let ioServer: Server
let port: number
/** 가드를 통과해 실제로 핸들러가 실행된 횟수 */
let handledPayloads: unknown[] = []

function connect(): Promise<ClientSocket> {
  const token = jwt.sign({ id: 'u1', username: 'u1', nickname: '테스터', isAdmin: false }, SECRET)
  return new Promise((resolve, reject) => {
    const c = createClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    })
    c.on('connect', () => resolve(c))
    c.on('connect_error', reject)
  })
}

function emitAck(c: ClientSocket, event: string, payload: unknown, timeoutMs = 1500): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), timeoutMs)
    c.emit(event, payload, (res: unknown) => {
      clearTimeout(t)
      resolve(res)
    })
  })
}

beforeAll(async () => {
  httpServer = createServer()
  ioServer = new Server(httpServer, { cors: { origin: true } })

  ioServer.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) return next(new Error('UNAUTHORIZED'))
      socket.data.user = jwt.verify(token, SECRET)
      next()
    } catch {
      next(new Error('UNAUTHORIZED'))
    }
  })

  ioServer.on('connection', (socket) => {
    const user = socket.data.user as { id: string }
    const { on } = createSocketGuard(socket, user.id)

    // 실제 socket.ts의 room:join 과 같은 형태 — 검증이 없으면 code가 숫자일 때 터진다
    on('room:join', S.roomJoin, RATE.action, (payload, cb) => {
      handledPayloads.push(payload)
      const upper = payload.code ? payload.code.toUpperCase() : null
      cb?.({ ok: true, code: upper })
    })

    // 핸들러가 항상 터지는 경우 — 프로세스가 죽지 않아야 한다
    on('boom:sync', S.none, RATE.action, () => {
      throw new Error('sync boom')
    })
    on('boom:async', S.none, RATE.action, async () => {
      throw new Error('async boom')
    })

    on('fast', S.none, { burst: 3, refillMs: 60_000 }, (_p, cb) => {
      cb?.({ ok: true })
    })
  })

  await new Promise<void>((r) => httpServer.listen(0, r))
  port = (httpServer.address() as { port: number }).port
})

afterAll(async () => {
  ioServer.close()
  await new Promise<void>((r) => httpServer.close(() => r()))
})

describe('소켓 가드', () => {
  it('정상 페이로드는 그대로 통과한다', async () => {
    const c = await connect()
    handledPayloads = []
    const res = await emitAck(c, 'room:join', { code: 'ab12' })
    expect(res).toEqual({ ok: true, code: 'AB12' })
    expect(handledPayloads).toHaveLength(1)
    c.close()
  })

  it('타입이 틀린 페이로드는 핸들러에 닿지 않는다', async () => {
    const c = await connect()
    handledPayloads = []
    // 예전에는 이 한 줄이 서버를 내렸다
    const res = await emitAck(c, 'room:join', { code: 123 })
    expect(res).toEqual({ ok: false, error: '잘못된 요청입니다' })
    expect(handledPayloads).toHaveLength(0)
    c.close()
  })

  it('페이로드가 객체가 아니어도 죽지 않는다', async () => {
    const c = await connect()
    handledPayloads = []
    for (const bad of [null, 'string', 42, [], true]) {
      const res = await emitAck(c, 'room:join', bad)
      expect(res?.ok).toBe(false)
    }
    expect(handledPayloads).toHaveLength(0)
    c.close()
  })

  it('모르는 키는 버리고 아는 키만 넘긴다', async () => {
    const c = await connect()
    handledPayloads = []
    await emitAck(c, 'room:join', { code: 'ab12', __proto__: { evil: 1 }, extra: 'x'.repeat(5000) })
    expect(handledPayloads[0]).toEqual({ code: 'ab12' })
    c.close()
  })

  it('핸들러가 터져도 연결과 서버가 살아있다', async () => {
    const c = await connect()
    const sync = await emitAck(c, 'boom:sync', {})
    const async = await emitAck(c, 'boom:async', {})
    expect(sync).toEqual({ ok: false, error: '처리 중 오류가 발생했습니다' })
    expect(async).toEqual({ ok: false, error: '처리 중 오류가 발생했습니다' })

    // 터진 뒤에도 정상 요청이 처리되어야 한다
    const after = await emitAck(c, 'room:join', { code: 'zz99' })
    expect(after).toEqual({ ok: true, code: 'ZZ99' })
    c.close()
  })

  it('버스트를 넘기면 레이트리밋이 걸린다', async () => {
    const c = await connect()
    const results = []
    for (let i = 0; i < 5; i += 1) results.push(await emitAck(c, 'fast', {}))
    expect(results.slice(0, 3).every((r) => r.ok === true)).toBe(true)
    expect(results.slice(3).every((r) => r.ok === false)).toBe(true)
    c.close()
  })

  it('레이트리밋은 이벤트별·연결별로 따로 센다', async () => {
    const a = await connect()
    const b = await connect()
    for (let i = 0; i < 4; i += 1) await emitAck(a, 'fast', {})
    // a가 다 써도 b는 멀쩡해야 한다
    expect((await emitAck(b, 'fast', {})).ok).toBe(true)
    // 다른 이벤트도 멀쩡해야 한다
    expect((await emitAck(a, 'room:join', { code: 'q1' })).ok).toBe(true)
    a.close()
    b.close()
  })
})
