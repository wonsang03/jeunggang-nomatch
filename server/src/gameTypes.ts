/**
 * 게임 런타임 타입.
 *
 * socket.ts 가 8천 줄을 넘기면서 "이 방에 무슨 상태가 있는지" 보려면
 * 핸들러 더미를 헤집어야 했다. 상태의 모양만 따로 떼어 둔다.
 * 런타임 코드는 없다 — 타입만 있으므로 옮겨도 동작이 바뀌지 않는다.
 */
import type { GameMode, ReadingState } from './readingMode.js'

export type SlotPublic = {
  id: string
  label: string
  revealed: boolean
  hidden: boolean
  unlocked: boolean
  answer?: string
  by?: string
  /** 초성 힌트 (라벨명과 무관 · 슬롯 단위) */
  chosung?: string
}
export type QuestionRuntime = {
  id: string
  youtubeUrl: string
  startSec: number
  endSec: number
  genre: string
  tags: string[]
  titleChosung: string
  artistChosung: string
  /** 제목만 모드에서 가수를 「정답이 아닌 힌트」로 보여줄 때의 표시값 (없으면 빈 문자열) */
  artistHint?: string
  slots: Array<{
    id: string
    label: string
    answer: string
    accepts: string[]
    /** normalizeAnswer 미리 계산 — 채점 핫패스용 */
    acceptNorms: string[]
    hidden: boolean
    chosung: string
  }>
}

/** 사용 시점부터 roundsLeft 동안 적용 (본인 버프는 이번 R 포함 · 상대 디버프는 보통 startIndex=다음 R) */
export type ActiveBuff = {
  name: string
  description: string
  effectType: string
  effectValue: Record<string, unknown>
  imageUrl: string | null
  usedByNickname: string
  /**
   * 시전자 userId. 영역전개·코로나·진흙탕처럼 시전자 본인에게도 같은 effectType이
   * 박히는 증강을 "남이 건 디버프"와 구분하려고 쓴다. 본인에게 저장되지 않는
   * 증강은 비워두면 되고, 그 경우 항상 남이 건 것으로 취급된다.
   */
  usedByUserId?: string
  startIndex: number
  roundsLeft: number
}

export type Member = {
  userId: string
  nickname: string
  avatarUrl: string | null
  ready: boolean
  score: number
  socketId: string
  /**
   * 연결이 끊긴 시각. null이면 접속 중.
   * 게임 중 끊긴 사람을 곧바로 내보내면 점수·증강이 통째로 사라지므로,
   * RECONNECT_GRACE_MS 동안 자리를 비워두고 기다린다.
   */
  disconnectedAt: number | null
  /** 관전: 채팅만 · 점수/증강/정답 미참여 */
  isSpectator: boolean
  /** 채팅 말풍선 색 인덱스 (0 ~ CHAT_COLOR_COUNT-1 · 관전자는 색 없음) */
  chatColor: number | null
  heldAugmentId: string | null
  heldAugmentName: string | null
  heldAugmentDescription: string | null
  heldAugmentImageUrl: string | null
  heldAugmentEffectType: string | null
  heldAugmentEffectValue: string | null
  heldAugmentTier: string | null
  usedAugments: string[]
  /** 이번 증강 선택 페이즈에서 이미 보여준 후보 id (리롤 시 제외) */
  offerSeenAugmentIds: string[]
  /** 지금 화면에 떠 있는 후보 3장 (타임아웃 랜덤은 여기서만) */
  lastOfferCandidateIds: string[]
  /** 가호선택: 고정 3장 후보 (리롤 없음) */
  gahoPickIds: string[] | null
  activeBuffs: ActiveBuff[]
  /** 엄→준→식 등 다단계 수집 */
  collectedPieces: string[]
  /** 채팅·제출 금지 (라운드 단위) */
  chatMute: { startIndex: number; roundsLeft: number; byName: string; byNickname: string } | null
  /** 쉬었음청년 소프트 뮤트: 이 시각까지 채팅·제출 차단 */
  chatMuteUntil: number | null
  /** 님아 매너좀: 라운드 시작 후 N초까지 제출 불가 */
  answerDelay: {
    startIndex: number
    roundsLeft: number
    delaySec: number
    byName: string
    byNickname: string
  } | null
  /** 예의바른청년/다요/진조이니라: 답 끝에 suffix 필수 */
  politeSuffix: {
    startIndex: number
    roundsLeft: number
    suffix: string
    byName: string
    byNickname: string
    /** 진조이니라 등: 정답 시 추가 점수 */
    bonus?: number
  } | null
  /** 쉬었음청년(구)·수면: 정답 인정 불가 (채팅은 가능) */
  answerBlock: {
    startIndex: number
    roundsLeft: number
    byName: string
    byNickname: string
  } | null
  /** 영역전개: 시각 기반 정답 불가 */
  answerBlockUntil: number | null
  answerBlockUntilBy: string | null
  /** 슬로우 스타터·야차 대상 등: 이 시각까지 노래 지연 */
  audioDelayUntil: number | null
  /** 야차룰 시전자: 대결 중 초성 즉시 */
  duelEarlyChosung: boolean
  /** 범인은 당신이야: 감시 라운드에 정답 시 → 다음 R 수면 */
  accuseMark: {
    watchIndex: number
    byName: string
    byNickname: string
  } | null
  /** 가불기: 정답 시 시전자에게 점수 이전 · 라운드 무득점 시 추가 이전 */
  gabuki: {
    startIndex: number
    roundsLeft: number
    casterUserId: string
    hitPenalty: number
    missPenalty: number
    byName: string
    byNickname: string
  } | null
  /** 신속정확대리: 대상 정답 → 결산 시 시전자 점수 */
  answerProxy: {
    targetUserId: string
    startIndex: number
    roundsLeft: number
    pendingScore: number
    byName: string
  } | null
  /** 트루먼쇼(환상) / 세노 등: 다른 곡 재생 · truman은 가짜 점수 */
  sakuraDecoy: {
    youtubeUrl: string
    startSec: number
    endSec: number
    startIndex: number
    roundsLeft: number
    scoreMult: number
    byName: string
    byNickname: string
    mode: 'truman' | 'classic'
    slots: Array<{ id: string; label: string; answer: string; accepts: string[]; acceptNorms: string[]; hidden: boolean; chosung: string }>
    fakeRevealed: Record<string, true>
    fakeScore: number
    /** 트루먼: 이미 들려준 디코이 yt (라운드마다 다른 곡) */
    usedDecoyYt: string[]
    genre: string
    titleChosung: string
    artistChosung: string
  } | null
  /** 불꽃남자김상원: 본인 고정곡 청취 · 정답 시 대상 점수 감소 */
  flameKim: {
    targetUserId: string
    targetNickname: string
    startIndex: number
    roundsLeft: number
    drain: number
    youtubeUrl: string
    startSec: number
    byName: string
  } | null
  /**
   * 쪼아요~: 대상이 «끝까지» 들어야 하는 벌칙 곡.
   * 라운드·스킵과 무관하게 곡이 끝날 때까지(또는 hardEndsAt까지) 유지된다.
   */
  peckSong: {
    /** 재생 세션 식별자 — 클라가 끝났다고 알릴 때 대조 */
    id: string
    youtubeUrl: string
    startSec: number
    startedAt: number
    /** 안전장치: 클라가 끝을 못 알려도 이 시각엔 해제 */
    hardEndsAt: number
    byName: string
    byNickname: string
  } | null
  /** 전원을 꺼봤습니다: 이 시각까지 노래 음소거(본인 제외 대상) */
  songMuteUntil: number | null
  /** 이번 라운드 본인 득점 합 (콤보 결산용) */
  roundScoreGain: number
}

export type Room = {
  id: string
  name: string
  hostId: string
  isPrivate: boolean
  code: string | null
  maxPlayers: number
  genreCounts: Record<string, number>
  /** 문제은행 장르별 보유 수 — 대기실 슬라이더 max */
  genreBankCounts: Record<string, number>
  /** 제목만(첫 비전 슬롯) | 제목+가수(전 슬롯, 히든 포함) */
  answerMode: 'title' | 'title_artist'
  /** false면 증강 선택 페이즈 생략 */
  augmentsEnabled: boolean
  /** 노맞(기본) | 리딩방(증강 OFF · 턴제 투표) */
  gameMode: GameMode
  /** 리딩방 목표 점수 */
  readingTargetScore: number
  reading: ReadingState | null
  /** 이 방에서 곡이 마지막으로 나온 판 번호 (questionId → gameSeq · 다음 뽑기 가중치↓) */
  songLastPlayed: Map<string, number>
  /** 이 방에서 시작한 판 번호. 판을 시작할 때마다 +1 */
  gameSeq: number
  /** 0=끔(균등 추첨) · 1=최근에 나온 곡일수록 덜 뽑힘 (기본 1) */
  recentSongPenalty: number
  members: Map<string, Member>
  status: 'lobby' | 'playing' | 'revealing' | 'augment' | 'countdown' | 'duel' | 'ended'
  queue: QuestionRuntime[]
  index: number
  roundEndsAt: number
  roundStartedAt: number
  roundDuration: number
  skipVotes: Set<string>
  revealed: Record<string, {
    answer: string
    by: string
    userId: string
    at?: number
    /** 선답자에게 준 슬롯 점수(중복 정답 우선 처리 시 회수용) */
    points?: number
    /** 선답 시 맞췄죠? 등으로 준 추가 점수 */
    wagerPts?: number
    /** 선답과 함께 일어난 점수 이전(가불기·불꽃남자) — 정답 취소 시 되돌림 */
    transfers?: Array<{ fromUserId: string; toUserId: string | null; amount: number }>
  }>
  /** 전부 맞춤 안내 채팅을 이번 라운드에 이미 보냈는지 */
  clearedHintSent: boolean
  timer: NodeJS.Timeout | null
  extraTimers: NodeJS.Timeout[]
  lastAugmentAt: number
  /** 이번 증강 선택: bronze | silver | gold 단일 등급 */
  augmentOfferLockedTier: 'bronze' | 'silver' | 'gold' | null
  /** 증강 선택 마감 시각 */
  augmentOfferEndsAt: number
  /** 점수가 2배: 이번 라운드 -1 이미 적용한 유저 */
  riskyBustApplied: Set<string>
  /** 맞췄죠?: 이번 라운드 성공 결산 완료한 유저 */
  wagerSettled: Set<string>
  /** 보너스 타임: 슬롯별 선답 후 추종 가능 창 */
  followAnswerWindow: Record<string, {
    at: number
    windowMs: number
    acceptNorms: string[]
    answer: string
    label: string
    hidden: boolean
    byUserId: string
  }>
  /** 보너스 타임: 슬롯별 이미 추종 득점한 유저 */
  followAnswerClaimed: Record<string, Set<string>>
  /** 미룬이의 가호: 이미 공개된 슬롯을 뒤늦게 맞힌 유저 */
  lateAnswerClaimed: Record<string, Set<string>>
  /** 야차룰 1v1 */
  duel: {
    challengerId: string
    opponentId: string
    question: QuestionRuntime
    penalty: number
    byName: string
    casterEarlyChosung: boolean
    targetAudioDelaySec: number
    resumeIndex: number
    /** 야차 시작 전 본게임 라운드 진행도 */
    savedRevealed: Record<string, { answer: string; by: string; userId: string }>
    savedRemainingMs: number
    savedRiskyBust: Set<string>
    savedWagerSettled: Set<string>
  } | null
  /** 라운드 진행 중 사용 시 → 다음 라운드 시작 때 발동 */
  pendingDuel: {
    challengerId: string
    opponentId: string
    penalty: number
    byName: string
    casterEarlyChosung: boolean
    targetAudioDelaySec: number
  } | null
  /** 야차 곡 고르는 중 — startRound 재진입 방지 */
  duelStarting: boolean
  /** 다음 라운드 발동 증강: 예약자는 즉시 알고, 전원은 실제 발동 때 알림 */
  pendingAugmentNotices: Array<{
    startIndex: number
    userId: string
    nickname: string
    name: string
    effectType: string
    description: string
    imageUrl: string | null
    tier?: string
    message: string
  }>
  /** 조로룰: 방 전체 스킵 금지 */
  /** 이번 라운드에 "재생 불가"를 보고한 userId. 라운드마다 비운다. */
  unplayableReports: Set<string>
  noSkip: {
    startIndex: number
    roundsLeft: number
    byName: string
    byNickname: string
  } | null
  /** 코로나: 채팅방 분리(격리조) */
  chatIsolate: {
    startIndex: number
    roundsLeft: number
    byName: string
    byNickname: string
    groupByUserId: Record<string, number>
  } | null
}
