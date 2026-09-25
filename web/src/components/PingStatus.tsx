import { usePing } from '../GameContext'
import { C, F } from '../ui'

/**
 * 핑 표시 — 1.2초마다 갱신된다.
 * 화면 컴포넌트가 직접 pingMs를 읽으면 그때마다 채팅·로그까지 다시 그려지므로 여기서만 읽는다.
 */
export function PingText({ connected }: { connected: boolean }) {
  const { pingMs } = usePing()
  const color = !connected ? C.red : pingMs == null ? C.muted : pingMs < 80 ? C.green : pingMs < 160 ? C.blue : C.red
  return (
    <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
      {connected ? (pingMs == null ? '…ms' : `${pingMs}ms`) : '끊김'}
    </span>
  )
}

/** 증강 선택 화면의 싱크 표시 — 같은 이유로 분리 */
export function SyncStatus() {
  const { pingMs, clockSamples } = usePing()
  return (
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
  )
}
