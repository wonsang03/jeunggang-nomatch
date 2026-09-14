// 프로필 수정 + 내 전적.

import { useEffect, useRef, useState } from 'react'
import { useGame } from '../GameContext'
import { api, avatarSrc } from '../api'
import { Avatar, Btn, C, F, Field, NoteCard, notebookLines, sk } from '../ui'
import type { Screen } from './types'

export type UserStats = {
  games: number
  wins: number
  totalScore: number
  bestScore: number
  avgScore: number
  avgRank: number
  recent: Array<{
    playedAt: string
    roomName: string
    gameMode: string
    score: number
    rank: number
    players: number
  }>
}

export function ProfileScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, updateProfile, uploadAvatar, removeAvatar } = useGame()
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<UserStats | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) nav('login')
  }, [user, nav])

  useEffect(() => {
    if (!user) return
    let alive = true
    api<UserStats>('/api/auth/me/stats')
      .then((s) => { if (alive) setStats(s) })
      // 전적은 부가 정보 — 실패해도 프로필 화면은 그대로 쓴다
      .catch(() => { if (alive) setStats(null) })
    return () => { alive = false }
  }, [user?.id])

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

        <div style={{ height: 18 }} />

        <NoteCard>
          <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, color: C.body, marginBottom: 14 }}>
            내 전적
          </div>

          {!stats || stats.games === 0 ? (
            <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, padding: '8px 0' }}>
              아직 끝까지 진행한 판이 없습니다.
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 10, marginBottom: 16,
              }}>
                {[
                  { label: '판수', value: `${stats.games}판` },
                  { label: '1등', value: `${stats.wins}회` },
                  { label: '평균 점수', value: `${stats.avgScore}점` },
                  { label: '최고 점수', value: `${stats.bestScore}점` },
                  { label: '평균 등수', value: `${stats.avgRank}위` },
                ].map((cell) => (
                  <div key={cell.label} style={{ ...sk(), padding: '10px 8px', textAlign: 'center', backgroundColor: C.card }}>
                    <div style={{ fontFamily: F.ui, fontSize: 11, color: C.muted, letterSpacing: '0.05em' }}>{cell.label}</div>
                    <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, color: C.body, marginTop: 3 }}>{cell.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 6 }}>최근 기록</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.recent.map((g, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '54px 1fr auto auto', gap: 8, alignItems: 'center',
                    padding: '8px 10px', ...sk(g.rank === 1 ? C.blue : C.line, true),
                    backgroundColor: g.rank === 1 ? C.blueLight : C.card,
                  }}>
                    <span style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 900, color: g.rank === 1 ? C.blue : C.body }}>
                      {g.rank}위
                    </span>
                    <span style={{
                      fontFamily: F.ui, fontSize: 13, color: C.body,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {g.roomName}
                      <span style={{ color: C.muted }}>{g.gameMode === 'reading' ? ' · 리딩방' : ''} · {g.players}명</span>
                    </span>
                    <span style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.body }}>{g.score}점</span>
                    <span style={{ fontFamily: F.ui, fontSize: 11, color: C.muted }}>
                      {new Date(g.playedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </NoteCard>
      </div>
    </div>
  )
}
