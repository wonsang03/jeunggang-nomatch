/** 대기실·일반 출제에 쓰는 장르 (클래식 제거 · 기타 제외) */
export const PLAYABLE_GENRES = [
  '한국노래',
  '일본노래',
  '해외노래',
  '애니',
  '버튜버',
  '게임',
] as const

/** 야차룰 전용 풀 · 일반 출제에서는 쓰지 않음 */
export const YACHA_GENRE = '기타' as const

/** 문제은행·시드에 유지하는 전체 장르 (플레이어블 + 야차용 기타) */
export const BANK_GENRES = [...PLAYABLE_GENRES, YACHA_GENRE] as const

/** @deprecated 대기실/출제는 PLAYABLE_GENRES 사용. 하위호환용 별칭 */
export const GENRES = PLAYABLE_GENRES

export type PlayableGenreName = (typeof PLAYABLE_GENRES)[number]
export type BankGenreName = (typeof BANK_GENRES)[number]
export type GenreName = PlayableGenreName

export function emptyGenreCounts(
  defaultGenre: PlayableGenreName = '한국노래',
  count = 20,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const g of PLAYABLE_GENRES) out[g] = g === defaultGenre ? count : 0
  return out
}

export function isPlayableGenre(name: string) {
  return (PLAYABLE_GENRES as readonly string[]).includes(name)
}

export function isBankGenre(name: string) {
  return (BANK_GENRES as readonly string[]).includes(name)
}
