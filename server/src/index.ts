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

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
})
registerSocket(io)

httpServer.listen(PORT, () => {
  console.log(`API+Socket listening on http://localhost:${PORT}`)
  if (fs.existsSync(publicRoot)) {
    console.log(`Web UI served from ${publicRoot}`)
  }
})
