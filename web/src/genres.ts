/** 문제 은행 / 방 설정 공통 장르 */
export const GENRES = [
  'K팝',
  '제이팝',
  '팝',
  '영화',
  '드라마',
  '애니',
  '클래식',
  '버튜버',
  '게임',
  '기타',
] as const

export type GenreName = (typeof GENRES)[number]

export function emptyGenreCounts(defaultGenre: GenreName = 'K팝', count = 20): Record<GenreName, number> {
  const out = {} as Record<GenreName, number>
  for (const g of GENRES) out[g] = g === defaultGenre ? count : 0
  return out
}
