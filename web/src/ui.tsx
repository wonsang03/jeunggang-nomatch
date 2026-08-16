import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { avatarSrc } from './api'
import { playSfx } from './sfx'
import { serverNow } from './clockSync'

// ── Design Tokens ─────────────────────────────────────────────
// Soft blue + paper white (stationery aesthetic)
export const C = {
  paper:      '#EEF3F8',
  card:       '#F7FAFC',
  panel:      '#F7FAFC',
  graphite:   '#2A3340',
  blue:       '#5D8CD7',
  blueLight:  '#D6E8F7',
  yellow:     '#F5E6A3',
  red:        '#E05252',
  redLight:   '#F8DADA',
  green:      '#3D9E62',
  greenLight: '#DAEEE5',
  text:       '#1A1A1A',
  body:       '#222831',
  muted:      '#5A6570',
  line:       '#C6DCE8',
  margin:     '#C85040',
  tierBronze: '#B87333',
  tierSilver: '#6E7F8D',
  tierGold:   '#C9A227',
  tierGaho:   '#7B5EA7',
}

export function tierBorderColor(tier?: string | null): string {
  const t = (tier || '').toLowerCase()
  if (t === 'bronze' || t === '브론즈') return C.tierBronze
  if (t === 'silver' || t === '실버') return C.tierSilver
  if (t === 'gold' || t === '골드') return C.tierGold
  if (t === '가호' || t === 'gaho') return C.tierGaho
  return C.graphite
}

export function tierDisplayName(tier?: string | null): string {
  const t = (tier || '').toLowerCase()
  if (t === 'bronze' || t === '브론즈') return '브론즈'
  if (t === 'silver' || t === '실버') return '실버'
  if (t === 'gold' || t === '골드') return '골드'
  if (t === '가호' || t === 'gaho') return '가호'
  return tier || ''
}

/** 구겨진 종이 사진 배경 */
export const crumpledPaper: React.CSSProperties = {
  backgroundColor: '#E8F1F7',
  backgroundImage: 'url(/crumpled-paper.png)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'fixed',
  position: 'relative',
}

export const notebookLines = crumpledPaper

/** 가호 선택 프리즘 배경 */
export const prismBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 90,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background:
    'linear-gradient(125deg, rgba(255,130,190,0.55) 0%, rgba(120,190,255,0.55) 22%, rgba(190,130,255,0.5) 45%, rgba(110,240,200,0.48) 68%, rgba(255,220,130,0.52) 100%)',
  backgroundSize: '220% 220%',
  animation: 'prismShift 7s ease-in-out infinite',
}

export function PrismKeyframes() {
  return (
    <style>{`
      @keyframes prismShift {
        0% { background-position: 0% 40%; }
        50% { background-position: 100% 60%; }
        100% { background-position: 0% 40%; }
      }
      @keyframes prismShine {
        0%, 100% { opacity: 0.35; transform: translateX(-30%) rotate(12deg); }
        50% { opacity: 0.55; transform: translateX(30%) rotate(12deg); }
      }
    `}</style>
  )
}

export function CrumpleOverlay() {
  // 실 질감 이미지가 배경이므로 추가 CSS 구김 레이어는 쓰지 않음
  return null
}

export function PaperShell({
  children,
  style,
  className,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <div className={className} style={{ ...crumpledPaper, ...style }}>
      <CrumpleOverlay />
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'contents' }}>
        {children}
      </div>
    </div>
  )
}

// Pencil-sketch border with layered graphite smudge shadow
// small=true → 2-layer thin shadow for chips/tags
export function sk(border = C.graphite, small = false): React.CSSProperties {
  const a = small
    ? [`1.5px 1.5px 0 ${border}`, `2.5px 2.5px 0 ${border}70`, `3.5px 3.5px 0 ${border}28`]
    : [`2.5px 2.5px 0 ${border}`, `4px 4px 0 ${border}60`,     `5.5px 5.5px 0 ${border}18`]
  return {
    border: `2.5px solid ${border}`,
    borderRadius: '7px 5px 8px 4px / 5px 8px 5px 7px',
    boxShadow: a.join(', '),
    filter: 'url(#pencilRough)',
  }
}

/** overflow에 잘리지 않도록 body에 fixed 팝업 */
export function FloatingHoverPopup({
  anchor,
  children,
  width = 240,
  borderColor = C.graphite,
}: {
  anchor: DOMRect | null
  children: React.ReactNode
  width?: number
  borderColor?: string
}) {
  if (!anchor || typeof document === 'undefined') return null
  const gap = 10
  const estimatedH = 220
  const placeAbove = anchor.top > estimatedH + gap + 24
  const left = Math.min(
    Math.max(width / 2 + 12, anchor.left + anchor.width / 2),
    window.innerWidth - width / 2 - 12,
  )
  const top = placeAbove ? anchor.top - gap : anchor.bottom + gap
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left,
        top,
        transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        width,
        maxWidth: 'min(90vw, 280px)',
        zIndex: 400,
        ...sk(borderColor, true),
        backgroundColor: C.card,
        padding: 12,
        boxShadow: `0 8px 24px ${C.graphite}35`,
        pointerEvents: 'none',
        textAlign: 'left',
        border: `2.5px solid ${borderColor}`,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

// ── SVG Filter Definitions ─────────────────────────────────────
// Rendered once at app root; filter: url(#pencilRough) displaces
// element edges by ~1px — visible on thin borders, imperceptible on text
export function PencilFilters() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        <filter
          id="pencilRough"
          x="-5%" y="-5%" width="110%" height="110%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.038 0.072"
            numOctaves="3"
            seed="11"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="1.1"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter
          id="paperCrumple"
          x="-20%" y="-20%" width="140%" height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.018"
            numOctaves="3"
            seed="7"
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale="28"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}

// ── Typography helpers ─────────────────────────────────────────
export const F = {
  brand: "'Gaegu', cursive",   // 타이틀·채팅 큰 글씨
  chat:  "'Gaegu', cursive",
  ui:    "'Jua', sans-serif",  // 작은 라벨·UI (비슷한 느낌, 작은 크기에서 더 또렷)
}

/** 사진 없는 증강 — 그 칸에 이름만 굵게 (사진처럼) */
export function AugmentNoPhoto({
  name,
  accent,
  compact = false,
}: {
  name?: string | null
  accent?: string
  compact?: boolean
}) {
  const border = accent || C.graphite
  const title = (name || '').trim() || '?'
  const len = title.length
  const size = compact
    ? (len > 10 ? 13 : len > 6 ? 16 : 20)
    : (len > 12 ? 18 : len > 8 ? 22 : len > 4 ? 28 : 34)
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: compact ? 6 : 12,
      boxSizing: 'border-box',
      backgroundColor: '#E8EEF4',
      backgroundImage:
        `linear-gradient(135deg, ${border}18 0%, transparent 45%, ${border}10 100%)`,
    }}>
      <div style={{
        fontFamily: F.brand,
        fontSize: size,
        fontWeight: 900,
        color: C.graphite,
        lineHeight: 1.15,
        textAlign: 'center',
        wordBreak: 'keep-all',
        WebkitTextStroke: '0.55px currentColor',
      }}>
        {title}
      </div>
    </div>
  )
}

export const HOSTILE_AUGMENT_TYPES = new Set([
  'mute_chat', 'soft_chat_mute', 'answer_delay', 'answer_block', 'answer_block_others',
  'polite_suffix', 'named_decoy', 'named_decoy_all', 'sakura_decoy', 'accuse_sleep',
  'gabuki_mark', 'hide_hints', 'audio_stutter', 'power_off_others', 'party_music_others',
  'chat_isolate', 'slow_playback', 'answer_proxy', 'score_steal', 'rock_throw',
  'steal_chain', 'yacha_duel', 'flame_kim', 'mud_fight',
  'swap_scores', 'destroy_held_augment',
])

/** 증강 적용 칸: 썸네일 + 짧은 라벨 · 호버로 카드 */
export function AppliedAugmentChip({
  name,
  imageUrl,
  hostile,
  meta,
  description,
  onHover,
  onLeave,
}: {
  name: string
  imageUrl?: string | null
  hostile?: boolean
  meta?: string
  description?: string
  onHover?: (rect: DOMRect) => void
  onLeave?: () => void
}) {
  const accent = hostile ? C.red : C.blue
  const bg = hostile ? C.redLight : C.blueLight
  return (
    <div
      onMouseEnter={(e) => onHover?.(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onLeave?.()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px 6px 6px',
        ...sk(accent, true),
        backgroundColor: bg,
        cursor: 'help',
        minWidth: 0,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{
        width: 40, height: 40, flexShrink: 0, overflow: 'hidden',
        ...sk(accent, true), backgroundColor: C.card,
      }}>
        {imageUrl ? (
          <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <AugmentNoPhoto name={name} accent={accent} compact />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: accent,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </div>
        {meta ? (
          <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginTop: 1 }}>
            {meta}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 긴 제목/가수: 공개 전이면 초성 힌트(있으면) 또는 ？？？ */
export function FitAnswer({
  label,
  value,
  hint,
  revealed,
}: {
  label: string
  value: string | null
  hint?: string | null
  revealed: boolean
}) {
  const shown = revealed ? (value?.trim() || null) : null
  const text = shown || (!revealed ? (hint?.trim() || null) : null) || '？？？'
  const isHint = !revealed && !shown && !!hint?.trim()
  const len = text.length
  const size = len > 24 ? 20 : len > 16 ? 24 : len > 10 ? 30 : 36
  return (
    <div style={{ width: '100%', textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontFamily: F.ui, fontSize: 17, fontWeight: 500, color: C.muted, marginBottom: 6 }}>{label}</div>
      <div
        title={shown || undefined}
        style={{
          fontFamily: F.brand,
          fontSize: size,
          fontWeight: 700,
          color: shown ? C.body : isHint ? C.blue : C.line,
          lineHeight: 1.25,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'keep-all',
          overflowWrap: 'anywhere',
        }}
      >
        {text}
      </div>
    </div>
  )
}

/** 라운드 시작: 장르를 크게 보여준 뒤 자리로 축소·페이드 인 */
export function GenreIntroFly({
  text,
  targetRef,
  active,
  onSettled,
  color = C.blue,
}: {
  text: string
  targetRef: React.RefObject<HTMLElement | null>
  active: boolean
  onSettled: () => void
  color?: string
}) {
  const flyRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'off' | 'hold' | 'fly'>('off')

  useEffect(() => {
    if (!active || !text) {
      setPhase('off')
      return
    }
    setPhase('hold')
    const holdT = window.setTimeout(() => setPhase('fly'), 850)
    const doneT = window.setTimeout(() => onSettled(), 850 + 780)
    return () => {
      window.clearTimeout(holdT)
      window.clearTimeout(doneT)
    }
  }, [active, text, onSettled])

  useEffect(() => {
    if (phase !== 'fly' || !flyRef.current) return
    const el = flyRef.current
    const dest = targetRef.current?.getBoundingClientRect()
    if (!dest) return
    const from = el.getBoundingClientRect()
    const fromCx = from.left + from.width / 2
    const fromCy = from.top + from.height / 2
    const toCx = dest.left + dest.width / 2
    const toCy = dest.top + dest.height / 2
    const scale = Math.max(0.22, Math.min(0.4, dest.height / Math.max(from.height, 1)))
    el.style.transition = 'transform 0.72s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.55s ease 0.15s'
    el.style.transform = `translate(${toCx - fromCx}px, ${toCy - fromCy}px) scale(${scale})`
    el.style.opacity = '0'
  }, [phase, targetRef])

  if (!active || phase === 'off' || !text) return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        ref={flyRef}
        style={{
          fontFamily: F.brand,
          fontSize: text.length > 8 ? 52 : 72,
          fontWeight: 700,
          color,
          letterSpacing: '0.06em',
          lineHeight: 1.1,
          padding: '10px 22px',
          backgroundColor: 'transparent',
          border: `3px solid ${color}`,
          borderRadius: '10px 7px 11px 6px / 7px 11px 7px 10px',
          boxShadow: 'none',
          textShadow: 'none',
          WebkitTextStroke: '0',
          transform: 'translate(0, 0) scale(1)',
          opacity: 1,
          willChange: 'transform, opacity',
        }}
      >
        {text}
      </div>
    </div>,
    document.body,
  )
}

// ── Shared Components ─────────────────────────────────────────

export function Btn({
  children, onClick, variant = 'default', size = 'md',
  fullWidth = false, disabled = false,
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'yellow' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  disabled?: boolean
}) {
  const [p, setP] = useState(false)
  const bg:    Record<string, string> = { default: C.card, primary: C.blue, danger: C.red, yellow: C.yellow, ghost: 'transparent' }
  const col:   Record<string, string> = { default: C.body, primary: '#fff', danger: '#fff', yellow: C.body, ghost: C.body }
  const pad:   Record<string, string> = { sm: '6px 16px', md: '11px 26px', lg: '14px 36px' }
  const fs:    Record<string, string> = { sm: '16px', md: '18px', lg: '20px' }
  const fw:    Record<string, number> = { sm: 700, md: 800, lg: 800 }

  const borderC = disabled ? C.muted : C.graphite
  const skStyle = sk(borderC, size === 'sm')

  return (
    <button
      disabled={disabled}
      onClick={disabled ? undefined : () => {
        playSfx('click')
        onClick?.()
      }}
      onMouseDown={() => !disabled && setP(true)}
      onMouseUp={() => setP(false)}
      onMouseLeave={() => setP(false)}
      style={{
        ...skStyle,
        backgroundColor: disabled ? '#C9D5E0' : bg[variant],
        color: disabled ? C.muted : col[variant],
        fontFamily: F.ui,
        fontSize: fs[size],
        fontWeight: fw[size],
        letterSpacing: '0.03em',
        padding: pad[size],
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        transform: p ? 'translate(2px,2px)' : undefined,
        boxShadow: p
          ? `1px 1px 0 ${borderC}`
          : skStyle.boxShadow,
        transition: 'transform 0.08s, box-shadow 0.08s',
        outline: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

export function Field({ label, type = 'text', placeholder, value, onChange }: {
  label?: string
  type?: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ marginBottom: '24px' }}>
      {label && (
        <div style={{ fontFamily: F.ui, fontSize: '13px', fontWeight: 700, color: C.muted, marginBottom: '4px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {label}
        </div>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: `2.5px solid ${C.graphite}`,
          outline: 'none',
          fontFamily: F.ui,
          fontSize: '18px',
          fontWeight: 700,
          color: C.body,
          padding: '9px 4px 6px',
          letterSpacing: '0.02em',
        }}
      />
    </div>
  )
}

/** 대기실: 장르별 출제 곡 수 — 슬라이더 + 숫자 입력 */
export function GenreSongCountRow({
  genre,
  value,
  max = 999,
  disabled,
  onChange,
}: {
  genre: string
  value: number
  max?: number
  disabled?: boolean
  onChange: (n: number) => void
}) {
  const serverN = Math.max(0, Math.min(max, Math.floor(Number(value) || 0)))
  const [local, setLocal] = useState(serverN)
  const dragging = useRef(false)
  // 슬라이더는 은행 max까지만 (0곡이면 0)
  const sliderMax = Math.max(0, max)

  useEffect(() => {
    if (!dragging.current) setLocal(serverN)
  }, [serverN])

  const commit = (n: number) => {
    const next = Math.max(0, Math.min(max, Math.floor(n)))
    setLocal(next)
    onChange(next)
  }

  return (
    <div style={{ opacity: disabled ? 0.65 : 1 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, marginBottom: 4,
      }}>
        <div style={{ fontFamily: F.ui, fontSize: 13, color: C.body, fontWeight: 800 }}>{genre}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            min={0}
            max={max}
            step={1}
            disabled={disabled}
            value={local}
            onChange={(e) => {
              if (disabled) return
              const raw = e.target.value
              if (raw === '') {
                setLocal(0)
                return
              }
              const next = Math.floor(Number(raw))
              if (!Number.isFinite(next)) return
              commit(next)
            }}
            onBlur={() => commit(local)}
            style={{
              ...sk(C.graphite, true),
              backgroundColor: C.card,
              width: 64,
              fontFamily: F.ui,
              fontSize: 15,
              fontWeight: 800,
              textAlign: 'center',
              padding: '4px 6px',
              outline: 'none',
              color: C.body,
            }}
          />
          <span style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, fontWeight: 700 }}>곡</span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={sliderMax}
        step={1}
        disabled={disabled}
        value={Math.min(local, sliderMax)}
        onPointerDown={() => { dragging.current = true }}
        onChange={(e) => {
          if (disabled) return
          setLocal(Number(e.target.value))
        }}
        onPointerUp={(e) => {
          dragging.current = false
          if (disabled) return
          commit(Number((e.target as HTMLInputElement).value))
          playSfx('click')
        }}
        onKeyUp={(e) => {
          if (disabled) return
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
            commit(Number((e.target as HTMLInputElement).value))
          }
        }}
        style={{ width: '100%', accentColor: C.blue, cursor: disabled ? 'default' : 'pointer' }}
      />
    </div>
  )
}

export function NoteCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      ...sk(),
      backgroundColor: C.panel,
      padding: '24px',
      ...style,
    }}>
      {children}
    </div>
  )
}

export function Equalizer({ color = C.blue, h = 22 }: { color?: string; h?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: `${h}px` }}>
      {[65, 90, 50, 80, 45].map((pct, i) => (
        <div key={i} style={{
          width: '3px', backgroundColor: color, borderRadius: '2px',
          height: `${pct}%`, transformOrigin: 'bottom',
          animation: `eqBounce 0.55s ease-in-out ${i * 0.11}s infinite alternate`,
        }} />
      ))}
    </div>
  )
}

export function TimerRing({ value, max = 40, size = 68 }: { value: number; max?: number; size?: number }) {
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const danger = value <= 10
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={danger ? C.red : C.blue} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - value / max)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: F.ui, fontSize: size * 0.28, fontWeight: 900, color: danger ? C.red : C.body,
      }}>
        {value}
      </div>
    </div>
  )
}

/** 링만 250ms 갱신 — GameScreen 전체 리렌더 방지 */
export function RoundTimer({ endsAt, max = 40, size = 58 }: { endsAt: number; max?: number; size?: number }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)))
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)))
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [endsAt])
  return <TimerRing value={left} max={max} size={size} />
}

export function SketchInput({ value, onChange, onKeyDown, placeholder, style, noPaste }: {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  style?: React.CSSProperties
  /** true면 붙여넣기/드롭 차단 */
  noPaste?: boolean
}) {
  const blockPaste = (e: React.ClipboardEvent | React.DragEvent) => {
    if (!noPaste) return
    e.preventDefault()
  }
  return (
    <input
      value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onPaste={blockPaste}
      onDrop={blockPaste}
      onBeforeInput={(e) => {
        if (!noPaste) return
        const ne = e.nativeEvent as InputEvent
        if (ne.inputType === 'insertFromPaste' || ne.inputType === 'insertFromDrop') {
          e.preventDefault()
        }
      }}
      onKeyDown={e => {
        if (noPaste && (e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
          e.preventDefault()
          return
        }
        onKeyDown?.(e)
      }}
      autoComplete={noPaste ? 'off' : undefined}
      style={{
        ...sk(),
        backgroundColor: C.card,
        fontFamily: F.ui,
        fontSize: '15px',
        fontWeight: 700,
        color: C.body,
        padding: '9px 14px',
        outline: 'none',
        letterSpacing: '0.02em',
        ...style,
      }}
    />
  )
}

export function MarginLine() {
  return null
}

// Tag chip for genre labels, status badges
export function Tag({ children, color = C.blue, bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  const bgFallback = color === C.blue ? C.blueLight : color === C.green ? C.greenLight : '#FFF8DC'
  return (
    <div style={{
      ...sk(color, true),
      backgroundColor: bg ?? bgFallback,
      color,
      fontFamily: F.ui,
      fontSize: '12px',
      fontWeight: 800,
      letterSpacing: '0.05em',
      padding: '3px 10px',
      display: 'inline-flex',
      alignItems: 'center',
    }}>
      {children}
    </div>
  )
}

export function Avatar({
  name,
  url,
  size = 40,
  host = false,
}: {
  name?: string | null
  url?: string | null
  size?: number
  host?: boolean
}) {
  const src = avatarSrc(url)
  const letter = (name || '?')[0]
  return (
    <div style={{
      width: size,
      height: size,
      flexShrink: 0,
      overflow: 'hidden',
      ...sk(host ? C.yellow : C.blue, true),
      backgroundColor: host ? C.yellow : C.blueLight,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: F.ui,
      fontSize: size * 0.4,
      fontWeight: 900,
      color: C.blue,
    }}>
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        letter
      )}
    </div>
  )
}