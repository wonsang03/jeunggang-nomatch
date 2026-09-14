import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

/**
 * JWT 서명 키.
 *
 * 예전에는 `process.env.JWT_SECRET || 'dev-secret'` 이었다. 배포에서 환경변수를
 * 빠뜨리면 리포에 그대로 적혀 있는 값으로 조용히 폴백했고, 그 순간 누구든
 * `{ isAdmin: true }` 토큰을 직접 서명해 관리자가 될 수 있었다.
 * 게다가 폴백은 로그에도 안 남아서 취약한 채로 떠 있는지 알 방법이 없었다.
 *
 * 조용히 취약해지느니 아예 못 뜨는 편이 낫다. 그래서 여기서 막고 죽는다.
 */
const PLACEHOLDER_SECRETS = new Set([
  'dev-secret', 'change-me', 'changeme', 'secret', 'test', 'password', 'jwt-secret',
])
const MIN_SECRET_LENGTH = 32

function readJwtSecret(): string {
  const raw = (process.env.JWT_SECRET || '').trim()
  const how = [
    'server/.env 에 JWT_SECRET 을 설정해야 서버가 뜹니다.',
    '새 값 생성:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    '※ 값을 바꾸면 기존 토큰이 전부 무효가 되어 접속자 전원 재로그인이 필요합니다.',
  ].join('\n  ')

  let why: string | null = null
  if (!raw) why = 'JWT_SECRET 이 설정되지 않았습니다'
  else if (PLACEHOLDER_SECRETS.has(raw.toLowerCase())) why = 'JWT_SECRET 이 예시/기본값 그대로입니다'
  else if (raw.length < MIN_SECRET_LENGTH) {
    why = `JWT_SECRET 이 너무 짧습니다 (${raw.length}자 · ${MIN_SECRET_LENGTH}자 이상 필요)`
  }

  if (why) {
    // 스택트레이스보다 "무엇을 해야 하는지"가 보이는 편이 운영에 낫다
    console.error(`\n[config] ${why}.\n  ${how}\n`)
    process.exit(1)
  }
  return raw
}

export const JWT_SECRET = readJwtSecret()
export const PORT = Number(process.env.PORT || 4000)

const originRaw = process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:5175'
export const CLIENT_ORIGINS = originRaw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** cors / socket.io 용: * 이면 모든 origin 허용 */
export const allowAnyOrigin = CLIENT_ORIGINS.includes('*')
export const corsOrigin: boolean | string[] = allowAnyOrigin ? true : CLIENT_ORIGINS

/**
 * `*` + credentials:true 는 브라우저가 요청 Origin 을 그대로 반사하게 만든다.
 * 지금은 Bearer 헤더 인증이라 피해가 제한적이지만, 쿠키 인증을 조금이라도
 * 들이는 순간 아무 사이트나 인증된 요청을 보낼 수 있게 된다.
 * 그래서 `*` 를 쓰는 동안에는 credentials 를 끈다.
 */
export const corsCredentials = !allowAnyOrigin
if (allowAnyOrigin) {
  console.warn('[config] CLIENT_ORIGIN 이 * 입니다 — credentials 를 끕니다. 운영에서는 실제 도메인을 나열하세요.')
}
