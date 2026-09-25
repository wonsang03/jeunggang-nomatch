import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useGame } from '../GameContext'
import { playSfx } from '../sfx'
import { serverNow } from '../clockSync'
import type { Screen } from './types'
import {
  AppliedAugmentChip,
  AugmentNoPhoto,
  AugmentTargetBadge,
  Btn,
  C,
  crumpledPaper,
  Equalizer,
  F,
  FitAnswer,
  FloatingHoverPopup,
  GenreIntroFly,
  HOSTILE_AUGMENT_TYPES,
  prismBackdrop,
  PrismKeyframes,
  RoundTimer,
  sk,
  SketchInput,
  tierBorderColor,
  tierDisplayName,
} from '../ui'
import { PingText } from '../components/PingStatus'
import { useStickyChatScroll } from '../components/useStickyChatScroll'
import { GameScoreboard, GameLogList, GameChatList } from '../components/GameLists'

export function GameScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, chats, round, skip, skipVoted, augmentHint, startCountdown, musicVolume, setMusicVolume, sfxVolume, setSfxVolume, submitAnswer, sendChat, voteSkip, useAugment, fetchGahoCandidates, leaveRoom, connected, readingAccept, readingPass, readingClaim, readingVote } = useGame()
  const [input, setInput] = useState('')
  const [showUsedList, setShowUsedList] = useState(false)
  /** 2칸일 때 어느 카드를 쓸지 */
  const [heldPickId, setHeldPickId] = useState<string | null>(null)
  const [augHover, setAugHover] = useState(false)
  const [augHoverAnchor, setAugHoverAnchor] = useState<DOMRect | null>(null)
  const [queueHover, setQueueHover] = useState(false)
  const [queueHoverAnchor, setQueueHoverAnchor] = useState<DOMRect | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [targetPickOpen, setTargetPickOpen] = useState(false)
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([])
  const [genrePickOpen, setGenrePickOpen] = useState(false)
  const [gahoPickOpen, setGahoPickOpen] = useState(false)
  const [gahoCandidates, setGahoCandidates] = useState<Array<{
    id: string
    name: string
    description?: string
    tier: string
    imageUrl?: string | null
  }>>([])
  const [gahoBusy, setGahoBusy] = useState(false)
  const [chatCardHover, setChatCardHover] = useState<number | null>(null)
  const [chatCardAnchor, setChatCardAnchor] = useState<DOMRect | null>(null)
  const [appliedCardHover, setAppliedCardHover] = useState<{
    name: string
    description: string
    imageUrl?: string | null
    hostile: boolean
    meta?: string
  } | null>(null)
  const [appliedCardAnchor, setAppliedCardAnchor] = useState<DOMRect | null>(null)
  const [now, setNow] = useState(() => serverNow())
  const [genreSettled, setGenreSettled] = useState(true)
  const [genreIntroActive, setGenreIntroActive] = useState(false)
  // 야차룰 당사자에게는 관전 채팅이 안 보인다 (early return 전이라 옵셔널 접근)
  const isDuelistForChat = !!(
    room?.duel && user
    && (room.duel.challengerId === user.id || room.duel.opponentId === user.id)
  )
  // 사람 채팅 / 시스템 로그를 나눠 각각 따로 스크롤한다
  const playerChats = useMemo(
    () => chats.filter((m) => !m.system && !(m.spectator && isDuelistForChat)),
    [chats, isDuelistForChat],
  )
  const logChats = useMemo(() => chats.filter((m) => m.system), [chats])
  const {
    scrollRef: chatRef,
    contentRef: chatContentRef,
    stick: chatStickBottom,
    hasNew: chatHasNew,
    onScroll: onChatScrollBase,
    onWheel: onGameChatWheel,
    jumpToLatest: jumpToLatestGameChat,
  } = useStickyChatScroll(playerChats)
  const {
    scrollRef: logRef,
    contentRef: logContentRef,
    onScroll: onLogScroll,
    onWheel: onLogWheel,
  } = useStickyChatScroll(logChats)
  const answerInputRef = useRef<HTMLInputElement>(null)
  const genreSlotRef = useRef<HTMLDivElement>(null)
  const genreIntroRoundRef = useRef<number | null>(null)

  // 단축키(K=스킵, R=증강 사용) · 렌더마다 최신 상태로 갱신되는 핸들러를 ref에 담는다
  const hotkeyRef = useRef<(action: 'skip' | 'augment' | 'focusInput') => boolean>(() => false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return
      if (e.isComposing || e.keyCode === 229) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      // 입력창·채팅창에 커서가 있으면 그냥 글자로 (정답 타이핑 방해 금지)
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      const key = e.key.toLowerCase()
      // 한글 자판이어도 자리로 잡히게 e.code 우선
      const action: 'skip' | 'augment' | 'focusInput' | null =
        (e.code === 'KeyK' || key === 'k') ? 'skip'
        : (e.code === 'KeyR' || key === 'r') ? 'augment'
        : (e.key === 'Enter') ? 'focusInput'
        : null
      if (!action) return
      // 모달이 떠 있는 등 처리하지 않은 경우엔 기본 동작을 막지 않는다
      if (hotkeyRef.current(action)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const settleGenreIntro = useCallback(() => {
    setGenreIntroActive(false)
    setGenreSettled(true)
  }, [])

  useEffect(() => {
    if (!room) nav('lobby')
    else if (room.status === 'augment') nav('augment')
    else if (room.status === 'ended') nav('result')
    else if (room.status === 'lobby') nav('waiting')
  }, [room, nav])

  // 1초 간격으로 그냥 돌면 "남은 초"가 바뀌는 순간과 틱이 어긋나 최대 1초까지 늦게 보인다.
  // 라운드 링(RoundTimer, 250ms)과 숫자가 서로 다른 값을 가리키고, timer로 판정하는
  // 초성 힌트 공개 시점도 사람마다 1초씩 밀린다. 남은 초가 바뀌는 순간에 맞춰 깨운다.
  const roundEndsAtForTick = round?.endsAt ?? null
  useEffect(() => {
    let id = 0
    const tick = () => {
      const n = serverNow()
      setNow(n)
      const untilNextSecond = roundEndsAtForTick != null
        ? ((roundEndsAtForTick - n) % 1000 + 1000) % 1000
        : 1000 - (n % 1000)
      id = window.setTimeout(tick, untilNextSecond || 1000)
    }
    tick()
    return () => window.clearTimeout(id)
  }, [roundEndsAtForTick])
  // 3-2-1 오버레이는 느린 틱이면 남은 초가 부풀어 4가 잠깐 보임 → 빠르게
  useEffect(() => {
    const overlayOn = (startCountdown != null && startCountdown > 0)
      || room?.reading?.phase === 'pre_solve'
    if (!overlayOn) return
    setNow(serverNow())
    const t = setInterval(() => setNow(serverNow()), 100)
    return () => clearInterval(t)
  }, [startCountdown, room?.reading?.phase])

  // 노래(라운드) 시작 시 장르 인트로: 크게 → 자리로 축소 페이드
  useEffect(() => {
    if (!room || !round) return
    if (round.duel) {
      setGenreIntroActive(false)
      setGenreSettled(true)
      return
    }
    if (room.status === 'countdown') {
      setGenreIntroActive(false)
      setGenreSettled(false)
      return
    }
    if (room.status !== 'playing') return
    if (genreIntroRoundRef.current === round.index) return
    genreIntroRoundRef.current = round.index
    setGenreSettled(false)
    setGenreIntroActive(true)
  }, [room?.status, round?.index, round?.duel])

  const onGameChatScroll = () => {
    // 스크롤하면 붙어 있던 호버 카드는 자리가 어긋나므로 닫는다
    if (chatCardHover != null) {
      setChatCardHover(null)
      setChatCardAnchor(null)
    }
    onChatScrollBase()
  }

  if (!room || !user) return null

  const me = room.members.find(m => m.userId === user.id)
  const isSpectator = !!me?.isSpectator
  const timer = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0
  const maxTime = round?.duration || 40
  const openSlots = (round?.slots || []).filter(s => !s.hidden)
  const hiddenSlot = round?.slots.find(s => s.hidden)
  const genreHidden = !!(hiddenSlot || round?.hasHidden)
  const genreColor = genreHidden ? C.red : C.blue
  const spoilArtists = (me?.knowSpoilArtist || '')
    .split(/\s*,\s*/)
    .map(s => s.trim())
    .filter(Boolean)
  const spoilBySlot = me?.knowSpoilSlots || null
  const hiddenRevealed = hiddenSlot?.revealed ? (hiddenSlot.answer || null) : null
  const hiddenSpoil = hiddenSlot && spoilBySlot?.[hiddenSlot.id] ? spoilBySlot[hiddenSlot.id] : null
  const openAllDone = openSlots.length > 0 && openSlots.every(s => s.revealed)
  const showHidden = !!hiddenSlot && (
    hiddenSlot.unlocked
    || openAllDone
    || (!!me?.alienQwertyActive && !!hiddenSpoil)
    || !!me?.hiddenPreview
  )
  const answerDelayLocked = !!(me?.answerDelayUnlockAt && now < me.answerDelayUnlockAt)
  const answerDelayLeftSec = answerDelayLocked
    ? Math.max(0, Math.ceil((me!.answerDelayUnlockAt! - now) / 1000))
    : 0
  const duel = room.duel
  const inDuel = room.status === 'duel'
  const isDuelist = !!(duel && user && (duel.challengerId === user.id || duel.opponentId === user.id))
  const duelSpectating = inDuel && !!duel && !isDuelist
  const submitBlocked = !!me?.chatMuted || answerDelayLocked
  const visibleChats = chats.filter((msg) => !(msg.spectator && isDuelist))
  const hoveredChatCard = chatCardHover != null
    ? visibleChats.find((c) => c.id === chatCardHover)?.augmentCard
    : null
  // 순위표 memo가 먹히도록 room:state가 올 때만 새 배열을 만든다
  const members = room.members
  const ranked = useMemo(
    () => members.filter((m) => !m.isSpectator).sort((a, b) => b.score - a.score),
    [members],
  )
  const spectators = useMemo(() => members.filter((m) => m.isSpectator), [members])
  // 채팅 색·프로필 사진은 멤버 목록에서 가져온다 (색을 바꾸면 지난 말풍선도 같이 바뀜)
  const chatMetaByUser = useMemo(() => {
    const out: Record<string, { color: number | null; avatarUrl: string | null }> = {}
    for (const m of members) {
      out[m.userId] = {
        color: m.isSpectator ? null : (m.chatColor ?? null),
        avatarUrl: m.avatarUrl ?? null,
      }
    }
    return out
  }, [members])
  const myBuffs = me?.activeBuffs || []
  const deafMode = myBuffs.some(b => b.active && (
    b.effectType === 'score_mult_hint_only' || b.effectType === 'mud_fight'
  ))
  const mudBuff = myBuffs.find(b => b.active && b.effectType === 'mud_fight')
  const inCountdown = room.status === 'countdown'
  const songPlaybackRate = (!inDuel && me?.playbackRate && me.playbackRate > 0 && me.playbackRate !== 1)
    ? me.playbackRate
    : 1
  // 보유 슬롯은 최대 2칸 (혼돈 2장 · 인수인계로 떠넘겨진 잠긴 카드).
  // 사용 UI는 «지금 고른 카드» 하나를 기준으로 돈다.
  const heldCards = me?.heldAugments || []
  const usableHeldCards = heldCards.filter((h) => !h.locked)
  const heldCard = usableHeldCards.find((h) => h.id === heldPickId) || usableHeldCards[0] || null
  /** 잠긴 카드만 들고 있어도 칸은 보여준다 */
  const displayCard = heldCard || heldCards[0] || null
  const heldId = heldCard?.id || null
  const heldEffectType = heldCard?.effectType || null
  const heldName = displayCard?.name || null
  const heldDescription = displayCard?.description || null
  const heldImageUrl = displayCard?.imageUrl || null
  const heldTier = displayCard?.tier || null

  const needsTargetPick = !isSpectator && (
    heldEffectType === 'soft_chat_mute'
    || heldEffectType === 'slow_playback'
    || heldEffectType === 'answer_proxy'
    || heldEffectType === 'named_decoy'
    || heldEffectType === 'peck_song'
    || heldEffectType === 'sakura_decoy'
    || heldEffectType === 'answer_delay'
    || heldEffectType === 'yacha_duel'
    || heldEffectType === 'polite_suffix'
    || heldEffectType === 'rock_throw'
    || heldEffectType === 'steal_chain'
    || heldEffectType === 'score_steal'
    || heldEffectType === 'zero_both'
    || heldEffectType === 'muffled_answer'
    || heldEffectType === 'accuse_sleep'
    || heldEffectType === 'gabuki_mark'
    || (heldEffectType === 'flame_kim' && room.members.filter((m) => !m.isSpectator).length >= 2)
    || heldEffectType === 'steal_held_augment'
    || heldEffectType === 'hide_hints'
    || heldEffectType === 'audio_stutter'
    || heldEffectType === 'score_share'
    || heldEffectType === 'destroy_held_augment'
  )
  const isTrumanTargetPick = heldEffectType === 'sakura_decoy'
  const heldNeedsDebuffFree = !!(heldEffectType && HOSTILE_AUGMENT_TYPES.has(heldEffectType))
  const targetCandidates = room.members.filter((player) => (
    player.userId !== user.id
    && !player.isSpectator
    && (!heldNeedsDebuffFree || !player.augmentBusy)
    && (heldEffectType !== 'steal_held_augment' || (player.heldAugments || []).some((h) => !h.locked))
  ))
  const busyTargets = heldNeedsDebuffFree
    ? room.members.filter((player) => (
      player.userId !== user.id
      && !player.isSpectator
      && !!player.augmentBusy
    ))
    : []
  const isAutoAugment = heldEffectType === 'water_ghost'
    || heldEffectType === 'combo_clear_double'
  const isPassiveHeld = heldEffectType === 'reflect_debuff'
  const isAutoTriggerHeld = heldEffectType === 'cha_cha_cha'
  const useLocked = isSpectator || isAutoAugment || isPassiveHeld || isAutoTriggerHeld
  const needsGahoPick = !isSpectator && heldEffectType === 'gaho_select'
  const needsGenrePick = !isSpectator
    && (heldEffectType === 'ban_genre' || heldEffectType === 'genre_early_chosung')
  const genrePickIsBan = heldEffectType === 'ban_genre'
  const upcomingGenreEntries = Object.entries(room.upcomingGenreCounts || {})
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
  /** 이번 곡 포함 남은 장르별 잔량 (호버용) */
  const remainingGenreEntries = (() => {
    const counts: Record<string, number> = { ...(room.upcomingGenreCounts || {}) }
    if (round?.genre && (room.status === 'playing' || room.status === 'revealing' || room.status === 'duel')) {
      counts[round.genre] = (counts[round.genre] || 0) + 1
    }
    return Object.entries(counts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
  })()
  const remainingTotal = remainingGenreEntries.reduce((s, [, c]) => s + c, 0)

  const openGahoPick = async () => {
    setGahoBusy(true)
    setGahoPickOpen(true)
    try {
      const { candidates } = await fetchGahoCandidates()
      setGahoCandidates(candidates)
    } finally {
      setGahoBusy(false)
    }
  }
  const reading = room.reading
  const isReading = (room.gameMode || 'nomatch') === 'reading'

  // 모달이 떠 있으면 단축키 무시
  const hotkeyBlocked = leaveOpen || targetPickOpen || genrePickOpen || gahoPickOpen || showUsedList
  hotkeyRef.current = (action) => {
    if (hotkeyBlocked) return false
    if (action === 'focusInput') {
      const el = answerInputRef.current
      if (!el) return false
      el.focus()
      return true
    }
    if (action === 'skip') {
      if (isSpectator || isReading || skipVoted || room.status !== 'playing' || inDuel) return false
      if (room.noSkipActive) return false
      voteSkip()
      return true
    }
    if (!heldId || useLocked) return false
    if (needsGahoPick) void openGahoPick()
    else if (needsTargetPick) {
      setSelectedTargetIds([])
      setTargetPickOpen(true)
    }
    else if (needsGenrePick) setGenrePickOpen(true)
    else useAugment({ augmentId: heldId || undefined })
    return true
  }
  const isReadingSolver = !!(reading && reading.solverId === user.id)
  const readingPhase = reading?.phase
  /** 리딩: 도전 전 숨김 · 투표/준비는 유권자만 · 풀이·결과는 전원(장르+？？？) */
  const showReadingSongInfo = (() => {
    if (!isReading || !readingPhase) return false
    if (readingPhase === 'vote' || readingPhase === 'pre_solve') return !isReadingSolver
    if (readingPhase === 'solve' || readingPhase === 'reveal') return true
    return false
  })()

  const noHintMode = !!me?.hintsHidden
    || myBuffs.some(b => b.active && (b.effectType === 'score_mult_no_hint' || b.effectType === 'hide_hints'))
  const songPowerOff = !!(me?.songMuteUntil && now < me.songMuteUntil)
  const stutterMuted = (() => {
    const st = me?.audioStutter
    if (!st || inCountdown || room.status !== 'playing') return false
    const onMs = Math.max(50, st.onMs || 1000)
    const offMs = Math.max(50, st.offMs || 1000)
    const cycle = onMs + offMs
    const started = round?.endsAt != null && round?.duration
      ? round.endsAt - round.duration * 1000
      : null
    if (started == null) return false
    const elapsed = Math.max(0, now - started)
    return (elapsed % cycle) >= onMs
  })()
  const songPowerOffLeft = songPowerOff
    ? Math.max(0, Math.ceil((me!.songMuteUntil! - now) / 1000))
    : 0
  // 방 노래(정답 곡) / 증강 트릭 노래 = HiddenYouTube 2개
  // audioTrick.mode
  //   replace  → 세노·트루먼·에라모르겠다·진흙탕 (방 곡 끔, 트릭만)
  //   overlay  → 불꽃남자·풍악 (방 곡 + 트릭 동시)
  const audioTrick = !inDuel ? (me?.audioTrick ?? null) : null
  // 방/트릭/증강 BGM 은 App 루트 RoomSongPersistentBgm
  const showGenre = isReading
    ? showReadingSongInfo
    : (!noHintMode && audioTrick?.source !== 'mud')
  // 초성은 위쪽 슬롯 칸, 증강 정답 안내는 증강 적용 칸
  // 같은 라벨 N개 → 한 칸에 「A / B」로 합치고, 종류(칸) 수만큼 동일 비율
  // 초성: 라벨(제목/가수)이 아니라 open 슬롯 역순 — 마지막 슬롯부터 10초 간격으로 공개
  // 예) 2슬롯 → 2번 ≤20초, 1번 ≤10초 / 3슬롯 → 3·2·1 = ≤30·20·10
  const openIndexById = new Map(openSlots.map((s, i) => [s.id, i]))
  const slotChosungDue = (slotId: string) => {
    if (isReading || inCountdown || noHintMode) return false
    if (deafMode || me?.earlyChosungActive) return true
    const idx = openIndexById.get(slotId)
    if (idx == null) return false
    return timer <= 10 * (idx + 1)
  }
  const slotGroups: Array<{ label: string; slots: typeof openSlots }> = []
  for (const slot of openSlots) {
    const g = slotGroups.find((x) => x.label === slot.label)
    if (g) g.slots.push(slot)
    else slotGroups.push({ label: slot.label, slots: [slot] })
  }
  const slotDisplays = (isReading && !showReadingSongInfo)
    ? []
    : slotGroups.map((group) => {
    const isArtist = group.label.includes('가수') || group.label.includes('커버') || group.label.includes('캐릭터')
    const isTitleLike = group.label.includes('제목') || group.label.includes('게임')
    const parts = group.slots.map((slot, i) => {
      if (slot.revealed && slot.answer) return slot.answer
      if (spoilBySlot?.[slot.id]) return spoilBySlot[slot.id]
      if (isArtist && spoilArtists[i]) return spoilArtists[i]
      if (isArtist && group.slots.length === 1 && me?.knowSpoilArtist) return me.knowSpoilArtist
      if (isTitleLike && me?.knowSpoilTitle) return me.knowSpoilTitle
      return ''
    })
    const dueChosungs = group.slots.map((slot) => (
      slotChosungDue(slot.id) ? (slot.chosung || '').trim() : ''
    ))
    const anyRevealed = group.slots.some((s, i) => s.revealed || !!parts[i])
    const allRevealed = group.slots.every((s, i) => s.revealed || !!parts[i])
    const value = anyRevealed
      ? parts.map((p) => p || '？？？').join(' / ')
      : null
    let hint: string | null = null
    if (isReading) {
      // 리딩: 초성 없이 미공개면 ？？？ + 장르만
      if (!anyRevealed) hint = '？？？'
    } else if (!allRevealed && !inCountdown && !noHintMode) {
      if (!anyRevealed) {
        if (dueChosungs.every(Boolean)) hint = dueChosungs.join(' / ')
        else if (dueChosungs.some(Boolean)) {
          hint = dueChosungs.map((h) => h || '？？？').join(' / ')
        }
      }
    }
    // 일부만 맞힌 경우 value에 초성/？？？ 섞어 표시
    const displayValue = anyRevealed && !allRevealed && dueChosungs.some(Boolean) && !inCountdown && !noHintMode && !isReading
      ? parts.map((p, i) => p || dueChosungs[i] || '？？？').join(' / ')
      : value
    return {
      key: group.label,
      label: group.label,
      value: displayValue,
      hint: !anyRevealed ? hint : null,
      revealed: anyRevealed,
    }
  })

  // 제목만 모드 가수 힌트 — 서버가 한국·일본·해외 장르에만 실어 보낸다
  // 초성처럼 바로 주지 않고 남은 시간 20초부터 공개
  const ARTIST_HINT_DUE_SEC = 20
  const artistHintDue = timer <= ARTIST_HINT_DUE_SEC
  const artistHintText = (!isReading && !inDuel && !inCountdown && !noHintMode && artistHintDue)
    ? (round?.artistHint || '').trim()
    : ''

  // 다음 R 예약(pending) 적대 효과는 발동 전까지 적용 칸·요약에 안 보임 (대상 미리보기 방지).
  // 단 내가 건 것(영역전개·코로나·진흙탕)은 남겨야 발동 여부를 확인할 수 있다.
  const visibleBuffs = myBuffs.filter((b) => {
    if (b.frozen || b.active) return true
    if (b.pending) {
      const fromOther = !!(b.usedByNickname && b.usedByNickname !== user.nickname)
      return !HOSTILE_AUGMENT_TYPES.has(b.effectType) || !fromOther
    }
    return false
  })
  const scoreMult = Math.max(
    1,
    ...myBuffs.filter(b => b.active && b.mult).map(b => b.mult || 1),
    me?.sakuraActive && me.sakuraScoreMult ? me.sakuraScoreMult : 1,
  )
  const activeBuffLabel = [
    ...visibleBuffs.map(b => {
      const multPart = b.mult && b.mult > 1 ? ` ×${b.mult}` : ''
      const ratePart = b.rate && b.rate !== 1 ? ` ×${b.rate}배속` : ''
      if (b.frozen) return `${b.name} ${b.roundsLeft}R(정지)${multPart}${ratePart}`
      return b.pending ? `${b.name}(대기)${multPart}${ratePart}` : `${b.name} ${b.roundsLeft}R${multPart}${ratePart}`
    }),
    me?.sakuraActive
      ? `${me.sakuraBy || '다른 곡'}${me.sakuraScoreMult && me.sakuraScoreMult > 1 ? ` · 정답×${me.sakuraScoreMult}` : ''} · 트릭곡만`
      : '',
    me?.flameKimActive
      ? `${me.flameKimBy || '불꽃남자김상원'} ${me.flameKimRoundsLeft ?? '?'}R · ${me.flameKimTarget || '대상'} −1 · 방곡+트릭`
      : '',
    (!me?.answerDelayPending && me?.answerDelayRoundsLeft)
      ? `${me.answerDelayBy || '잠깐만요'} ${me.answerDelayRoundsLeft}R · ${me.answerDelaySec || 5}초 딜레이`
      : '',
    me?.politeActive
      ? `${me.politeBy || '예의바른청년'} ${me.politeRoundsLeft ?? '?'}R · 「${me.politeSuffix || '입니다'}」${me.politeBonus && me.politeBonus > 0 ? ` · +${me.politeBonus}` : ''}`
      : '',
    me?.answerBlocked
      ? (me.answerBlockUntil
        ? `${me.answerBlockBy || '영역전개'} · 잠시 정답 인정 안 됨`
        : `${me.answerBlockBy || '수면'} ${me.answerBlockRoundsLeft ?? '?'}R · 정답 인정 안 됨`)
      : '',
    me?.accuseWatchActive
      ? `${me.accuseWatchBy || '범인은 당신이야!'} · 맞히면 다음 R 수면`
      : '',
    me?.gabukiActive
      ? `${me.gabukiBy || '가불기'} ${me.gabukiRoundsLeft ?? '?'}R · 정답−1/미득점−2`
      : '',
    (me?.answerProxyActive && !me?.answerProxyPending)
      ? `신속정확대리 ${me.answerProxyRoundsLeft ?? '?'}R · 적립 ${me.answerProxyPendingScore ?? 0}`
      : '',
  ].filter(Boolean).join(' · ')

  const readingPhaseLeft = reading
    ? Math.max(0, Math.ceil((reading.phaseEndsAt - now) / 1000))
    : 0
  // pre_solve는 서버 3초 — 시계 오차로 4가 보이지 않게 상한
  const readingPreSolveCd = reading?.phase === 'pre_solve'
    ? Math.min(3, readingPhaseLeft)
    : null
  const displayCountdown = (startCountdown != null && startCountdown > 0)
    ? startCountdown
    : (readingPreSolveCd != null && readingPreSolveCd > 0 ? readingPreSolveCd : null)
  // 리딩은 관전도 진행 패널 표시 · 노맞 증강 패널만 관전 숨김
  const showAugmentSide = isReading || (!isSpectator && room.augmentsEnabled !== false)
  const isReadingOffered = !!(reading && reading.offeredUserId === user.id && !isSpectator)
  const canReadingVote = !!(reading && reading.phase === 'vote' && !isReadingSolver && !isSpectator)
  const readingTurnCycle = (reading?.turnOrder || []).map((uid, i) => {
    const nick = room.members.find((m) => m.userId === uid)?.nickname || '?'
    const current = reading ? (i === (reading.turnIndex % reading.turnOrder.length)) : false
    const isSolver = reading?.solverId === uid
    return { userId: uid, nickname: nick, current, isSolver, order: i + 1 }
  })

  const send = () => {
    if (me?.chatMuted) return
    if (me?.answerDelayUnlockAt && now < me.answerDelayUnlockAt) return
    if (!input.trim()) return
    const text = input.trim()
    if (isSpectator) sendChat(text)
    else submitAnswer(text)
    setInput('')
  }

  const panelBox: React.CSSProperties = {
    ...sk(), backgroundColor: C.panel, padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, minWidth: 0,
  }
  const surf = C.panel
  const chip = (ok: boolean, label: string, value: string | null) => (
    <div style={{
      ...sk(ok ? C.green : C.graphite, true),
      backgroundColor: ok ? C.greenLight : surf,
      padding: '6px 12px', fontFamily: F.ui, fontSize: 16, fontWeight: 400,
      color: ok ? C.green : C.muted, maxWidth: 160,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {label} {value || '＿＿'}
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', ...crumpledPaper, overflow: 'hidden' }}>
      {displayCountdown != null && displayCountdown > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 90,
          backgroundColor: 'rgba(30, 40, 50, 0.55)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div
            key={displayCountdown}
            style={{
              fontFamily: F.brand,
              fontSize: 'min(28vw, 180px)',
              fontWeight: 800,
              color: C.card,
              textShadow: `4px 4px 0 ${C.graphite}`,
              lineHeight: 1,
              animation: 'countdownPop 0.45s ease-out',
            }}
          >
            {displayCountdown}
          </div>
          <div style={{
            marginTop: 12,
            fontFamily: F.ui,
            fontSize: 22,
            fontWeight: 700,
            color: C.card,
            textShadow: `2px 2px 0 ${C.graphite}`,
          }}>
            {reading?.phase === 'pre_solve' ? '곧 풀이 시작' : '곧 시작합니다'}
          </div>
          <style>{`@keyframes countdownPop {
            0% { transform: scale(0.55); opacity: 0.2; }
            55% { transform: scale(1.08); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }`}</style>
        </div>
      )}
      {/* 트릭/진흙탕/증강 BGM 은 App 루트 RoomSongPersistentBgm 이 담당 */}
      <div style={{
        position: 'relative', zIndex: 2, backgroundColor: C.card,
        borderBottom: `2.5px solid ${C.graphite}`, boxShadow: `0 3px 0 ${C.graphite}40`,
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        filter: 'url(#pencilRough)',
      }}>
        <RoundTimer endsAt={round?.endsAt ?? now} max={maxTime} size={66} />
        <div
          style={{
            fontFamily: F.ui,
            fontSize: 18,
            fontWeight: 400,
            color: C.body,
            cursor: 'help',
            padding: '2px 4px',
            borderRadius: 4,
            backgroundColor: queueHover ? C.blueLight : 'transparent',
          }}
          onMouseEnter={(e) => {
            setQueueHover(true)
            setQueueHoverAnchor(e.currentTarget.getBoundingClientRect())
          }}
          onMouseLeave={() => {
            setQueueHover(false)
            setQueueHoverAnchor(null)
          }}
          title="남은 곡 · 장르별"
        >
          Q{(round?.index ?? 0) + 1}/{round?.total ?? '?'}
        </div>
        {(!isReading || showReadingSongInfo) && (
        <div style={{
          border: `2.5px solid ${genreColor}`,
          borderRadius: '7px 5px 8px 4px / 5px 8px 5px 7px',
          backgroundColor: 'transparent',
          padding: '5px 12px',
          fontFamily: F.ui,
          fontSize: 16,
          color: genreColor,
          fontWeight: 700,
        }}>
          {round?.genre || '-'}
        </div>
        )}
        {!isReading && (
        <div style={{ ...sk(C.graphite, true), backgroundColor: C.blueLight, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Equalizer />
          <span style={{ fontFamily: F.ui, fontSize: 16, color: C.blue }}>
            {inDuel
              ? `야차룰 · ${(round?.duelChallenger || duel?.challengerNickname || '?')} vs ${(round?.duelOpponent || duel?.opponentNickname || '?')}`
              : room.pendingDuel
                ? `야차룰 대기 · ${room.pendingDuel.challengerNickname} vs ${room.pendingDuel.opponentNickname}`
              : songPowerOff
                ? `전원을 꺼봤습니다 · ${songPowerOffLeft}초`
                : me?.audioDelayUntil && now < me.audioDelayUntil
                ? `슬로우 스타터 · ${Math.max(0, Math.ceil((me.audioDelayUntil - now) / 1000))}초 후`
                : me?.sakuraActive
                  ? `${me.sakuraBy || '다른 곡'} · 트릭곡만`
                  : me?.flameKimActive
                    ? `${me.flameKimBy || '불꽃남자김상원'} · 방곡+트릭`
                  : songPlaybackRate !== 1
                    ? `재생 ×${songPlaybackRate}`
                    : '재생 중'}
          </span>
        </div>
        )}
        {!inDuel && (!isReading || showReadingSongInfo) && slotDisplays.map((col) => (
          <span key={col.key}>
            {chip(col.revealed, col.label, col.value ?? col.hint)}
          </span>
        ))}
        {inDuel && (
          <div style={{
            ...sk(C.blue, true), backgroundColor: C.blueLight, padding: '5px 12px',
            fontFamily: F.ui, fontSize: 15, color: C.blue, fontWeight: 700,
          }}>
            제목만 · 패자 −{round?.duelPenalty || duel?.penalty || 5}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted }}>노래</span>
            <input type="range" min={0} max={100} value={musicVolume} onChange={e => setMusicVolume(Number(e.target.value))} style={{ width: 64, accentColor: C.blue }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted }}>효과</span>
            <input
              type="range" min={0} max={100} value={sfxVolume}
              onChange={e => setSfxVolume(Number(e.target.value))}
              onMouseUp={() => playSfx('click')}
              style={{ width: 64, accentColor: C.blue }}
            />
          </div>
        </div>
        <div style={{
          fontFamily: F.ui, fontSize: 13, fontWeight: 700,
          padding: '4px 8px',
          minWidth: 52,
          textAlign: 'right',
        }} title="서버 왕복 지연">
          <PingText connected={connected} />
        </div>
        <Btn size="sm" onClick={() => setLeaveOpen(true)}>나가기</Btn>
      </div>

      <div style={{
        position: 'relative', zIndex: 2, flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: showAugmentSide
          ? 'clamp(230px, 17vw, 340px) minmax(0, 1fr) clamp(230px, 16vw, 320px)'
          : 'clamp(230px, 17vw, 340px) minmax(0, 1fr)',
        gap: 16, padding: '16px 18px 0',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, minWidth: 0 }}>
          <GameScoreboard
            ranked={ranked}
            spectators={spectators}
            selfId={user.id}
            style={{ flex: 1.35 }}
          />
          <div style={{ ...panelBox, flex: 1, backgroundColor: surf, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontFamily: F.ui, fontSize: 17, color: C.muted, textAlign: 'center', flexShrink: 0 }}>
              로그
              <span style={{ fontSize: 12, marginLeft: 5, opacity: 0.7 }}>· 정답 · 증강</span>
            </div>
            <div
              ref={logRef}
              onScroll={onLogScroll}
              onWheel={onLogWheel}
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                minHeight: 0,
                minWidth: 0,
                // 크롬 스크롤 앵커링 끄기 — 아바타·줄바꿈으로 위쪽 높이가 변하면
                // 크롬이 scrollTop을 몰래 올리는데, 그걸 «사용자가 위로 올렸다»로 오인해
                // 자동 스크롤 고정이 저절로 풀렸다.
                overflowAnchor: 'none',
                padding: '4px 8px 8px 4px',
                scrollBehavior: 'auto',
              }}
            >
              <div
                ref={logContentRef}
                style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}
              >
                <GameLogList
                  logs={logChats}
                  setChatCardHover={setChatCardHover}
                  setChatCardAnchor={setChatCardAnchor}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, minWidth: 0 }}>
          <div style={{ ...sk(), backgroundColor: surf, padding: '14px 18px', textAlign: 'center', flexShrink: 0 }}>
            <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                ref={genreSlotRef}
                style={{
                  fontFamily: F.brand,
                  fontSize: 22,
                  fontWeight: 700,
                  color: genreColor,
                  lineHeight: 1.2,
                  minHeight: 28,
                  padding: showGenre ? '4px 14px' : 0,
                  border: showGenre ? `2.5px solid ${genreColor}` : '2.5px solid transparent',
                  borderRadius: '8px 5px 9px 5px / 5px 9px 5px 8px',
                  backgroundColor: 'transparent',
                  opacity: genreSettled ? 1 : 0,
                  transition: genreSettled ? 'opacity 0.25s ease' : undefined,
                }}
              >
                {showGenre ? (round?.genre || '') : (isReading ? '' : '???')}
              </div>
              {(activeBuffLabel || mudBuff || deafMode || songPowerOff || stutterMuted || me?.hintsHidden || me?.alienQwertyActive) && (
                <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted }}>
                  {activeBuffLabel ? activeBuffLabel : ''}
                  {mudBuff ? `${activeBuffLabel ? ' · ' : ''}진흙탕 싸움` : deafMode && !mudBuff ? `${activeBuffLabel ? ' · ' : ''}청각 OFF` : ''}
                  {songPowerOff ? ` · 전원 OFF ${songPowerOffLeft}초` : ''}
                  {stutterMuted || me?.audioStutter ? ` · ${me?.audioStutter?.byName || '스타카토'} 끊김` : ''}
                  {me?.hintsHidden ? ` · ${me.hintsHiddenBy || '눈찌르기'} 힌트X` : ''}
                  {me?.alienQwertyActive ? ' · 외계인 영타' : ''}
                </div>
              )}
            </div>
            <GenreIntroFly
              text={showGenre ? (round?.genre || '') : '???'}
              targetRef={genreSlotRef}
              active={!!showGenre && genreIntroActive && room.status === 'playing' && !inDuel && !isReading}
              onSettled={settleGenreIntro}
              color={genreColor}
            />
            {isReading && !showReadingSongInfo ? (
              <div style={{ fontFamily: F.ui, fontSize: 16, color: C.muted, padding: '18px 8px' }}>
                {readingPhase === 'decide' || readingPhase === 'claim'
                  ? '도전·참가 확정 전 · 곡 정보 비공개'
                  : isReadingSolver
                    ? (readingPhase === 'vote' || readingPhase === 'pre_solve'
                      ? '곡 정보 비공개 · 곧 노래만 듣고 맞춤'
                      : '노래만 듣고 제목을 맞히세요')
                    : '대기 중…'}
              </div>
            ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(1, slotDisplays.length)}, minmax(0, 1fr))`,
                gap: 0,
                width: '100%',
                alignItems: 'stretch',
              }}
            >
              {slotDisplays.map((col, i) => (
                <div
                  key={col.key}
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    minWidth: 0,
                    borderLeft: i > 0 ? `2px solid ${C.line}` : undefined,
                    paddingLeft: i > 0 ? 12 : 0,
                    paddingRight: i < slotDisplays.length - 1 ? 12 : 0,
                  }}
                >
                  <FitAnswer
                    label={col.label}
                    value={col.value}
                    hint={col.hint}
                    revealed={col.revealed}
                  />
                </div>
              ))}
            </div>
            )}
            {!!artistHintText && (
              <div style={{
                marginTop: 10,
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}>
                <span style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue }}>
                  가수 힌트
                </span>
                <span style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, color: C.body }}>
                  {artistHintText}
                </span>
              </div>
            )}
            {!isReading && showHidden && hiddenSlot && (
              <div style={{
                marginTop: 14, paddingTop: 12,
                borderTop: `2px dashed ${C.blue}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}>
                <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: C.blue, marginBottom: 8 }}>
                  히든 문제
                </div>
                <FitAnswer
                  label={hiddenSlot.label || '히든'}
                  value={hiddenRevealed || hiddenSpoil || null}
                  hint={null}
                  revealed={!!hiddenRevealed || !!hiddenSpoil}
                />
              </div>
            )}
            {!isReading && hiddenSlot && !showHidden && (
              <div style={{ marginTop: 12, fontFamily: F.ui, fontSize: 13, color: C.muted }}>
                제목·가수를 모두 맞히면 히든 문제가 등장합니다
              </div>
            )}
          </div>

          <div style={{ ...panelBox, flex: 1, backgroundColor: surf, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontFamily: F.ui, fontSize: 20, color: C.muted, textAlign: 'center', flexShrink: 0 }}>
              {duelSpectating ? '관전 채팅' : me?.chatIsolated ? '격리 채팅' : '채팅'}
              {duelSpectating && (
                <span style={{ fontSize: 13, marginLeft: 6, opacity: 0.7 }}>· 당사자에게 안 보임</span>
              )}
              {me?.chatIsolated && !duelSpectating && (
                <span style={{ fontSize: 13, marginLeft: 6, color: C.blue, opacity: 0.9 }}>
                  · 조{(me.chatIsolateGroup ?? 0) + 1}
                  {me.chatIsolateRoundsLeft != null ? ` · ${me.chatIsolateRoundsLeft}R` : ''}
                </span>
              )}
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div
              ref={chatRef}
              onScroll={onGameChatScroll}
              onWheel={onGameChatWheel}
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                minHeight: 0,
                minWidth: 0,
                // 크롬 스크롤 앵커링 끄기 — 아바타·줄바꿈으로 위쪽 높이가 변하면
                // 크롬이 scrollTop을 몰래 올리는데, 그걸 «사용자가 위로 올렸다»로 오인해
                // 자동 스크롤 고정이 저절로 풀렸다.
                overflowAnchor: 'none',
                // 스케치 그림자·우측 말풍선이 잘리지 않게
                padding: '6px 12px 10px 6px',
                scrollBehavior: 'auto',
              }}
            >
              <div
                ref={chatContentRef}
                style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}
              >
                <GameChatList
                  chats={playerChats}
                  selfId={user.id}
                  metaByUser={chatMetaByUser}
                />
              </div>
            </div>
              {!chatStickBottom && (
                <button
                  type="button"
                  onClick={jumpToLatestGameChat}
                  style={{
                    position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
                    fontFamily: F.ui, fontSize: 13, fontWeight: 800, padding: '7px 14px',
                    ...sk(C.blue, true), backgroundColor: C.blueLight, color: C.blue, cursor: 'pointer',
                    whiteSpace: 'nowrap', zIndex: 3, boxShadow: `0 4px 0 ${C.graphite}22`,
                  }}
                >
                  최근 채팅으로{chatHasNew ? ' · 새 메시지' : ''}
                </button>
              )}
            </div>
          </div>
        </div>

        {showAugmentSide && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          {isReading && reading ? (
            <>
              <div style={{ ...panelBox, flex: 1.2 }}>
                <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center' }}>
                  리딩 · {readingPhaseLeft}초
                  {(reading.targetScore || room.readingTargetScore) ? ` · 목표 ${reading.targetScore || room.readingTargetScore}점` : ''}
                </div>
                <div style={{
                  flex: 1, ...sk(C.graphite),
                  backgroundColor: C.card, padding: '14px 12px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', gap: 10, minHeight: 160,
                }}>
                  <div style={{ fontFamily: F.brand, fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>
                    {
                      reading.phase === 'decide' ? '도전할까요?'
                        : reading.phase === 'claim' ? '참가할 사람?'
                          : reading.phase === 'vote' ? '맞힐 수 있을까요?'
                            : reading.phase === 'pre_solve' ? '3 · 2 · 1'
                              : reading.phase === 'solve' ? '제목 풀이'
                                : '결과'
                    }
                  </div>
                  <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, lineHeight: 1.4 }}>
                    {
                      reading.phase === 'decide' ? `${reading.offeredNickname}님 차례`
                        : reading.phase === 'claim' ? '포기 턴 · 대리 참가'
                          : reading.phase === 'vote'
                            ? (isReadingSolver
                              ? `${reading.solverNickname || '?'} · 투표 중`
                              : `${reading.solverNickname || '?'} · 맞힐듯 ${reading.voteCounts?.yes ?? 0} / 못맞힐듯 ${reading.voteCounts?.no ?? 0}`)
                            : reading.phase === 'pre_solve'
                              ? `${reading.solverNickname || '?'}님 풀이 준비`
                              : reading.phase === 'solve'
                                ? `${reading.solverNickname || '?'}님 풀이 중`
                                : reading.lastResult
                                  ? `${reading.lastResult.solved ? '정답' : '실패'} · ${reading.lastResult.title}`
                                  : ''
                    }
                  </div>
                  {reading.phase === 'reveal' && reading.lastResult?.voterPayouts?.length ? (
                    <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, lineHeight: 1.4 }}>
                      {reading.lastResult.voterPayouts.map((p) => `${p.nickname} ${p.odds}+${p.gain}`).join(' · ')}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                    {isSpectator ? (
                      <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>관전 중 · 채팅만 가능</div>
                    ) : (
                      <>
                        {reading.phase === 'decide' && isReadingOffered && (
                          <>
                            <Btn variant="primary" fullWidth onClick={readingAccept}>도전 (+3/−3)</Btn>
                            <Btn variant="danger" fullWidth onClick={readingPass}>포기 (−1)</Btn>
                          </>
                        )}
                        {reading.phase === 'decide' && !isReadingOffered && (
                          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>
                            {reading.offeredNickname}님 선택 대기…
                          </div>
                        )}
                        {reading.phase === 'claim' && !isReadingOffered && (
                          <Btn variant="primary" fullWidth onClick={readingClaim}>참가</Btn>
                        )}
                        {reading.phase === 'claim' && isReadingOffered && (
                          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>참가자 대기…</div>
                        )}
                        {canReadingVote && (
                          <>
                            <Btn variant="primary" fullWidth onClick={() => readingVote('yes')}>맞힐듯</Btn>
                            <Btn fullWidth onClick={() => readingVote('no')}>못맞힐듯</Btn>
                          </>
                        )}
                        {reading.phase === 'vote' && isReadingSolver && (
                          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>투표 대기… (미리듣기 없음)</div>
                        )}
                        {reading.phase === 'pre_solve' && (
                          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>곧 풀이 시작</div>
                        )}
                        {reading.phase === 'solve' && isReadingSolver && (
                          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>아래 입력창에 제목 제출</div>
                        )}
                        {reading.phase === 'solve' && !isReadingSolver && (
                          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>같이 들으며 관전</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ ...panelBox, flex: 1 }}>
                <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center' }}>
                  참가 순서
                </div>
                <div style={{
                  flex: 1, ...sk(C.graphite, true), backgroundColor: C.card, padding: '12px 12px',
                  display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflowY: 'auto',
                }}>
                  {readingTurnCycle.length === 0 ? (
                    <div style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: F.ui, fontSize: 15, color: C.muted,
                    }}>
                      순서 없음
                    </div>
                  ) : (
                    readingTurnCycle.map((t) => (
                      <div
                        key={t.userId}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 10px',
                          ...sk(t.current ? C.blue : C.graphite, true),
                          backgroundColor: t.current ? C.blueLight : C.card,
                        }}
                      >
                        <span style={{
                          fontFamily: F.ui, fontSize: 13, fontWeight: 800,
                          color: t.current ? C.blue : C.muted, width: 22, textAlign: 'center',
                        }}>
                          {t.order}
                        </span>
                        <span style={{
                          flex: 1, fontFamily: F.ui, fontSize: 15, fontWeight: t.current ? 800 : 600,
                          color: t.current ? C.blue : C.body,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {t.nickname}
                          {t.isSolver ? ' · 풀이' : t.current ? ' · 차례' : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
          <div style={{ ...panelBox, flex: 1.2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ fontFamily: F.ui, fontSize: 20, color: C.muted }}>증강</div>
              <Btn size="sm" onClick={() => setShowUsedList(true)}>사용 목록</Btn>
            </div>
            {heldCards.length > 1 && (
              <div style={{ display: 'flex', gap: 6 }}>
                {heldCards.map((h) => {
                  const on = !!displayCard && h.id === displayCard.id
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => { if (!h.locked) setHeldPickId(h.id) }}
                      title={h.locked
                        ? `${h.lockedByNickname || '누군가'}님이 떠넘김 · 사용 불가`
                        : h.name}
                      style={{
                        flex: 1, minWidth: 0, padding: '6px 8px',
                        cursor: h.locked ? 'not-allowed' : 'pointer',
                        fontFamily: F.ui, fontSize: 13, fontWeight: 800,
                        color: C.muted,
                        backgroundColor: on ? C.card : 'transparent',
                        border: `2px solid ${h.locked ? C.graphite : tierBorderColor(h.tier)}`,
                        opacity: h.locked ? 0.55 : 1,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {h.locked ? '🔒 ' : ''}{h.name}
                    </button>
                  )
                })}
              </div>
            )}
            <div style={{
              flex: 1, ...sk(heldTier ? tierBorderColor(heldTier) : C.graphite),
              backgroundColor: C.card, padding: '16px 14px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', gap: 12, minHeight: 184, position: 'relative',
              border: heldTier
                ? `2.5px solid ${tierBorderColor(heldTier)}`
                : undefined,
            }}>
              {displayCard ? (
                <>
                  <div style={{
                    width: 104, height: 104, flexShrink: 0,
                    ...sk(tierBorderColor(heldTier), true),
                    overflow: 'hidden', backgroundColor: '#F2F0EB',
                  }}>
                    {heldImageUrl ? (
                      <img
                        src={heldImageUrl}
                        alt={heldName || '증강'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <AugmentNoPhoto name={heldName} accent={tierBorderColor(heldTier)} compact />
                    )}
                  </div>
                  {heldTier && (
                    <div style={{
                      fontFamily: F.ui, fontSize: 12, fontWeight: 800,
                      color: tierBorderColor(heldTier),
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap',
                    }}>
                      {tierDisplayName(heldTier)}
                      <AugmentTargetBadge effectType={heldEffectType} />
                    </div>
                  )}
                  {!heldTier && heldEffectType && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <AugmentTargetBadge effectType={heldEffectType} />
                    </div>
                  )}
                  <div style={{ fontFamily: F.brand, fontSize: 23, fontWeight: 700, lineHeight: 1.2 }}>
                    {heldName || '보유 중'}
                  </div>
                  <div
                    style={{ width: '100%', position: 'relative' }}
                    onMouseEnter={(e) => {
                      setAugHover(true)
                      setAugHoverAnchor(e.currentTarget.getBoundingClientRect())
                    }}
                    onMouseLeave={() => {
                      setAugHover(false)
                      setAugHoverAnchor(null)
                    }}
                  >
                    <Btn
                      variant="primary"
                      fullWidth
                      disabled={useLocked || !heldId}
                      onClick={() => {
                        if (useLocked || !heldId) return
                        if (needsGahoPick) void openGahoPick()
                        else if (needsTargetPick) {
                          setSelectedTargetIds([])
                          setTargetPickOpen(true)
                        }
                        else if (needsGenrePick) setGenrePickOpen(true)
                        else useAugment({ augmentId: heldId || undefined })
                      }}
                    >
                      {!heldId
                        ? '떠넘겨진 증강 · 사용 불가'
                        : isAutoTriggerHeld
                        ? '자동 사용'
                        : isPassiveHeld
                        ? '피격 시 자동'
                        : isAutoAugment
                          ? '자동 적용'
                          : needsGahoPick
                            ? '프리즘 선택'
                            : needsTargetPick
                              ? '대상 선택'
                              : needsGenrePick
                                ? '장르 선택'
                                : '사용'}
                      {!useLocked && ' · R'}
                    </Btn>
                  </div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted }}>
                    {!heldId
                      ? `${displayCard?.lockedByNickname || '누군가'}님이 떠넘김 · 다음 증강 선택 때 사라집니다`
                      : isAutoTriggerHeld
                      ? '동시 정답 시 우선권'
                      : isPassiveHeld
                      ? '지목당하면 자동 반사'
                      : isAutoAugment
                        ? '선택 후 자동 적용'
                        : needsGahoPick
                          ? '프리즘 중 하나를 골라 적용'
                          : needsTargetPick
                            ? '대상을 골라 사용'
                            : needsGenrePick
                              ? (genrePickIsBan ? '밴픽 장르를 골라 사용' : '장르를 골라 사용')
                              : '사용 버튼에 올리면 설명'}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: F.ui, fontSize: 16, color: C.muted }}>보유 증강 없음</div>
              )}
            </div>
          </div>
          <div style={{ ...panelBox, flex: 1 }}>
            <div style={{ fontFamily: F.ui, fontSize: 20, color: C.muted, textAlign: 'center' }}>
              증강 적용{scoreMult > 1 ? ` · 점수 ×${scoreMult}` : ''}
            </div>
            <div style={{
              flex: 1, ...sk(C.graphite, true), backgroundColor: C.card, padding: '10px 10px',
              display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflowY: 'auto',
            }}>
              {(() => {
                const chips: Array<{
                  key: string
                  name: string
                  imageUrl?: string | null
                  hostile: boolean
                  meta: string
                  description: string
                }> = []
                for (const [i, b] of visibleBuffs.entries()) {
                  const fromOther = !!(b.usedByNickname && b.usedByNickname !== user.nickname)
                  const hostile = HOSTILE_AUGMENT_TYPES.has(b.effectType) || fromOther
                  chips.push({
                    key: `buff-${b.name}-${i}`,
                    name: b.name,
                    imageUrl: b.imageUrl,
                    hostile,
                    meta: [
                      b.pending ? '다음부터' : `${b.roundsLeft}R`,
                      b.mult && b.mult > 1 ? `×${b.mult}` : '',
                      b.usedByNickname && fromOther ? b.usedByNickname : '',
                    ].filter(Boolean).join(' · '),
                    description: [
                      b.description || '',
                      b.usedByNickname ? `시전: ${b.usedByNickname}` : '',
                      b.pending ? '다음 라운드부터' : `남은 ${b.roundsLeft}R`,
                    ].filter(Boolean).join('\n'),
                  })
                }
                if (me?.sakuraActive) {
                  chips.push({
                    key: 'sakura',
                    name: me.sakuraBy || '다른 곡',
                    imageUrl: null,
                    hostile: true,
                    meta: me.sakuraScoreMult && me.sakuraScoreMult > 1 ? `정답 ×${me.sakuraScoreMult}` : '환상',
                    description: '지금 들리는 곡은 실제 문제와 다릅니다.',
                  })
                }
                if (!me?.answerDelayPending && me?.answerDelayRoundsLeft && me.answerDelayRoundsLeft > 0) {
                  chips.push({
                    key: 'answer-delay',
                    name: me.answerDelayBy || '잠깐만요',
                    imageUrl: null,
                    hostile: true,
                    meta: `${me.answerDelayRoundsLeft}R · ${me.answerDelaySec || 5}초`,
                    description: `매 라운드 시작 ${me.answerDelaySec || 5}초 뒤에만 정답 입력`,
                  })
                }
                if (me?.answerProxyActive && !me?.answerProxyPending) {
                  chips.push({
                    key: 'answer-proxy',
                    name: '신속정확대리',
                    imageUrl: null,
                    hostile: true,
                    meta: `${me.answerProxyRoundsLeft ?? '?'}R · 적립 ${me.answerProxyPendingScore ?? 0}`,
                    description: '대상은 비공개입니다. 3라운드 후 적립 점수가 결산됩니다.',
                  })
                }
                if (me?.accuseWatchActive) {
                  chips.push({
                    key: 'accuse',
                    name: me.accuseWatchBy || '범인은 당신이야!',
                    imageUrl: null,
                    hostile: true,
                    meta: '감시 중',
                    description: '감시 라운드에 맞히면 다음 라운드 수면',
                  })
                }
                if (me?.gabukiActive) {
                  chips.push({
                    key: 'gabuki',
                    name: me.gabukiBy || '가불기',
                    imageUrl: null,
                    hostile: true,
                    meta: `${me.gabukiRoundsLeft ?? '?'}R`,
                    description: '정답 시 −1 · 못 맞히면 −2 · 시전자에게 전달',
                  })
                }
                if (me?.flameKimActive || me?.flameKimPending) {
                  chips.push({
                    key: 'flame',
                    name: me.flameKimBy || '불꽃남자김상원',
                    imageUrl: null,
                    hostile: false,
                    meta: me.flameKimPending
                      ? '다음부터'
                      : `${me.flameKimRoundsLeft ?? '?'}R · ${me.flameKimTarget || '대상'}`,
                    description: '방 노래+불꽃남자 동시 · 본인 득점 시 대상 −1',
                  })
                }
                // 아래는 activeBuffs 가 아니라 멤버 전용 필드로 저장되는 효과들이다.
                // 칩을 안 만들어 두면 적용 중인데도 이 칸에 아무 표시가 안 뜬다.
                // (버프 목록에 실리는 효과는 여기에 또 넣으면 두 번 뜬다)
                if (me?.chatMuted || me?.chatMutePending) {
                  chips.push({
                    key: 'chat-mute',
                    name: me.chatMuteBy || '입 막기',
                    imageUrl: null,
                    hostile: true,
                    meta: me.chatMutePending ? '다음부터' : '채팅 금지',
                    description: '이 효과가 끝날 때까지 채팅을 보낼 수 없습니다.',
                  })
                }
                if (me?.politeActive || me?.politePending) {
                  chips.push({
                    key: 'polite',
                    name: me.politeBy || '예의바른청년',
                    imageUrl: null,
                    hostile: !!(me.politeBy && me.politeBy !== user.nickname),
                    meta: [
                      me.politePending ? '다음부터' : `${me.politeRoundsLeft ?? '?'}R`,
                      me.politeBonus ? `+${me.politeBonus}` : '',
                    ].filter(Boolean).join(' · '),
                    description: '정답 끝에 정해진 말을 붙여야 인정됩니다.',
                  })
                }
                if (me?.audioDelayUntil && now < me.audioDelayUntil) {
                  chips.push({
                    key: 'audio-delay',
                    name: '노래 지연',
                    imageUrl: null,
                    hostile: true,
                    meta: `${me.audioDelaySec ?? '?'}초`,
                    description: '남들보다 늦게 노래가 들립니다.',
                  })
                }
                if (me?.songMuteUntil && now < me.songMuteUntil) {
                  chips.push({
                    key: 'power-off',
                    name: '전원을 꺼봤습니다',
                    imageUrl: null,
                    hostile: true,
                    meta: `${Math.max(0, Math.ceil((me.songMuteUntil - now) / 1000))}초`,
                    description: '노래가 들리지 않습니다.',
                  })
                }
                if (me?.peckSong) {
                  chips.push({
                    key: 'peck-song',
                    name: me.peckSong.byName || '쪼아요~',
                    imageUrl: null,
                    hostile: true,
                    meta: '벌칙 곡',
                    description: '이 곡이 끝날 때까지 방 노래 대신 벌칙 곡만 들립니다.',
                  })
                }
                if (chips.length === 0 && !augmentHint) {
                  return (
                    <div style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: F.ui, fontSize: 15, color: C.muted, textAlign: 'center',
                    }}>
                      적용 중인 증강이 없습니다
                    </div>
                  )
                }
                return (
                  <>
                    {chips.map((c) => (
                      <AppliedAugmentChip
                        key={c.key}
                        name={c.name}
                        imageUrl={c.imageUrl}
                        hostile={c.hostile}
                        meta={c.meta}
                        description={c.description}
                        onHover={(rect) => {
                          setAppliedCardHover({
                            name: c.name,
                            description: c.description,
                            imageUrl: c.imageUrl,
                            hostile: c.hostile,
                            meta: c.meta,
                          })
                          setAppliedCardAnchor(rect)
                        }}
                        onLeave={() => {
                          setAppliedCardHover(null)
                          setAppliedCardAnchor(null)
                        }}
                      />
                    ))}
                    {augmentHint && (
                      <div style={{
                        marginTop: chips.length ? 4 : 0,
                        paddingTop: chips.length ? 8 : 0,
                        borderTop: chips.length ? `2px solid ${C.line}` : undefined,
                        fontFamily: F.ui, fontSize: 15, color: C.body, lineHeight: 1.45,
                        whiteSpace: 'pre-line', textAlign: 'center',
                      }}>
                        {augmentHint}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
            </>
          )}
        </div>
        )}

      </div>

      {showUsedList && (
        <div onClick={() => setShowUsedList(false)} style={{
          position: 'fixed', inset: 0, zIndex: 50, backgroundColor: 'rgba(30,40,50,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', width: '100%', maxWidth: 420, textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 32, fontWeight: 700, marginBottom: 18 }}>사용한 증강</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {(me?.usedAugments || []).length === 0 ? (
                <div style={{ fontFamily: F.ui, fontSize: 20, color: C.muted }}>아직 없음</div>
              ) : (
                me!.usedAugments.map((name, i) => (
                  <div key={`${name}-${i}`} style={{ ...sk(C.blue, true), backgroundColor: C.blueLight, padding: '12px 16px', fontFamily: F.ui, fontSize: 22 }}>
                    {i + 1}. {name}
                  </div>
                ))
              )}
            </div>
            <Btn variant="primary" onClick={() => setShowUsedList(false)}>닫기</Btn>
          </div>
        </div>
      )}

      {leaveOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(30,40,50,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', maxWidth: 360, width: '100%', textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 12 }}>방 나가기</div>
            <div style={{ fontFamily: F.ui, fontSize: 16, color: C.muted, marginBottom: 22, lineHeight: 1.5 }}>
              정말 방에서 나가시겠습니까?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Btn onClick={() => setLeaveOpen(false)}>취소</Btn>
              <Btn variant="danger" onClick={() => { setLeaveOpen(false); leaveRoom(); nav('lobby') }}>나가기</Btn>
            </div>
          </div>
        </div>
      )}

      {targetPickOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(30,40,50,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
              {heldName || '대상 선택'}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>
              {heldEffectType === 'sakura_decoy'
                ? '트루먼으로 만들 플레이어를 1~2명 선택하세요'
                : heldEffectType === 'slow_playback'
                ? (heldName?.includes('알레그로')
                  ? '노래를 빠르게 틀어줄 플레이어를 선택하세요'
                  : '노래를 느리게 틀어줄 플레이어를 선택하세요')
                : heldEffectType === 'audio_stutter'
                ? '노래를 끊을 플레이어를 선택하세요'
                : heldEffectType === 'hide_hints'
                ? '힌트를 가릴 플레이어를 선택하세요'
                : heldEffectType === 'score_share'
                ? '기생할 플레이어를 선택하세요 (그 사람 득점만큼 나도 획득)'
                : heldEffectType === 'answer_proxy'
                  ? '대리할 플레이어를 선택하세요 (대상은 공개되지 않습니다)'
                  : heldEffectType === 'named_decoy'
                      ? '연애서큘레이션을 틀어줄 플레이어를 선택하세요'
                      : heldEffectType === 'peck_song'
                      ? '쪼아요~를 들려줄 플레이어를 선택하세요 (그 사람만 들림)'
                      : heldEffectType === 'answer_delay'
                      ? (heldName?.includes('잠깐')
                        ? '잠깐 기다리게 할 플레이어를 선택하세요'
                        : '제출을 늦출 플레이어를 선택하세요')
                      : heldEffectType === 'yacha_duel'
                        ? '야차룰로 맞붙을 플레이어를 선택하세요'
                        : heldEffectType === 'polite_suffix'
                          ? (heldName === '다요'
                            ? '답 끝에 「다요」를 붙이게 할 플레이어를 선택하세요'
                            : '답 끝에 「입니다」를 붙이게 할 플레이어를 선택하세요')
                          : heldEffectType === 'soft_chat_mute'
                            ? '라운드 시작마다 잠시 채팅·제출을 막을 플레이어를 선택하세요'
                            : heldEffectType === 'rock_throw'
                              || heldEffectType === 'steal_chain'
                              ? '돌을 던질 플레이어를 선택하세요'
                              : heldEffectType === 'score_steal'
                                ? '점수를 뜯을 플레이어를 선택하세요'
                                : heldEffectType === 'pair_average'
                                  ? '점수를 맞출 플레이어를 선택하세요'
                                  : heldEffectType === 'accuse_sleep'
                                    ? '범인으로 지목할 플레이어를 선택하세요'
                                    : heldEffectType === 'gabuki_mark'
                                      ? '가불기를 걸 플레이어를 선택하세요'
                                      : heldEffectType === 'flame_kim'
                                        ? '불태울 플레이어를 선택하세요'
                                      : heldEffectType === 'steal_held_augment'
                                        ? '증강을 뺏을 플레이어를 선택하세요'
                                    : '대상을 선택하세요'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {targetCandidates.map(p => (
                <Btn
                  key={p.userId}
                  fullWidth
                  variant={isTrumanTargetPick && selectedTargetIds.includes(p.userId) ? 'yellow' : 'primary'}
                  onClick={() => {
                    if (isTrumanTargetPick) {
                      setSelectedTargetIds((current) => current.includes(p.userId)
                        ? current.filter((id) => id !== p.userId)
                        : current.length < 2
                          ? [...current, p.userId]
                          : current)
                    } else {
                      useAugment({ augmentId: heldId || undefined, targetUserId: p.userId })
                      setTargetPickOpen(false)
                    }
                  }}
                >
                  {isTrumanTargetPick && selectedTargetIds.includes(p.userId) ? '✓ ' : ''}{p.nickname}
                </Btn>
              ))}
              {targetCandidates.length === 0 && (
                <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>
                  {heldEffectType === 'steal_held_augment'
                    ? '증강을 보유한 다른 플레이어가 없습니다'
                    : busyTargets.length > 0
                      ? '이미 디버프가 적용 중인 대상만 있어 사용할 수 없습니다'
                      : '선택할 대상이 없습니다'}
                </div>
              )}
              {busyTargets.length > 0 && targetCandidates.length > 0 && (
                <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginTop: 4 }}>
                  디버프 적용 중(선택 불가): {busyTargets.map((p) => p.nickname).join(', ')}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              {isTrumanTargetPick && (
                <Btn
                  variant="primary"
                  disabled={selectedTargetIds.length < 1 || selectedTargetIds.length > 2}
                  onClick={() => {
                    useAugment({ augmentId: heldId || undefined, targetUserIds: selectedTargetIds })
                    setTargetPickOpen(false)
                    setSelectedTargetIds([])
                  }}
                >
                  {selectedTargetIds.length}명에게 사용
                </Btn>
              )}
              <Btn onClick={() => {
                setTargetPickOpen(false)
                setSelectedTargetIds([])
              }}>취소</Btn>
            </div>
          </div>
        </div>
      )}

      {genrePickOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(30,40,50,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
              {heldName || '밴픽'}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>
              {genrePickIsBan
                ? '밴할 장르를 선택하세요 (항상 성공 · 잔량은 다른 장르로 배분 · 총 곡 수 유지)'
                : '장르를 선택하세요'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {upcomingGenreEntries.map(([g, c]) => (
                <Btn
                  key={g}
                  fullWidth
                  variant="primary"
                  onClick={() => {
                    useAugment({ augmentId: heldId || undefined, genreName: g })
                    setGenrePickOpen(false)
                  }}
                >
                  {g} · 남은 {c}곡
                </Btn>
              ))}
              {upcomingGenreEntries.length === 0 && (
                <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>
                  {genrePickIsBan ? '밴할 장르가 없습니다' : '고를 장르가 없습니다'}
                </div>
              )}
            </div>
            <Btn onClick={() => setGenrePickOpen(false)}>취소</Btn>
          </div>
        </div>
      )}

      {gahoPickOpen && (
        <div style={prismBackdrop}>
          <PrismKeyframes />
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: '-20%',
              background: 'linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.35) 50%, transparent 65%)',
              animation: 'prismShine 4.5s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />
          <div style={{
            ...sk(C.tierGaho),
            position: 'relative',
            backgroundColor: 'rgba(247,250,252,0.92)',
            padding: '28px 32px',
            maxWidth: 720,
            width: '100%',
            textAlign: 'center',
            boxShadow: `0 0 0 1px ${C.tierGaho}55, 0 12px 40px rgba(80,40,120,0.25)`,
          }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 8, color: C.tierGaho }}>
              프리즘 선택
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 22 }}>
              3장 중 1개 · 리롤 없음 · 이름·사진만 (효과는 선택 후 확인)
            </div>
            {gahoBusy ? (
              <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>불러오는 중…</div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 14,
                marginBottom: 22,
              }}>
                {gahoCandidates.map((g) => {
                  const tierC = C.tierGaho
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        useAugment({ augmentId: heldId || undefined, gahoAugmentId: g.id })
                        // 대상/장르 추가 선택이 필요하면 held가 바뀌며 창을 유지하지 않음 · room:state로 UI 갱신
                        setGahoPickOpen(false)
                        setGahoCandidates([])
                      }}
                      style={{
                        ...sk(tierC),
                        backgroundColor: C.card,
                        padding: 12,
                        cursor: 'pointer',
                        border: `2.5px solid ${tierC}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <div style={{
                        width: '100%',
                        aspectRatio: '1',
                        ...sk(tierC, true),
                        overflow: 'hidden',
                        backgroundColor: '#F2F0EB',
                      }}>
                        {g.imageUrl ? (
                          <img src={g.imageUrl} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <AugmentNoPhoto name={g.name} accent={tierC} />
                        )}
                      </div>
                      <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: tierC }}>프리즘</div>
                      <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{g.name}</div>
                    </button>
                  )
                })}
                {gahoCandidates.length === 0 && (
                  <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, gridColumn: '1 / -1', textAlign: 'center' }}>
                    선택 가능한 프리즘이 없습니다
                  </div>
                )}
              </div>
            )}
            <Btn onClick={() => { setGahoPickOpen(false); setGahoCandidates([]) }}>취소</Btn>
          </div>
        </div>
      )}

      <div style={{
        position: 'relative', zIndex: 2, backgroundColor: 'transparent',
        padding: '12px 18px 14px', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0,
        filter: 'url(#pencilRough)',
      }}>
        <SketchInput
          inputRef={answerInputRef}
          value={input}
          onChange={setInput}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            // 빈 채로 엔터 → 입력창에서 빠져나감 (땅바닥 클릭한 것처럼 · K/R 단축키 사용 가능)
            if (!input.trim()) {
              e.currentTarget.blur()
              return
            }
            if (!submitBlocked) send()
          }}
          placeholder={
            isReading && reading
              ? (reading.phase === 'solve' && isReadingSolver
                ? '제목 정답 입력'
                : reading.phase === 'claim' && !isReadingOffered
                  ? '「참가」 입력 또는 오른쪽 버튼'
                  : reading.phase === 'vote'
                    ? (isReadingSolver ? '투표 대기 중…' : '오른쪽 버튼으로 투표')
                    : reading.phase === 'decide' && isReadingOffered
                      ? '오른쪽에서 도전/포기'
                      : '대기 중…')
            : me?.chatMuted
              ? me.chatMuteUntil
                ? `${me.chatMuteBy || '쉬었음청년'} · 라운드 시작 직시 채팅·제출 불가`
                : `${me.chatMuteBy || '채팅·제출 금지'} · 채팅·제출 불가`
              : me?.chatIsolated
                ? `${me.chatIsolateBy || '코로나'} 격리 · 조${(me.chatIsolateGroup ?? 0) + 1} 채팅만 보여요`
              : me?.answerBlocked
                ? me.answerBlockUntil
                  ? `${me.answerBlockBy || '영역전개'} · 지금은 정답 인정 안 됨 (채팅 OK)`
                  : `${me.answerBlockBy || '수면'} · 지금은 정답 인정 안 됨 (채팅 OK)`
                : me?.politeActive
                  ? `${me.politeBy || '예의바른청년'} · 답 끝「${me.politeSuffix || '입니다'}」필수`
                  : answerDelayLocked
                ? `${me?.answerDelayBy || '잠깐만요'} · ${answerDelayLeftSec}초 후 입력 가능`
                : duelSpectating
                  ? '관전 채팅 · 대결 당사자에겐 안 보여요'
                  : isSpectator
                    ? '관전 중 · 채팅만 가능'
                  : inDuel
                    ? '야차룰 · 제목만 맞히세요!'
                    : '정답 여러 번 제출 가능 · 제목/가수 둘 다 맞혀도 OK'
          }
          style={{
            flex: 1,
            fontSize: '25px',
            padding: '14px 18px',
            backgroundColor: submitBlocked ? '#E8EEF3' : C.card,
            textAlign: 'center',
            fontFamily: F.chat,
          }}
          noPaste
        />
        <Btn
          variant="danger"
          disabled={isSpectator || isReading || skipVoted || room.status !== 'playing' || inDuel || !!room.noSkipActive}
          onClick={voteSkip}
        >
          {isSpectator
            ? '관전'
            : isReading
            ? '리딩방'
            : inDuel
            ? '야차룰 중'
            : room.noSkipActive
            ? `스킵 불가 · ${room.noSkipBy || '조로룰'} ${room.noSkipRoundsLeft ?? '?'}R`
            : room.status === 'revealing'
              ? '공개 중'
              : room.status === 'countdown'
                ? '대기 중'
                : `스킵 ${skip.votes}/${skip.need} · K`}
        </Btn>
        <Btn variant="primary" disabled={submitBlocked} onClick={send}>
          {isSpectator ? '채팅' : '제출'}
        </Btn>
      </div>

      {queueHover && (
        <FloatingHoverPopup
          anchor={queueHoverAnchor}
          borderColor={C.blue}
          width={220}
        >
          <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue, marginBottom: 8 }}>
            남은 곡 {remainingTotal} · 장르별
          </div>
          {remainingGenreEntries.length === 0 ? (
            <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>남은 곡 없음</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {remainingGenreEntries.map(([g, c]) => (
                <div
                  key={g}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    fontFamily: F.ui,
                    fontSize: 14,
                    color: C.body,
                  }}
                >
                  <span>{g}</span>
                  <span style={{ fontWeight: 800, color: C.blue }}>{c}</span>
                </div>
              ))}
            </div>
          )}
        </FloatingHoverPopup>
      )}

      {augHover && heldDescription && (
        <FloatingHoverPopup
          anchor={augHoverAnchor}
          borderColor={tierBorderColor(heldTier)}
          width={260}
        >
          <div style={{
            fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue, marginBottom: 6,
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            증강 설명
            <AugmentTargetBadge effectType={heldEffectType} />
          </div>
          {heldName && (
            <div style={{ fontFamily: F.brand, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              {heldName}
            </div>
          )}
          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
            {heldDescription}
          </div>
        </FloatingHoverPopup>
      )}

      {hoveredChatCard && (
        <FloatingHoverPopup
          anchor={chatCardAnchor}
          borderColor={tierBorderColor(hoveredChatCard.tier)}
          width={240}
        >
          <div style={{
            width: '100%', aspectRatio: '1.4', marginBottom: 8,
            ...sk(tierBorderColor(hoveredChatCard.tier), true),
            overflow: 'hidden', backgroundColor: '#F2F0EB',
          }}>
            {hoveredChatCard.imageUrl ? (
              <img src={hoveredChatCard.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <AugmentNoPhoto name={hoveredChatCard.name} accent={tierBorderColor(hoveredChatCard.tier)} compact />
            )}
          </div>
          <div style={{ fontFamily: F.brand, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            {hoveredChatCard.name}
          </div>
          {hoveredChatCard.tier && (
            <div style={{
              fontFamily: F.ui, fontSize: 12,
              color: tierBorderColor(hoveredChatCard.tier),
              fontWeight: 800, marginBottom: 6,
            }}>
              {tierDisplayName(hoveredChatCard.tier)}
            </div>
          )}
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.body, lineHeight: 1.45 }}>
            {hoveredChatCard.description}
          </div>
        </FloatingHoverPopup>
      )}

      {appliedCardHover && (
        <FloatingHoverPopup
          anchor={appliedCardAnchor}
          borderColor={appliedCardHover.hostile ? C.red : C.blue}
          width={240}
        >
          <div style={{
            width: '100%', aspectRatio: '1.4', marginBottom: 8,
            ...sk(appliedCardHover.hostile ? C.red : C.blue, true),
            overflow: 'hidden', backgroundColor: '#F2F0EB',
          }}>
            {appliedCardHover.imageUrl ? (
              <img src={appliedCardHover.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <AugmentNoPhoto
                name={appliedCardHover.name}
                accent={appliedCardHover.hostile ? C.red : C.blue}
                compact
              />
            )}
          </div>
          <div style={{ fontFamily: F.brand, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            {appliedCardHover.name}
          </div>
          {appliedCardHover.meta && (
            <div style={{
              fontFamily: F.ui, fontSize: 12,
              color: appliedCardHover.hostile ? C.red : C.blue,
              fontWeight: 800, marginBottom: 6,
            }}>
              {appliedCardHover.meta}
            </div>
          )}
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.body, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
            {appliedCardHover.description}
          </div>
        </FloatingHoverPopup>
      )}
    </div>
  )
}
