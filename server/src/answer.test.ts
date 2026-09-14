import { describe, it, expect } from 'vitest'
import {
  normalizeAnswer,
  isAcceptedAnswer,
  parseAcceptList,
  extractYoutubeId,
  splitDuoArtists,
  expandArtistAccepts,
  stripParenSections,
  chosung,
  hintChosung,
  hangulToQwertyMistype,
  pickPronunciationSource,
} from './answer.js'

describe('normalizeAnswer', () => {
  it('공백·대소문자를 무시한다', () => {
    expect(normalizeAnswer('  Blinding   Lights ')).toBe('blindinglights')
    expect(normalizeAnswer('아이 유')).toBe('아이유')
  })

  it('문장부호를 무시한다 (쉼표 포함)', () => {
    expect(normalizeAnswer('Hello, World!')).toBe('helloworld')
    expect(normalizeAnswer('Lady Gaga, Bruno Mars')).toBe(normalizeAnswer('Lady Gaga Bruno Mars'))
    expect(normalizeAnswer('좋은 날 (Good Day)')).toBe('좋은날gooday'.replace('gooday', 'goodday'))
  })

  it('전각을 반각으로 정규화한다', () => {
    expect(normalizeAnswer('ＩＵ')).toBe('iu')
  })
})

describe('isAcceptedAnswer', () => {
  const accepts = ['아이유', '좋은날'].map(normalizeAnswer)

  it('정규화 후 완전 일치만 인정한다', () => {
    expect(isAcceptedAnswer('아이 유', accepts)).toBe(true)
    expect(isAcceptedAnswer('좋은 날!', accepts)).toBe(true)
    expect(isAcceptedAnswer('아이', accepts)).toBe(false)
    expect(isAcceptedAnswer('아이유짱', accepts)).toBe(false)
  })

  it('빈 입력은 언제나 오답이다', () => {
    expect(isAcceptedAnswer('', accepts)).toBe(false)
    expect(isAcceptedAnswer('   ', accepts)).toBe(false)
    expect(isAcceptedAnswer('!!!', accepts)).toBe(false)
  })

  it('빈 인정답에 걸려 통과하지 않는다', () => {
    expect(isAcceptedAnswer('아무거나', ['', '아이유'])).toBe(false)
  })
})

describe('parseAcceptList', () => {
  it('구분자로 나누고 중복을 제거한다', () => {
    expect(parseAcceptList('아이유, IU / 이지은')).toEqual(['아이유', 'IU', '이지은'])
    expect(parseAcceptList('A, A, B')).toEqual(['A', 'B'])
    expect(parseAcceptList(['A', ' B ', 'A'])).toEqual(['A', 'B'])
    expect(parseAcceptList(null)).toEqual([])
  })
})

describe('extractYoutubeId', () => {
  it('여러 URL 형태에서 11자 id를 뽑는다', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ')
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYoutubeId('https://example.com/none')).toBeNull()
  })
})

describe('splitDuoArtists', () => {
  it('공동 가수를 나눈다', () => {
    expect(splitDuoArtists('Lady Gaga, Bruno Mars')).toEqual(['Lady Gaga', 'Bruno Mars'])
    expect(splitDuoArtists('서인국, 정은지')).toEqual(['서인국', '정은지'])
    expect(splitDuoArtists('악동뮤지션 와 아이유')).toEqual(['악동뮤지션', '아이유'])
  })

  it('피처링은 메인 가수만 남긴다', () => {
    expect(splitDuoArtists('Justin Bieber feat. Daniel Caesar')).toEqual(['Justin Bieber'])
  })

  it('슬래시 그룹명은 쪼개지 않는다', () => {
    expect(splitDuoArtists('HUNTR/X')).toEqual(['HUNTR/X'])
    expect(splitDuoArtists('IU')).toEqual(['IU'])
  })
})

describe('expandArtistAccepts', () => {
  it('공동 표기 인정답은 한 슬롯에 끌어오지 않는다', () => {
    expect(expandArtistAccepts('Lady Gaga', ['Lady Gaga, Bruno Mars', '레이디 가가']))
      .toEqual(['Lady Gaga', '레이디 가가'])
  })

  it('피처링 표기는 메인 가수도 인정한다', () => {
    expect(expandArtistAccepts('Justin Bieber feat. Daniel Caesar'))
      .toEqual(['Justin Bieber feat. Daniel Caesar', 'Justin Bieber'])
  })
})

describe('stripParenSections / chosung', () => {
  it('괄호 안을 제거한다', () => {
    expect(stripParenSections('기도 (I\'ll Be Your Man)')).toBe('기도')
    expect(stripParenSections('좋은 날 [Remix')).toBe('좋은 날')
  })

  it('한글 음절만 초성으로 바꾼다', () => {
    expect(chosung('좋은 날')).toBe('ㅈㅇ ㄴ')
    expect(chosung('Blinding Lights')).toBe('')
  })
})

describe('hintChosung', () => {
  it('한글 제목은 제목 그대로 초성을 뽑는다', () => {
    expect(hintChosung('좋은 날')).toBe('ㅈㅇ ㄴ')
  })

  it('숫자·영문이 섞이면 한글로 풀어 쓴 인정답을 쓴다', () => {
    expect(hintChosung('벌써 12시', ['벌써 열두시'])).toBe('ㅂㅆ ㅇㄷㅅ')
    expect(hintChosung('넌 is 뭔들', ['넌 이즈 뭔들'])).toBe('ㄴ ㅇㅈ ㅁㄷ')
    expect(hintChosung('강한 척하는 girl', ['강한 척하는 걸'])).toBe('ㄱㅎ ㅊㅎㄴ ㄱ')
  })

  it('괄호 부제가 초성에 새지 않는다', () => {
    expect(hintChosung('기도 (I\'ll Be Your Man)', ['기도', '아일 비 유어 맨'])).toBe('ㄱㄷ')
    expect(hintChosung('Cherish (My Love)', ['체리시', '체리시 마이 러브'])).toBe('ㅊㄹㅅ')
    expect(hintChosung('404 (New Era)', ['사공사', '404뉴에라', '포오포뉴에라'])).toBe('ㅅㄱㅅ')
  })

  it('숫자를 뺀 줄임 표기가 원본보다 짧으면 쓰지 않는다', () => {
    expect(pickPronunciationSource('용과 같이 5: 꿈을 이루는자', ['용과같이', '용과 같이 오']))
      .toBe('용과 같이 5: 꿈을 이루는자')
  })

  it('하이픈도 단어 경계로 본다', () => {
    expect(hintChosung('Given-Taken', ['기븐 테이큰'])).toBe('ㄱㅂ ㅌㅇㅋ')
  })

  it('영문 제목은 발음 인정답의 초성을 쓴다', () => {
    expect(hintChosung('Blinding Lights', ['블라인딩 라이츠'])).toBe('ㅂㄹㅇㄷ ㄹㅇㅊ')
  })
})

describe('hangulToQwertyMistype', () => {
  it('한영키 안 누른 영타로 바꾼다', () => {
    expect(hangulToQwertyMistype('정답')).toBe('wjdekq')
    expect(hangulToQwertyMistype('좋은날')).toBe('whgdmsskf')
  })

  it('한글이 아닌 글자는 그대로 둔다', () => {
    expect(hangulToQwertyMistype('IU 3집')).toBe('IU 3wlq')
  })
})
