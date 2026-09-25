import { useState, useEffect, useRef } from 'react'
import { C, F } from '../ui'

/** 가호 사용 — 전원 풀스크린 컷신 */
export function GahoCutscene({
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
