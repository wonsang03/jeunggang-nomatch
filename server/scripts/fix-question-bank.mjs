/**
 * 문제은행 정확도 일괄 교정
 *   node scripts/fix-question-bank.mjs            # 미리보기 (파일 안 건드림)
 *   node scripts/fix-question-bank.mjs --write    # data/questions-dump.json 갱신
 *
 * 고치는 것
 *   1) 오답 처리되던 명백한 오류 (제목 오타·오역)
 *   2) 가수 표기 흔들림 통일
 *   3) 기호·숫자·악센트 때문에 못 맞히던 것 → 인정답 자동 보강
 *   4) 외래어 제목의 "띄어쓴 한글 별칭" 추가 (초성 띄어쓰기의 근거)
 *
 * ※ 인정답은 정규화(공백·일부 문장부호 무시) 후 완전 일치로 채점되므로
 *    별칭을 더 넣는 것은 안전하다. 지우지 않고 더하기만 한다.
 */
import fs from 'node:fs'
import path from 'node:path'

const FILE = path.resolve(process.argv.find((a) => a.endsWith('.json')) || 'data/questions-dump.json')
const WRITE = process.argv.includes('--write')
const dump = JSON.parse(fs.readFileSync(FILE, 'utf8'))

const hasHangul = (s) => /[가-힣]/.test(s)
const hasLatin = (s) => /[A-Za-z]/.test(s)
const hasKana = (s) => /[ぁ-んァ-ヴー一-龥]/.test(s)
const isTitleLabel = (l) => /제목|이름/.test(l)
const isArtistLabel = (l) => /가수|아티스트|커버/.test(l)

// ── 1. 명백한 오류 (제목/정답 자체가 틀린 것) ────────────────────
// key = 현재 answer, value = { answer?, add?[] }
const HARD_FIX = {
  // 오타: 정답에 'ㅑ'가 붙어 있고 그게 유일한 인정답이라 정상 제목이 오답 처리됨
  '사쿠라장의 애완그녀ㅑ': {
    answer: '사쿠라장의 애완그녀',
    add: ['사쿠라장의 애완그녀', '사쿠라장', 'さくら荘のペットな彼女'],
  },
  // 오타: 스비루 → 스바루
  '나츠키 스비루': { answer: '나츠키 스바루', add: ['나츠키 스바루', '나츠키스바루', '스바루'] },
  // 오역: ハルジオン = 하루지온(꽃) = 봄망초. 'Halcyon(할시온)'과 혼동된 표기
  '할시온': {
    answer: '봄망초',
    add: ['봄망초', '하루지온', '할시온', 'ハルジオン', 'Haruzion', 'Harujion'],
  },
  // 약칭이 인정답에 아예 없었음
  'Re: 제로부터 시작하는 이세계 생활': {
    add: ['리제로', 'Re제로', '리제로부터 시작하는 이세계 생활', 'Re:zero', 'rezero'],
  },
  // 한글 발음 별칭 누락
  '말해줘(言って)': { add: ['잇테', '잇떼', 'Itte'] },
  // 한글 인정답이 하나도 없던 곡
  RPG: { add: ['알피지', '아르피지'] },
  'SODA POP': { add: ['소다 팝', '소다팝'] },
  AKB48: { add: ['에이케이비 사십팔', '에이케이비사십팔', '에이케이비48', 'AKB'] },
  // 기호 없는 표기가 아예 없던 곡
  '팝핀 캔디☆피버!': { add: ['팝핀 캔디 피버', '팝핀캔디피버', '팝핀 캔디 피버!'] },
  // 오타: 토요탸 → 토요타
  '토요탸 AE86 스프린터 트레노': {
    answer: '토요타 AE86 스프린터 트레노',
    add: ['토요타 AE86 스프린터 트레노', '토요타 스프린터 트레노', '에이이 팔육'],
  },
  // 괄호 때문에 한글 비중이 낮아 기계 발음("네 라르르")으로 초성이 깨지던 곡
  '뉴 랠리(New Rally)': { add: ['뉴 랠리', '뉴랠리', '뉴 랠리 엑스', 'New Rally X'] },
  // 초성이 '퍼센트 퍼센트'(ㅍㅅㅌㅍㅅㅌ)로 나오던 곡.
  // pickPronunciationSource 가 "띄어쓰기 많은 후보"를 우선하는 탓이라,
  // 띄어쓴 '퍼센트 퍼센트'를 빼면 '응응'이 뽑혀 초성이 ㅇㅇ 이 된다.
  // 정규화가 공백을 지우므로 '퍼센트 퍼센트' 입력은 그대로 정답 인정된다.
  '%%': { add: ['응응', '퍼센트퍼센트'], drop: ['퍼센트 퍼센트'] },

  // ── 유튜브 영상 대조로 잡은 오류 (한국·일본·해외 노래 613곡 전수) ──
  // 혜성은 '은하'가 아니라 '윤하'. (은하는 여자친구 멤버 — 다른 사람)
  '은하': { answer: '윤하', add: ['윤하', 'YOUNHA', 'Younha', '윤하(YOUNHA)'] },
  // 오타: 앚기 → 아직, 끝에 '까' 누락. 원제 愛にできることはまだあるかい
  '사랑이 할 수 있는 일이 앚기 있을': {
    answer: '사랑이 할 수 있는 일이 아직 있을까',
    add: [
      '사랑이 할 수 있는 일이 아직 있을까', '사랑이할수있는일이아직있을까',
      '愛にできることはまだあるかい', 'Ai ni Dekiru Koto wa Mada Aru kai',
    ],
  },
  // ロキ 는 みきとP(미키토P). '미쿠P'는 하츠네 미쿠와 혼동된 표기
  '미쿠P': { answer: '미키토P', add: ['미키토P', '미키토피', 'みきとP', 'mikitoP', '미쿠P'] },

  // ── 초성 띄어쓰기용: 한글 발음이 붙여쓰기뿐이라 초성이 한 덩어리로 나오던 곡 ──
  // 초성은 발음 표기의 띄어쓰기를 그대로 따라가므로, 띄어쓴 한글 표기를 넣어준다.
  '넌 is 뭔들': { add: ['넌 이즈 뭔들', '넌이즈뭔들'] },                    // ㄴ ㅁㄷ → ㄴ ㅇㅈ ㅁㄷ
  '강한 척하는 girl': { add: ['강한 척하는 걸'] },                          // ㄱㅎㅊㅎㄴㄱ → ㄱㅎ ㅊㅎㄴ ㄱ
  '광란 Hey Kids!!': { add: ['광란 헤이 키즈', '광란 헤이 키드'] },          // ㄱㄹ ㅎㅇㅋㄷㅅ → ㄱㄹ ㅎㅇ ㅋㅈ
  'WASD : 토리의 모험': { add: ['더블유에이에스디 토리의 모험'] },           // 한 덩어리 → ㄷㅂㅇㅇㅇㅇㅅㄷ ㅌㄹㅇ ㅁㅎ
  'Something New (ft.헌서)': { add: ['썸띵 뉴', '섬씽 뉴'] },              // ㅆㄸㄴ → ㅆㄸ ㄴ
  // 제목이 "17살의 노래"(2단어)이므로 초성도 2덩어리가 맞다.
  // '열일곱 살의 노래'(3단어)는 띄어쓴 채로 두면 그쪽이 발음 소스로 뽑혀 3덩어리가 된다.
  '17살의 노래(17さいのうた。)': { add: ['십칠살의 노래', '열일곱살의노래'], drop: ['열일곱 살의 노래'] },
  // 괄호 안 설명문("가사 모르고 들으면 좋은 노래")이 발음 소스로 뽑혀
  // 초성이 제목(Dramatic Song)이 아니라 설명문의 초성으로 나왔다.
  // 띄어쓴 표기만 빼면 '드라마틱 송'이 뽑힌다. (붙여쓴 표기가 남아 정답 인정은 그대로)
  'Dramatic Song(가사 모르고 들으면 좋은 노래)': {
    add: ['드라마틱 송', '가사모르고들으면좋은노래', '영어모르면좋은노래'],
    drop: ['가사 모르고 들으면 좋은 노래', '영어 모르면 좋은 노래'],
  },
  '용과 같이 5: 꿈을 이루는자': { add: ['용과 같이 오: 꿈을 이루는자'] },     // 5 증발 → ㅇㄱ ㄱㅇ ㅇ ㄲㅇ ㅇㄹㄴㅈ

  // ── 검수표 행별 대조에서 나온 교정 ─────────────────────────
  // REALLY 는 '리얼리'. 띄어쓴 '릴리 릴리'가 발음 소스로 뽑혀 초성이 ㄹㄹ ㄹㄹ 였다.
  // 붙여쓴 '릴리릴리'는 남겨서 입력은 계속 정답 인정된다.
  'REALLY REALLY': { add: ['리얼리 리얼리', '릴리릴리'], drop: ['릴리 릴리'] },
  // 아래 둘은 화면에 뜨는 제목이 로마자인데 초성이 '번역 제목'으로 나오던 것.
  // 음역 표기를 앞으로 보내 초성을 제목과 맞춘다. (번역 표기도 계속 정답 인정)
  Something: { add: ['썸띵', '썸씽'], drop: ['썸씽'] },              // ㅆㅆ → ㅆㄸ
  imagination: { add: ['이미지네이션', '상상력'], drop: ['상상력'] },   // ㅅㅅㄹ(상상력) → ㅇㅁㅈㄴㅇㅅ

  // 하이픈·슬래시로 나뉜 제목 — 띄어쓴 한글 표기가 없어 초성이 한 덩어리였다.
  'Tick-Tack': { add: ['틱 택', '틱택'] },                      // ㅌㅌ → ㅌ ㅌ
  'Butter-Fly': { add: ['버터 플라이', '버터플라이'] },            // ㅂㅌㅍㄹㅇ → ㅂㅌ ㅍㄹㅇ
  'I-BULL': { add: ['아이 불', '아이불'] },                      // ㅇㅇㅂ → ㅇㅇ ㅂ
  // 오타: '더블유엑스와' 는 끝 '이'가 빠졌다 (W/X/Y = 더블유 엑스 와이)
  'W/X/Y': { add: ['더블유 엑스 와이', '더블유엑스와이'], drop: ['더블유엑스와'] },
  // STEREOTYPE 의 한국어 제목이 '색안경'. 초성(ㅅㅇㄱ)도 색안경 기준으로 나오고 있어
  // 화면에 뜨는 제목과 초성을 일치시킨다.
  STEREOTYPE: { answer: '색안경', add: ['색안경', 'STEREOTYPE', '스테레오타입'] },
}

// ── 유튜브 링크 교체 ────────────────────────────────────────────
const LINK_FIX = {
  // 곡 MV가 아니라 '좌표 인터뷰' 영상이 걸려 있었음 → DEANTRBL 공식 채널 영상으로
  'https://www.youtube.com/watch?v=FpqO6YtjwoI': 'https://www.youtube.com/watch?v=wKyMIrBClYw',
}

// ── 2. 가수 표기 통일 ───────────────────────────────────────────
// 정규화 키 → { answer: 대표표기, add: [...] }
const ARTIST_CANON = {
  mrsgreenapple: {
    answer: 'Mrs. GREEN APPLE',
    add: ['Mrs. GREEN APPLE', 'Mrs. Green Apple', 'MRS. GREEN APPLE', '미세스 그린 애플', '미세스그린애플', '미시즈 그린 애플'],
  },
  나나오아카리: { answer: '나나오 아카리', add: ['나나오 아카리', '나나오아카리', 'ナナヲアカリ', 'Nanawo Akari'] },
  honeyworks: { answer: 'HoneyWorks', add: ['HoneyWorks', 'honeyworks', '허니웍스', '하니웍스'] },
  세카이노오와리: {
    answer: 'SEKAI NO OWARI',
    add: ['SEKAI NO OWARI', '세카이노 오와리', '세카이노오와리', '세오와', '世界の終わり'],
  },
  // 이미 로마자로 적힌 슬롯도 같은 별칭을 받아야 한다
  sekainoowari: {
    answer: 'SEKAI NO OWARI',
    add: ['SEKAI NO OWARI', '세카이노 오와리', '세카이노오와리', '세오와', '世界の終わり'],
  },
}

// ── 3. 외래어 제목의 띄어쓴 한글 별칭 (초성 띄어쓰기 근거) ───────
const SPACED = {
  'FANTASTIC BABY': '판타스틱 베이비',
  'Hype Boy': '하입 보이',
  'Super Shy': '슈퍼 샤이',
  'Lucky Girl Syndrome': '럭키 걸 신드롬',
  'I AM': '아이 엠',
  'Feel Good': '필 굿',
  'Talk & Talk': '톡 앤 톡',
  'Stay This Way': '스테이 디스 웨이',
  'Black Mamba': '블랙 맘바',
  'Next Level': '넥스트 레벨',
  'Whatta Man (Good Man)': '왓타 맨',
  'Walking with you': '워킹 위드 유',
  'DJMAX RESPECT V': '디제이맥스 리스펙트 브이',
  'Maid My Way': '메이드 마이 웨이',
  'Berry Verry Strawberry': '베리 베리 스트로베리',
  'Hush Trap': '허쉬 트랩',
  'Poker Face': '포커 페이스',
  'KICK BACK': '킥 백',
  'To The Moon': '투 더 문',
  'For River': '포 리버',
  'Still Alive': '스틸 얼라이브',
  'Hopes And Dreams': '홉스 앤드 드림스',
  'His Theme': '히스 테마',
  'Stardew Valley': '스타듀 밸리',
  'GTA : San Andreas': '지티에이 산 안드레아스',
  'Second Run': '세컨드 런',
  'Passing Memories': '패싱 메모리즈',
  'Not A Hero': '낫 어 히어로',
  'JANE DOE': '제인 도',
  'Deja Vu': '데자 뷰',
  'Bunny Girl': '버니 걸',
  'DADDY! DADDY! DO!': '대디 대디 두',
  'God Knows': '갓 노우즈',
  'This game': '디스 게임',
  'Let Me Hear': '렛 미 히어',
  'Hacking to the Gate': '해킹 투 더 게이트',
  'Snow halation': '스노우 할레이션',
  'Don\'t say "lazy"': '돈트 세이 레이지',
  'Secret Base': '시크릿 베이스',
  'Only My Railgun': '온리 마이 레일건',
  'My dearest': '마이 디어리스트',
  'World Is Mine': '월드 이즈 마인',
  'BOW AND ARROW': '보우 앤드 애로우',
  'The WORLD': '더 월드',
  'THE HERO!!': '더 히어로',
  'Mixed Nuts': '믹스드 넛츠',
  'Dance In The Game': '댄스 인 더 게임',
  'Song of the Dead': '송 오브 더 데드',
  'DAYBREAK FRONTLINE': '데이브레이크 프론트라인',
  'All I Want For Christmas Is You': '올 아이 원트 포 크리스마스 이즈 유',
  'SODA POP': '소다 팝',
  'T.T. STAR': '티티 스타',
  'BE MY STAR': '비 마이 스타',
  'Roller Coaster': '롤러 코스터',
  'WA DA DA': '와 다 다',
  'ライラック(LILAC, 라일락)': '라일락',
  'Englishman In New York': '잉글리시맨 인 뉴욕',
  'My Love (And)': '마이 러브',
}

// ── 4. 숫자가 들어간 제목·가수 (전 31종 수동 확인) ──────────────
// 자동 생성은 'fromis_ 구' 같은 쓰레기를 만들어서 손으로 적는다.
const NUM_FIX = {
  'fromis_9': ['프로미스9', '프로미스 9'],
  'DAY6': ['데이 식스', '데이6'],
  '404 (New Era)': ['사백사', '사영사', '사공사 뉴 에라', '사백사 뉴 에라'],
  '...사랑했잖아...(2024)': ['사랑했잖아 이천이십사', '사랑했잖아 이영이사'],
  '10CM': ['십센티', '텐센치', '텐센티', '10센치', '10센티'],
  '하트111(ハート111)': ['하트 일일일', '하트 백십일', '하트백십일', '하트 원원원'],
  '용과 같이 5: 꿈을 이루는자': ['용과 같이 5', '용과같이5', '용과 같이 오', '용과 같이 파이브'],
  '2002': ['이영영이', '투제로제로투'],
  'Day 1': ['데이원', '데이 일'],
  '메가맨 2': ['메가맨 투', '메가맨 이', '메가맨이'],
  '4월은 너의 거짓말': ['사월은 너의 거짓말'],
  '86-에이티식스-': ['팔십육', '팔육', '에이티 식스'],
  '괴수 8호': ['괴수 팔호', '괴수팔호'],
  '3월의 라이온': ['삼월의 라이온'],
  '좀100': ['좀 백', '좀 일영영'],
  '12시 30분': ['열두시 삼십분', '열두시삼십분', '십이시 삼십분', '십이시삼십분'],
  '벌써 12시': ['벌써 열두시', '벌써열두시', '벌써 십이시', '벌써십이시'],
  'NCT 127': ['엔시티 일이칠', '엔시티일이칠', '엔시티 백이십칠'],
  '0X1=LOVESONG': ['0X1 LOVESONG', '0X1러브송', '0X1 러브송', '영엑스일 러브송', '제로바이원 러브송', '러브 송'],
  'Love 119': ['러브 119', '러브119', '러브 일일구', '러브일일구', '러브 백십구', '러브백십구'],
  'AKB48': ['에이케이비 포티에이트', '에이케이비포티에이트'],
}

const SYMBOL_READ = {
  '&': ['앤드', '앤'],
  '＆': ['앤드', '앤'],
  '%': ['퍼센트'],
  '+': ['플러스'],
  '∞': ['인피니티'],
}

/** 악센트 제거: Beyoncé → Beyonce, KHÔNG → KHONG */
const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')

/**
 * 정규화가 안 지우는 기호를 떼어낸 표기.
 * ー(장음부호)는 일본어 표기의 일부라 건드리지 않는다.
 */
const stripSymbols = (s) =>
  s
    .replace(/[,=&＆%+#$*※☆★♪♡♥❗❓✋♿💦😁]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** 한 슬롯에 추가할 별칭 계산 — 안전한 것만 */
function generateAliases(answer, accepts) {
  const add = new Set()
  for (const base of [answer, ...accepts]) {
    // 기호 제거형 · 악센트 제거형 (항상 안전)
    const st = stripSymbols(base)
    if (st && st !== base) add.add(st)
    const da = deaccent(base)
    if (da !== base) add.add(da)
    const both = deaccent(st)
    if (both && both !== base) add.add(both)

    // 기호 한글 읽기 — 원문이 한글 위주일 때만 (영문에 끼워 넣으면 쓰레기가 됨)
    if (hasHangul(base) && !hasLatin(base)) {
      for (const [sym, reads] of Object.entries(SYMBOL_READ)) {
        if (!base.includes(sym)) continue
        for (const r of reads) add.add(base.split(sym).join(r).replace(/\s+/g, ' ').trim())
      }
    }
  }
  return [...add]
}

// ── 실행 ───────────────────────────────────────────────────────
const norm = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[.'"()[\]{}<>~\-_/\\|:;!?]/g, '')

const log = { hard: [], artist: [], spaced: [], num: [], link: [], auto: 0, slots: 0 }

for (const q of dump.questions) {
  const nl = LINK_FIX[q.youtubeUrl]
  if (nl) {
    log.link.push(`${q.youtubeUrl}  →  ${nl}`)
    q.youtubeUrl = nl
  }
  for (const s of q.slots) {
    let accepts = []
    try {
      accepts = JSON.parse(s.acceptAnswers || '[]')
    } catch {
      accepts = []
    }
    const before = new Set(accepts.map(norm))
    const push = (v) => {
      const t = String(v).trim()
      if (t && !accepts.some((a) => a === t)) accepts.push(t)
    }

    // 1) 하드 픽스
    const hf = HARD_FIX[s.answer]
    if (hf) {
      const old = s.answer
      if (hf.answer) s.answer = hf.answer
      // drop 을 먼저 — 그래야 add 로 다시 넣을 때 원하는 순서로 들어간다.
      // 발음 소스는 동점이면 앞에 있는 후보가 뽑히므로 순서가 초성을 좌우한다.
      if (hf.drop) accepts = accepts.filter((a) => !hf.drop.includes(a))
      ;(hf.add || []).forEach(push)
      push(s.answer)
      log.hard.push(`${old}${hf.answer ? ` → ${hf.answer}` : ''}`)
    }

    // 2) 가수 표기 통일
    if (isArtistLabel(s.label)) {
      const canon = ARTIST_CANON[norm(s.answer)]
      if (canon) {
        if (s.answer !== canon.answer) log.artist.push(`${s.answer} → ${canon.answer}`)
        s.answer = canon.answer
        canon.add.forEach(push)
      }
    }

    // 3) 띄어쓴 한글 별칭
    const sp = SPACED[s.answer]
    if (sp && isTitleLabel(s.label)) {
      if (!accepts.includes(sp)) log.spaced.push(`${s.answer}  →  "${sp}"`)
      push(sp)
    }

    // 4) 숫자 표기 (수동 확인 테이블)
    const nf = NUM_FIX[s.answer]
    if (nf) {
      nf.forEach(push)
      log.num.push(s.answer)
    }

    // 5) 기계적 별칭 (기호·악센트)
    generateAliases(s.answer, accepts).forEach(push)

    // answer 자신은 항상 인정답에 포함
    push(s.answer)

    const added = accepts.filter((a) => !before.has(norm(a))).length
    if (added) {
      log.auto += added
      log.slots++
    }
    s.acceptAnswers = JSON.stringify(accepts)
  }
}

console.log('── 1. 오류 교정 ─────────────────────────')
log.hard.forEach((x) => console.log('  ' + x))
console.log('\n── 2. 가수 표기 통일 ────────────────────')
log.artist.forEach((x) => console.log('  ' + x))
console.log('\n── 3. 띄어쓴 한글 별칭 추가 ─────────────')
log.spaced.forEach((x) => console.log('  ' + x))
console.log('\n── 4. 숫자 표기 보강 ────────────────────')
console.log('  ' + [...new Set(log.num)].join(' · '))
console.log('\n── 합계 ────────────────────────────────')
console.log(`  ${log.slots}개 슬롯에 인정답 ${log.auto}개 추가`)

if (WRITE) {
  dump.exportedAt = new Date().toISOString()
  fs.writeFileSync(FILE, JSON.stringify(dump, null, 0))
  console.log(`\n✅ 저장됨: ${FILE}`)
  console.log('   반영: node scripts/import-questions-dump.mjs')
} else {
  console.log('\n(미리보기 — 저장하려면 --write)')
}
