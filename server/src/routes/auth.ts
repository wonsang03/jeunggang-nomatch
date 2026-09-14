import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../config.js'
import { authMiddleware, signToken, type AuthUser } from '../auth.js'
import { loadUserStats } from '../records.js'
import type { Request } from 'express'

export const authRouter = Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/avatars')

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

function toUserPayload(user: {
  id: string
  username: string
  nickname: string
  avatarUrl: string | null
  isAdmin: boolean
  musicVolume: number
  sfxVolume: number
}): AuthUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    musicVolume: user.musicVolume,
    sfxVolume: user.sfxVolume,
  }
}

const registerSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(4).max(72),
  nickname: z.string().min(1).max(24),
})

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const settingsSchema = z.object({
  musicVolume: z.number().int().min(0).max(100).optional(),
  sfxVolume: z.number().int().min(0).max(100).optional(),
})

const profileSchema = z.object({
  nickname: z.string().min(1).max(24).optional(),
})

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: '입력값을 확인해주세요' })

  const { username, password, nickname } = parsed.data
  const exists = await prisma.user.findUnique({ where: { username } })
  if (exists) return res.status(409).json({ error: '이미 존재하는 아이디입니다' })

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { username, passwordHash, nickname },
  })

  const payload = toUserPayload(user)
  return res.json({ token: signToken(payload), user: payload })
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: '입력값을 확인해주세요' })

  const user = await prisma.user.findUnique({ where: { username: parsed.data.username } })
  if (!user) return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸습니다' })

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸습니다' })

  const payload = toUserPayload(user)
  return res.json({ token: signToken(payload), user: payload })
})

authRouter.get('/me', authMiddleware, async (req, res) => {
  const auth = (req as Request & { user: AuthUser }).user
  const user = await prisma.user.findUnique({ where: { id: auth.id } })
  if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다' })
  return res.json({ user: toUserPayload(user) })
})

/** 내 전적 — 판수·승수·평균점수·최근 기록 */
authRouter.get('/me/stats', authMiddleware, async (req, res) => {
  const user = (req as Request & { user: AuthUser }).user
  try {
    res.json(await loadUserStats(user.id))
  } catch (err) {
    console.error('[auth] 전적 조회 실패', err)
    res.status(500).json({ error: '전적을 불러오지 못했습니다' })
  }
})

authRouter.patch('/settings', authMiddleware, async (req, res) => {
  const auth = (req as Request & { user: AuthUser }).user
  const parsed = settingsSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: '볼륨은 0~100 사이여야 합니다' })
  if (parsed.data.musicVolume == null && parsed.data.sfxVolume == null) {
    return res.status(400).json({ error: '변경할 설정이 없습니다' })
  }

  const user = await prisma.user.update({
    where: { id: auth.id },
    data: {
      ...(parsed.data.musicVolume != null ? { musicVolume: parsed.data.musicVolume } : {}),
      ...(parsed.data.sfxVolume != null ? { sfxVolume: parsed.data.sfxVolume } : {}),
    },
  })
  return res.json({ user: toUserPayload(user) })
})

authRouter.patch('/profile', authMiddleware, async (req, res) => {
  const auth = (req as Request & { user: AuthUser }).user
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: '닉네임을 확인해주세요 (1~24자)' })
  if (!parsed.data.nickname) return res.status(400).json({ error: '변경할 내용이 없습니다' })

  const nickname = parsed.data.nickname.trim()
  if (!nickname) return res.status(400).json({ error: '닉네임을 입력해주세요' })

  const user = await prisma.user.update({
    where: { id: auth.id },
    data: { nickname },
  })
  const payload = toUserPayload(user)
  // 닉네임 바뀌면 새 토큰 발급 (소켓 인증용)
  return res.json({ token: signToken(payload), user: payload })
})

authRouter.post('/avatar', authMiddleware, async (req, res) => {
  const auth = (req as Request & { user: AuthUser }).user
  const imageBase64 = req.body?.imageBase64 as string | undefined
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: '이미지 데이터가 필요합니다' })
  }

  const m = imageBase64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i)
  if (!m) return res.status(400).json({ error: 'PNG/JPEG/WebP 이미지만 가능합니다' })

  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase()
  const buf = Buffer.from(m[3], 'base64')
  if (buf.length > 1.5 * 1024 * 1024) {
    return res.status(400).json({ error: '이미지는 1.5MB 이하로 올려주세요' })
  }

  ensureUploadsDir()
  const filename = `${auth.id}.${ext}`
  const filepath = path.join(UPLOADS_DIR, filename)
  // 이전 확장자 파일 정리
  for (const oldExt of ['png', 'jpg', 'webp']) {
    const old = path.join(UPLOADS_DIR, `${auth.id}.${oldExt}`)
    if (old !== filepath && fs.existsSync(old)) fs.unlinkSync(old)
  }
  fs.writeFileSync(filepath, buf)

  const avatarUrl = `/uploads/avatars/${filename}?t=${Date.now()}`
  const user = await prisma.user.update({
    where: { id: auth.id },
    data: { avatarUrl },
  })
  return res.json({ user: toUserPayload(user) })
})

authRouter.delete('/avatar', authMiddleware, async (req, res) => {
  const auth = (req as Request & { user: AuthUser }).user
  ensureUploadsDir()
  for (const ext of ['png', 'jpg', 'webp']) {
    const p = path.join(UPLOADS_DIR, `${auth.id}.${ext}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  const user = await prisma.user.update({
    where: { id: auth.id },
    data: { avatarUrl: null },
  })
  return res.json({ user: toUserPayload(user) })
})
