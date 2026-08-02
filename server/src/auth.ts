import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import { JWT_SECRET } from './config.js'

export type AuthUser = {
  id: string
  username: string
  nickname: string
  avatarUrl?: string | null
  isAdmin: boolean
  musicVolume?: number
  sfxVolume?: number
}

export function signToken(user: AuthUser) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      isAdmin: user.isAdmin,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다' })
  }
  try {
    const user = verifyToken(header.slice(7))
    ;(req as Request & { user: AuthUser }).user = user
    next()
  } catch {
    return res.status(401).json({ error: '토큰이 유효하지 않습니다' })
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: AuthUser }).user
  if (!user?.isAdmin) return res.status(403).json({ error: '관리자만 가능합니다' })
  next()
}
