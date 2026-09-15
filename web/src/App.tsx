import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useGame, type ChatMsg, type RoomMember } from './GameContext'
import { PLAYABLE_GENRES, emptyGenreCounts, type GenreName } from './genres'
import { playSfx } from './sfx'
import { serverNow } from './clockSync'
import { HiddenYouTube, FlameKimOverlayBgm, PeckSongBgm, RoomSongPersistentBgm } from './youtubePlayer'
import { HomeScreen, LoginScreen } from './screens/AuthScreens'
import { BankScreen } from './screens/BankScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import type { Screen } from './screens/types'
import {
  AppliedAugmentChip,
  AugmentNoPhoto,
  AugmentTargetBadge,
  Avatar,
  Btn,
  C,
  CHAT_COLORS,
  chatColorOf,
  CrumpleOverlay,
  Equalizer,
  F,
  FitAnswer,
  FloatingHoverPopup,
  GenreIntroFly,
  GenreSongCountRow,
  HOSTILE_AUGMENT_TYPES,
  MarginLine,
  NoteCard,
  PencilFilters,
  PrismKeyframes,
  RoundTimer,
  SketchInput,
  Tag,
  crumpledPaper,
  notebookLines,
  prismBackdrop,
  sk,
  tierBorderColor,
  tierDisplayName,
} from './ui'


// ── Lobby ──────────────────────────────────────────────────────

function LobbyScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, rooms, connected, pingMs, musicVolume, sfxVolume, setMusicVolume, setSfxVolume, createRoom, joinRoom, logout } = useGame()
  const [search, setSearch] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const filtered = rooms.filter(r => r.name.includes(search) || r.genre.includes(search))

  useEffect(() => {
    if (!user) nav('login')
  }, [user, nav])

  const makeRoom = async (isPrivate: boolean) => {
    setBusy(true); setErr('')
    try {
      await createRoom({
        name: `${user?.nickname || '나'}의 방`,
        genreCounts: emptyGenreCounts('한국노래', 20),
        maxPlayers: 10,
        isPrivate,
      })
      nav('waiting')
    } catch (e) { setErr(e instanceof Error ? e.message : '실패') }
    finally { setBusy(false) }
  }

  const enter = async (roomId: string) => {
    setBusy(true); setErr('')
    try {
      // 역할(플레이어/관전)은 방 안에서 전환 · 입장 시엔 플레이어 우선(만원이면 서버가 관전으로)
      await joinRoom({ roomId })
      nav('waiting')
    } catch (e) { setErr(e instanceof Error ? e.message : '실패') }
    finally { setBusy(false) }
  }

  const enterCode = async () => {
    if (!code.trim()) return
    setBusy(true); setErr('')
    try {
      await joinRoom({ code: code.trim() })
      nav('waiting')
    } catch (e) { setErr(e instanceof Error ? e.message : '실패') }
    finally { setBusy(false) }
  }

  const pingColor = !connected ? C.red : pingMs == null ? C.muted : pingMs < 80 ? C.green : pingMs < 160 ? C.blue : C.red

  return (
    <div style={{ minHeight: '100vh', ...notebookLines, position: 'relative' }}>
      <MarginLine />
      <div style={{
        backgroundColor: C.card,
        borderBottom: `2.5px solid ${C.graphite}`,
        boxShadow: `0 3px 0 ${C.graphite}60, 0 5px 0 ${C.graphite}18`,
        padding: '14px 36px',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, zIndex: 10,
        filter: 'url(#pencilRough)',
      }}>
        <div style={{ fontFamily: F.brand, fontSize: 30, fontWeight: 700, color: C.text, flex: 1, lineHeight: 1 }}>
          증강노맞
        </div>
        <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: connected ? C.green : C.red, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{connected ? '● 연결됨' : '○ 연결 중…'}</span>
          {connected && (
            <span style={{ color: pingColor, fontVariantNumeric: 'tabular-nums' }}>
              {pingMs == null ? '…ms' : `${pingMs}ms`}
            </span>
          )}
        </div>
        <div style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 700, color: C.muted }}>
          안녕하세요,{' '}
          <strong style={{ color: C.body, fontWeight: 900 }}>{user?.nickname || '?'}</strong> 님!
        </div>
        <div
          onClick={() => nav('profile')}
          title="프로필 수정"
          style={{ cursor: 'pointer' }}
        >
          <Avatar name={user?.nickname} url={user?.avatarUrl} size={40} />
        </div>
        {user?.isAdmin && <Btn size="sm" variant="yellow" onClick={() => nav('bank')}>문제 은행</Btn>}
        <Btn size="sm" onClick={() => nav('profile')}>프로필</Btn>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, width: 36 }}>노래</span>
            <input
              type="range" min={0} max={100} value={musicVolume}
              onChange={e => setMusicVolume(Number(e.target.value))}
              style={{ width: 80, accentColor: C.blue }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, width: 36 }}>효과</span>
            <input
              type="range" min={0} max={100} value={sfxVolume}
              onChange={e => setSfxVolume(Number(e.target.value))}
              onMouseUp={() => playSfx('click')}
              style={{ width: 80, accentColor: C.blue }}
            />
          </div>
        </div>
        <Btn size="sm" onClick={() => { logout(); nav('home') }}>로그아웃</Btn>
      </div>

      <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 24px 40px', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn variant="primary" size="md" onClick={() => makeRoom(false)} disabled={busy || !connected}>+ 공개 방</Btn>
          <Btn size="md" onClick={() => makeRoom(true)} disabled={busy || !connected}>+ 비공개 방</Btn>
          <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 220 }}>
            <SketchInput
              value={code} onChange={setCode}
              placeholder="비공개 방 초대코드..."
              style={{ flex: 1, fontSize: '15px', padding: '10px 14px', fontWeight: 700 }}
            />
            <Btn onClick={enterCode} disabled={busy || !connected}>
              코드 입장
            </Btn>
          </div>
          <SketchInput
            value={search} onChange={setSearch}
            placeholder="방 이름 / 장르 검색..."
            style={{ width: 230, fontSize: '15px', padding: '10px 14px', fontWeight: 700 }}
          />
        </div>

        {err && <div style={{ fontFamily: F.ui, color: C.red, marginBottom: 12 }}>{err}</div>}

        <div style={{
          fontFamily: F.ui, fontSize: 13, fontWeight: 800,
          color: C.muted, marginBottom: 14, paddingLeft: 2,
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          공개 방 목록 ({filtered.length})
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.length === 0 && (
            <div style={{ ...sk(), backgroundColor: C.card, padding: 24, fontFamily: F.ui, color: C.muted, textAlign: 'center' }}>
              공개 방이 없습니다. 방을 만들어보세요!
            </div>
          )}
          {filtered.map(room => {
            const playerFull = room.players >= room.max
            const spectFull = (room.spectators ?? 0) >= (room.maxSpectators ?? 4)
            const bothFull = playerFull && spectFull
            const canSpectFallback = playerFull && !spectFull
            return (
              <div
                key={room.id}
                onClick={() => !bothFull && !busy && enter(room.id)}
                style={{
                  ...sk(),
                  backgroundColor: C.card,
                  padding: '16px 24px',
                  display: 'flex', alignItems: 'center', gap: 16,
                  cursor: bothFull ? 'not-allowed' : 'pointer',
                  opacity: bothFull ? 0.72 : 1,
                }}
              >
                <Tag color={C.blue}>{room.genre}</Tag>
                {room.gameMode === 'reading' && <Tag color={C.red}>리딩</Tag>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: F.ui, fontSize: 17, fontWeight: 800,
                    color: C.body, lineHeight: 1.3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {room.priv ? '🔒 ' : ''}{room.name}
                  </div>
                </div>
                <span style={{
                  fontFamily: F.ui, fontSize: 15, fontWeight: 900,
                  color: room.players / room.max > 0.8 ? C.red : C.body, minWidth: 72, textAlign: 'right',
                }}>
                  {room.players}/{room.max}
                  {(room.spectators ?? 0) > 0 ? ` · 관${room.spectators}` : ''}
                </span>
                <Btn size="sm" variant={bothFull ? 'default' : 'primary'} disabled={bothFull || busy}>
                  {bothFull ? '가득 참' : canSpectFallback ? '관전으로' : '입장'}
                </Btn>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Waiting ────────────────────────────────────────────────────

/** 채팅 하단 고정 판정 여유 (px) */
const CHAT_BOTTOM_EPS = 48

/**
 * 채팅 자동 스크롤.
 * - 맨 아래에 붙어 있으면 새 글·이미지 로딩으로 높이가 변해도 계속 따라 내려간다.
 * - 휠/드래그로 위로 올리는 순간에만 자동 스크롤을 멈춘다.
 *   (메시지 2개가 연달아 오면 높이가 먼저 늘어 nearBottom이 잠깐 false가 되는데,
 *    그걸 사용자 스크롤로 오인해 고정이 풀리던 문제를 막는다)
 * - 다시 맨 아래까지 내리면(또는 「최근 채팅으로」) 자동 스크롤을 재개한다.
 */
function useStickyChatScroll(dep: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  /** 우리가 건 스크롤인지 (사용자 스크롤과 구분) */
  const autoRef = useRef(false)
  /** pin 세대 — 연속 pin 시 이전 rAF가 auto 플래그를 너무 빨리 끄는 것 방지 */
  const pinGenRef = useRef(0)
  /** 「최근 채팅으로」 직후 관성/잔여 휠로 다시 풀리는 것 방지 */
  const jumpGuardUntilRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const [stick, setStick] = useState(true)
  const [hasNew, setHasNew] = useState(false)

  const isNearBottom = useCallback((el: HTMLDivElement) => (
    el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_BOTTOM_EPS
  ), [])

  const pin = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const gen = ++pinGenRef.current
    autoRef.current = true
    el.scrollTop = el.scrollHeight
    lastScrollTopRef.current = el.scrollTop
    // 연달아 온 메시지·버튼 제거 등으로 높이가 한 박자 늦게 바뀌는 경우 재고정
    requestAnimationFrame(() => {
      if (gen !== pinGenRef.current) return
      const cur = scrollRef.current
      if (cur && stickRef.current) {
        cur.scrollTop = cur.scrollHeight
        lastScrollTopRef.current = cur.scrollTop
      }
      requestAnimationFrame(() => {
        if (gen !== pinGenRef.current) return
        const cur2 = scrollRef.current
        if (cur2 && stickRef.current) {
          cur2.scrollTop = cur2.scrollHeight
          lastScrollTopRef.current = cur2.scrollTop
        }
        autoRef.current = false
      })
    })
  }, [])

  const setStickBoth = useCallback((v: boolean) => {
    if (stickRef.current === v) return
    stickRef.current = v
    setStick(v)
  }, [])

  // 새 메시지
  useEffect(() => {
    if (stickRef.current) {
      pin()
      setHasNew(false)
    } else {
      setHasNew(true)
    }
  }, [dep, pin])

  // 아바타 로딩·줄바꿈 등으로 나중에 높이가 늘어도 하단 고정 유지
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) pin()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [pin])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop
    const prevTop = lastScrollTopRef.current
    lastScrollTopRef.current = top
    if (autoRef.current) return

    const nearBottom = isNearBottom(el)
    if (nearBottom) {
      setStickBoth(true)
      setHasNew(false)
      return
    }

    // 점프 직후 가드
    if (performance.now() < jumpGuardUntilRef.current) return

    // 사용자가 위로 스크롤한 경우에만 고정 해제.
    // 메시지 동시 도착으로 scrollHeight만 커진 경우(top 동일·증가)는 무시하고, 붙어 있으면 다시 붙인다.
    if (top < prevTop - 1) {
      setStickBoth(false)
      return
    }
    if (stickRef.current) pin()
  }, [isNearBottom, pin, setStickBoth])

  // 휠로 위로 올리는 순간 바로 끊음 (관성으로 도로 끌려 내려가는 것 방지)
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (performance.now() < jumpGuardUntilRef.current) return
    if (e.deltaY >= 0) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.clientHeight <= CHAT_BOTTOM_EPS) return
    setStickBoth(false)
  }, [setStickBoth])

  const jumpToLatest = useCallback(() => {
    stickRef.current = true
    setStick(true)
    setHasNew(false)
    jumpGuardUntilRef.current = performance.now() + 450
    pin()
    window.setTimeout(() => {
      if (!stickRef.current) return
      pin()
    }, 40)
    window.setTimeout(() => {
      if (!stickRef.current) return
      pin()
    }, 120)
  }, [pin])

  return { scrollRef, contentRef, stick, hasNew, onScroll, onWheel, jumpToLatest }
}

function WaitingScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, roomCode, chats, setReady, setSpectator, setChatColor, updateSettings, startGame, sendChat, leaveRoom } = useGame()
  const [chatInput, setChatInput] = useState('')
  const [err, setErr] = useState('')
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [roleBusy, setRoleBusy] = useState(false)
  /** 비공개 초대코드 · 기본 숨김 (화면 공유/몰래보기 방지) */
  const [showInviteCode, setShowInviteCode] = useState(false)
  const {
    scrollRef: chatRef,
    contentRef: chatContentRef,
    stick: chatStickBottom,
    hasNew: chatHasNew,
    onScroll: onChatScroll,
    onWheel: onChatWheel,
    jumpToLatest: jumpToLatestChat,
  } = useStickyChatScroll(chats)

  useEffect(() => {
    if (!room) nav('lobby')
  }, [room, nav])

  useEffect(() => {
    if (room?.status === 'playing' || room?.status === 'revealing' || room?.status === 'countdown' || room?.status === 'duel') nav('game')
    if (room?.status === 'augment') nav('augment')
  }, [room?.status, nav])

  if (!room || !user) return null

  const players = room.members
  const me = players.find(p => p.userId === user.id)
  const isHost = room.hostId === user.id
  const playerList = players.filter((p) => !p.isSpectator)
  const spectatorList = players.filter((p) => p.isSpectator)
  const maxSpectators = room.maxSpectators ?? 4
  const qCount = PLAYABLE_GENRES.reduce((sum, g) => sum + (room.genreCounts[g] || 0), 0)

  const onToggleSpectator = async () => {
    if (!me || roleBusy) return
    setErr('')
    setRoleBusy(true)
    try {
      await setSpectator(!me.isSpectator)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '역할 변경 실패')
    } finally {
      setRoleBusy(false)
    }
  }

  const onPickChatColor = async (idx: number) => {
    setErr('')
    try { await setChatColor(idx) }
    catch (e) { setErr(e instanceof Error ? e.message : '색 변경 실패') }
  }

  const send = () => {
    if (!chatInput.trim()) return
    sendChat(chatInput.trim())
    setChatInput('')
  }

  const onStart = async () => {
    setErr('')
    try { await startGame() }
    catch (e) { setErr(e instanceof Error ? e.message : '시작 실패') }
  }

  const setGenreCount = (genre: GenreName, n: number) => {
    if (!isHost) return
    const max = room.genreBankCounts?.[genre] ?? 0
    const clamped = Math.max(0, Math.min(max, Math.floor(n)))
    const next: Record<string, number> = {}
    for (const g of PLAYABLE_GENRES) next[g] = g === genre ? clamped : (room.genreCounts[g] || 0)
    updateSettings({ genreCounts: next })
  }

  const selBtn = (val: string | number, current: string | number) => ({
    ...sk(current === val ? C.blue : C.graphite, true),
    backgroundColor: current === val ? C.blueLight : C.card,
    color: current === val ? C.blue : C.body,
    fontFamily: F.ui,
    fontSize: '14px',
    fontWeight: 800 as const,
    padding: '5px 14px',
    cursor: isHost ? 'pointer' : 'default',
    border: `2px solid ${current === val ? C.blue : C.graphite}`,
    borderRadius: '5px 4px 6px 4px / 4px 5px 4px 5px',
    outline: 'none',
    filter: 'url(#pencilRough)',
  })

  const inviteCode = (roomCode || room.code || '').trim()
  const maskedInvite = inviteCode ? '•'.repeat(Math.max(6, inviteCode.length)) : '••••••'
  const copyInvite = () => {
    if (!inviteCode) return
    void navigator.clipboard?.writeText(inviteCode)
  }

  return (
    <div style={{ minHeight: '100vh', ...notebookLines }}>
      <div style={{ backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`, boxShadow: `0 3px 0 ${C.graphite}50`, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 14, filter: 'url(#pencilRough)' }}>
        <Btn size="sm" onClick={() => setLeaveOpen(true)}>← 로비</Btn>
        <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, flex: 1, color: C.body }}>{room.name}</div>
        {room.isPrivate ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            ...sk(C.blue, true), backgroundColor: C.blueLight, padding: '6px 12px',
          }}>
            <span style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue }}>비공개</span>
            <span style={{
              fontFamily: F.ui, fontSize: 16, fontWeight: 900, color: C.body,
              letterSpacing: showInviteCode ? 1.5 : 2,
              minWidth: 72, textAlign: 'center',
            }}>
              {showInviteCode ? (inviteCode || '······') : maskedInvite}
            </span>
            {!!inviteCode && (
              <>
                <button
                  type="button"
                  onClick={() => setShowInviteCode((v) => !v)}
                  style={{
                    fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  {showInviteCode ? '안보기' : '보기'}
                </button>
                <button
                  type="button"
                  onClick={copyInvite}
                  style={{
                    fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  복사
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: C.muted }}>공개 방</div>
        )}
        <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.muted }}>
          {playerList.filter(p => p.ready).length}/{playerList.length} 준비 · 관전 {spectatorList.length}/{maxSpectators}
        </div>
      </div>

      <div style={{ maxWidth: 1020, margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <NoteCard>
            <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 16, color: C.body }}>
              참가자 ({playerList.length}/{room.maxPlayers}) · 관전 ({spectatorList.length}/{maxSpectators})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {players.map(p => (
                <div key={p.userId} style={{
                  ...sk(p.isSpectator ? C.muted : (p.ready ? C.green : C.graphite), true),
                  backgroundColor: p.isSpectator ? '#F0EEE8' : (p.ready ? C.greenLight : C.card),
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <Avatar
                    name={p.nickname}
                    url={p.avatarUrl}
                    size={32}
                    host={p.isHost}
                    border={p.isSpectator ? null : chatColorOf(p.chatColor)?.line}
                    tint={p.isSpectator ? null : chatColorOf(p.chatColor)?.fill}
                  />
                  <div style={{
                    flex: 1, fontFamily: F.ui, fontSize: 15, fontWeight: 800,
                    color: (!p.isSpectator && chatColorOf(p.chatColor)?.line) || undefined,
                  }}>
                    {p.nickname}{p.isHost ? ' 👑' : ''}
                    {p.isSpectator ? ' · 관전' : ''}
                  </div>
                  <div style={{ fontFamily: F.ui, fontSize: 13, color: p.isSpectator ? C.muted : (p.ready ? C.green : C.muted) }}>
                    {p.isSpectator ? '관전' : (p.ready ? '준비' : '대기')}
                  </div>
                </div>
              ))}
            </div>
          </NoteCard>

          <NoteCard>
            <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 12 }}>채팅</div>
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <div
                ref={chatRef}
                onScroll={onChatScroll}
                onWheel={onChatWheel}
                style={{ height: 220, overflowY: 'auto' }}
              >
                <div ref={chatContentRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {chats.map(m => {
                    const sender = players.find((p) => p.userId === m.userId)
                    const cc = sender && !sender.isSpectator ? chatColorOf(sender.chatColor) : null
                    return (
                      <div key={m.id} style={{ fontFamily: F.chat, fontSize: 18 }}>
                        <strong style={{ color: m.system ? C.green : (cc?.line || C.blue) }}>{m.nickname}</strong>: {m.text}
                      </div>
                    )
                  })}
                </div>
              </div>
              {!chatStickBottom && (
                <button
                  type="button"
                  onClick={jumpToLatestChat}
                  style={{
                    position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                    fontFamily: F.ui, fontSize: 13, fontWeight: 800, padding: '6px 12px',
                    ...sk(C.blue, true), backgroundColor: C.blueLight, color: C.blue, cursor: 'pointer',
                    whiteSpace: 'nowrap', zIndex: 2,
                  }}
                >
                  최근 채팅으로{chatHasNew ? ' · 새 메시지' : ''}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <SketchInput value={chatInput} onChange={setChatInput} onKeyDown={e => e.key === 'Enter' && send()} placeholder="메시지..." style={{ flex: 1 }} />
              <Btn onClick={send}>전송</Btn>
            </div>
          </NoteCard>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <NoteCard>
            <div style={{ fontFamily: F.ui, fontSize: 16, fontWeight: 900, marginBottom: 12 }}>방 설정 {isHost ? '' : '(방장만)'}</div>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>공개 여부</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <button
                type="button"
                style={selBtn('public', room.isPrivate ? 'private' : 'public')}
                onClick={() => isHost && updateSettings({ isPrivate: false })}
              >
                공개
              </button>
              <button
                type="button"
                style={selBtn('private', room.isPrivate ? 'private' : 'public')}
                onClick={() => isHost && updateSettings({ isPrivate: true })}
              >
                비공개
              </button>
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>모드</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <button
                type="button"
                style={selBtn('nomatch', room.gameMode || 'nomatch')}
                onClick={() => isHost && updateSettings({ gameMode: 'nomatch' })}
              >
                노맞
              </button>
              <button
                type="button"
                style={selBtn('reading', room.gameMode || 'nomatch')}
                onClick={() => isHost && updateSettings({ gameMode: 'reading' })}
              >
                리딩방
              </button>
            </div>
            {(room.gameMode || 'nomatch') === 'reading' ? (
              <>
              <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
                증강 OFF · 제목만 · 힌트/초성 없음 · 투표·풀이 각 15초 · 3-2-1 중 정지 · 풀이 시 처음부터 · 정답 +3/−3 · 총점 0 미만 없음 · 정배·동배 +1 · 역배 +2
              </div>
              <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>
                목표 점수: {room.readingTargetScore ?? 50}점 (최소 50)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {[50, 60, 70, 80, 100, 120].map((n) => (
                  <button
                    key={n}
                    type="button"
                    style={selBtn(n, room.readingTargetScore ?? 50)}
                    onClick={() => isHost && updateSettings({ readingTargetScore: n })}
                  >
                    {n}점
                  </button>
                ))}
              </div>
              </>
            ) : (
              <>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>정답 모드</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <button
                type="button"
                style={selBtn('title', room.answerMode || 'title_artist')}
                onClick={() => isHost && updateSettings({ answerMode: 'title' })}
              >
                제목만
              </button>
              <button
                type="button"
                style={selBtn('title_artist', room.answerMode || 'title_artist')}
                onClick={() => isHost && updateSettings({ answerMode: 'title_artist' })}
              >
                제목+가수
              </button>
            </div>
            {(room.answerMode || 'title_artist') === 'title' && (
              <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginTop: -8, marginBottom: 14 }}>
                한국·일본·해외 장르는 20초 남았을 때 가수를 힌트로 알려줍니다 (애니·버튜버·게임은 없음)
              </div>
            )}
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>증강</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <button
                type="button"
                style={selBtn(1, room.augmentsEnabled !== false ? 1 : 0)}
                onClick={() => isHost && updateSettings({ augmentsEnabled: true })}
              >
                ON
              </button>
              <button
                type="button"
                style={selBtn(0, room.augmentsEnabled !== false ? 1 : 0)}
                onClick={() => isHost && updateSettings({ augmentsEnabled: false })}
              >
                OFF
              </button>
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginBottom: 14 }}>
              {room.augmentsEnabled !== false
                ? '20문제마다 선택 · 곡 전 3-2-1 (시작 시 증강 없음)'
                : '증강 없음 · 곡 시작 전 3-2-1만'}
            </div>
              </>
            )}
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 10 }}>
              장르별 출제 수 (총 {qCount}곡) · 문제은행 보유량까지만 설정 가능
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
              {PLAYABLE_GENRES.map(g => {
                const bankMax = room.genreBankCounts?.[g] ?? 0
                return (
                  <GenreSongCountRow
                    key={g}
                    genre={`${g} (은행 ${bankMax})`}
                    value={Math.min(room.genreCounts[g] || 0, bankMax)}
                    max={bankMax}
                    disabled={!isHost || bankMax === 0}
                    onChange={(n) => setGenreCount(g, n)}
                  />
                )
              })}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>
              최근곡 중복 방지
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <button
                type="button"
                style={selBtn(1, (room.recentSongPenalty ?? 1) > 0 ? 1 : 0)}
                onClick={() => isHost && updateSettings({ recentSongPenalty: 1 })}
              >
                ON
              </button>
              <button
                type="button"
                style={selBtn(0, (room.recentSongPenalty ?? 1) > 0 ? 1 : 0)}
                onClick={() => isHost && updateSettings({ recentSongPenalty: 0 })}
              >
                OFF
              </button>
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>최대 인원: {room.maxPlayers}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[4, 6, 8, 10].map(n => (
                <button key={n} type="button" style={selBtn(n, room.maxPlayers)} onClick={() => isHost && updateSettings({ maxPlayers: n })}>{n}명</button>
              ))}
            </div>
          </NoteCard>

          <NoteCard>
            <div style={{ fontFamily: F.ui, fontSize: 16, fontWeight: 900, marginBottom: 8 }}>내 채팅 색</div>
            {me?.isSpectator ? (
              <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted }}>
                관전 중에는 색이 없습니다
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {CHAT_COLORS.map((c, i) => {
                    const picked = me?.chatColor === i
                    const takenBy = playerList.find((p) => p.userId !== user.id && p.chatColor === i)
                    return (
                      <button
                        key={c.name}
                        type="button"
                        title={takenBy ? `${c.name} · ${takenBy.nickname}` : c.name}
                        onClick={() => onPickChatColor(i)}
                        style={{
                          width: 34, height: 34, cursor: 'pointer', padding: 0,
                          ...sk(picked ? C.graphite : c.line, true),
                          backgroundColor: c.fill,
                          borderWidth: picked ? 3.5 : 2.5,
                          fontFamily: F.ui, fontSize: 12, fontWeight: 900, color: c.line,
                          opacity: takenBy && !picked ? 0.45 : 1,
                        }}
                      >
                        {picked ? '✓' : takenBy ? takenBy.nickname[0] : ''}
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginTop: 8 }}>
                  10개 중 하나 · 흐린 건 다른 사람이 쓰는 색
                </div>
              </>
            )}
          </NoteCard>

          {err && <div style={{ fontFamily: F.ui, color: C.red }}>{err}</div>}
          <Btn
            fullWidth
            disabled={roleBusy}
            onClick={onToggleSpectator}
            variant={me?.isSpectator ? 'primary' : 'default'}
          >
            {me?.isSpectator ? '플레이어로 참가' : '관전으로 전환'}
          </Btn>
          {me?.isSpectator ? (
            <div style={{
              fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.muted, textAlign: 'center',
              padding: '12px 8px', lineHeight: 1.5,
            }}>
              관전 중 · 채팅만 · 방장도 설정·시작 가능
            </div>
          ) : (
            <Btn variant={me?.ready ? 'default' : 'primary'} fullWidth onClick={setReady}>
              {me?.ready ? '준비 취소' : '준비하기'}
            </Btn>
          )}
          {isHost && (
            <Btn variant="primary" fullWidth size="lg" onClick={onStart}>게임 시작</Btn>
          )}
        </div>
      </div>

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
    </div>
  )
}

// ── Game ───────────────────────────────────────────────────────

/** 증강 사용 — 장르 인트로처럼 크게 떴다가 서서히 사라진다 (로그가 왼쪽이라 놓치기 쉬움) */
function AugmentUseNotice({
  name,
  message,
  onClose,
}: {
  name: string
  message: string
  onClose: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 'min(15vh, 140px)',
        // 알림이 화면을 먹지 않게 · 알림 상자만 클릭 가능
        pointerEvents: 'none',
      }}
    >
      <style>{`
        @keyframes augmentNoticeFly {
          0%   { opacity: 0; transform: scale(0.62) translateY(22px); }
          9%   { opacity: 1; transform: scale(1.06) translateY(0); }
          16%  { opacity: 1; transform: scale(1) translateY(0); }
          62%  { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(0.9) translateY(-46px); }
        }
      `}</style>
      <button
        type="button"
        onClick={onClose}
        aria-label="증강 사용 알림 닫기"
        style={{
          pointerEvents: 'auto',
          cursor: 'pointer',
          maxWidth: 'min(760px, calc(100vw - 40px))',
          ...sk(C.blue),
          backgroundColor: 'rgba(244, 248, 255, 0.94)',
          boxShadow: `0 8px 0 ${C.graphite}22, 0 16px 40px rgba(35,91,158,0.18)`,
          padding: '16px 32px 20px',
          color: C.body,
          textAlign: 'center',
          animation: 'augmentNoticeFly 3.4s cubic-bezier(0.22, 1, 0.36, 1) forwards',
          willChange: 'transform, opacity',
        }}
      >
        <div style={{
          fontFamily: F.ui,
          fontSize: 14,
          fontWeight: 900,
          color: C.blue,
          letterSpacing: '0.12em',
          marginBottom: 6,
        }}>
          증강 사용
        </div>
        <div style={{
          fontFamily: F.brand,
          fontSize: name.length > 9 ? 40 : 54,
          fontWeight: 700,
          color: C.blue,
          lineHeight: 1.1,
          marginBottom: 10,
          wordBreak: 'keep-all',
        }}>
          {name}
        </div>
        <div style={{
          fontFamily: F.ui,
          fontSize: 19,
          fontWeight: 750,
          lineHeight: 1.45,
          whiteSpace: 'pre-line',
          wordBreak: 'keep-all',
        }}>
          {message}
        </div>
      </button>
    </div>
  )
}

/** 가호 사용 — 전원 풀스크린 컷신 */
function GahoCutscene({
  item,
  onDone,
}: {
  item: {
    name: string
    description: string
    imageUrl?: string | null
    nickname: string
  }
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in')
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const gaho = C.tierGaho

  useEffect(() => {
    setPhase('in')
    const t1 = setTimeout(() => setPhase('hold'), 900)
    const t2 = setTimeout(() => setPhase('out'), 4200)
    const t3 = setTimeout(() => onDoneRef.current(), 4800)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [item.name, item.nickname])

  const scale = phase === 'in' ? 0.86 : phase === 'out' ? 1.08 : 1
  const opacity = phase === 'out' ? 0 : 1
  const y = phase === 'in' ? '-75vh' : phase === 'out' ? '18px' : '0px'
  const glow = phase === 'hold' ? 0.55 : phase === 'in' ? 0.15 : 0

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 120,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'auto',
      background: phase === 'out'
        ? 'rgba(18,12,28,0)'
        : `radial-gradient(ellipse at 50% 42%, ${gaho}55 0%, rgba(18,12,28,0.92) 55%, rgba(10,8,16,0.97) 100%)`,
      transition: 'background 0.5s ease',
    }}>
      <style>{`
        @keyframes gahoShimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes gahoRing {
          0% { transform: scale(0.6); opacity: 0.7; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes gahoRays {
          from { transform: rotate(0deg) scale(.85); opacity: .15; }
          50% { opacity: .48; }
          to { transform: rotate(360deg) scale(1.1); opacity: .15; }
        }
        @keyframes gahoHorn {
          0%, 100% { transform: translateY(2px) rotate(-8deg) scale(.96); }
          50% { transform: translateY(-4px) rotate(4deg) scale(1.08); }
        }
        @keyframes gahoHornMirror {
          0%, 100% { transform: translateY(2px) scaleX(-1) rotate(-8deg) scale(.96); }
          50% { transform: translateY(-4px) scaleX(-1) rotate(4deg) scale(1.08); }
        }
      `}</style>
      {phase !== 'out' && (
        <div style={{
          position: 'absolute',
          width: 'min(720px, 120vw)',
          aspectRatio: '1',
          borderRadius: '50%',
          background: `repeating-conic-gradient(from 0deg, ${gaho}00 0deg 10deg, #F2E6FF44 10deg 17deg, ${gaho}00 17deg 30deg)`,
          animation: 'gahoRays 8s linear infinite',
          filter: 'blur(1px)',
        }} />
      )}
      {/* 확산 링 */}
      {phase !== 'out' && (
        <>
          <div style={{
            position: 'absolute', width: 280, height: 280, borderRadius: '50%',
            border: `2px solid ${gaho}`,
            animation: 'gahoRing 1.6s ease-out infinite',
            opacity: 0.5,
          }} />
          <div style={{
            position: 'absolute', width: 280, height: 280, borderRadius: '50%',
            border: `1px solid ${gaho}88`,
            animation: 'gahoRing 1.6s ease-out 0.45s infinite',
          }} />
        </>
      )}
      <div style={{
        width: 'min(340px, 90vw)',
        position: 'relative',
        padding: 22,
        textAlign: 'center',
        borderRadius: '18px 14px 20px 12px / 14px 18px 12px 20px',
        background: `linear-gradient(145deg, #2a1f3d 0%, #1a1428 48%, #241a35 100%)`,
        border: `2.5px solid ${gaho}`,
        boxShadow: `
          0 0 ${40 + glow * 60}px ${gaho}${phase === 'hold' ? '88' : '44'},
          0 16px 0 rgba(0,0,0,0.35),
          inset 0 1px 0 rgba(255,255,255,0.12)
        `,
        transform: `translateY(${y}) scale(${scale})`,
        opacity,
        transition: 'transform 0.9s cubic-bezier(.16,1.18,.3,1), opacity 0.45s ease, box-shadow 0.4s ease',
      }}>
        {phase !== 'in' && (
          <>
            <div aria-hidden style={{
              position: 'absolute', left: -48, top: 34, fontSize: 42,
              filter: `drop-shadow(0 0 12px ${gaho})`,
              animation: 'gahoHorn 1s ease-in-out infinite',
            }}>📯</div>
            <div aria-hidden style={{
              position: 'absolute', right: -48, top: 34, fontSize: 42,
              filter: `drop-shadow(0 0 12px ${gaho})`,
              animation: 'gahoHornMirror 1s ease-in-out .2s infinite',
            }}>📯</div>
          </>
        )}
        <div style={{
          fontFamily: F.ui,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '0.22em',
          marginBottom: 8,
          backgroundImage: `linear-gradient(90deg, ${gaho}, #E8D5FF, ${gaho}, #E8D5FF)`,
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          animation: phase === 'hold' ? 'gahoShimmer 2.2s linear infinite' : undefined,
        }}>
          프리즘 강림
        </div>
        <div style={{
          fontFamily: F.ui, fontSize: 11, fontWeight: 700,
          color: '#E8D5FF', letterSpacing: '0.12em', marginBottom: 6, opacity: 0.82,
        }}>
          천상의 나팔이 울립니다
        </div>
        <div style={{
          fontFamily: F.ui, fontSize: 15, fontWeight: 700,
          color: '#C9B8E0', marginBottom: 14,
        }}>
          {item.nickname}님의 프리즘
        </div>
        <div style={{
          width: '100%', aspectRatio: '1', marginBottom: 14,
          borderRadius: '12px 10px 14px 8px / 10px 14px 8px 12px',
          overflow: 'hidden',
          border: `2px solid ${gaho}aa`,
          boxShadow: `0 0 24px ${gaho}55, inset 0 0 30px rgba(0,0,0,0.35)`,
          backgroundColor: '#1a1428',
        }}>
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: 'saturate(1.15) contrast(1.05)' }}
            />
          ) : (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: F.brand, fontSize: 32, fontWeight: 700, color: gaho, padding: 16, textAlign: 'center',
            }}>
              {item.name}
            </div>
          )}
        </div>
        <div style={{
          fontFamily: F.brand, fontSize: 30, fontWeight: 700,
          color: '#F4EEFF', marginBottom: 10, lineHeight: 1.15,
          textShadow: `0 0 18px ${gaho}99`,
        }}>
          {item.name}
        </div>
        {item.description && (
          <div style={{
            fontFamily: F.ui, fontSize: 14, color: '#D4C6E8',
            lineHeight: 1.5, opacity: 0.95,
          }}>
            {item.description}
          </div>
        )}
      </div>
    </div>
  )
}


/**
 * 채팅 목록은 GameScreen의 1초 타이머 리렌더와 분리한다.
 * props가 모두 안정적인 참조라 새 메시지가 올 때만 다시 그린다.
 */
/** 순위표도 시간과 무관하다 — room:state로 명단·점수가 바뀔 때만 다시 그린다. */
const GameScoreboard = memo(function GameScoreboard({
  ranked,
  spectators,
  selfId,
  style,
}: {
  ranked: RoomMember[]
  spectators: RoomMember[]
  selfId: string
  style?: React.CSSProperties
}) {
  const surf = C.panel
  return (
    <div style={{
      ...sk(), backgroundColor: surf, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, minWidth: 0,
      ...style,
    }}>
      <div style={{ fontFamily: F.ui, fontSize: 20, color: C.muted, textAlign: 'center', flexShrink: 0 }}>전체 순위</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {ranked.map((s, i) => {
          const mine = s.userId === selfId
          // 채팅에서 고른 색을 순위표에도 그대로 (관전자는 색 없음)
          const cc = chatColorOf(s.chatColor)
          const line = cc?.line || (mine ? C.blue : C.graphite)
          const nameColor = cc?.line || (mine ? C.blue : C.body)
          return (
            <div key={s.userId} style={{
              display: 'grid', gridTemplateColumns: '40px 36px 1fr auto', gap: 8, alignItems: 'center',
              padding: '10px 10px', ...sk(line, true),
              backgroundColor: cc?.fill || (mine ? C.blueLight : surf),
              borderWidth: mine ? 3.5 : 2.5,
              // 끊긴 사람은 자리·점수를 지켜주되 지금 못 맞힌다는 걸 보이게
              opacity: s.disconnected ? 0.45 : 1,
            }}>
              <span style={{ fontFamily: F.ui, fontSize: 17, fontWeight: mine ? 900 : 500, color: nameColor, textAlign: 'center' }}>{i + 1}</span>
              <Avatar name={s.nickname} url={s.avatarUrl} size={32} border={cc?.line} tint={cc?.fill} />
              <span style={{ fontFamily: F.ui, fontSize: 17, fontWeight: mine ? 900 : 500, color: nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.disconnected ? '📵 ' : ''}{s.nickname}{mine ? ' · 나' : ''}
              </span>
              <span style={{ fontFamily: F.ui, fontSize: 17, fontWeight: mine ? 900 : 700, color: C.body }}>{s.score}점</span>
            </div>
          )
        })}
        {spectators.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1.5px dashed ${C.graphite}55` }}>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>관전</div>
            {spectators.map((s) => (
              <div key={s.userId} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', opacity: 0.85,
              }}>
                <Avatar name={s.nickname} url={s.avatarUrl} size={24} />
                <span style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>{s.nickname}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

/** 정답·증강 등 시스템 알림만 모은 로그 (사람 채팅과 분리) */
const ROUND_LOG_DIVIDER_RE = /^-+\d+R?-+$/
const GameLogList = memo(function GameLogList({
  logs,
  setChatCardHover,
  setChatCardAnchor,
}: {
  logs: ChatMsg[]
  setChatCardHover: (id: number | null) => void
  setChatCardAnchor: (rect: DOMRect | null) => void
}) {
  return (
    <>
      {logs.map((msg) => {
        const dividerMatch = msg.text.trim().match(/^-+(\d+)R?-+$/)
        if (dividerMatch) {
          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '2px 2px',
                minWidth: 0,
                opacity: 0.85,
              }}
            >
              <div style={{ flex: 1, height: 1, background: C.muted, opacity: 0.35 }} />
              <div style={{
                fontFamily: F.ui,
                fontSize: 12,
                fontWeight: 800,
                color: C.muted,
                letterSpacing: 0.4,
                whiteSpace: 'nowrap',
              }}>
                {dividerMatch[1]}R
              </div>
              <div style={{ flex: 1, height: 1, background: C.muted, opacity: 0.35 }} />
            </div>
          )
        }
        return (
        <div
          key={msg.id}
          style={{ display: 'flex', position: 'relative', opacity: msg.spectator ? 0.55 : 1, minWidth: 0 }}
          onMouseEnter={(e) => {
            if (!msg.augmentCard) return
            setChatCardHover(msg.id)
            setChatCardAnchor(e.currentTarget.getBoundingClientRect())
          }}
          onMouseLeave={() => {
            setChatCardHover(null)
            setChatCardAnchor(null)
          }}
        >
          <div style={{
            ...sk(msg.augmentCard ? C.red : C.green, true),
            backgroundColor: msg.augmentCard ? C.redLight : C.greenLight,
            padding: '6px 10px', fontFamily: F.ui, fontSize: 14, lineHeight: 1.4,
            color: msg.augmentCard ? C.red : C.green,
            cursor: msg.augmentCard ? 'help' : undefined,
            width: '100%',
            boxSizing: 'border-box',
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
          }}>{msg.text}</div>
        </div>
        )
      })}
    </>
  )
})

const GameChatList = memo(function GameChatList({
  chats,
  selfId,
  metaByUser,
}: {
  chats: ChatMsg[]
  selfId: string
  metaByUser: Record<string, { color: number | null; avatarUrl: string | null }>
}) {
  return (
    <>
      {chats.map(msg => {
        const self = msg.userId === selfId
        const spect = !!msg.spectator
        // 관전자는 색 없음 · 나머지는 방에서 고른 색
        const meta = metaByUser[msg.userId]
        const cc = spect ? null : chatColorOf(meta?.color)
        const lineColor = cc?.line || C.graphite
        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              justifyContent: 'flex-start',
              gap: 8,
              alignItems: 'flex-end',
              opacity: spect ? 0.52 : 1,
              minWidth: 0,
              width: '100%',
            }}
          >
            <Avatar
              name={msg.nickname}
              url={meta?.avatarUrl}
              size={34}
              border={lineColor}
              tint={spect ? '#E8EEF3' : (cc?.fill || C.blueLight)}
            />
            <div style={{ maxWidth: 'min(76%, 100%)', minWidth: 0, boxSizing: 'border-box' }}>
              <div style={{
                fontFamily: F.ui, fontSize: 14, fontWeight: self ? 800 : 500,
                color: spect ? C.muted : lineColor, marginBottom: 3,
              }}>
                {msg.nickname}{spect ? ' · 관전' : self ? ' · 나' : ''}
              </div>
              <div style={{
                ...sk(lineColor, true),
                backgroundColor: spect
                  ? 'rgba(255,255,255,0.45)'
                  : (cc?.fill || '#FFFFFF'),
                padding: '10px 14px',
                fontFamily: F.chat,
                fontSize: 22,
                fontWeight: 700,
                color: C.body,
                lineHeight: 1.45,
                backdropFilter: spect ? 'blur(2px)' : undefined,
                boxSizing: 'border-box',
                maxWidth: '100%',
                wordBreak: 'keep-all',
                overflowWrap: 'anywhere',
              }}>{msg.text}</div>
            </div>
          </div>
        )
      })}
    </>
  )
})

function GameScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, chats, round, skip, skipVoted, augmentHint, startCountdown, musicVolume, setMusicVolume, sfxVolume, setSfxVolume, submitAnswer, sendChat, voteSkip, useAugment, fetchGahoCandidates, leaveRoom, connected, pingMs, readingAccept, readingPass, readingClaim, readingVote } = useGame()
  const [input, setInput] = useState('')
  const [showUsedList, setShowUsedList] = useState(false)
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
  const needsTargetPick = !isSpectator && (
    me?.heldAugmentEffectType === 'soft_chat_mute'
    || me?.heldAugmentEffectType === 'slow_playback'
    || me?.heldAugmentEffectType === 'answer_proxy'
    || me?.heldAugmentEffectType === 'named_decoy'
    || me?.heldAugmentEffectType === 'peck_song'
    || me?.heldAugmentEffectType === 'sakura_decoy'
    || me?.heldAugmentEffectType === 'answer_delay'
    || me?.heldAugmentEffectType === 'yacha_duel'
    || me?.heldAugmentEffectType === 'polite_suffix'
    || me?.heldAugmentEffectType === 'rock_throw'
    || me?.heldAugmentEffectType === 'steal_chain'
    || me?.heldAugmentEffectType === 'score_steal'
    || me?.heldAugmentEffectType === 'zero_both'
    || me?.heldAugmentEffectType === 'muffled_answer'
    || me?.heldAugmentEffectType === 'accuse_sleep'
    || me?.heldAugmentEffectType === 'gabuki_mark'
    || (me?.heldAugmentEffectType === 'flame_kim' && room.members.filter((m) => !m.isSpectator).length >= 2)
    || me?.heldAugmentEffectType === 'steal_held_augment'
    || me?.heldAugmentEffectType === 'hide_hints'
    || me?.heldAugmentEffectType === 'audio_stutter'
    || me?.heldAugmentEffectType === 'score_share'
    || me?.heldAugmentEffectType === 'destroy_held_augment'
  )
  const isTrumanTargetPick = me?.heldAugmentEffectType === 'sakura_decoy'
  const heldNeedsDebuffFree = !!(me?.heldAugmentEffectType && HOSTILE_AUGMENT_TYPES.has(me.heldAugmentEffectType))
  const targetCandidates = room.members.filter((player) => (
    player.userId !== user.id
    && !player.isSpectator
    && (!heldNeedsDebuffFree || !player.augmentBusy)
    && (me?.heldAugmentEffectType !== 'steal_held_augment' || !!player.heldAugmentId)
  ))
  const busyTargets = heldNeedsDebuffFree
    ? room.members.filter((player) => (
      player.userId !== user.id
      && !player.isSpectator
      && !!player.augmentBusy
    ))
    : []
  const isAutoAugment = me?.heldAugmentEffectType === 'water_ghost'
    || me?.heldAugmentEffectType === 'combo_clear_double'
  const isPassiveHeld = me?.heldAugmentEffectType === 'reflect_debuff'
  const isAutoTriggerHeld = me?.heldAugmentEffectType === 'cha_cha_cha'
  const useLocked = isSpectator || isAutoAugment || isPassiveHeld || isAutoTriggerHeld
  const needsGahoPick = !isSpectator && me?.heldAugmentEffectType === 'gaho_select'
  const needsGenrePick = !isSpectator
    && (me?.heldAugmentEffectType === 'ban_genre' || me?.heldAugmentEffectType === 'genre_early_chosung')
  const genrePickIsBan = me?.heldAugmentEffectType === 'ban_genre'
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
    if (!me?.heldAugmentId || useLocked) return false
    if (needsGahoPick) void openGahoPick()
    else if (needsTargetPick) {
      setSelectedTargetIds([])
      setTargetPickOpen(true)
    }
    else if (needsGenrePick) setGenrePickOpen(true)
    else useAugment()
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
          color: !connected ? C.red : pingMs == null ? C.muted : pingMs < 80 ? C.green : pingMs < 160 ? C.blue : C.red,
          fontVariantNumeric: 'tabular-nums',
          padding: '4px 8px',
          minWidth: 52,
          textAlign: 'right',
        }} title="서버 왕복 지연">
          {connected ? (pingMs == null ? '…ms' : `${pingMs}ms`) : '끊김'}
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
            <div style={{
              flex: 1, ...sk(me?.heldAugmentTier ? tierBorderColor(me.heldAugmentTier) : C.graphite),
              backgroundColor: C.card, padding: '16px 14px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', gap: 12, minHeight: 184, position: 'relative',
              border: me?.heldAugmentTier
                ? `2.5px solid ${tierBorderColor(me.heldAugmentTier)}`
                : undefined,
            }}>
              {me?.heldAugmentId ? (
                <>
                  <div style={{
                    width: 104, height: 104, flexShrink: 0,
                    ...sk(tierBorderColor(me.heldAugmentTier), true),
                    overflow: 'hidden', backgroundColor: '#F2F0EB',
                  }}>
                    {me.heldAugmentImageUrl ? (
                      <img
                        src={me.heldAugmentImageUrl}
                        alt={me.heldAugmentName || '증강'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <AugmentNoPhoto name={me.heldAugmentName} accent={tierBorderColor(me.heldAugmentTier)} compact />
                    )}
                  </div>
                  {me.heldAugmentTier && (
                    <div style={{
                      fontFamily: F.ui, fontSize: 12, fontWeight: 800,
                      color: tierBorderColor(me.heldAugmentTier),
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap',
                    }}>
                      {tierDisplayName(me.heldAugmentTier)}
                      <AugmentTargetBadge effectType={me.heldAugmentEffectType} />
                    </div>
                  )}
                  {!me.heldAugmentTier && me.heldAugmentEffectType && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <AugmentTargetBadge effectType={me.heldAugmentEffectType} />
                    </div>
                  )}
                  <div style={{ fontFamily: F.brand, fontSize: 23, fontWeight: 700, lineHeight: 1.2 }}>
                    {me.heldAugmentName || '보유 중'}
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
                      disabled={useLocked}
                      onClick={() => {
                        if (useLocked) return
                        if (needsGahoPick) void openGahoPick()
                        else if (needsTargetPick) {
                          setSelectedTargetIds([])
                          setTargetPickOpen(true)
                        }
                        else if (needsGenrePick) setGenrePickOpen(true)
                        else useAugment()
                      }}
                    >
                      {isAutoTriggerHeld
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
                    {isAutoTriggerHeld
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
                if (me?.flameKimActive) {
                  chips.push({
                    key: 'flame',
                    name: me.flameKimBy || '불꽃남자김상원',
                    imageUrl: null,
                    hostile: false,
                    meta: `${me.flameKimRoundsLeft ?? '?'}R · ${me.flameKimTarget || '대상'}`,
                    description: '방 노래+불꽃남자 동시 · 본인 득점 시 대상 −1',
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
              {me?.heldAugmentName || '대상 선택'}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>
              {me?.heldAugmentEffectType === 'sakura_decoy'
                ? '트루먼으로 만들 플레이어를 1~2명 선택하세요'
                : me?.heldAugmentEffectType === 'slow_playback'
                ? (me.heldAugmentName?.includes('알레그로')
                  ? '노래를 빠르게 틀어줄 플레이어를 선택하세요'
                  : '노래를 느리게 틀어줄 플레이어를 선택하세요')
                : me?.heldAugmentEffectType === 'audio_stutter'
                ? '노래를 끊을 플레이어를 선택하세요'
                : me?.heldAugmentEffectType === 'hide_hints'
                ? '힌트를 가릴 플레이어를 선택하세요'
                : me?.heldAugmentEffectType === 'score_share'
                ? '기생할 플레이어를 선택하세요 (그 사람 득점만큼 나도 획득)'
                : me?.heldAugmentEffectType === 'answer_proxy'
                  ? '대리할 플레이어를 선택하세요 (대상은 공개되지 않습니다)'
                  : me?.heldAugmentEffectType === 'named_decoy'
                      ? '연애서큘레이션을 틀어줄 플레이어를 선택하세요'
                      : me?.heldAugmentEffectType === 'peck_song'
                      ? '쪼아요~를 들려줄 플레이어를 선택하세요 (그 사람만 들림)'
                      : me?.heldAugmentEffectType === 'answer_delay'
                      ? (me.heldAugmentName?.includes('잠깐')
                        ? '잠깐 기다리게 할 플레이어를 선택하세요'
                        : '제출을 늦출 플레이어를 선택하세요')
                      : me?.heldAugmentEffectType === 'yacha_duel'
                        ? '야차룰로 맞붙을 플레이어를 선택하세요'
                        : me?.heldAugmentEffectType === 'polite_suffix'
                          ? (me.heldAugmentName === '다요'
                            ? '답 끝에 「다요」를 붙이게 할 플레이어를 선택하세요'
                            : '답 끝에 「입니다」를 붙이게 할 플레이어를 선택하세요')
                          : me?.heldAugmentEffectType === 'soft_chat_mute'
                            ? '라운드 시작마다 잠시 채팅·제출을 막을 플레이어를 선택하세요'
                            : me?.heldAugmentEffectType === 'rock_throw'
                              || me?.heldAugmentEffectType === 'steal_chain'
                              ? '돌을 던질 플레이어를 선택하세요'
                              : me?.heldAugmentEffectType === 'score_steal'
                                ? '점수를 뜯을 플레이어를 선택하세요'
                                : me?.heldAugmentEffectType === 'pair_average'
                                  ? '점수를 맞출 플레이어를 선택하세요'
                                  : me?.heldAugmentEffectType === 'accuse_sleep'
                                    ? '범인으로 지목할 플레이어를 선택하세요'
                                    : me?.heldAugmentEffectType === 'gabuki_mark'
                                      ? '가불기를 걸 플레이어를 선택하세요'
                                      : me?.heldAugmentEffectType === 'flame_kim'
                                        ? '불태울 플레이어를 선택하세요'
                                      : me?.heldAugmentEffectType === 'steal_held_augment'
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
                      useAugment({ targetUserId: p.userId })
                      setTargetPickOpen(false)
                    }
                  }}
                >
                  {isTrumanTargetPick && selectedTargetIds.includes(p.userId) ? '✓ ' : ''}{p.nickname}
                </Btn>
              ))}
              {targetCandidates.length === 0 && (
                <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>
                  {me?.heldAugmentEffectType === 'steal_held_augment'
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
                    useAugment({ targetUserIds: selectedTargetIds })
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
              {me?.heldAugmentName || '밴픽'}
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
                    useAugment({ genreName: g })
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
                        useAugment({ gahoAugmentId: g.id })
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

      {augHover && me?.heldAugmentDescription && (
        <FloatingHoverPopup
          anchor={augHoverAnchor}
          borderColor={tierBorderColor(me.heldAugmentTier)}
          width={260}
        >
          <div style={{
            fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue, marginBottom: 6,
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            증강 설명
            <AugmentTargetBadge effectType={me.heldAugmentEffectType} />
          </div>
          {me.heldAugmentName && (
            <div style={{ fontFamily: F.brand, fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              {me.heldAugmentName}
            </div>
          )}
          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
            {me.heldAugmentDescription}
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

// ── Augment ────────────────────────────────────────────────────

function AugmentScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, augmentOffer, pickAugment, rerollAugment, fetchGahoCandidates, pingMs, clockSamples } = useGame()
  const [timer, setTimer] = useState(20)
  const [selected, setSelected] = useState<string | null>(null)
  const [rerollsLeft, setRerollsLeft] = useState(1)
  const [candidates, setCandidates] = useState(augmentOffer?.candidates || [])
  const [gahoOpen, setGahoOpen] = useState(false)
  const [gahoBusy, setGahoBusy] = useState(false)
  const [gahoCandidates, setGahoCandidates] = useState<Array<{
    id: string
    name: string
    description?: string
    tier: string
    imageUrl?: string | null
  }>>([])
  const [selectedGahoId, setSelectedGahoId] = useState<string | null>(null)
  const selectedRef = useRef(selected)
  const selectedGahoIdRef = useRef<string | null>(null)
  const doneRef = useRef(false)
  selectedRef.current = selected
  selectedGahoIdRef.current = selectedGahoId

  useEffect(() => {
    if (room?.status === 'playing' || room?.status === 'revealing' || room?.status === 'countdown' || room?.status === 'duel') nav('game')
    if (room?.status === 'ended') nav('result')
    if (!room) nav('lobby')
  }, [room, nav])

  useEffect(() => {
    if (augmentOffer) {
      setCandidates(augmentOffer.candidates)
      setRerollsLeft(augmentOffer.rerolls)
      if (augmentOffer.endsAt) {
        setTimer(Math.max(0, Math.ceil((augmentOffer.endsAt - serverNow()) / 1000)))
      } else {
        setTimer(augmentOffer.timeoutSec)
      }
      // 가호 고르는 중이면 오퍼 갱신해도 창 유지
      if (!gahoOpen) {
        doneRef.current = false
        setGahoCandidates([])
      }
    }
  }, [augmentOffer, gahoOpen])

  useEffect(() => {
    if (augmentOffer?.candidates) setCandidates(augmentOffer.candidates)
  }, [augmentOffer?.candidates])

  useEffect(() => {
    const endsAt = augmentOffer?.endsAt
    const finalize = () => {
      if (doneRef.current) return
      // 프리즘 선택 중이면 타임아웃에도 랜덤 확정하되, 고른 가호가 있으면 그걸 보냄
      if (gahoOpen && selectedGahoIdRef.current) {
        doneRef.current = true
        pickAugment(selectedRef.current, selectedGahoIdRef.current)
        setGahoOpen(false)
        return
      }
      if (gahoOpen) {
        doneRef.current = true
        pickAugment(selectedRef.current)
        setGahoOpen(false)
        return
      }
      doneRef.current = true
      pickAugment(selectedRef.current)
      setGahoOpen(false)
    }
    const tick = () => {
      if (endsAt) {
        const left = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000))
        setTimer(left)
        if (left <= 0) finalize()
        return
      }
      setTimer((v) => {
        if (v <= 1) {
          finalize()
          return 0
        }
        return v - 1
      })
    }
    tick()
    const t = setInterval(tick, endsAt ? 250 : 1000)
    return () => clearInterval(t)
  }, [augmentOffer?.endsAt, pickAugment, gahoOpen])

  const onReroll = async () => {
    if (rerollsLeft <= 0 || gahoOpen) return
    await rerollAugment()
    setRerollsLeft(r => r - 1)
    setSelected(null)
  }

  const openGahoFromOffer = async (augmentId: string) => {
    setGahoBusy(true)
    setGahoOpen(true)
    setSelectedGahoId(null)
    try {
      const { candidates: list } = await fetchGahoCandidates()
      setGahoCandidates(list)
    } finally {
      setGahoBusy(false)
    }
    // augmentId는 selected로 유지
    setSelected(augmentId)
  }

  const confirm = () => {
    if (!selected || doneRef.current || gahoOpen) return
    const card = candidates.find((c) => c.id === selected)
    if (card?.effectType === 'gaho_select') {
      void openGahoFromOffer(selected)
      return
    }
    doneRef.current = true
    pickAugment(selected)
  }

  const confirmGaho = (gahoId: string) => {
    if (!selected || doneRef.current) return
    doneRef.current = true
    pickAugment(selected, gahoId)
    setGahoOpen(false)
    setSelectedGahoId(null)
  }

  return (
    <div style={{ minHeight: '100vh', ...crumpledPaper, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* 증강 BGM YouTube 제거: 방 노래 플레이어와 동시에 뜨면 다음 라운드 자동재생이 번갈아 깨짐 */}
      <div style={{ ...sk(), backgroundColor: C.card, padding: '36px 32px', maxWidth: 720, width: '100%', textAlign: 'center' }}>
        <div style={{ fontFamily: F.brand, fontSize: 42, fontWeight: 700, marginBottom: 8 }}>증강 선택</div>
        <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, marginBottom: 8 }}>남은 시간 {timer}초 · 1개 보관</div>
        <div style={{
          fontFamily: F.ui,
          fontSize: 13,
          color: clockSamples >= 4 ? C.green : C.muted,
          marginBottom: 10,
        }}>
          {clockSamples >= 4
            ? `재생 싱크 맞춤 · ${pingMs == null ? '…' : `${pingMs}ms`}`
            : `재생 싱크 맞추는 중… (${clockSamples}/4)`}
        </div>
        {augmentOffer?.lockedTier && (
          <div style={{
            display: 'inline-block',
            fontFamily: F.ui,
            fontSize: 15,
            fontWeight: 800,
            color: tierBorderColor(augmentOffer.lockedTier),
            border: `2px solid ${tierBorderColor(augmentOffer.lockedTier)}`,
            borderRadius: 6,
            padding: '4px 12px',
            marginBottom: 12,
            backgroundColor: C.card,
          }}>
            이번 등급 · {tierDisplayName(augmentOffer.lockedTier)}만
          </div>
        )}
        <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 22 }}>
          카드를 고른 뒤 보관 · 뱃지로 본인/상대 구분 · 설명은 카드 아래
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginBottom: 22,
        }}>
          {candidates.map(a => {
            const on = selected === a.id
            const tierC = tierBorderColor(a.tier)
            const borderC = on ? C.blue : tierC
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => !gahoOpen && setSelected(a.id)}
                style={{
                  ...sk(borderC),
                  backgroundColor: on ? C.blueLight : C.card,
                  padding: 12,
                  cursor: gahoOpen ? 'default' : 'pointer',
                  border: `2.5px solid ${borderC}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  opacity: gahoOpen && !on ? 0.55 : 1,
                  textAlign: 'center',
                  minWidth: 0,
                }}
              >
                <div style={{
                  width: '100%',
                  aspectRatio: '1',
                  ...sk(tierC, true),
                  overflow: 'hidden',
                  backgroundColor: '#F2F0EB',
                  position: 'relative',
                }}>
                  {a.imageUrl ? (
                    <img
                      src={a.imageUrl}
                      alt={a.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <AugmentNoPhoto name={a.name} accent={tierC} />
                  )}
                </div>
                <div style={{
                  fontFamily: F.ui, fontSize: 12, fontWeight: 800,
                  color: tierC, letterSpacing: 0.3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap',
                }}>
                  {tierDisplayName(a.tier)}
                  <AugmentTargetBadge effectType={a.effectType} />
                </div>
                <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{a.name}</div>
                {a.description && (
                  <div style={{
                    fontFamily: F.ui,
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.body,
                    lineHeight: 1.45,
                    wordBreak: 'keep-all',
                    overflowWrap: 'anywhere',
                  }}>
                    {a.description}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Btn disabled={rerollsLeft <= 0 || gahoOpen} onClick={onReroll}>{rerollsLeft <= 0 ? '리롤 사용함' : `리롤 (${rerollsLeft}회)`}</Btn>
          <Btn variant="primary" size="lg" disabled={!selected || gahoOpen} onClick={confirm}>보관하기</Btn>
        </div>
      </div>

      {gahoOpen && (
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
            <div style={{ fontFamily: F.ui, fontSize: 16, color: C.body, marginBottom: 6, fontWeight: 700 }}>
              남은 시간 {timer}초
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 22 }}>
              3장 중 1개 · 리롤 없음 · 이름·사진만 (효과는 선택 후 확인) · 시간 종료 시 랜덤
            </div>
            {gahoBusy ? (
              <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>불러오는 중…</div>
            ) : (
              <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 14,
                marginBottom: 18,
              }}>
                {gahoCandidates.map((g) => {
                  const tierC = C.tierGaho
                  const on = selectedGahoId === g.id
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGahoId(g.id)}
                      style={{
                        ...sk(on ? C.blue : tierC),
                        backgroundColor: on ? C.blueLight : C.card,
                        padding: 12,
                        cursor: 'pointer',
                        border: `2.5px solid ${on ? C.blue : tierC}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 8,
                        textAlign: 'center',
                        minWidth: 0,
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
              <Btn
                variant="primary"
                size="lg"
                disabled={!selectedGahoId}
                onClick={() => selectedGahoId && confirmGaho(selectedGahoId)}
              >
                이 프리즘으로 보관
              </Btn>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Result ─────────────────────────────────────────────────────

function ResultScreen({ nav }: { nav: (s: Screen) => void }) {
  const { results, leaveRoom, clearResults, backToWaiting, room } = useGame()
  const list = results || room?.members.map(m => ({ nickname: m.nickname, score: m.score, userId: m.userId })).sort((a, b) => b.score - a.score) || []

  return (
    <div style={{ minHeight: '100vh', ...crumpledPaper, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ ...sk(), backgroundColor: C.card, padding: '40px 36px', maxWidth: 520, width: '100%', textAlign: 'center' }}>
        <div style={{ fontFamily: F.brand, fontSize: 48, fontWeight: 700, marginBottom: 8 }}>결과</div>
        <div style={{ fontFamily: F.ui, fontSize: 16, color: C.muted, marginBottom: 24 }}>이번 판 점수</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {list.map((r, i) => (
            <div key={r.userId} style={{
              ...sk(i === 0 ? C.blue : C.graphite, true),
              backgroundColor: i === 0 ? C.blueLight : C.card,
              padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
              fontFamily: F.ui, fontSize: 20,
            }}>
              <span>{i + 1}위 {r.nickname}</span>
              <span>{r.score}점</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Btn variant="primary" size="lg" onClick={() => { backToWaiting().then(() => nav('waiting')).catch(() => {}) }}>대기실로</Btn>
          <Btn size="lg" onClick={() => { clearResults(); leaveRoom(); nav('lobby') }}>로비로</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Profile ────────────────────────────────────────────────────

// ── Admin Question Bank ────────────────────────────────────────

// ── App Root ──────────────────────────────────────────────────

export default function App() {
  const {
    user,
    room,
    results,
    trumanReveal,
    clearTrumanReveal,
    gahoCutscene,
    clearGahoCutscene,
    augmentNotice,
    clearAugmentNotice,
  } = useGame()
  const [screen, setScreen] = useState<Screen>('home')
  const [manual, setManual] = useState(false)

  useEffect(() => {
    if (manual) return
    if (!user) { setScreen(s => (s === 'login' ? s : 'home')); return }
    if (results || room?.status === 'ended') { setScreen('result'); return }
    if (!room) { setScreen(s => (s === 'bank' || s === 'profile' ? s : 'lobby')); return }
    if (room.status === 'lobby') setScreen('waiting')
    else if (room.status === 'playing' || room.status === 'revealing' || room.status === 'countdown' || room.status === 'duel') setScreen('game')
    else if (room.status === 'augment') setScreen('augment')
  }, [user, room, results, manual])

  // identity가 흔들리면 nav를 deps로 쓰는 화면 effect들이 매 렌더 재실행된다
  const nav = useCallback((s: Screen) => {
    setManual(true)
    setScreen(s)
    setTimeout(() => setManual(false), 50)
  }, [])

  const render = () => {
    switch (screen) {
      case 'home':    return <HomeScreen    nav={nav} />
      case 'login':   return <LoginScreen   nav={nav} />
      case 'lobby':   return <LobbyScreen   nav={nav} />
      case 'waiting': return <WaitingScreen nav={nav} />
      case 'game':    return <GameScreen    nav={nav} />
      case 'augment': return <AugmentScreen nav={nav} />
      case 'result':  return <ResultScreen  nav={nav} />
      case 'bank':    return <BankScreen    nav={nav} />
      case 'profile': return <ProfileScreen nav={nav} />
    }
  }

  return (
    <>
      <PencilFilters />
      <div style={{ position: 'fixed', inset: 0, ...crumpledPaper, zIndex: 0 }}>
        <CrumpleOverlay />
      </div>
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
        {render()}
      </div>
      <FlameKimOverlayBgm />
      <PeckSongBgm />
      <RoomSongPersistentBgm />
      {gahoCutscene && (
        <GahoCutscene
          key={`gaho-${gahoCutscene.nickname}-${gahoCutscene.name}`}
          item={gahoCutscene}
          onDone={clearGahoCutscene}
        />
      )}
      {augmentNotice && !gahoCutscene && (
        <AugmentUseNotice
          key={`${augmentNotice.nickname}-${augmentNotice.name}-${augmentNotice.message}`}
          name={augmentNotice.name}
          message={augmentNotice.message}
          onClose={clearAugmentNotice}
        />
      )}
      {trumanReveal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            backgroundColor: 'rgba(30,40,50,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={clearTrumanReveal}
        >
          <div
            style={{
              ...sk(),
              backgroundColor: C.card,
              padding: '36px 28px',
              maxWidth: 420,
              width: '100%',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontFamily: F.brand, fontSize: 36, fontWeight: 700, marginBottom: 10 }}>
              짜잔!
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 800, color: C.blue, marginBottom: 12 }}>
              당신은 트루먼이었습니다
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 16, color: C.body, lineHeight: 1.5, marginBottom: 18 }}>
              {trumanReveal.fakeScore > 0 ? (
                <>
                  가짜 +{trumanReveal.fakeScore}점은 무효입니다.
                  <br />
                  실제 점수 {trumanReveal.realScore}점
                </>
              ) : (
                <>실제 점수 {trumanReveal.realScore}점</>
              )}
            </div>
            <Btn onClick={clearTrumanReveal}>확인</Btn>
          </div>
        </div>
      )}
    </>
  )
}
