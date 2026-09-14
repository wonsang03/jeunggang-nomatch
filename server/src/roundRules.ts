import type { ActiveBuff } from './gameTypes.js'

/**
 * 방 상태를 건드리지 않는 순수 규칙 함수들.
 *
 * socket.ts 안에 섞여 있을 땐 테스트를 붙일 수가 없었다 (파일을 import 하는 순간
 * prisma·socket.io가 딸려 온다). 여기로 옮기면 규칙만 따로 검증할 수 있다.
 */

/** 증강 effectValue 는 DB에 JSON 문자열로 들어있다. 깨져 있어도 게임이 멈추면 안 된다. */
export function parseEffectValue(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 버프가 이번 라운드에 살아 있는가 (시작 라운드 이후 · 남은 라운드 > 0) */
export function buffApplies(buff: ActiveBuff, roundIndex: number) {
  return roundIndex >= buff.startIndex && buff.roundsLeft > 0
}

/** 스킵 정족수 = 과반 (분모는 "지금 대답할 수 있는 사람" 수) */
export function skipVotesNeeded(memberCount: number) {
  const n = Math.max(0, Math.floor(memberCount))
  if (n <= 0) return 1
  return Math.max(1, Math.ceil(n / 2))
}

/** 제목 = 게임명 (힌트·초성 동일 취급) */
export function isTitleLikeLabel(label: string) {
  return label.includes('제목') || label.includes('게임')
}

/** 가수 = 커버 = 캐릭터 (힌트·초성·스포일 동일 취급) */
export function isArtistLikeLabel(label: string) {
  return label.includes('가수') || label.includes('커버') || label.includes('캐릭터')
}

/** 조사 을/를 — 받침이 있으면 '을' */
export function josaUlReul(word: string) {
  const ch = [...word].filter((c) => /[가-힣]/.test(c)).pop()
  if (!ch) return '를'
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return '를'
  return code % 28 === 0 ? '를' : '을'
}
