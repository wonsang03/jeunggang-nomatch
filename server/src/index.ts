import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { CLIENT_ORIGINS, PORT } from './config.js'
import { authRouter } from './routes/auth.js'
import { questionRouter } from './routes/questions.js'
import { registerSocket } from './socket.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsRoot = path.resolve(__dirname, '../uploads')

const app = express()
app.use(cors({ origin: CLIENT_ORIGINS, credentials: true }))
app.use(express.json({ limit: '15mb' }))
app.use('/uploads', express.static(uploadsRoot))

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api/questions', questionRouter)

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGINS, credentials: true },
})
registerSocket(io)

httpServer.listen(PORT, () => {
  console.log(`API+Socket listening on http://localhost:${PORT}`)
})
