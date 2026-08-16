import { prisma } from './config.js'
import { PLAYABLE_GENRES, isPlayableGenre } from './genres.js'

/**
 * 문제은행은 관리자가 편집할 때만 바뀌는데, 장르 조회와 장르별 보유 수는
 * 방 입장·설정 변경·게임 시작마다 불린다. 편집 시 무효화하는 캐시로 왕복을 줄인다.
 */

const GENRE_TTL_MS = 60_000
const BANK_COUNT_TTL_MS = 15_000
const QUESTION_TTL_MS = 60_000

let genreIdCache: { at: number; byName: Map<string, string> } | null = null
let bankCountCache: { at: number; counts: Record<string, number> } | null = null
const genreQuestionCache = new Map<string, { at: number; list: BankQuestion[] }>()

/** 문제·장르를 편집한 뒤 호출해 캐시를 즉시 버린다 */
export function invalidateBankCache() {
  genreIdCache = null
  bankCountCache = null
  genreQuestionCache.clear()
}

async function loadGenreIds() {
  if (genreIdCache && Date.now() - genreIdCache.at < GENRE_TTL_MS) {
    return genreIdCache.byName
  }
  const genres = await prisma.genre.findMany({ select: { id: true, name: true } })
  const byName = new Map(genres.map((g) => [g.name, g.id]))
  genreIdCache = { at: Date.now(), byName }
  return byName
}

/** 장르명 → id. 없으면 null */
export async function getGenreId(name: string) {
  const byName = await loadGenreIds()
  return byName.get(name) ?? null
}

function fetchGenreQuestions(genreId: string) {
  return prisma.question.findMany({
    where: { genreId, enabled: true },
    include: { slots: { orderBy: { sortOrder: 'asc' } }, genre: true },
  })
}

export type BankQuestion = Awaited<ReturnType<typeof fetchGenreQuestions>>[number]

/**
 * 장르별 활성 문제 전체.
 * 라운드 시작을 막고 도는 트루먼 디코이 추첨·증강의 장르 재배분이 매번 은행을
 * 통째로 읽어서 캐시한다. 반환 배열은 공유되므로 호출 쪽에서 변형하면 안 된다.
 */
export async function loadGenreQuestions(genreName: string): Promise<BankQuestion[]> {
  const genreId = await getGenreId(genreName)
  if (!genreId) return []
  const hit = genreQuestionCache.get(genreId)
  if (hit && Date.now() - hit.at < QUESTION_TTL_MS) return hit.list
  const list = await fetchGenreQuestions(genreId)
  genreQuestionCache.set(genreId, { at: Date.now(), list })
  return list
}

/** 플레이어블 장르별 활성 문제 수 (대기실 슬라이더 max) */
export async function loadGenreBankCounts(): Promise<Record<string, number>> {
  if (bankCountCache && Date.now() - bankCountCache.at < BANK_COUNT_TTL_MS) {
    return { ...bankCountCache.counts }
  }
  const [genres, grouped] = await Promise.all([
    prisma.genre.findMany({ select: { id: true, name: true } }),
    prisma.question.groupBy({
      by: ['genreId'],
      where: { enabled: true },
      _count: { _all: true },
    }),
  ])
  const byId = new Map(grouped.map((g) => [g.genreId, g._count._all]))
  const counts: Record<string, number> = {}
  // 대기실 슬라이더: 플레이어블만 (기타·클래식 제외)
  for (const name of PLAYABLE_GENRES) counts[name] = 0
  for (const g of genres) {
    if (!isPlayableGenre(g.name)) continue
    counts[g.name] = byId.get(g.id) || 0
  }
  bankCountCache = { at: Date.now(), counts }
  return { ...counts }
}
