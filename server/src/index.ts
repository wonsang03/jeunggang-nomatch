import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { corsOrigin, PORT } from './config.js'
import { authRouter } from './routes/auth.js'
import { questionRouter } from './routes/questions.js'
import { registerSocket } from './socket.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsRoot = path.resolve(__dirname, '../uploads')
const publicRoot = path.resolve(__dirname, '../public')

const app = express()
app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(express.json({ limit: '15mb' }))
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
  cors: { origin: corsOrigin, credentials: true },
  maxHttpBufferSize: 1e6,
})
registerSocket(io)

httpServer.listen(PORT, () => {
  console.log(`API+Socket listening on http://localhost:${PORT}`)
  if (fs.existsSync(publicRoot)) {
    console.log(`Web UI served from ${publicRoot}`)
  }
})
