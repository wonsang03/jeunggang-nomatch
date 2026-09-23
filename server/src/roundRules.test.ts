import { describe, it, expect } from 'vitest'
import {
  parseEffectValue,
  buffApplies,
  skipVotesNeeded,
  isTitleLikeLabel,
  isArtistLikeLabel,
  josaUlReul,
  toSlotRows,
} from './roundRules.js'
import type { ActiveBuff } from './gameTypes.js'
import { isAcceptedAnswer, expandArtistAccepts, normalizeAnswer } from './answer.js'

describe('parseEffectValue', () => {
  it('정상 JSON 객체를 그대로 준다', () => {
    expect(parseEffectValue('{"sec":5,"mult":2}')).toEqual({ sec: 5, mult: 2 })
  })

  it('깨진 값이면 빈 객체 — 게임이 멈추면 안 된다', () => {
    expect(parseEffectValue('{nope')).toEqual({})
    expect(parseEffectValue(null)).toEqual({})
    expect(parseEffectValue(undefined)).toEqual({})
    expect(parseEffectValue('')).toEqual({})
  })

  it('객체가 아닌 JSON도 빈 객체로 받는다', () => {
    expect(parseEffectValue('[1,2]')).toEqual({})
    expect(parseEffectValue('"문자열"')).toEqual({})
    expect(parseEffectValue('42')).toEqual({})
    expect(parseEffectValue('null')).toEqual({})
  })
})

describe('buffApplies', () => {
  const buff = (startIndex: number, roundsLeft: number) =>
    ({ startIndex, roundsLeft } as ActiveBuff)

  it('시작 라운드부터 적용된다', () => {
    expect(buffApplies(buff(3, 2), 2)).toBe(false)
    expect(buffApplies(buff(3, 2), 3)).toBe(true)
    expect(buffApplies(buff(3, 2), 9)).toBe(true)
  })

  it('남은 라운드가 없으면 적용되지 않는다', () => {
    expect(buffApplies(buff(3, 0), 5)).toBe(false)
    expect(buffApplies(buff(3, -1), 5)).toBe(false)
  })
})

describe('skipVotesNeeded', () => {
  it('과반을 요구한다', () => {
    expect(skipVotesNeeded(2)).toBe(1)
    expect(skipVotesNeeded(3)).toBe(2)
    expect(skipVotesNeeded(4)).toBe(2)
    expect(skipVotesNeeded(5)).toBe(3)
    expect(skipVotesNeeded(10)).toBe(5)
  })

  it('사람이 없어도 최소 1표는 필요하다 (0으로 나뉘어 즉시 스킵되면 안 된다)', () => {
    expect(skipVotesNeeded(0)).toBe(1)
    expect(skipVotesNeeded(-3)).toBe(1)
    expect(skipVotesNeeded(1)).toBe(1)
  })

  it('소수가 들어와도 정수로 다룬다', () => {
    expect(skipVotesNeeded(3.7)).toBe(2)
  })
})

describe('라벨 분류', () => {
  it('제목과 게임명을 같게 본다', () => {
    expect(isTitleLikeLabel('제목')).toBe(true)
    expect(isTitleLikeLabel('게임 제목')).toBe(true)
    expect(isTitleLikeLabel('가수')).toBe(false)
  })

  it('가수·커버·캐릭터를 같게 본다', () => {
    expect(isArtistLikeLabel('가수')).toBe(true)
    expect(isArtistLikeLabel('커버')).toBe(true)
    expect(isArtistLikeLabel('캐릭터')).toBe(true)
    expect(isArtistLikeLabel('제목')).toBe(false)
  })
})

describe('josaUlReul', () => {
  it('받침이 있으면 을, 없으면 를', () => {
    expect(josaUlReul('제목')).toBe('을')
    expect(josaUlReul('가수')).toBe('를')
    expect(josaUlReul('노래')).toBe('를')
    expect(josaUlReul('정답')).toBe('을')
  })

  it('한글이 없으면 를로 넘어간다', () => {
    expect(josaUlReul('IU')).toBe('를')
    expect(josaUlReul('')).toBe('를')
    expect(josaUlReul('123')).toBe('를')
  })

  it('마지막 한글 글자를 기준으로 본다', () => {
    expect(josaUlReul('BTS 제목')).toBe('을')
    expect(josaUlReul('제목 (Title)')).toBe('을')
  })
})

describe('toSlotRows — 듀오 가수 칸 분리', () => {
  const duo = {
    id: 'slot-a',
    label: '가수',
    answer: '시라유키 히나 · 네네코 마시로',
    acceptAnswers: JSON.stringify([
      '시라유키 히나 · 네네코 마시로',
      '시라유키히나·네네코마시로',
      '시라유키 히나',
      '네네코 마시로',
    ]),
    hidden: false,
  }

  it('두 칸으로 나뉘고 각 칸의 답이 한 사람씩이다', () => {
    const rows = toSlotRows(duo)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.answer)).toEqual(['시라유키 히나', '네네코 마시로'])
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
  })

  it('한 명만 쳐서는 다른 칸이 끝나지 않는다', () => {
    const rows = toSlotRows(duo)
    const norms = (r: (typeof rows)[number]) =>
      [...new Set([r.answer, ...expandArtistAccepts(r.answer, r.accepts)].map(normalizeAnswer))]
    const [hina, mashiro] = rows

    expect(isAcceptedAnswer('시라유키 히나', norms(hina))).toBe(true)
    expect(isAcceptedAnswer('시라유키 히나', norms(mashiro))).toBe(false)

    expect(isAcceptedAnswer('네네코 마시로', norms(mashiro))).toBe(true)
    expect(isAcceptedAnswer('네네코 마시로', norms(hina))).toBe(false)

    // 두 이름을 한 번에 친 공동 표기도 어느 칸도 끝내지 못한다
    expect(isAcceptedAnswer('시라유키 히나 · 네네코 마시로', norms(hina))).toBe(false)
    expect(isAcceptedAnswer('시라유키 히나 · 네네코 마시로', norms(mashiro))).toBe(false)
  })

  it('한 사람짜리 칸·히든 칸은 그대로 둔다', () => {
    expect(toSlotRows({ ...duo, answer: '시라유키 히나', acceptAnswers: '[]' })).toHaveLength(1)
    expect(toSlotRows({ ...duo, hidden: true })).toHaveLength(1)
    expect(toSlotRows({ ...duo, label: '제목' })).toHaveLength(1)
  })

  it('인정답 JSON이 깨져 있어도 터지지 않는다', () => {
    const rows = toSlotRows({ ...duo, acceptAnswers: '{broken' })
    expect(rows).toHaveLength(2)
    expect(rows[0].accepts).toEqual([])
  })
})

describe('toSlotRows — 3인 이상과 쪼개면 안 되는 표기', () => {
  const slot = (answer: string, accepts: string[] = []) => ({
    id: 's', label: '가수', answer, acceptAnswers: JSON.stringify(accepts), hidden: false,
  })

  it('트리오·4인도 사람 수만큼 쪼갠다', () => {
    expect(toSlotRows(slot('징버거 · 릴파 · 주르르')).map((r) => r.answer))
      .toEqual(['징버거', '릴파', '주르르'])
    expect(toSlotRows(slot('징버거 · 릴파 · 비챤 · 해루석')).map((r) => r.answer))
      .toEqual(['징버거', '릴파', '비챤', '해루석'])
  })

  it('유닛명+멤버 괄호 표기는 쪼개지 않는다', () => {
    const rows = toSlotRows(slot('Universe (히나 · 마시로 · 리제 · 타비)'))
    expect(rows).toHaveLength(1)
    expect(rows[0].answer).toBe('Universe (히나 · 마시로 · 리제 · 타비)')
  })

  it('이름에 and 가 든 한 팀은 쪼개지 않는다', () => {
    expect(toSlotRows(slot('Tones and I'))).toHaveLength(1)
  })

  it('feat. 은 메인 한 명만 남기고 칸을 늘리지 않는다', () => {
    expect(toSlotRows(slot('Justin Bieber feat. Daniel Caesar'))).toHaveLength(1)
  })
})
