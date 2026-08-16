import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useGame, type ChatMsg, type RoomMember } from './GameContext'
import { api, avatarSrc } from './api'
import { PLAYABLE_GENRES, BANK_GENRES, emptyGenreCounts, YACHA_GENRE, type GenreName, type BankGenreName } from './genres'
import { normalizeSongTags } from './tags'
import { playSfx } from './sfx'
import { serverNow } from './clockSync'
import { HiddenYouTube, FlameKimOverlayBgm, RoomSongPersistentBgm, ytId, loadYtApi, type YtPlayer } from './youtubePlayer'
import {
  AppliedAugmentChip,
  AugmentNoPhoto,
  Avatar,
  Btn,
  C,
  CrumpleOverlay,
  Equalizer,
  F,
  Field,
  FitAnswer,
  FloatingHoverPopup,
  GenreIntroFly,
  GenreSongCountRow,
  HOSTILE_AUGMENT_TYPES,
  MarginLine,
  NoteCard,
  PaperShell,
  PencilFilters,
  PrismKeyframes,
  RoundTimer,
  SketchInput,
  Tag,
  TimerRing,
  crumpledPaper,
  notebookLines,
  prismBackdrop,
  sk,
  tierBorderColor,
  tierDisplayName,
} from './ui'

// ── Types ─────────────────────────────────────────────────────
type Screen = 'home' | 'login' | 'lobby' | 'waiting' | 'game' | 'augment' | 'result' | 'bank' | 'profile'

// ── Screens ───────────────────────────────────────────────────

function HomeScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user } = useGame()
  return (
    <div style={{
      minHeight: '100vh',
      ...crumpledPaper,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '60px 20px 100px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        ...sk(), backgroundColor: C.card, padding: '52px 64px',
        maxWidth: 540, width: '100%', textAlign: 'center',
        position: 'relative', zIndex: 1, animation: 'slideUp 0.4s ease-out both',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '5px', backgroundColor: C.blue, borderRadius: '5px 3px 0 0' }} />

        <div style={{ fontFamily: F.brand, fontSize: 76, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          증강노맞
        </div>

        <div style={{
          display: 'inline-block', backgroundColor: C.blueLight,
          padding: '6px 16px', ...sk(C.blue, true),
          fontFamily: F.ui, fontSize: 15, fontWeight: 400,
          color: C.blue, marginTop: 12, marginBottom: 28,
        }}>
          실시간 멀티플레이 노래 맞히기 게임
        </div>

        <p style={{ fontFamily: F.ui, fontSize: 17, fontWeight: 400, color: C.muted, marginBottom: 36, lineHeight: 1.85 }}>
          친구랑 모여<br />노래 맞히고 증강 골라 최강자가 되어봐요
        </p>

        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Btn variant="primary" size="lg" onClick={() => nav(user ? 'lobby' : 'login')}>시작하기</Btn>
          <Btn size="lg" onClick={() => nav('login')}>로그인</Btn>
        </div>
        <div style={{ marginTop: 22, fontFamily: F.ui, fontSize: 15, fontWeight: 400, color: C.muted }}>
          처음 오셨나요?{' '}
          <span style={{ color: C.blue, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => nav('login')}>
            회원가입
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center', zIndex: 1 }}>
        {['최대 10인', '증강 시스템', '실시간 채팅', '장르별 플레이', '20문제마다 증강'].map(t => (
          <div key={t} style={{
            ...sk(C.blue, true), backgroundColor: C.blueLight, color: C.blue,
            fontFamily: F.ui, fontSize: 14, fontWeight: 400, padding: '6px 14px',
          }}>{t}</div>
        ))}
      </div>
    </div>
  )
}

function LoginScreen({ nav }: { nav: (s: Screen) => void }) {
  const { login, register, user } = useGame()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [nick, setNick] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) nav('lobby')
  }, [user, nav])

  const submit = async () => {
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') await login(id.trim(), pw)
      else await register(id.trim(), pw, nick.trim() || id.trim())
      nav('lobby')
    } catch (e) {
      setError(e instanceof Error ? e.message : '실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      ...crumpledPaper,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px 100px', position: 'relative',
    }}>
      <div style={{ width: '100%', maxWidth: 440, position: 'relative', zIndex: 1 }}>
        <div
          style={{ marginBottom: 14, cursor: 'pointer', display: 'inline-block' }}
          onClick={() => nav('home')}
        >
          <span style={{
            ...sk(C.blue, true),
            backgroundColor: C.card,
            padding: '6px 12px',
            fontFamily: F.ui, fontSize: 16, fontWeight: 400, color: C.blue,
            display: 'inline-block',
          }}>
            ← 증강노맞
          </span>
        </div>

        <div style={{ ...sk(), backgroundColor: C.card, padding: '32px 28px', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: C.blue }} />

          <div style={{ fontFamily: F.brand, fontSize: 42, fontWeight: 700, color: C.text, marginBottom: 8, textAlign: 'center' }}>
            {mode === 'login' ? '로그인' : '회원가입'}
          </div>
          <div style={{
            fontFamily: F.ui, fontSize: 16, fontWeight: 400, color: C.muted,
            marginBottom: 24, textAlign: 'center', paddingBottom: 16,
            borderBottom: `2px solid ${C.line}`,
          }}>
            {mode === 'login' ? '아이디와 비밀번호를 입력해주세요' : '새 계정을 만들어보세요'}
          </div>

          {mode === 'signup' && <Field label="닉네임" placeholder="게임에서 사용할 이름" value={nick} onChange={setNick} />}
          <Field label="아이디" placeholder="test 또는 admin" value={id} onChange={setId} />
          <Field label="비밀번호" type="password" placeholder="••••••••" value={pw} onChange={setPw} />

          {error && (
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.red, marginBottom: 10, textAlign: 'center' }}>{error}</div>
          )}

          <div style={{ marginTop: 8 }}>
            <Btn variant="primary" fullWidth size="lg" onClick={submit} disabled={loading || !id || !pw}>
              {loading ? '처리 중…' : mode === 'login' ? '로그인' : '회원가입'}
            </Btn>
          </div>

          <div style={{ textAlign: 'center', marginTop: 12, fontFamily: F.ui, fontSize: 13, color: C.muted }}>
            테스트 계정: test / test1234
          </div>

          <div style={{ textAlign: 'center', marginTop: 20, fontFamily: F.ui, fontSize: 15, fontWeight: 400, color: C.muted }}>
            {mode === 'login'
              ? <>계정이 없으신가요? <span style={{ color: C.blue, cursor: 'pointer' }} onClick={() => setMode('signup')}>회원가입</span></>
              : <>이미 계정이 있으신가요? <span style={{ color: C.blue, cursor: 'pointer' }} onClick={() => setMode('login')}>로그인</span></>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Lobby ──────────────────────────────────────────────────────

function LobbyScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, rooms, connected, pingMs, musicVolume, sfxVolume, setMusicVolume, setSfxVolume, createRoom, joinRoom, logout } = useGame()
  const [search, setSearch] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const filtered = rooms.filter(r => r.name.includes(search) || r.genre.includes(search))

  const [joinAsSpectator, setJoinAsSpectator] = useState(false)

  useEffect(() => {
    if (!user) nav('login')
  }, [user, nav])

  const makeRoom = async () => {
    setBusy(true); setErr('')
    try {
      await createRoom({ name: `${user?.nickname || '나'}의 방`, genreCounts: emptyGenreCounts('한국노래', 20), maxPlayers: 10 })
      nav('waiting')
    } catch (e) { setErr(e instanceof Error ? e.message : '실패') }
    finally { setBusy(false) }
  }

  const enter = async (roomId: string) => {
    setBusy(true); setErr('')
    try {
      await joinRoom({ roomId, asSpectator: joinAsSpectator })
      nav('waiting')
    } catch (e) { setErr(e instanceof Error ? e.message : '실패') }
    finally { setBusy(false) }
  }

  const enterCode = async () => {
    if (!code.trim()) return
    setBusy(true); setErr('')
    try {
      await joinRoom({ code: code.trim(), asSpectator: joinAsSpectator })
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
          <Btn variant="primary" size="md" onClick={makeRoom} disabled={busy || !connected}>+ 방 만들기</Btn>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setJoinAsSpectator(false)}
              style={{
                ...sk(!joinAsSpectator ? C.blue : C.graphite, true),
                backgroundColor: !joinAsSpectator ? C.blueLight : C.card,
                color: !joinAsSpectator ? C.blue : C.body,
                fontFamily: F.ui, fontSize: 13, fontWeight: 800, padding: '6px 12px', cursor: 'pointer',
              }}
            >
              플레이어
            </button>
            <button
              type="button"
              onClick={() => setJoinAsSpectator(true)}
              style={{
                ...sk(joinAsSpectator ? C.blue : C.graphite, true),
                backgroundColor: joinAsSpectator ? C.blueLight : C.card,
                color: joinAsSpectator ? C.blue : C.body,
                fontFamily: F.ui, fontSize: 13, fontWeight: 800, padding: '6px 12px', cursor: 'pointer',
              }}
            >
              관전
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
            <SketchInput
              value={code} onChange={setCode}
              placeholder="초대 코드 입력..."
              style={{ flex: 1, fontSize: '15px', padding: '10px 14px', fontWeight: 700 }}
            />
            <Btn onClick={enterCode} disabled={busy || !connected}>
              {joinAsSpectator ? '관전 입장' : '코드 입장'}
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
            const full = joinAsSpectator ? spectFull : playerFull
            const canSpectFallback = !joinAsSpectator && playerFull && !spectFull
            return (
              <div
                key={room.id}
                onClick={() => !(full && !canSpectFallback) && !busy && enter(room.id)}
                style={{
                  ...sk(),
                  backgroundColor: C.card,
                  padding: '16px 24px',
                  display: 'flex', alignItems: 'center', gap: 16,
                  cursor: (full && !canSpectFallback) ? 'not-allowed' : 'pointer',
                  opacity: (full && !canSpectFallback) ? 0.72 : 1,
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
                <Btn size="sm" variant={(full && !canSpectFallback) ? 'default' : 'primary'} disabled={(full && !canSpectFallback) || busy}>
                  {(full && !canSpectFallback)
                    ? '가득 참'
                    : (joinAsSpectator || canSpectFallback ? '관전' : '입장')}
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

function WaitingScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, roomCode, chats, setReady, setSpectator, updateSettings, startGame, sendChat, leaveRoom } = useGame()
  const [chatInput, setChatInput] = useState('')
  const [err, setErr] = useState('')
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [roleBusy, setRoleBusy] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const [chatStickBottom, setChatStickBottom] = useState(true)
  const [chatHasNew, setChatHasNew] = useState(false)

  useEffect(() => {
    if (!room) nav('lobby')
  }, [room, nav])

  useEffect(() => {
    if (room?.status === 'playing' || room?.status === 'revealing' || room?.status === 'countdown' || room?.status === 'duel') nav('game')
    if (room?.status === 'augment') nav('augment')
  }, [room?.status, nav])

  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    if (chatStickBottom) {
      el.scrollTop = el.scrollHeight
      setChatHasNew(false)
    } else {
      setChatHasNew(true)
    }
  }, [chats, chatStickBottom])

  const onChatScroll = () => {
    const el = chatRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setChatStickBottom(nearBottom)
    if (nearBottom) setChatHasNew(false)
  }

  const jumpToLatestChat = () => {
    const el = chatRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setChatStickBottom(true)
    setChatHasNew(false)
  }
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

  return (
    <div style={{ minHeight: '100vh', ...notebookLines }}>
      <div style={{ backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`, boxShadow: `0 3px 0 ${C.graphite}50`, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 14, filter: 'url(#pencilRough)' }}>
        <Btn size="sm" onClick={() => setLeaveOpen(true)}>← 로비</Btn>
        <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, flex: 1, color: C.body }}>{room.name}</div>
        {roomCode && <div style={{ fontFamily: F.ui, fontSize: 14, color: C.blue }}>코드: {roomCode}</div>}
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
                  <Avatar name={p.nickname} url={p.avatarUrl} size={32} host={p.isHost} />
                  <div style={{ flex: 1, fontFamily: F.ui, fontSize: 15, fontWeight: 800 }}>
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
                style={{ height: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                {chats.map(m => (
                  <div key={m.id} style={{ fontFamily: F.chat, fontSize: 18 }}>
                    <strong style={{ color: m.system ? C.green : C.blue }}>{m.nickname}</strong>: {m.text}
                  </div>
                ))}
              </div>
              {chatHasNew && !chatStickBottom && (
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
                  최근 채팅으로
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
            <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginBottom: 8 }}>
              ON이면 이 방에서 최근 나온 곡(약 3판 분량)을 다음 게임에서 빼고 뽑음 · 은행이 모자랄 때만 재사용
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
    <button
      type="button"
      onClick={onClose}
      aria-label="증강 사용 알림 닫기"
      style={{
        position: 'fixed',
        top: 18,
        left: '50%',
        zIndex: 110,
        width: 'min(560px, calc(100vw - 28px))',
        transform: 'translateX(-50%)',
        ...sk(C.blue, true),
        backgroundColor: '#F4F8FF',
        boxShadow: `0 8px 0 ${C.graphite}30, 0 14px 34px rgba(35,91,158,0.2)`,
        padding: '12px 18px 13px',
        color: C.body,
        textAlign: 'center',
        cursor: 'pointer',
        animation: 'augmentNoticeIn 0.3s cubic-bezier(.2,1.15,.3,1)',
      }}
    >
      <style>{`
        @keyframes augmentNoticeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-18px) scale(.94); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
      <div style={{
        fontFamily: F.ui,
        fontSize: 13,
        fontWeight: 900,
        color: C.blue,
        letterSpacing: '0.08em',
        marginBottom: 5,
      }}>
        증강 사용 · {name}
      </div>
      <div style={{
        fontFamily: F.ui,
        fontSize: 16,
        fontWeight: 750,
        lineHeight: 1.4,
        whiteSpace: 'pre-line',
      }}>
        {message}
      </div>
    </button>
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
          가호 강림
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
          {item.nickname}님의 가호
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
}: {
  ranked: RoomMember[]
  spectators: RoomMember[]
  selfId: string
}) {
  const surf = C.panel
  return (
    <div style={{
      ...sk(), backgroundColor: surf, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, minWidth: 0,
    }}>
      <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center' }}>전체 순위</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
        {ranked.map((s, i) => {
          const mine = s.userId === selfId
          return (
            <div key={s.userId} style={{
              display: 'grid', gridTemplateColumns: '36px 32px 1fr auto', gap: 6, alignItems: 'center',
              padding: '8px 8px', ...sk(mine ? C.blue : C.graphite, true),
              backgroundColor: mine ? C.blueLight : surf,
            }}>
              <span style={{ fontFamily: F.ui, fontSize: 15, color: mine ? C.blue : C.body, textAlign: 'center' }}>{i + 1}</span>
              <Avatar name={s.nickname} url={s.avatarUrl} size={28} />
              <span style={{ fontFamily: F.ui, fontSize: 15, color: mine ? C.blue : C.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nickname}</span>
              <span style={{ fontFamily: F.ui, fontSize: 15 }}>{s.score}점</span>
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

const GameChatList = memo(function GameChatList({
  chats,
  isDuelist,
  selfId,
  setChatCardHover,
  setChatCardAnchor,
}: {
  chats: ChatMsg[]
  isDuelist: boolean
  selfId: string
  setChatCardHover: (id: number | null) => void
  setChatCardAnchor: (rect: DOMRect | null) => void
}) {
  return (
    <>
      {chats.filter((msg) => !(msg.spectator && isDuelist)).map(msg => {
        if (msg.system) {
          return (
            <div
              key={msg.id}
              style={{ display: 'flex', justifyContent: 'center', position: 'relative', opacity: msg.spectator ? 0.55 : 1, minWidth: 0 }}
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
                padding: '8px 16px', fontFamily: F.ui, fontSize: 17,
                color: msg.augmentCard ? C.red : C.green, textAlign: 'center',
                cursor: msg.augmentCard ? 'help' : undefined,
                maxWidth: '100%',
                boxSizing: 'border-box',
                wordBreak: 'keep-all',
                overflowWrap: 'anywhere',
              }}>{msg.text}</div>
            </div>
          )
        }
        const self = msg.userId === selfId
        const spect = !!msg.spectator
        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              justifyContent: self ? 'flex-end' : 'flex-start',
              gap: 8,
              alignItems: 'flex-end',
              opacity: spect ? 0.52 : 1,
              minWidth: 0,
              width: '100%',
            }}
          >
            {!self && (
              <div style={{
                width: 34, height: 34, flexShrink: 0, ...sk(C.graphite, true),
                backgroundColor: spect ? '#E8EEF3' : C.blueLight,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: F.ui, fontSize: 16, color: C.blue,
              }}>{msg.nickname?.[0]}</div>
            )}
            <div style={{ maxWidth: 'min(72%, 100%)', minWidth: 0, boxSizing: 'border-box' }}>
              {!self && (
                <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 3 }}>
                  {msg.nickname}{spect ? ' · 관전' : ''}
                </div>
              )}
              <div style={{
                ...sk(self ? C.blue : C.graphite, true),
                backgroundColor: spect
                  ? (self ? 'rgba(74, 144, 186, 0.22)' : 'rgba(255,255,255,0.45)')
                  : (self ? C.blueLight : '#FFFFFF'),
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
  const chatRef = useRef<HTMLDivElement>(null)
  const [chatStickBottom, setChatStickBottom] = useState(true)
  const [chatHasNew, setChatHasNew] = useState(false)
  const genreSlotRef = useRef<HTMLDivElement>(null)
  const genreIntroRoundRef = useRef<number | null>(null)

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

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000)
    return () => clearInterval(t)
  }, [])
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

  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    if (chatStickBottom) {
      // smooth 스크롤과 휠이 싸우면 복제감 → 즉시 이동
      const prev = el.style.scrollBehavior
      el.style.scrollBehavior = 'auto'
      el.scrollTop = el.scrollHeight
      el.style.scrollBehavior = prev
      setChatHasNew(false)
    } else {
      setChatHasNew(true)
    }
  }, [chats, chatStickBottom])

  const onGameChatScroll = () => {
    const el = chatRef.current
    if (!el) return
    if (chatCardHover != null) {
      setChatCardHover(null)
      setChatCardAnchor(null)
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 56
    setChatStickBottom(nearBottom)
    if (nearBottom) setChatHasNew(false)
  }

  const jumpToLatestGameChat = () => {
    const el = chatRef.current
    if (!el) return
    el.style.scrollBehavior = 'auto'
    el.scrollTop = el.scrollHeight
    setChatStickBottom(true)
    setChatHasNew(false)
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
    || me?.heldAugmentEffectType === 'sakura_decoy'
    || me?.heldAugmentEffectType === 'answer_delay'
    || me?.heldAugmentEffectType === 'yacha_duel'
    || me?.heldAugmentEffectType === 'polite_suffix'
    || me?.heldAugmentEffectType === 'rock_throw'
    || me?.heldAugmentEffectType === 'steal_chain'
    || me?.heldAugmentEffectType === 'score_steal'
    || me?.heldAugmentEffectType === 'accuse_sleep'
    || me?.heldAugmentEffectType === 'gabuki_mark'
    || (me?.heldAugmentEffectType === 'flame_kim' && room.members.filter((m) => !m.isSpectator).length >= 2)
    || me?.heldAugmentEffectType === 'steal_held_augment'
    || me?.heldAugmentEffectType === 'hide_hints'
    || me?.heldAugmentEffectType === 'audio_stutter'
    || me?.heldAugmentEffectType === 'score_share'
    || me?.heldAugmentEffectType === 'swap_scores'
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
  const needsGenrePick = !isSpectator && me?.heldAugmentEffectType === 'ban_genre'
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
    ...sk(), backgroundColor: C.panel, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, minWidth: 0,
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
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        filter: 'url(#pencilRough)',
      }}>
        <RoundTimer endsAt={round?.endsAt ?? now} max={maxTime} size={58} />
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
          ? '200px minmax(0, 1fr) 220px'
          : '200px minmax(0, 1fr)',
        gap: 14, padding: '14px 14px 0',
      }}>
        <GameScoreboard ranked={ranked} spectators={spectators} selfId={user.id} />

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
            <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center', flexShrink: 0 }}>
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
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minHeight: 0,
                minWidth: 0,
                // 스케치 그림자·우측 말풍선이 잘리지 않게
                padding: '6px 12px 10px 6px',
                scrollBehavior: 'auto',
              }}
            >
              <GameChatList
                chats={chats}
                isDuelist={isDuelist}
                selfId={user.id}
                setChatCardHover={setChatCardHover}
                setChatCardAnchor={setChatCardAnchor}
              />
            </div>
              {chatHasNew && !chatStickBottom && (
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
                  최근 채팅으로
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
              <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted }}>증강</div>
              <Btn size="sm" onClick={() => setShowUsedList(true)}>사용 목록</Btn>
            </div>
            <div style={{
              flex: 1, ...sk(me?.heldAugmentTier ? tierBorderColor(me.heldAugmentTier) : C.graphite),
              backgroundColor: C.card, padding: '14px 12px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', gap: 10, minHeight: 160, position: 'relative',
              border: me?.heldAugmentTier
                ? `2.5px solid ${tierBorderColor(me.heldAugmentTier)}`
                : undefined,
            }}>
              {me?.heldAugmentId ? (
                <>
                  <div style={{
                    width: 88, height: 88, flexShrink: 0,
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
                    }}>
                      {tierDisplayName(me.heldAugmentTier)}
                    </div>
                  )}
                  <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
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
                            ? '가호 선택'
                            : needsTargetPick
                              ? '대상 선택'
                              : needsGenrePick
                                ? '장르 선택'
                                : '사용'}
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
                          ? '가호 중 하나를 골라 적용'
                          : needsTargetPick
                            ? '대상을 골라 사용'
                            : needsGenrePick
                              ? '밴픽 장르를 골라 사용'
                              : '사용 버튼에 올리면 설명'}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: F.ui, fontSize: 16, color: C.muted }}>보유 증강 없음</div>
              )}
            </div>
          </div>
          <div style={{ ...panelBox, flex: 1 }}>
            <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center' }}>
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
              밴할 장르를 선택하세요 (항상 성공 · 잔량은 다른 장르로 랜덤 배분)
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
                <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>밴할 장르가 없습니다</div>
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
              가호 선택
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
                      <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: tierC }}>가호</div>
                      <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{g.name}</div>
                    </button>
                  )
                })}
                {gahoCandidates.length === 0 && (
                  <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, gridColumn: '1 / -1', textAlign: 'center' }}>
                    선택 가능한 가호가 없습니다
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
        padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0,
        filter: 'url(#pencilRough)',
      }}>
        <SketchInput
          value={input}
          onChange={setInput}
          onKeyDown={e => e.key === 'Enter' && !submitBlocked && send()}
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
            fontSize: '22px',
            padding: '12px 16px',
            backgroundColor: submitBlocked ? '#E8EEF3' : C.card,
            textAlign: 'center',
            fontFamily: F.chat,
          }}
          noPaste
        />
        <Btn
          variant="danger"
          disabled={isSpectator || isReading || skipVoted || room.status !== 'playing' || inDuel}
          onClick={voteSkip}
        >
          {isSpectator
            ? '관전'
            : isReading
            ? '리딩방'
            : inDuel
            ? '야차룰 중'
            : room.status === 'revealing'
              ? '공개 중'
              : room.status === 'countdown'
                ? '대기 중'
                : `스킵 ${skip.votes}/${skip.need}`}
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
          <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue, marginBottom: 6 }}>
            증강 설명
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
      // 가호 선택 중이면 타임아웃에도 랜덤 확정하되, 고른 가호가 있으면 그걸 보냄
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
          카드를 고른 뒤 보관 · 효과 설명은 카드 아래에 표시됩니다
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
                }}>
                  {tierDisplayName(a.tier)}
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
              가호 선택
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
                      <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: tierC }}>가호</div>
                      <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{g.name}</div>
                    </button>
                  )
                })}
                {gahoCandidates.length === 0 && (
                  <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, gridColumn: '1 / -1', textAlign: 'center' }}>
                    선택 가능한 가호가 없습니다
                  </div>
                )}
              </div>
              <Btn
                variant="primary"
                size="lg"
                disabled={!selectedGahoId}
                onClick={() => selectedGahoId && confirmGaho(selectedGahoId)}
              >
                이 가호로 보관
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
  const { results, leaveRoom, clearResults, room } = useGame()
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
        <Btn variant="primary" size="lg" onClick={() => { clearResults(); leaveRoom(); nav('lobby') }}>로비로</Btn>
      </div>
    </div>
  )
}

// ── Profile ────────────────────────────────────────────────────

function ProfileScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, updateProfile, uploadAvatar, removeAvatar } = useGame()
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) nav('login')
  }, [user, nav])

  useEffect(() => {
    setNickname(user?.nickname || '')
  }, [user?.nickname])

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'))
      reader.readAsDataURL(file)
    })

  /** 너무 큰 이미지는 캔버스로 줄여서 업로드 */
  const compressImage = async (file: File): Promise<string> => {
    const dataUrl = await readFileAsDataUrl(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('이미지 로드 실패'))
      el.src = dataUrl
    })
    const max = 512
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.86)
  }

  const onPick = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErr('이미지 파일만 선택할 수 있습니다')
      return
    }
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const dataUrl = await compressImage(file)
      setPreview(dataUrl)
      await uploadAvatar(dataUrl)
      setOkMsg('프로필 사진이 저장되었습니다')
      setPreview(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '업로드 실패')
    } finally {
      setBusy(false)
    }
  }

  const saveNickname = async () => {
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const nick = nickname.trim()
      if (!nick) throw new Error('닉네임을 입력하세요')
      if (nick.length > 24) throw new Error('닉네임은 24자 이하입니다')
      await updateProfile(nick)
      setOkMsg('닉네임이 저장되었습니다')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setBusy(false)
    }
  }

  const clearAvatar = async () => {
    setBusy(true); setErr(''); setOkMsg('')
    try {
      await removeAvatar()
      setPreview(null)
      setOkMsg('프로필 사진을 삭제했습니다')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제 실패')
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null
  const shown = preview || avatarSrc(user.avatarUrl)

  return (
    <div style={{ minHeight: '100vh', ...notebookLines }}>
      <div style={{
        backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`,
        boxShadow: `0 3px 0 ${C.graphite}50`, padding: '12px 28px',
        display: 'flex', alignItems: 'center', gap: 14, filter: 'url(#pencilRough)',
      }}>
        <Btn size="sm" onClick={() => nav('lobby')}>← 로비</Btn>
        <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, flex: 1, color: C.body }}>프로필 수정</div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: 24 }}>
        <NoteCard>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <div
              onClick={() => fileRef.current?.click()}
              style={{ cursor: 'pointer', position: 'relative' }}
              title="클릭해서 사진 변경"
            >
              {shown ? (
                <div style={{
                  width: 120, height: 120, borderRadius: '50%', overflow: 'hidden',
                  ...sk(C.blue), backgroundColor: C.blueLight,
                }}>
                  <img src={shown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <Avatar name={user.nickname} url={null} size={120} />
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={e => onPick(e.target.files?.[0] || null)}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Btn size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>사진 선택</Btn>
              {user.avatarUrl && (
                <Btn size="sm" variant="danger" onClick={clearAvatar} disabled={busy}>사진 삭제</Btn>
              )}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, textAlign: 'center' }}>
              PNG/JPG/WebP · 자동으로 작게 줄여 저장합니다
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: F.ui, fontSize: '13px', fontWeight: 700, color: C.muted, marginBottom: '4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              아이디
            </div>
            <div style={{
              fontFamily: F.ui, fontSize: 18, fontWeight: 700, color: C.muted,
              padding: '9px 4px 6px', borderBottom: `2.5px solid ${C.line}`,
            }}>
              {user.username}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginTop: 6 }}>
              아이디는 변경할 수 없습니다
            </div>
          </div>
          <Field label="닉네임" value={nickname} onChange={setNickname} placeholder="표시될 이름" />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Btn variant="primary" onClick={saveNickname} disabled={busy || nickname.trim() === user.nickname}>
              닉네임 저장
            </Btn>
          </div>

          {err && <div style={{ fontFamily: F.ui, color: C.red, marginTop: 12 }}>{err}</div>}
          {okMsg && <div style={{ fontFamily: F.ui, color: C.green, marginTop: 12 }}>{okMsg}</div>}
        </NoteCard>
      </div>
    </div>
  )
}

// ── Admin Question Bank ────────────────────────────────────────

type BankSlotDraft = { label: string; answer: string; accepts: string; hidden: boolean }
type BankQuestion = {
  id: string
  youtubeUrl: string
  startSec: number
  endSec: number
  genre: string
  tags: string[]
  slots: Array<{ id: string; label: string; answer?: string; acceptAnswers?: string[]; hidden?: boolean }>
}

function BankSegmentPreview({
  url,
  startSec,
  endSec,
  volume = 70,
  onClose,
  title,
}: {
  url: string
  startSec: number
  endSec: number
  volume?: number
  onClose: () => void
  title?: string
}) {
  const id = ytId(url)
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const start = Math.max(0, Math.floor(startSec))
  const end = Math.max(start + 1, Math.floor(endSec))
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id || !hostRef.current) return
    let cancelled = false
    let player: YtPlayer | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    ;(async () => {
      await loadYtApi()
      if (cancelled || !hostRef.current || !window.YT) return
      hostRef.current.innerHTML = ''
      const mount = document.createElement('div')
      hostRef.current.appendChild(mount)
      const https = window.location.protocol === 'https:'
      player = new window.YT.Player(mount, {
        videoId: id,
        width: 276,
        height: 155,
        playerVars: {
          autoplay: 1,
          mute: 1,
          start,
          // end 는 API에 안 넣고 폴링으로 컷 (http 임베드 오류 줄임)
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          ...(https ? { origin: window.location.origin } : {}),
        },
        events: {
          onReady: (e) => {
            if (cancelled) return
            playerRef.current = e.target
            try {
              e.target.seekTo(start, true)
              e.target.setVolume(Math.max(0, Math.min(100, volume)))
              e.target.mute()
              e.target.playVideo()
              e.target.unMute()
              e.target.setVolume(Math.max(0, Math.min(100, volume)))
            } catch { /* ignore */ }
            poll = setInterval(() => {
              try {
                const t = e.target.getCurrentTime?.() ?? 0
                if (t >= end - 0.15) {
                  e.target.pauseVideo()
                  if (poll) clearInterval(poll)
                }
              } catch { /* ignore */ }
            }, 200)
          },
          onError: (e) => {
            if (cancelled) return
            if (e.data === 101 || e.data === 150 || e.data === 153) {
              setErr('이 영상은 외부 재생이 막혀 있습니다. 유튜브 링크를 바꿔주세요')
            } else {
              setErr('미리듣기를 재생할 수 없습니다')
            }
          },
        },
      })
    })()

    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try { player?.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
  }, [id, start, end, volume])

  if (!id) {
    return (
      <div style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 90,
        ...sk(C.red, true), backgroundColor: C.card, padding: 12, maxWidth: 320,
      }}>
        <div style={{ fontFamily: F.ui, color: C.red }}>유효한 유튜브 URL이 아닙니다</div>
        <div style={{ marginTop: 8 }}>
          <Btn size="sm" onClick={onClose}>닫기</Btn>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed',
      right: 16,
      bottom: 16,
      zIndex: 90,
      ...sk(C.blue, true),
      backgroundColor: C.card,
      padding: 12,
      width: 300,
      boxShadow: `0 8px 0 ${C.graphite}40`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 13, color: C.blue, flex: 1, lineHeight: 1.35 }}>
          미리듣기 {title ? `· ${title}` : ''}
          <div style={{ fontWeight: 700, color: C.muted, fontSize: 12 }}>{start}s ~ {end}s</div>
        </div>
        <Btn size="sm" onClick={onClose}>정지</Btn>
      </div>
      {err && <div style={{ fontFamily: F.ui, color: C.red, marginBottom: 8, fontSize: 13 }}>{err}</div>}
      <div ref={hostRef} style={{ borderRadius: 8, overflow: 'hidden', width: 276, height: 155 }} />
    </div>
  )
}

function BankScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user } = useGame()
  const PAGE_SIZE = 10
  const [list, setList] = useState<BankQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [genres, setGenres] = useState<Array<{ name: string; count: number }>>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [startSec, setStartSec] = useState('30')
  const [endSec, setEndSec] = useState('70')
  const [genreName, setGenreName] = useState<BankGenreName>('한국노래')
  const [formTags, setFormTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [slots, setSlots] = useState<BankSlotDraft[]>([
    { label: '노래 제목', answer: '', accepts: '', hidden: false },
    { label: '가수', answer: '', accepts: '', hidden: false },
  ])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [filterGenre, setFilterGenre] = useState<BankGenreName | ''>('')
  const [filterTag, setFilterTag] = useState('')
  const [filterTagInput, setFilterTagInput] = useState('')
  const [filterHidden, setFilterHidden] = useState<'all' | 'yes' | 'no'>('all')
  const [bulkJson, setBulkJson] = useState('')
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [clipPreview, setClipPreview] = useState<{ url: string; startSec: number; endSec: number; title?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const listTopRef = useRef<HTMLDivElement>(null)

  const parseAccepts = (raw: string) =>
    [...new Set(raw.split(/[,，、/|]+/).map(x => x.trim()).filter(Boolean))]

  const defaultTitleLabel = (genre: BankGenreName) => {
    if (genre === '애니') return '애니 제목'
    if (genre === '한국노래' || genre === '일본노래' || genre === '해외노래' || genre === '버튜버') return '노래 제목'
    return '제목'
  }

  const emptySlots = (genre: BankGenreName = genreName): BankSlotDraft[] => [
    { label: defaultTitleLabel(genre), answer: '', accepts: '', hidden: false },
    { label: '가수', answer: '', accepts: '', hidden: false },
  ]

  const resetForm = () => {
    setEditingId(null)
    setYoutubeUrl('')
    setStartSec('30')
    setEndSec('70')
    setGenreName('한국노래')
    setFormTags([])
    setTagInput('')
    setSlots(emptySlots('한국노래'))
  }

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(page),
      })
      if (searchQ.trim()) params.set('q', searchQ.trim())
      if (filterGenre) params.set('genre', filterGenre)
      if (filterTag) params.set('tag', filterTag)
      if (filterHidden === 'yes') params.set('hidden', 'yes')
      if (filterHidden === 'no') params.set('hidden', 'no')
      const [q, g] = await Promise.all([
        api<{ questions: BankQuestion[]; total: number; page: number; pageCount: number }>(`/api/questions?${params}`),
        api<{ genres: Array<{ name: string; count: number }> }>('/api/questions/genres'),
      ])
      setList(q.questions)
      setTotal(q.total)
      const pc = Math.max(1, q.pageCount || 1)
      setPageCount(pc)
      if (page > pc) setPage(pc)
      setGenres(g.genres)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '목록 불러오기 실패')
    }
  }, [searchQ, filterGenre, filterTag, filterHidden, page])

  useEffect(() => {
    if (!user?.isAdmin) { nav('lobby'); return }
    load()
  }, [user, nav, load])

  useEffect(() => {
    setPage(1)
  }, [searchQ, filterGenre, filterTag, filterHidden])

  const goPage = (p: number) => {
    const next = Math.max(1, Math.min(pageCount, p))
    setPage(next)
    setTimeout(() => listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40)
  }

  const pageItems = (() => {
    const totalPages = pageCount
    if (totalPages <= 9) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const items: Array<number | '…'> = []
    const push = (x: number | '…') => {
      if (items[items.length - 1] !== x) items.push(x)
    }
    push(1)
    const start = Math.max(2, page - 2)
    const end = Math.min(totalPages - 1, page + 2)
    if (start > 2) push('…')
    for (let i = start; i <= end; i += 1) push(i)
    if (end < totalPages - 1) push('…')
    push(totalPages)
    return items
  })()

  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(total, page * PAGE_SIZE)

  const addSlot = (label = `슬롯${slots.length + 1}`, hidden = false) => {
    if (slots.length >= 8) {
      setErr('슬롯은 최대 8개까지입니다')
      return
    }
    if (hidden && slots.some(s => s.hidden)) {
      setErr('히든 문제는 1개만 넣을 수 있습니다')
      return
    }
    setErr('')
    setSlots(s => [...s, {
      label: hidden ? (label === `슬롯${slots.length + 1}` ? '히든 질문' : label) : label,
      answer: '',
      accepts: '',
      hidden,
    }])
  }
  const removeSlot = (i: number) => setSlots(s => s.length <= 1 ? s : s.filter((_, idx) => idx !== i))
  const updateSlot = (i: number, patch: Partial<BankSlotDraft>) =>
    setSlots(s => s.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl)))

  const genreBtn = (_g: string, selected: boolean) => ({
    ...sk(selected ? C.blue : C.graphite, true),
    backgroundColor: selected ? C.blueLight : C.card,
    color: selected ? C.blue : C.body,
    fontFamily: F.ui, fontSize: '13px', fontWeight: 800 as const,
    padding: '6px 12px', cursor: 'pointer', outline: 'none' as const,
    border: `2px solid ${selected ? C.blue : C.graphite}`,
  })

  const addFormTag = () => {
    const next = tagInput.trim()
    if (!next) return
    setFormTags(normalizeSongTags([...formTags, next]))
    setTagInput('')
  }

  const removeFormTag = (tag: string) => {
    setFormTags(formTags.filter(t => t !== tag))
  }

  const startEdit = (q: BankQuestion) => {
    setEditingId(q.id)
    setYoutubeUrl(q.youtubeUrl)
    setStartSec(String(q.startSec))
    setEndSec(String(q.endSec))
    setGenreName((BANK_GENRES.includes(q.genre as BankGenreName) ? q.genre : YACHA_GENRE) as BankGenreName)
    setFormTags(normalizeSongTags(q.tags || []))
    setTagInput('')
    setSlots(q.slots.map(s => ({
      label: s.label,
      answer: s.answer || '',
      accepts: (s.acceptAnswers || []).filter(a => a !== s.answer).join(', '),
      hidden: !!s.hidden,
    })))
    setErr('')
    setOkMsg('수정 모드 · 아래 폼에서 저장하세요')
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const submit = async () => {
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const start = Number(startSec)
      const end = Number(endSec)
      if (!youtubeUrl.trim()) throw new Error('유튜브 URL을 입력하세요')
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('구간(초)을 확인하세요')
      if (slots.some(s => !s.label.trim() || !s.answer.trim())) throw new Error('슬롯 라벨/정답을 모두 입력하세요')

      const body = {
        youtubeUrl: youtubeUrl.trim(),
        startSec: start,
        endSec: end,
        genreName,
        tags: normalizeSongTags(formTags),
        slots: slots.map(s => ({
          label: s.label.trim(),
          answer: s.answer.trim(),
          acceptAnswers: parseAccepts(s.accepts),
          hidden: !!s.hidden,
        })),
      }

      if (editingId) {
        await api(`/api/questions/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setOkMsg(`수정 완료 · 슬롯 ${slots.length}개`)
      } else {
        await api('/api/questions', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setOkMsg(`등록 완료 · 슬롯 ${slots.length}개`)
      }
      resetForm()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : (editingId ? '수정 실패' : '등록 실패'))
    } finally {
      setBusy(false)
    }
  }

  const submitBulk = async (raw: string) => {
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const parsed = JSON.parse(raw) as unknown
      const questions = Array.isArray(parsed)
        ? parsed
        : (parsed as { questions?: unknown }).questions
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('JSON 배열(또는 { questions: [...] }) 형식이 필요합니다')
      }
      const res = await api<{ created: number; failed: number; errors: Array<{ index: number; error: string }> }>('/api/questions/bulk', {
        method: 'POST',
        body: JSON.stringify({ questions }),
      })
      setOkMsg(`${res.created}곡 등록 완료` + (res.failed ? ` / 실패 ${res.failed}곡` : ''))
      if (res.errors?.length) {
        setErr(`일부 실패 예: #${res.errors[0].index} ${res.errors[0].error}`)
      }
      setBulkJson('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '대량 등록 실패')
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (file: File | null) => {
    if (!file) return
    const text = await file.text()
    setBulkJson(text)
    await submitBulk(text)
  }

  const remove = async (id: string) => {
    if (!confirm('이 문제를 삭제할까요?')) return
    setBusy(true); setErr('')
    try {
      await api(`/api/questions/${id}`, { method: 'DELETE' })
      if (editingId === id) resetForm()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제 실패')
    } finally {
      setBusy(false)
    }
  }

  if (!user?.isAdmin) return null

  return (
    <div style={{ minHeight: '100vh', ...notebookLines }}>
      <div style={{
        backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`,
        boxShadow: `0 3px 0 ${C.graphite}50`, padding: '12px 28px',
        display: 'flex', alignItems: 'center', gap: 14, filter: 'url(#pencilRough)',
      }}>
        <Btn size="sm" onClick={() => nav('lobby')}>← 로비</Btn>
        <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, flex: 1, color: C.body }}>문제 은행</div>
        <Tag color={C.blue}>총 {total}곡</Tag>
        <Tag color={C.blue}>관리자</Tag>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <NoteCard>
          <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 8 }}>대량 등록 (1000곡+ 추천)</div>
          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
            JSON 파일/텍스트로 한 번에 넣을 수 있습니다. 장르는{' '}
            <strong>{BANK_GENRES.join(', ')}</strong> 중 하나여야 합니다. (<code>{YACHA_GENRE}</code>는 야차룰 전용 · 일반전에 안 나옴)
            선택으로 <code>tags</code> 문자열 배열을 넣을 수 있습니다 (예: <code>["남돌","10년대"]</code>).
          </div>
          <textarea
            value={bulkJson}
            onChange={e => setBulkJson(e.target.value)}
            placeholder={`[\n  {\n    "youtubeUrl": "https://www.youtube.com/watch?v=...",\n    "startSec": 30,\n    "endSec": 70,\n    "genreName": "버튜버",\n    "tags": ["여돌", "20년대"],\n    "slots": [\n      { "label": "제목", "answer": "네리사에게 혼났습니다", "acceptAnswers": "네리사에게 혼났습니다.., Nerissa" },\n      { "label": "가수", "answer": "아오쿠모 린", "acceptAnswers": ["아오쿠모 린", "AOKUMO RIN"] },\n      { "label": "출시 연도는?", "answer": "2024", "hidden": true }\n    ]\n  }\n]`}
            style={{
              width: '100%', minHeight: 160, marginBottom: 12,
              ...sk(), backgroundColor: C.card, fontFamily: 'ui-monospace, monospace',
              fontSize: 13, padding: 12, color: C.body, resize: 'vertical', outline: 'none',
            }}
          />
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
            acceptAnswers는 배열 또는 쉼표 문자열 모두 OK. 슬롯은 문제당 최대 8개.
            히든은 <code>{`"hidden": true`}</code> (문제당 최대 1개, 없어도 됨).
          </div>          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <Btn variant="primary" onClick={() => submitBulk(bulkJson)} disabled={busy || !bulkJson.trim()}>JSON 등록</Btn>
            <Btn onClick={() => fileRef.current?.click()} disabled={busy}>.json 파일 선택</Btn>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={e => onPickFile(e.target.files?.[0] || null)}
            />
          </div>
        </NoteCard>

        <NoteCard>
          <div ref={formRef} style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 16 }}>
            {editingId ? '문제 수정' : '단건 등록'}
            {editingId && (
              <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, color: C.blue }}>수정 중</span>
            )}
          </div>
          <Field label="유튜브 URL" value={youtubeUrl} onChange={setYoutubeUrl} placeholder="https://www.youtube.com/watch?v=..." />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="시작(초)" value={startSec} onChange={setStartSec} placeholder="30" />
            <Field label="종료(초)" value={endSec} onChange={setEndSec} placeholder="70" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <Btn
              size="sm"
              variant="primary"
              disabled={!youtubeUrl.trim()}
              onClick={() => {
                const start = Number(startSec)
                const end = Number(endSec)
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
                  setErr('구간(초)을 확인하세요')
                  return
                }
                setErr('')
                setClipPreview({
                  url: youtubeUrl.trim(),
                  startSec: start,
                  endSec: end,
                  title: slots[0]?.answer || '폼 구간',
                })
              }}
            >
              미리듣기
            </Btn>
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 8 }}>장르</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {BANK_GENRES.map(g => (
              <button key={g} type="button" style={genreBtn(g, genreName === g)} onClick={() => {
                setGenreName(g)
                setSlots(prev => {
                  if (prev.length === 0) return emptySlots(g)
                  const next = [...prev]
                  const first = next[0]
                  if (first && !first.hidden && (first.label === '제목' || first.label === '노래 제목' || first.label === '애니 제목')) {
                    next[0] = { ...first, label: defaultTitleLabel(g) }
                  }
                  return next
                })
              }}>{g}</button>
            ))}
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 8 }}>태그</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SketchInput
              value={tagInput}
              onChange={setTagInput}
              placeholder="예: 남돌, 10년대, 드라마…"
              style={{ flex: 1, minWidth: 160 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addFormTag()
                }
              }}
            />
            <Btn size="sm" variant="primary" onClick={addFormTag} disabled={!tagInput.trim()}>
              태그 추가하기
            </Btn>
          </div>
          {formTags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {formTags.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => removeFormTag(t)}
                  title="클릭하여 제거"
                  style={{
                    ...sk(C.blue, true),
                    backgroundColor: C.blueLight,
                    color: C.blue,
                    fontFamily: F.ui,
                    fontSize: 13,
                    fontWeight: 800,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    outline: 'none',
                    border: `2px solid ${C.blue}`,
                  }}
                >
                  {t} ×
                </button>
              ))}
            </div>
          )}
          {formTags.length === 0 && (
            <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginBottom: 16 }}>
              태그가 없으면 비워 둡니다. (남돌+여돌을 같이 넣으면 성별 태그는 자동 제거)
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: '0.06em' }}>
              정답 슬롯 ({slots.length}/8)
            </div>
            <div style={{ flex: 1 }} />
            <Btn size="sm" onClick={() => addSlot('제목')} disabled={slots.length >= 8}>+ 제목</Btn>
            <Btn size="sm" onClick={() => addSlot('가수')} disabled={slots.length >= 8}>+ 가수</Btn>
            <Btn size="sm" onClick={() => addSlot('키워드')} disabled={slots.length >= 8}>+ 키워드</Btn>
            <Btn
              size="sm"
              variant="primary"
              onClick={() => addSlot('출시 연도는?', true)}
              disabled={slots.length >= 8 || slots.some(s => s.hidden)}
            >
              + 히든
            </Btn>
            <Btn size="sm" onClick={() => addSlot()} disabled={slots.length >= 8}>+ 슬롯</Btn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {slots.map((s, i) => {
              const acceptsPreview = parseAccepts(s.accepts)
              return (
                <div
                  key={i}
                  style={{
                    ...sk(s.hidden ? C.blue : C.graphite, true),
                    backgroundColor: s.hidden ? C.blueLight : C.card,
                    padding: 12,
                  }}
                >
                  <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: s.hidden ? C.blue : C.muted, marginBottom: 8 }}>
                    {s.hidden ? '히든 문제' : `슬롯 ${i + 1}`} · 맞히면 {s.hidden ? '+3점' : '+1점'}
                    {s.hidden && ' · 제목·가수 맞힌 뒤 등장'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    <SketchInput
                      value={s.label}
                      onChange={v => updateSlot(i, { label: v })}
                      placeholder={s.hidden ? '히든 질문 (예: 출시 연도는?)' : '라벨 (제목/가수/키워드)'}
                      style={{ flex: '0 0 160px', minWidth: 120 }}
                    />
                    <SketchInput value={s.answer} onChange={v => updateSlot(i, { answer: v })} placeholder="대표 정답" style={{ flex: 1, minWidth: 120 }} />
                    <Btn size="sm" variant="danger" onClick={() => removeSlot(i)} disabled={slots.length <= 1}>삭제</Btn>
                  </div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginBottom: 4 }}>
                    인정 답안 (쉼표로 구분)
                  </div>
                  <SketchInput
                    value={s.accepts}
                    onChange={v => updateSlot(i, { accepts: v })}
                    placeholder="예: 네리사에게 혼났습니다.., Nerissa, 네리사"
                    style={{ width: '100%' }}
                  />
                  {(s.answer.trim() || acceptsPreview.length > 0) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {s.answer.trim() && <Tag color={C.green}>정답: {s.answer.trim()}</Tag>}
                      {acceptsPreview.map(a => (
                        <Tag key={a} color={C.blue}>{a}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 12, lineHeight: 1.55 }}>
            인정 답안 예: <code>아이유, IU, iu</code> · 구분자 <code>,</code> <code>/</code> <code>|</code> 가능.
            히든은 선택(0~1개). 라벨이 질문으로 표시되며, 제목·가수를 모두 맞히면 등장합니다.
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={submit} disabled={busy}>
              {editingId ? '수정 저장' : '등록하기'}
            </Btn>
            {editingId && (
              <Btn onClick={() => { resetForm(); setOkMsg(''); setErr('') }} disabled={busy}>수정 취소</Btn>
            )}
          </div>
          {err && <div style={{ fontFamily: F.ui, color: C.red, marginBottom: 8 }}>{err}</div>}
          {okMsg && <div style={{ fontFamily: F.ui, color: C.green, marginBottom: 8 }}>{okMsg}</div>}
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            장르 현황: {genres.map(g => `${g.name} ${g.count}곡`).join(' · ') || '없음'}
          </div>
        </NoteCard>

        <NoteCard>
          <div ref={listTopRef} style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 12 }}>
            등록 목록 ({rangeFrom}-{rangeTo} / 총 {total}곡)
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <SketchInput
              value={searchInput}
              onChange={setSearchInput}
              placeholder="제목·가수·인정답·URL 검색"
              style={{ flex: 1, minWidth: 180 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearchQ(searchInput.trim())
              }}
            />
            <Btn size="sm" variant="primary" onClick={() => setSearchQ(searchInput.trim())} disabled={busy}>검색</Btn>
            {(searchQ || filterGenre || filterTag || filterHidden !== 'all') && (
              <Btn
                size="sm"
                onClick={() => {
                  setSearchInput('')
                  setSearchQ('')
                  setFilterGenre('')
                  setFilterTag('')
                  setFilterTagInput('')
                  setFilterHidden('all')
                }}
                disabled={busy}
              >
                초기화
              </Btn>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={genreBtn('한국노래', filterGenre === '')}
              onClick={() => setFilterGenre('')}
            >
              전체 장르
            </button>
            {BANK_GENRES.map(g => (
              <button
                key={g}
                type="button"
                style={genreBtn(g, filterGenre === g)}
                onClick={() => setFilterGenre(g)}
              >
                {g}{g === YACHA_GENRE ? ' (야차)' : ''}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginRight: 4 }}>히든</span>
            {([
              ['all', '전체'],
              ['yes', '히든 있음'],
              ['no', '히든 없음'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                style={genreBtn(k, filterHidden === k)}
                onClick={() => setFilterHidden(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <SketchInput
              value={filterTagInput}
              onChange={setFilterTagInput}
              placeholder="태그로 필터 (예: 남돌)"
              style={{ flex: 1, minWidth: 140 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setFilterTag(filterTagInput.trim())
              }}
            />
            <Btn size="sm" onClick={() => setFilterTag(filterTagInput.trim())} disabled={busy}>태그 필터</Btn>
            {filterTag && (
              <Btn size="sm" onClick={() => { setFilterTag(''); setFilterTagInput('') }} disabled={busy}>태그 해제</Btn>
            )}
          </div>
          {(searchQ || filterGenre || filterTag || filterHidden !== 'all') && (
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 10 }}>
              {[
                searchQ ? `검색어: "${searchQ}"` : '',
                filterGenre ? `장르: ${filterGenre}` : '',
                filterTag ? `태그: ${filterTag}` : '',
                filterHidden === 'yes' ? '히든: 있음' : filterHidden === 'no' ? '히든: 없음' : '',
              ].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.length === 0 && (
              <div style={{ fontFamily: F.ui, color: C.muted, textAlign: 'center', padding: 20 }}>
                {searchQ || filterGenre || filterTag || filterHidden !== 'all' ? '검색 결과가 없습니다' : '아직 문제가 없습니다'}
              </div>
            )}
            {list.map(q => (
              <div
                key={q.id}
                style={{
                  ...sk(editingId === q.id ? C.blue : C.graphite, true),
                  backgroundColor: editingId === q.id ? C.blueLight : C.card,
                  padding: '12px 14px',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <Tag>{q.genre}</Tag>
                  {(q.tags || []).map(t => (
                    <Tag key={t} color={C.blue}>{t}</Tag>
                  ))}
                  <Tag color={C.muted}>{q.slots.length}슬롯</Tag>
                  {q.slots.some(s => s.hidden) && <Tag color={C.blue}>히든</Tag>}
                  <div style={{ flex: 1, fontFamily: F.ui, fontSize: 13, color: C.muted }}>
                    {q.startSec}s ~ {q.endSec}s
                  </div>
                  <Btn
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      const title = q.slots.find(s => s.label.includes('제목'))?.answer || q.slots[0]?.answer
                      setClipPreview({
                        url: q.youtubeUrl,
                        startSec: q.startSec,
                        endSec: q.endSec,
                        title,
                      })
                    }}
                    disabled={busy}
                  >
                    미리듣기
                  </Btn>
                  <Btn size="sm" onClick={() => startEdit(q)} disabled={busy}>수정</Btn>
                  <Btn size="sm" variant="danger" onClick={() => remove(q.id)} disabled={busy}>삭제</Btn>
                </div>
                <div style={{
                  fontFamily: F.ui, fontSize: 13, color: C.body, marginBottom: 6,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {q.youtubeUrl}
                </div>
                <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, marginBottom: 4 }}>
                  {q.slots.map(s => `${s.hidden ? '[히든] ' : ''}${s.label}: ${s.answer || '?'}`).join(' / ')}
                </div>
                {q.slots.some(s => (s.acceptAnswers?.length || 0) > 1) && (
                  <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted }}>
                    인정: {q.slots.map(s => {
                      const extras = (s.acceptAnswers || []).filter(a => a !== s.answer)
                      if (!extras.length) return null
                      return `${s.label}[${extras.join(', ')}]`
                    }).filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {pageCount > 1 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center',
              alignItems: 'center', marginTop: 16, paddingTop: 12,
              borderTop: `2px dashed ${C.line}`,
            }}>
              <Btn size="sm" disabled={page <= 1 || busy} onClick={() => goPage(page - 1)}>이전</Btn>
              {pageItems.map((item, idx) => (
                item === '…' ? (
                  <span key={`e-${idx}`} style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, padding: '0 4px' }}>…</span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    disabled={busy}
                    onClick={() => goPage(item)}
                    style={{
                      ...sk(item === page ? C.blue : C.graphite, true),
                      backgroundColor: item === page ? C.blueLight : C.card,
                      color: item === page ? C.blue : C.body,
                      fontFamily: F.ui,
                      fontSize: 14,
                      fontWeight: 800,
                      minWidth: 34,
                      padding: '6px 10px',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {item}
                  </button>
                )
              ))}
              <Btn size="sm" disabled={page >= pageCount || busy} onClick={() => goPage(page + 1)}>다음</Btn>
              <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginLeft: 6 }}>
                {page} / {pageCount} 페이지
              </span>
            </div>
          )}
        </NoteCard>
      </div>
      {clipPreview && (
        <BankSegmentPreview
          url={clipPreview.url}
          startSec={clipPreview.startSec}
          endSec={clipPreview.endSec}
          title={clipPreview.title}
          volume={user?.musicVolume ?? 70}
          onClose={() => setClipPreview(null)}
        />
      )}
    </div>
  )
}

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
