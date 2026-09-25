import { useState, useEffect } from 'react'
import { useGame } from '../GameContext'
import { emptyGenreCounts } from '../genres'
import { playSfx } from '../sfx'
import type { Screen } from './types'
import { Avatar, Btn, C, F, MarginLine, notebookLines, sk, SketchInput, Tag } from '../ui'
import { PingText } from '../components/PingStatus'

export function LobbyScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, rooms, connected, musicVolume, sfxVolume, setMusicVolume, setSfxVolume, createRoom, joinRoom, logout } = useGame()
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
            <PingText connected />
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
