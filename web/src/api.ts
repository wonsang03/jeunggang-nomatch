const rawApi = import.meta.env.VITE_API_URL as string | undefined
/** 배포(프로덕션)는 같은 출처, 로컬 개발은 :4000 */
const API_BASE =
  rawApi !== undefined && rawApi !== ''
    ? rawApi
    : import.meta.env.DEV
      ? 'http://localhost:4000'
      : ''

export type AuthUser = {
  id: string
  username: string
  nickname: string
  avatarUrl: string | null
  isAdmin: boolean
  musicVolume: number
  sfxVolume: number
}

function normalizeUser(u: Partial<AuthUser> & Pick<AuthUser, 'id' | 'username' | 'nickname' | 'isAdmin'>): AuthUser {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl ?? null,
    isAdmin: u.isAdmin,
    musicVolume: typeof u.musicVolume === 'number' ? u.musicVolume : 70,
    sfxVolume: typeof u.sfxVolume === 'number' ? u.sfxVolume : 55,
  }
}

export function getToken() {
  return localStorage.getItem('token') || ''
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem('token', token)
  localStorage.setItem('user', JSON.stringify(normalizeUser(user)))
}

export function clearAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    return normalizeUser(JSON.parse(raw))
  } catch {
    return null
  }
}

export function updateStoredUser(user: AuthUser) {
  localStorage.setItem('user', JSON.stringify(normalizeUser(user)))
}

/** 아바타 상대경로 → 절대 URL */
export function avatarSrc(url: string | null | undefined) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
  return `${API_BASE}${url}`
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || '요청 실패')
  return data as T
}

export { API_BASE }
