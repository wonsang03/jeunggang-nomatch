import { useGame } from '../GameContext'
import type { Screen } from './types'
import { Btn, C, crumpledPaper, F, sk } from '../ui'

export function ResultScreen({ nav }: { nav: (s: Screen) => void }) {
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
