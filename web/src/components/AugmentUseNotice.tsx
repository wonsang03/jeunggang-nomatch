import { C, F, sk } from '../ui'

/** 증강 사용 — 장르 인트로처럼 크게 떴다가 서서히 사라진다 (로그가 왼쪽이라 놓치기 쉬움) */
export function AugmentUseNotice({
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
