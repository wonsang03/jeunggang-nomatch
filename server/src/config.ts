import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
export const PORT = Number(process.env.PORT || 4000)
export const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
