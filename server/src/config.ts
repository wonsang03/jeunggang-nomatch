import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
export const PORT = Number(process.env.PORT || 4000)

const originRaw = process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:5175'
export const CLIENT_ORIGINS = originRaw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** cors / socket.io 용: * 이면 모든 origin 허용 */
export const corsOrigin: boolean | string[] = CLIENT_ORIGINS.includes('*')
  ? true
  : CLIENT_ORIGINS
