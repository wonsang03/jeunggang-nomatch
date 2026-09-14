import jwt from 'jsonwebtoken'
import { z } from 'zod'
import type { Request, Response, NextFunction } from 'express'
import { JWT_SECRET, prisma } from './config.js'

export type AuthUser = {
  id: string
  username: string
  nickname: string
  avatarUrl?: string | null
  isAdmin: boolean
  musicVolume?: number
  sfxVolume?: number
}

/**
 * 토큰 페이로드는 서명만 확인하고 `as AuthUser` 로 캐스팅해 쓰고 있었다.
 * 서명이 맞으면 우리가 발급한 게 맞긴 하지만, 캐스팅은 런타임에 아무것도
 * 보장하지 않는다. 특히 `id` 는 아바타 파일명(`${id}.png`)에 그대로 들어가서
 * 경로 문자가 섞이면 uploads 밖으로 새어나간다. 형태를 여기서 한 번 조인다.
 */
const tokenPayload = z.object({
  /** cuid/uuid 같은 식별자만. `.`·`/`·`\` 가 끼면 경로 조작이 된다 */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  username: z.string().min(1).max(64),
  nickname: z.string().min(1).max(64),
  isAdmin: z.boolean(),
})

/** 만료. 길수록 유출·권한회수 대응이 늦어진다 */
const TOKEN_TTL = '2d'

export function signToken(user: AuthUser) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      isAdmin: user.isAdmin,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL, algorithm: 'HS256' },
  )
}

export function verifyToken(token: string): AuthUser {
  // 알고리즘을 고정한다 (jsonwebtoken 9는 기본적으로 안전하지만 명시해 둔다)
  const raw = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
  const parsed = tokenPayload.safeParse(raw)
  if (!parsed.success) throw new Error('INVALID_TOKEN_PAYLOAD')
  return parsed.data
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

/**
 * 관리자 확인은 토큰의 isAdmin 클레임만 믿으면 안 된다.
 * 권한을 회수해도 이미 나간 토큰이 만료될 때까지 계속 관리자로 동작하기 때문이다.
 * 관리자 경로는 호출 빈도가 낮으니 DB를 한 번 더 본다.
 */
export async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: AuthUser }).user
  if (!user?.isAdmin) return res.status(403).json({ error: '관리자만 가능합니다' })
  try {
    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isAdmin: true },
    })
    if (!fresh?.isAdmin) return res.status(403).json({ error: '관리자만 가능합니다' })
  } catch (err) {
    console.error('[auth] 관리자 확인 실패', err)
    return res.status(500).json({ error: '권한 확인에 실패했습니다' })
  }
  next()
}
