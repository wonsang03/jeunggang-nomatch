// 첫 화면과 로그인/회원가입. App.tsx 가 4800줄을 넘겨 화면 단위로 떼어냈다.

import { useEffect, useState } from 'react'
import { useGame } from '../GameContext'
import { Btn, C, F, Field, crumpledPaper, sk } from '../ui'
import type { Screen } from './types'

export function HomeScreen({ nav }: { nav: (s: Screen) => void }) {
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

export function LoginScreen({ nav }: { nav: (s: Screen) => void }) {
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
