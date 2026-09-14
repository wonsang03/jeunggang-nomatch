import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { corsCredentials, corsOrigin, PORT, prisma } from './config.js'
import { authRouter } from './routes/auth.js'
import { questionRouter } from './routes/questions.js'
import { notifyShutdown, registerSocket } from './socket.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsRoot = path.resolve(__dirname, '../uploads')
const publicRoot = path.resolve(__dirname, '../public')

const app = express()

/**
 * 배포는 Nginx 뒤에 있다. 이걸 켜지 않으면 req.ip 가 항상 127.0.0.1 이라
 * IP 기준 레이트리밋이 "전원이 한 버킷" 이 되어 정상 사용자를 막아버린다.
 * 신뢰하는 홉은 Nginx 하나뿐이므로 1.
 */
app.set('trust proxy', 1)

app.use(cors({ origin: corsOrigin, credentials: corsCredentials }))

// 최소한의 보안 헤더. CSP는 유튜브 임베드를 깨뜨릴 수 있어 넣지 않는다.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

/**
 * 바디 상한을 경로별로 나눈다.
 *
 * 예전엔 전 라우트가 15mb였다. 즉 로그인조차 안 한 상대가 /api/auth/login 에
 * 15mb JSON을 밀어넣어 파싱을 강제할 수 있었다. 큰 바디가 실제로 필요한 곳만
 * 크게 열어두고 나머지는 좁힌다. (body-parser는 이미 파싱된 요청을 건너뛰므로
 * 앞의 좁은 mount가 먼저 잡고, 나머지는 마지막 기본값으로 떨어진다.)
 */
app.use('/api/auth/avatar', express.json({ limit: '3mb' }))   // 1.5MB 이미지의 base64
app.use('/api/questions', express.json({ limit: '15mb' }))    // 관리자 대량 등록(최대 2000곡)
app.use(express.json({ limit: '200kb' }))

app.use('/uploads', express.static(uploadsRoot))

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api/questions', questionRouter)

if (fs.existsSync(publicRoot)) {
  app.use(express.static(publicRoot))
  app.get(/^(?!\/api\/|\/uploads\/|\/socket\.io\/|\/health$).*/, (_req, res) => {
    res.sendFile(path.join(publicRoot, 'index.html'))
  })
}

// 소켓 핸들러 하나가 실패해도 게임 서버 전체가 죽지 않게 한다
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
// uncaughtException은 삼키면 안 된다. 스택이 중간에 끊긴 프로세스를 계속 굴리면
// 채점 도중 터진 방이 "점수만 깎이고 정답 처리는 안 된" 상태로 계속 서빙된다.
// pm2가 재시작해주므로 로그만 남기고 죽는 편이 안전하다.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] 프로세스를 종료합니다', err)
  process.exit(1)
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: corsOrigin, credentials: corsCredentials },
  maxHttpBufferSize: 1e6,
})
registerSocket(io)

/**
 * 재배포·pm2 restart 때 조용히 죽지 않도록 정리 후 내려간다.
 * 방 상태는 메모리에만 있어 어차피 사라지지만, 진행 중인 사람들에게 이유는 알린다.
 */
let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] ${signal} 수신 — 정리 후 종료합니다`)
  try {
    notifyShutdown(io)
  } catch (err) {
    console.error('[shutdown] 알림 실패', err)
  }
  // 알림이 실제로 나갈 시간을 조금 준 뒤 닫는다
  setTimeout(() => {
    io.close(() => {
      httpServer.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0))
      })
    })
    // 커넥션이 안 닫혀도 영원히 매달리지 않게
    setTimeout(() => process.exit(0), 5000).unref()
  }, 300)
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => shutdown(sig))
}

httpServer.listen(PORT, () => {
  console.log(`API+Socket listening on http://localhost:${PORT}`)
  if (fs.existsSync(publicRoot)) {
    console.log(`Web UI served from ${publicRoot}`)
  }
})
