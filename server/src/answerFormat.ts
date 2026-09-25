/**
 * 정답 표기 · 슬롯 찾기 (제목/가수 슬롯, 스포일·영타·타이핑 공개 문자열).
 * 방 상태를 바꾸지 않는 순수 함수만 둔다.
 */
import { hangulToQwertyMistype } from './answer.js'
import type { QuestionRuntime, Room } from './gameTypes.js'
import { isArtistLikeLabel, isTitleLikeLabel } from './roundRules.js'

export function findTitleSlot(q: QuestionRuntime) {
  return q.slots.find((s) => !s.hidden && isTitleLikeLabel(s.label))
    || q.slots.find((s) => !s.hidden && !isArtistLikeLabel(s.label))
    || null
}

export function findArtistSlots(q: QuestionRuntime) {
  return q.slots.filter((s) => !s.hidden && isArtistLikeLabel(s.label))
}

/** 제목만 모드에서 사라진 가수를 힌트로 알려주는 장르 (애니·버튜버·게임은 제외) */
export const ARTIST_HINT_GENRES = new Set(['한국노래', '일본노래', '해외노래'])

/**
 * 제목만 모드: 첫 번째 비전 슬롯(1번)만 남기고 가수·히든 슬롯은 전부 뺀다.
 * 없어진 가수 슬롯은 한국·일본·해외 장르에 한해 정답이 아닌 힌트(artistHint)로만 남긴다.
 */
export function applyAnswerMode(
  q: QuestionRuntime,
  mode: 'title' | 'title_artist',
  allowArtistHint = true,
): QuestionRuntime {
  if (mode !== 'title') return q
  const first = q.slots.find((s) => !s.hidden) || q.slots[0]
  const artistHint = allowArtistHint && ARTIST_HINT_GENRES.has(q.genre)
    ? findArtistSlots(q)
      .filter((s) => s.id !== first?.id)
      .map((s) => (s.answer || '').trim())
      .filter(Boolean)
      .join(' / ')
    : ''
  if (!first) {
    return {
      ...q,
      slots: [],
      artistChosung: '',
      artistHint,
    }
  }
  const titleSlot = { ...first, hidden: false }
  return {
    ...q,
    slots: [titleSlot],
    titleChosung: titleSlot.chosung || q.titleChosung,
    artistChosung: '',
    artistHint,
  }
}

export function hiddenUnlockedForQuestion(room: Room, q: QuestionRuntime) {
  const openSlots = q.slots.filter((s) => !s.hidden)
  return openSlots.length === 0 || openSlots.every((s) => room.revealed[s.id])
}

export function formatSlotAnswers(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .map((s) => `${s.hidden ? (s.label || '히든') : s.label}: ${s.answer}`)
    .join(' / ')
}

/** 제목·가수/커버/캐릭터만 (나이거·미래시 등) */
export function formatTitleArtistAnswers(q: QuestionRuntime) {
  const parts: string[] = []
  const title = findTitleSlot(q)
  if (title) parts.push(`${title.label}: ${title.answer}`)
  for (const artist of findArtistSlots(q)) {
    parts.push(`${artist.label}: ${artist.answer}`)
  }
  return parts.join(' · ') || formatSlotAnswers(q)
}

/** 타이핑 공개용: 괄호(한자·원제 등) 안은 빼고 본문만 */
export function stripParenHint(answer: string) {
  return String(answer || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 제목/가수 라벨 없이 답만 (타이핑 공개용) · 슬롯 역순(마지막→첫 번째) */
export function formatSlotAnswersPlain(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .slice()
    .reverse()
    .map((s) => stripParenHint(s.answer))
    .filter(Boolean)
    .join('\n')
}

/** 슬롯별 스포일 맵 (나이거 / 일론 등) */
export function buildSpoilBySlot(
  q: QuestionRuntime,
  mode: 'plain' | 'qwerty',
  includeHidden: boolean,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of q.slots) {
    if (!includeHidden && s.hidden) continue
    const raw = (s.answer || '').trim()
    if (!raw) continue
    out[s.id] = mode === 'qwerty' ? hangulToQwertyMistype(raw) : raw
  }
  return out
}

/** 일론 머스크의 가호: 외계인 영타 표기 */
export function formatAlienQwertyAnswers(q: QuestionRuntime, includeHidden = false) {
  return q.slots
    .filter((s) => includeHidden || !s.hidden)
    .map((s) => `${s.hidden ? (s.label || '히든') : s.label}: ${hangulToQwertyMistype(s.answer)}`)
    .join(' / ')
}
