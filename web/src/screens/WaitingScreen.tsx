import { useState, useEffect } from 'react'
import { useGame } from '../GameContext'
import { PLAYABLE_GENRES, type GenreName } from '../genres'
import type { Screen } from './types'
import {
  Avatar,
  Btn,
  C,
  CHAT_COLORS,
  chatColorOf,
  F,
  GenreSongCountRow,
  notebookLines,
  NoteCard,
  sk,
  SketchInput,
} from '../ui'
import { useStickyChatScroll } from '../components/useStickyChatScroll'

export function WaitingScreen({ nav }: { nav: (s: Screen) => void }) {
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
                        disabled={!!takenBy && !picked}
                        onClick={() => onPickChatColor(i)}
                        style={{
                          width: 34, height: 34, cursor: takenBy && !picked ? 'not-allowed' : 'pointer', padding: 0,
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
                  10개 중 하나 · 흐린 건 다른 사람이 쓰는 색 (고를 수 없음)
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
