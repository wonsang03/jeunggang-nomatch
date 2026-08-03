/** 노래 부가 태그 (장르와 별개) */
export const GENDER_TAGS = ['남돌', '여돌'] as const
export const DECADE_TAGS = ['90년대', '00년대', '10년대', '20년대'] as const
/** OST·구 장르 표기 (장르와 별개) */
export const SOURCE_TAGS = ['드라마', 'K-POP', '제이팝', '팝', '발라드'] as const
export const SONG_TAGS = [...GENDER_TAGS, ...DECADE_TAGS, ...SOURCE_TAGS] as const

export type GenderTag = (typeof GENDER_TAGS)[number]
export type DecadeTag = (typeof DECADE_TAGS)[number]
export type SourceTag = (typeof SOURCE_TAGS)[number]
export type SongTag = (typeof SONG_TAGS)[number]

/** 자유 입력 태그 정규화. 남돌+여돌 동시 → 성별 제거(혼성). 년대 키워드는 최대 1개. */
export function normalizeSongTags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map((x) => String(x).trim()).filter(Boolean)
    : []

  const seen = new Set<string>()
  const unique: string[] = []
  for (const t of list) {
    if (seen.has(t)) continue
    seen.add(t)
    unique.push(t)
  }

  const genders = unique.filter((t) => (GENDER_TAGS as readonly string[]).includes(t))
  const decades = unique.filter((t) => (DECADE_TAGS as readonly string[]).includes(t))
  const dropGender = genders.length !== 1
  const keepDecade = decades.length ? decades[decades.length - 1] : undefined

  return unique.filter((t) => {
    if ((GENDER_TAGS as readonly string[]).includes(t)) return !dropGender
    if ((DECADE_TAGS as readonly string[]).includes(t)) return t === keepDecade
    return true
  })
}

export function parseTagsJson(raw: string | null | undefined): string[] {
  try {
    return normalizeSongTags(JSON.parse(raw || '[]'))
  } catch {
    return []
  }
}

export function tagsToJson(tags: string[]): string {
  return JSON.stringify(normalizeSongTags(tags))
}
