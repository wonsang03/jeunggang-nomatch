/** 정답 비교용 정규화 — 공백·문장부호·대소문자 무시 */
export function normalizeAnswer(s: string) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[."""'''『』「」\[\]()（）{}<>〈〉《》·・…~\-_/\\|:;!?！？。，、,]/g, '')
}

/**
 * 정답 인정: 정규화(공백·문장부호·대소문자 무시) 후 **완전 일치**만
 */
export function isAcceptedAnswer(raw: string, acceptNorms: string[]): boolean {
  const norm = normalizeAnswer(raw)
  if (!norm) return false
  return acceptNorms.some((a) => !!a && a === norm)
}

/** 인정답안: 쉼표/슬래시/파이프 구분 → 배열 */
export function parseAcceptList(input: string | string[] | undefined | null): string[] {
  if (input == null) return []
  if (Array.isArray(input)) {
    return [...new Set(input.map((x) => String(x).trim()).filter(Boolean))]
  }
  return [...new Set(
    String(input)
      .split(/[,，、/|]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  )]
}

export function extractYoutubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m?.[1] || null
}

export function hasHangul(s: string) {
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)
}

export function isFeaturingCredit(s: string) {
  return /\b(feat\.?|ft\.?|featuring)\b|피처링/i.test(s)
}

/** "A, B" / "A & B" / "A 와 B" 식 목록 분리. HUNTR/X 같은 슬래시 그룹명은 유지. */
function splitArtistList(s: string): string[] {
  const normalized = s
    .replace(/\s+와\s+/g, ', ')
    .replace(/\s+과\s+/g, ', ')
    .trim()
  if (!normalized) return []
  const parts = normalized
    .split(/\s*(?:&|＆|×|✕|,|，|·|\band\b|\bwith\b)\s*| \/ /i)
    .map((p) => p.trim().replace(/^[(\[（]+|[)\]）]+$/g, '').trim())
    .filter(Boolean)
  return parts.length >= 2 ? parts : [normalized]
}

/**
 * 공동 가수(듀오) 분리. 피처링은 앞쪽 메인만 (feat 가수는 제외).
 * 예: "Lady Gaga, Bruno Mars" / "서인국, 정은지"
 */
export function splitDuoArtists(s: string): string[] {
  const raw = s.trim()
  if (!raw) return []
  if (isFeaturingCredit(raw)) {
    const main = raw.split(/\b(?:feat\.?|ft\.?|featuring)\b|피처링/i)[0]?.replace(/[(\[（]\s*$/, '').trim()
    return main ? splitArtistList(main) : [raw]
  }
  return splitArtistList(raw)
}

/** 가수 슬롯 인정답(별칭). 공동 가수는 슬롯 분리로 처리하며, 한 슬롯에 상대 이름을 넣지 않음. */
export function expandArtistAccepts(answer: string, accepts: string[] = []): string[] {
  const set = new Set<string>()
  const add = (x: string) => {
    const t = x.trim()
    if (t) set.add(t)
  }
  const isJointCredit = (s: string) => {
    if (isFeaturingCredit(s)) return false
    return splitDuoArtists(s).length >= 2 && /[,，&＆×]| 와 | 과 |\band\b/i.test(s)
  }
  add(answer)
  for (const a of accepts) {
    if (isJointCredit(a)) continue
    add(a)
  }
  // 피처링 표기면 메인만 인정답에 추가
  if (isFeaturingCredit(answer)) {
    for (const p of splitDuoArtists(answer)) add(p)
  }
  return [...set]
}

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

/**
 * "읽히지 않는" 글자 — 발음 소스 점수(한글 비중)를 계산할 때 분모에서 뺀다.
 * 여기에 빠진 기호가 있으면 그 기호가 든 표기의 점수가 부당하게 낮아져
 * 줄임 표기가 대신 뽑힌다. (예: "용과 같이 5: 꿈을 이루는자" 가 ':' 때문에 "용과같이"에 밀림)
 */
const NON_READING_CHARS = /[\s　\d._\-'"“”‘’,!?&/:;()[\]{}<>~|\\·・…。，、！？]/g

/** 초성으로 표현할 수 없는 글자 — 숫자·라틴문자·가나·한자 */
const NON_HANGUL_READABLE = /[\dA-Za-z぀-ヿ一-鿿]/

/** 초성·힌트용: 괄호(및 유사 괄호)와 그 안 내용 제거 */
export function stripParenSections(text: string) {
  return text
    .replace(/[(\[\{（［｛][^)\]\}）］｝]*[)\]\}）］｝]/g, ' ')
    .replace(/[(\[\{（［｛][^)\]\}）］｝]*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 한글 음절 → 초성 (공백으로 구분). 비한글은 건너뜀 */
export function chosung(text: string) {
  return [...stripParenSections(text)]
    .map((ch) => {
      const code = ch.charCodeAt(0)
      if (code >= 0xac00 && code <= 0xd7a3) return CHO[Math.floor((code - 0xac00) / 588)]
      if (ch === ' ' || ch === '\u3000') return ' '
      return ''
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── 가나 → 한글 (힌트용 발음) ─────────────────────────────────
const KANA_MAP: Record<string, string> = {
  あ: '아', い: '이', う: '우', え: '에', お: '오',
  か: '카', き: '키', く: '쿠', け: '케', こ: '코',
  さ: '사', し: '시', す: '스', せ: '세', そ: '소',
  た: '타', ち: '치', つ: '츠', て: '테', と: '토',
  な: '나', に: '니', ぬ: '누', ね: '네', の: '노',
  は: '하', ひ: '히', ふ: '후', へ: '헤', ほ: '호',
  ま: '마', み: '미', む: '무', め: '메', も: '모',
  や: '야', ゆ: '유', よ: '요',
  ら: '라', り: '리', る: '루', れ: '레', ろ: '로',
  わ: '와', を: '오', ん: 'ㄴ',
  が: '가', ぎ: '기', ぐ: '구', げ: '게', ご: '고',
  ざ: '자', じ: '지', ず: '즈', ぜ: '제', ぞ: '조',
  だ: '다', ぢ: '지', づ: '즈', で: '데', ど: '도',
  ば: '바', び: '비', ぶ: '부', べ: '베', ぼ: '보',
  ぱ: '파', ぴ: '피', ぷ: '푸', ぺ: '페', ぽ: '포',
  きゃ: '캬', きゅ: '큐', きょ: '쿄',
  しゃ: '샤', しゅ: '슈', しょ: '쇼',
  ちゃ: '챠', ちゅ: '츄', ちょ: '쵸',
  にゃ: '냐', にゅ: '뉴', にょ: '뇨',
  ひゃ: '햐', ひゅ: '휴', ひょ: '효',
  みゃ: '먀', みゅ: '뮤', みょ: '묘',
  りゃ: '랴', りゅ: '류', りょ: '료',
  ぎゃ: '갸', ぎゅ: '규', ぎょ: '교',
  じゃ: '쟈', じゅ: '쥬', じょ: '죠',
  びゃ: '뱌', びゅ: '뷰', びょ: '뵤',
  ぴゃ: '퍄', ぴゅ: '퓨', ぴょ: '표',
  ア: '아', イ: '이', ウ: '우', エ: '에', オ: '오',
  カ: '카', キ: '키', ク: '쿠', ケ: '케', コ: '코',
  サ: '사', シ: '시', ス: '스', セ: '세', ソ: '소',
  タ: '타', チ: '치', ツ: '츠', テ: '테', ト: '토',
  ナ: '나', ニ: '니', ヌ: '누', ネ: '네', ノ: '노',
  ハ: '하', ヒ: '히', フ: '후', ヘ: '헤', ホ: '호',
  マ: '마', ミ: '미', ム: '무', メ: '메', モ: '모',
  ヤ: '야', ユ: '유', ヨ: '요',
  ラ: '라', リ: '리', ル: '루', レ: '레', ロ: '로',
  ワ: '와', ヲ: '오', ン: 'ㄴ',
  ガ: '가', ギ: '기', グ: '구', ゲ: '게', ゴ: '고',
  ザ: '자', ジ: '지', ズ: '즈', ゼ: '제', ゾ: '조',
  ダ: '다', ヂ: '지', ヅ: '즈', デ: '데', ド: '도',
  バ: '바', ビ: '비', ブ: '부', ベ: '베', ボ: '보',
  パ: '파', ピ: '피', プ: '푸', ペ: '페', ポ: '포',
  キャ: '캬', キュ: '큐', キョ: '쿄',
  シャ: '샤', シュ: '슈', ショ: '쇼',
  チャ: '챠', チュ: '츄', チョ: '쵸',
  ニャ: '냐', ニュ: '뉴', ニョ: '뇨',
  ヒャ: '햐', ヒュ: '휴', ヒョ: '효',
  ミャ: '먀', ミュ: '뮤', ミョ: '묘',
  リャ: '랴', リュ: '류', リョ: '료',
  ギャ: '갸', ギュ: '규', ギョ: '교',
  ジャ: '쟈', ジュ: '쥬', ジョ: '죠',
  ビャ: '뱌', ビュ: '뷰', ビョ: '뵤',
  ピャ: '퍄', ピュ: '퓨', ピョ: '표',
  ー: '',
}

function kanaToHangul(text: string) {
  let out = ''
  let i = 0
  const s = text.normalize('NFKC')
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    if (KANA_MAP[two]) {
      out += KANA_MAP[two]
      i += 2
      continue
    }
    const one = s[i]
    if (KANA_MAP[one]) out += KANA_MAP[one]
    else if (hasHangul(one) || one === ' ') out += one
    i += 1
  }
  return out
}

/** 영문 대략 한글 발음 (힌트용 폴백). 인정 한글이 있으면 그걸 우선 */
function latinToHangulApprox(text: string) {
  const dict: Record<string, string> = {
    the: '더', and: '앤드', of: '오브',
    taylor: '테일러', swift: '스위프트', harry: '해리', styles: '스타일스',
    billie: '빌리', eilish: '아일리시', sabrina: '사브리나', carpenter: '카펜터',
    lady: '레이디', gaga: '가가', bruno: '브루노', mars: '마스',
    weeknd: '위켄드', teddy: '테디', swims: '스윔스',
    chappell: '채플', roan: '로안', rose: '로제',
    yoasobi: '요아소비', vaundy: '바운디', imase: '이마세',
    creepy: '크리피', nuts: '너츠', official: '오피셜',
    green: '그린', apple: '애플', mrs: '미세스',
    aimyon: '아이묭', fujii: '후지이', kaze: '카제',
    espresso: '에스프레소', please: '플리즈', apt: '아파트',
    cruel: '크루얼', summer: '서머', blinding: '블라인딩', lights: '라이츠',
    drowning: '드로잉', lemonade: '레모네이드', love: '러브', attack: '어택',
    idol: '아이돌', pretender: '프리텐더', night: '나이트', dancer: '댄서',
    birds: '버즈', feather: '페더', die: '다이', with: '위드', smile: '스마일',
    lose: '루즈', control: '컨트롤', good: '굿', luck: '럭', babe: '베이브',
    as: '애즈', it: '잇', was: '워즈',
  }

  const CHO_J = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
  const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
  const compose = (cho: string, jung: string) => {
    const ci = CHO_J.indexOf(cho)
    const ji = JUNG.indexOf(jung)
    if (ci < 0 || ji < 0) return ''
    return String.fromCharCode(0xac00 + ci * 588 + ji * 28)
  }
  const c2h: Record<string, string> = {
    b: 'ㅂ', c: 'ㅋ', d: 'ㄷ', f: 'ㅍ', g: 'ㄱ', h: 'ㅎ', j: 'ㅈ', k: 'ㅋ',
    l: 'ㄹ', m: 'ㅁ', n: 'ㄴ', p: 'ㅍ', q: 'ㅋ', r: 'ㄹ', s: 'ㅅ', t: 'ㅌ',
    v: 'ㅂ', w: 'ㅇ', x: 'ㅋ', y: 'ㅇ', z: 'ㅈ',
  }
  const v2h: Record<string, string> = { a: 'ㅏ', e: 'ㅔ', i: 'ㅣ', o: 'ㅗ', u: 'ㅜ' }

  const words = text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  return words.map((w) => {
    if (dict[w]) return dict[w]
    let i = 0
    let out = ''
    while (i < w.length) {
      let cho = 'ㅇ'
      if (c2h[w[i]] && !v2h[w[i]]) {
        cho = c2h[w[i]]
        i += 1
      }
      if (i < w.length && v2h[w[i]]) {
        out += compose(cho, v2h[w[i]])
        i += 1
      } else if (cho !== 'ㅇ') {
        out += compose(cho, 'ㅡ')
      } else {
        i += 1
      }
    }
    return out || w
  }).join(' ')
}
/** 알파벳/일본어 → 한국어 발음 문자열 */
export function toKoreanPronunciation(text: string) {
  const t = text.trim()
  if (!t) return ''
  if (hasHangul(t) && !/[A-Za-zぁ-んァ-ン]/.test(t)) return t
  if (/[ぁ-んァ-ン]/.test(t)) {
    const converted = kanaToHangul(t)
    if (hasHangul(converted)) return converted
  }
  if (/[A-Za-z]/.test(t)) return latinToHangulApprox(t)
  return t
}

/**
 * 힌트용 발음 소스: 한글 인정답을 우선, 없으면 발음 변환
 * (제목/가수 공통)
 * 초성 띄어쓰기를 위해, 한글 비중이 같으면 공백이 있는 표기를 우선한다.
 */
export function pickPronunciationSource(answer: string, accepts: string[] = []): string {
  const candidates = [answer, ...accepts].map((s) => s.trim()).filter(Boolean)
  const spaceCount = (s: string) => (s.match(/[\s\u3000]/g) || []).length

  // 한글 비중이 높은 후보 우선 · 동점이면 (1) 숫자 없는 쪽 (2) 띄어쓰기 많은 쪽
  // 숫자를 빼는 이유: 초성은 숫자를 표현하지 못해 "벌써 12시" → "ㅂㅆ ㅅ" 처럼 글자가 증발한다.
  // "벌써 열두시" 같이 숫자를 한글로 풀어 쓴 인정답이 있으면 그쪽을 발음 소스로 삼는다.
  // 초성은 "제목을 읽은 것"이어야 한다. 제목의 단어 수와 같은 후보를 최우선으로 삼는다.
  // 이 규칙이 없으면 괄호 안 부제가 딸려 들어간다.
  //   "기도 (I'll Be Your Man)" → 제목 "기도"(1단어)인데 "아일 비 유어 맨"(4단어)이 뽑혀 ㅇㅇㅂㅇㅇㅁ
  //   "Cherish (My Love)"      → 제목 "Cherish"(1단어)인데 "체리시 마이 러브"가 뽑혀 ㅊㄹㅅㅁㅇㄹㅂ
  const wordCount = (s: string) =>
    stripParenSections(s).split(/[\s　]+/).filter((w) => /[0-9A-Za-z가-힣]/.test(w)).length
  const targetWords = wordCount(answer)
  // 제목에 괄호 부제가 있으면, 부제까지 읽은 긴 표기가 아니라 제목만 읽은 짧은 표기를 쓴다.
  // "404 (New Era)" 의 인정답에는 "404뉴에라"·"포오포뉴에라"(부제 포함, 붙여써서 1단어로 보임)와
  // "사공사"(제목만)가 같이 있어서, 짧은 쪽을 고르지 않으면 부제가 초성에 섞인다.
  const preferShort = stripParenSections(answer.trim()) !== answer.trim()
  const hasDigit = (s: string) => /\d/.test(s)
  let best: string | null = null
  let bestScore = -1
  let bestWordMatch = false
  let bestDigitFree = false
  let bestSpaces = -1
  let bestHangulN = -1
  for (const c of candidates) {
    const chars = [...c.replace(NON_READING_CHARS, '')]
    if (!chars.length) continue
    const hangulN = chars.filter((ch) => /[가-힣]/.test(ch)).length
    if (hangulN <= 0) continue
    const score = hangulN / chars.length
    const wordMatch = targetWords > 0 && wordCount(c) === targetWords
    const digitFree = !hasDigit(c)
    const spaces = spaceCount(c)
    // 숫자 없는 후보를 우선하되, 그게 더 짧으면(줄임 표기면) 쓰지 않는다.
    // 예: "용과 같이 5: 꿈을 이루는자" 를 "용과 같이 오" 로 바꾸면 뒷부분이 통째로 사라진다.
    const digitUpgrade = digitFree && !bestDigitFree && hangulN >= bestHangulN
    const tie = score === bestScore
    const better =
      score > bestScore
      || (tie && digitUpgrade)
      || (tie && digitFree === bestDigitFree && preferShort && hangulN < bestHangulN)
      // 길이가 같으면 띄어쓴 표기를 쓴다 — 초성 띄어쓰기의 근거가 된다.
      || (tie && digitFree === bestDigitFree && (!preferShort || hangulN === bestHangulN) && spaces > bestSpaces)
    if (better) {
      bestScore = score
      bestWordMatch = wordMatch
      bestDigitFree = digitFree
      bestSpaces = spaces
      bestHangulN = hangulN
      best = c
    }
  }
  if (best && bestScore >= 0.4) {
    // 같은 정답(정규화)인데 붙여쓰기만 골랐다면 → 띄어쓰기 있는 표기로 교체
    if (bestSpaces === 0) {
      const norm = normalizeAnswer(best)
      const spaced = candidates.find(
        (c) => spaceCount(c) > 0 && hasHangul(c) && normalizeAnswer(c) === norm,
      )
      if (spaced) return spaced
    }
    return best
  }

  // 듀오면 각 이름을 발음 변환해 이어붙임
  if (!isFeaturingCredit(answer)) {
    const parts = splitDuoArtists(answer)
    if (parts.length >= 2) {
      return parts.map((p) => {
        const fromAccept = accepts.find((a) => normalizeAnswer(a) === normalizeAnswer(p) || a.includes(p))
        if (fromAccept && hasHangul(fromAccept)) return fromAccept
        const hangulAccept = accepts.find((a) => hasHangul(a) && (normalizeAnswer(a).includes(normalizeAnswer(p)) || normalizeAnswer(p).includes(normalizeAnswer(a))))
        return hangulAccept && hasHangul(hangulAccept) ? hangulAccept : toKoreanPronunciation(p)
      }).join(' ')
    }
  }
  return toKoreanPronunciation(answer)
}

/**
 * 제목(띄어쓰기 있는 표기)의 단어 경계를 초성 문자열에 반영.
 * 제목이 한글이면 제목 자체의 초성을 쓰고,
 * 아니면 발음 초성을 제목 단어별 음절 수에 맞춰 끊는다.
 * (괄호 안은 제외)
 */
function chosungWithTitleSpacing(spacedTitle: string, pronounced: string): string {
  const title = stripParenSections(spacedTitle)
  const titleChars = [...title.replace(NON_READING_CHARS, '')]
  const titleHangulN = titleChars.filter((ch) => /[가-힣]/.test(ch)).length
  if (titleChars.length && titleHangulN / titleChars.length >= 0.4) {
    // 초성은 한글 음절만 표현할 수 있다. 제목에 숫자·영문·가나가 섞여 있으면
    // 그 부분이 통째로 사라진다.
    //   "벌써 12시"        → "ㅂㅆ ㅅ"    (12 증발)
    //   "넌 is 뭔들"        → "ㄴ ㅁㄷ"    (is 증발)
    //   "강한 척하는 girl"  → "ㄱㅎ ㅊㅎㄴ" (girl 증발)
    // 전부 한글로 풀어 쓴 발음 표기가 있으면 그쪽을 쓴다.
    if (NON_HANGUL_READABLE.test(title) && !NON_HANGUL_READABLE.test(pronounced) && hasHangul(pronounced)) {
      return chosung(pronounced)
    }
    return chosung(title)
  }

  // \uc81c\ubaa9\uc774 \uc601\ubb38\u00b7\uac00\ub098\ub77c \uc81c\ubaa9 \ub2e8\uc5b4\ub85c\ub294 \ud55c\uae00 \uc74c\uc808\uc744 \uc140 \uc218 \uc5c6\ub2e4.
  // \uc774\ub54c \ubc1c\uc74c \ud45c\uae30 \uc790\uccb4\uac00 \ub744\uc5b4\uc4f0\uc5ec \uc788\uc73c\uba74(\uc608: "\ud310\ud0c0\uc2a4\ud2f1 \ubca0\uc774\ube44") \uadf8 \uacbd\uacc4\ub97c \uadf8\ub300\ub85c \uc4f4\ub2e4.
  // \uc608\uc804\uc5d0\ub294 \uc81c\ubaa9\uc758 \ud55c\uae00 \uae00\uc790 \uc218(\uc601\uc5b4 \ub2e8\uc5b4\ub294 0)\ub85c \ub04a\uc73c\ub824\ub2e4 \uc2e4\ud328\ud574 \uc804\ubd80 \ud55c \ub369\uc5b4\ub9ac\uac00 \ub410\ub2e4.
  if (/[\s\u3000]/.test(pronounced.trim())) {
    const byPronunciation = chosung(pronounced)
    if (byPronunciation.includes(' ')) return byPronunciation
  }

  const flat = chosung(pronounced).replace(/\s+/g, '')
  if (!flat) return chosung(pronounced)

  const words = title.split(/[\s\u3000]+/).filter(Boolean)
  const parts: string[] = []
  let pos = 0
  for (const w of words) {
    const n = [...w].filter((ch) => /[가-힣ㄱ-ㅎ]/.test(ch)).length
    if (n <= 0) continue
    parts.push(flat.slice(pos, pos + n))
    pos += n
  }
  if (pos < flat.length) parts.push(flat.slice(pos))
  return parts.filter(Boolean).join(' ')
}

/** 한국어 발음 → 초성 힌트 (띄어쓰기는 제목 표기 기준 · 괄호 안 제외) */
export function hintChosung(answer: string, accepts: string[] = []): string {
  const src = pickPronunciationSource(answer, accepts)
  const pronounced = hasHangul(src) ? src : toKoreanPronunciation(src)
  // 하이픈·슬래시·가운뎃점도 단어 경계다. ("Given-Taken" → 기븐 테이큰 = 2덩어리)
  const title = stripParenSections(answer.trim()).replace(/[-–—/·]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!title) return chosung(pronounced.replace(/[\s　]+/g, ''))
  // 괄호를 뗀 제목이 기준. 제목이 한글이면 제목 그대로 초성을 뽑으므로
  // "기도 (I'll Be Your Man)" 이 부제(아일 비 유어 맨)로 새지 않는다.
  const out = chosungWithTitleSpacing(title, pronounced)
  // 제목이 붙여쓰기면 초성도 붙여쓰기 (중복정답의 띄어쓰기는 무시)
  return /[\s　]/.test(title) ? out : out.replace(/\s+/g, '')
}

/** 두벌식 한글 → 한영키 안 누른 영타 (정답 → wjdekq) */
const CHO_TO_QWERTY = [
  'r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g',
] as const
const JUNG_TO_QWERTY = [
  'k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l',
] as const
const JONG_TO_QWERTY = [
  '', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g',
] as const
const JAMO_TO_QWERTY: Record<string, string> = {
  ㄱ: 'r', ㄲ: 'R', ㄴ: 's', ㄷ: 'e', ㄸ: 'E', ㄹ: 'f', ㅁ: 'a', ㅂ: 'q', ㅃ: 'Q',
  ㅅ: 't', ㅆ: 'T', ㅇ: 'd', ㅈ: 'w', ㅉ: 'W', ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g',
  ㅏ: 'k', ㅐ: 'o', ㅑ: 'i', ㅒ: 'O', ㅓ: 'j', ㅔ: 'p', ㅕ: 'u', ㅖ: 'P',
  ㅗ: 'h', ㅘ: 'hk', ㅙ: 'ho', ㅚ: 'hl', ㅛ: 'y',
  ㅜ: 'n', ㅝ: 'nj', ㅞ: 'np', ㅟ: 'nl', ㅠ: 'b',
  ㅡ: 'm', ㅢ: 'ml', ㅣ: 'l',
  ㄳ: 'rt', ㄵ: 'sw', ㄶ: 'sg', ㄺ: 'fr', ㄻ: 'fa', ㄼ: 'fq', ㄽ: 'ft', ㄾ: 'fx', ㄿ: 'fv', ㅀ: 'fg', ㅄ: 'qt',
}

export function hangulToQwertyMistype(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!
    if (code >= 0xac00 && code <= 0xd7a3) {
      const syl = code - 0xac00
      const cho = Math.floor(syl / 588)
      const jung = Math.floor((syl % 588) / 28)
      const jong = syl % 28
      out += CHO_TO_QWERTY[cho] + JUNG_TO_QWERTY[jung] + JONG_TO_QWERTY[jong]
      continue
    }
    if (JAMO_TO_QWERTY[ch]) {
      out += JAMO_TO_QWERTY[ch]
      continue
    }
    out += ch
  }
  return out
}

