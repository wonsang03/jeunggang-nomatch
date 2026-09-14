import { describe, it, expect } from 'vitest'
import {
  parseEffectValue,
  buffApplies,
  skipVotesNeeded,
  isTitleLikeLabel,
  isArtistLikeLabel,
  josaUlReul,
} from './roundRules.js'
import type { ActiveBuff } from './gameTypes.js'

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
