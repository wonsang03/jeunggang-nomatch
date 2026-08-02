import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────
type Screen = 'home' | 'login' | 'lobby' | 'waiting' | 'game' | 'augment' | 'result'

// ── Design Tokens ─────────────────────────────────────────────
const C = {
  paper:      '#EDE7C8',   // warm cream notebook paper
  card:       '#F8F4E2',   // lighter card surface — "sticker on paper"
  graphite:   '#3D3830',   // warm dark graphite (not pure black)
  blue:       '#3B72D4',
  blueLight:  '#D6E4FF',
  yellow:     '#F7D842',
  red:        '#E05252',
  green:      '#3D9E62',
  greenLight: '#DAEEE5',
  text:       '#2B2520',   // near-black for headings
  body:       '#2E2A24',   // body text — high contrast
  muted:      '#5C5548',   // muted but still very readable (was too light)
  line:       '#C4A870',   // warm tan notebook lines (not cool blue)
  margin:     '#C85040',   // classic red margin line
}

// Grain SVG data URI — fractal noise for paper texture
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23g)' opacity='0.065'/%3E%3C/svg%3E")`

const notebookLines: React.CSSProperties = {
  backgroundColor: C.paper,
  backgroundImage: `${GRAIN}, repeating-linear-gradient(
    transparent, transparent 31px,
    ${C.line} 31px, ${C.line} 32.5px
  )`,
  backgroundSize: '250px 250px, auto',
}

// Pencil-sketch border with layered graphite smudge shadow
// small=true → 2-layer thin shadow for chips/tags
function sk(border = C.graphite, small = false): React.CSSProperties {
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

// ── SVG Filter Definitions ─────────────────────────────────────
// Rendered once at app root; filter: url(#pencilRough) displaces
// element edges by ~1px — visible on thin borders, imperceptible on text
function PencilFilters() {
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
      </defs>
    </svg>
  )
}

// ── Typography helpers ─────────────────────────────────────────
const F = {
  brand:   "'Gaegu', cursive",     // brand title only
  ui:      "'Gothic A1', sans-serif",
}

// ── Shared Components ─────────────────────────────────────────

function Btn({
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
  const pad:   Record<string, string> = { sm: '5px 14px', md: '10px 24px', lg: '13px 36px' }
  const fs:    Record<string, string> = { sm: '14px', md: '15px', lg: '17px' }
  const fw:    Record<string, number> = { sm: 700, md: 800, lg: 800 }

  const borderC = disabled ? C.muted : C.graphite
  const skStyle = sk(borderC, size === 'sm')

  return (
    <button
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => !disabled && setP(true)}
      onMouseUp={() => setP(false)}
      onMouseLeave={() => setP(false)}
      style={{
        ...skStyle,
        backgroundColor: disabled ? '#d6d1be' : bg[variant],
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

function Field({ label, type = 'text', placeholder, value, onChange }: {
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

function NoteCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      ...sk(),
      ...notebookLines,
      backgroundColor: C.card,
      padding: '24px',
      ...style,
    }}>
      {children}
    </div>
  )
}

function Equalizer({ color = C.blue, h = 22 }: { color?: string; h?: number }) {
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

function TimerRing({ value, max = 40, size = 68 }: { value: number; max?: number; size?: number }) {
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

function SketchInput({ value, onChange, onKeyDown, placeholder, style }: {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  return (
    <input
      value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
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

function MarginLine() {
  return (
    <div style={{
      position: 'absolute', left: '72px', top: 0, bottom: 0,
      width: '2.5px', backgroundColor: C.margin, opacity: 0.7, pointerEvents: 'none',
    }} />
  )
}

// Tag chip for genre labels, status badges
function Tag({ children, color = C.blue, bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  const bgFallback = color === C.blue ? C.blueLight : color === C.green ? C.greenLight : '#FFF9E0'
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

// ── Demo Nav ──────────────────────────────────────────────────

const NAV_LABELS: [Screen, string][] = [
  ['home','홈'], ['login','로그인'], ['lobby','로비'], ['waiting','대기실'],
  ['game','게임'], ['augment','증강선택'], ['result','결과'],
]

function DemoNav({ current, nav }: { current: Screen; nav: (s: Screen) => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 5, zIndex: 999,
      ...sk(), backgroundColor: C.card, padding: '8px 12px',
    }}>
      {NAV_LABELS.map(([s, label]) => (
        <button key={s} onClick={() => nav(s)} style={{
          fontFamily: F.ui, fontSize: '12px', fontWeight: current === s ? 800 : 700,
          padding: '4px 10px', cursor: 'pointer', outline: 'none',
          border: `2px solid ${current === s ? C.blue : C.graphite}`,
          borderRadius: '5px 4px 6px 4px / 4px 6px 5px 5px',
          backgroundColor: current === s ? C.blueLight : 'transparent',
          color: current === s ? C.blue : C.muted,
          filter: 'url(#pencilRough)',
        }}>{label}</button>
      ))}
    </div>
  )
}

// ── Screens ───────────────────────────────────────────────────

function HomeScreen({ nav }: { nav: (s: Screen) => void }) {
  return (
    <div style={{
      minHeight: '100vh', ...notebookLines,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '60px 20px 100px', position: 'relative', overflow: 'hidden',
    }}>
      <MarginLine />
      {[
        { char:'♪',  top:60,  right:100, size:88,  rot:12,  op:0.18, col:C.graphite },
        { char:'♫',  top:180, left:130,  size:64,  rot:-9,  op:0.14, col:C.blue     },
        { char:'♩',  bot:120, right:140, size:96,  rot:16,  op:0.13, col:C.graphite },
        { char:'✏️', bot:200, left:110,  size:44,  rot:-12, op:0.30, col:C.graphite },
        { char:'★',  top:280, right:80,  size:34,  rot:5,   op:0.22, col:C.yellow   },
        { char:'♬',  top:100, left:200,  size:52,  rot:-6,  op:0.11, col:C.blue     },
      ].map((d, i) => (
        <div key={i} style={{
          position:'absolute', top:d.top, bottom:d.bot, left:d.left, right:d.right,
          fontSize:d.size, opacity:d.op, transform:`rotate(${d.rot}deg)`,
          lineHeight:1, color:d.col, userSelect:'none', pointerEvents:'none', fontFamily:'serif',
        }}>{d.char}</div>
      ))}

      <div style={{
        ...sk(), backgroundColor: C.card, padding: '52px 64px',
        maxWidth: 540, width: '100%', textAlign: 'center',
        position: 'relative', zIndex: 1, animation: 'slideUp 0.4s ease-out both',
      }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:'5px', backgroundColor:C.blue, borderRadius:'5px 3px 0 0' }} />

        <div style={{ fontFamily: F.brand, fontSize: 76, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          증강노맞
        </div>

        <div style={{
          display: 'inline-block', backgroundColor: C.yellow,
          padding: '3px 14px', ...sk(C.graphite, true),
          fontFamily: F.ui, fontSize: 13, fontWeight: 800,
          color: C.body, marginTop: 12, marginBottom: 28,
          transform: 'rotate(-1.2deg)', animation: 'wobble 4s ease-in-out infinite',
          letterSpacing: '0.02em',
        }}>
          실시간 멀티플레이 노래 맞히기 게임
        </div>

        <p style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 700, color: C.muted, marginBottom: 36, lineHeight: 1.85, letterSpacing: '0.02em' }}>
          친구랑 노트로 모여<br />노래 맞히고 증강 골라 최강자가 되어봐요 🎵
        </p>

        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Btn variant="primary" size="lg" onClick={() => nav('lobby')}>시작하기</Btn>
          <Btn size="lg" onClick={() => nav('login')}>로그인</Btn>
        </div>
        <div style={{ marginTop: 22, fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted }}>
          처음 오셨나요?{' '}
          <span style={{ color: C.blue, cursor: 'pointer', textDecoration: 'underline', fontWeight: 800 }} onClick={() => nav('login')}>
            회원가입
          </span>
        </div>
        <div style={{ position: 'absolute', bottom: 12, right: 16, opacity: 0.2, fontSize: 11, fontFamily: F.ui, color: C.muted }}>p.1</div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center', zIndex: 1 }}>
        {['최대 10인', '증강 시스템', '실시간 채팅', '장르별 플레이', '10문제마다 보상'].map((t, i) => (
          <div key={t} style={{
            ...sk(C.blue, true), backgroundColor: C.blueLight, color: C.blue,
            fontFamily: F.ui, fontSize: 13, fontWeight: 800, padding: '4px 13px',
            letterSpacing: '0.03em',
            transform: `rotate(${(i % 2 === 0 ? 1 : -1) * (i * 0.4 + 0.4)}deg)`,
          }}>{t}</div>
        ))}
      </div>
    </div>
  )
}

function LoginScreen({ nav }: { nav: (s: Screen) => void }) {
  const [id, setId]     = useState('')
  const [pw, setPw]     = useState('')
  const [nick, setNick] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')

  return (
    <div style={{
      minHeight: '100vh', ...notebookLines,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px 100px', position: 'relative',
    }}>
      <MarginLine />
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ marginBottom: 8, cursor: 'pointer' }} onClick={() => nav('home')}>
          <span style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: C.blue }}>← 증강노맞</span>
        </div>
        <div style={{ fontFamily: F.brand, fontSize: 40, fontWeight: 700, color: C.text, marginBottom: 2 }}>
          {mode === 'login' ? '로그인' : '회원가입'}
        </div>
        <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.muted, marginBottom: 28, borderBottom: `2px solid ${C.line}`, paddingBottom: 14, letterSpacing: '0.02em' }}>
          {mode === 'login' ? '노트에 이름을 적어주세요 ✏️' : '새 이름표를 만들어보세요 ✏️'}
        </div>
        <NoteCard>
          {mode === 'signup' && <Field label="닉네임" placeholder="게임에서 사용할 이름" value={nick} onChange={setNick} />}
          <Field label="아이디" placeholder="example@email.com" value={id} onChange={setId} />
          <Field label="비밀번호" type="password" placeholder="••••••••" value={pw} onChange={setPw} />
          <div style={{ marginTop: 8 }}>
            <Btn variant="primary" fullWidth size="lg" onClick={() => nav('lobby')}>
              {mode === 'login' ? '로그인' : '회원가입'}
            </Btn>
          </div>
          <div style={{ textAlign: 'center', marginTop: 20, fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.muted }}>
            {mode === 'login'
              ? <>계정이 없으신가요? <span style={{ color: C.blue, cursor: 'pointer', fontWeight: 800 }} onClick={() => setMode('signup')}>회원가입</span></>
              : <>이미 계정이 있으신가요? <span style={{ color: C.blue, cursor: 'pointer', fontWeight: 800 }} onClick={() => setMode('login')}>로그인</span></>
            }
          </div>
        </NoteCard>
      </div>
    </div>
  )
}

// ── Lobby ──────────────────────────────────────────────────────

const ROOMS = [
  { id: 1, name: '케이팝 고수 모여라', players: 7,  max: 10, priv: false, genre: 'K-POP'  },
  { id: 2, name: '90년대 아이돌 특집',  players: 3,  max: 8,  priv: false, genre: '복고'   },
  { id: 3, name: '민지네 방',            players: 5,  max: 6,  priv: true,  genre: '전체'   },
  { id: 4, name: '발라드 마스터',        players: 2,  max: 10, priv: false, genre: '발라드' },
  { id: 5, name: '아이돌 퀴즈왕',       players: 9,  max: 10, priv: false, genre: 'K-POP'  },
  { id: 6, name: '국내 인디 탐험대',    players: 4,  max: 8,  priv: false, genre: '인디'   },
]

function LobbyScreen({ nav }: { nav: (s: Screen) => void }) {
  const [search, setSearch] = useState('')
  const [code, setCode]     = useState('')
  const filtered = ROOMS.filter(r => r.name.includes(search) || r.genre.includes(search))

  return (
    <div style={{ minHeight: '100vh', ...notebookLines, position: 'relative' }}>
      {/* Margin red line */}
      <MarginLine />

      {/* Corner doodles — faint, non-intrusive */}
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        {/* Top-left corner cluster */}
        <div style={{ position: 'absolute', top: 90, left: 90, opacity: 0.12, fontSize: 38, color: C.graphite, transform: 'rotate(-14deg)', fontFamily: 'serif' }}>♪</div>
        <div style={{ position: 'absolute', top: 140, left: 108, opacity: 0.09, fontSize: 22, color: C.graphite, transform: 'rotate(6deg)', fontFamily: 'serif' }}>♫</div>
        <div style={{ position: 'absolute', top: 108, left: 150, opacity: 0.07, fontSize: 16, color: C.graphite, fontFamily: F.ui, fontWeight: 700 }}>★</div>

        {/* Top-right */}
        <div style={{ position: 'absolute', top: 80, right: 60, opacity: 0.10, fontSize: 44, color: C.blue, transform: 'rotate(10deg)', fontFamily: 'serif' }}>♩</div>
        <div style={{ position: 'absolute', top: 130, right: 88, opacity: 0.07, fontSize: 18, color: C.graphite, transform: 'rotate(-4deg)', fontFamily: 'serif' }}>♬</div>

        {/* Bottom-right */}
        <div style={{ position: 'absolute', bottom: 100, right: 80, opacity: 0.10, fontSize: 52, color: C.graphite, transform: 'rotate(18deg)', fontFamily: 'serif' }}>♪</div>
        <div style={{ position: 'absolute', bottom: 148, right: 110, opacity: 0.07, fontSize: 20, color: C.graphite, transform: 'rotate(-6deg)', fontFamily: F.ui, fontWeight: 700 }}>✦</div>

        {/* Bottom-left */}
        <div style={{ position: 'absolute', bottom: 120, left: 88, opacity: 0.09, fontSize: 40, color: C.blue, transform: 'rotate(-12deg)', fontFamily: 'serif' }}>♫</div>

        {/* Pencil scribble strokes (SVG) */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.07 }}>
          {/* top-left squiggle */}
          <path d="M 88 200 Q 96 192 104 200 Q 112 208 122 200" stroke={C.graphite} strokeWidth="2" fill="none" strokeLinecap="round"/>
          <path d="M 88 216 Q 100 210 112 218" stroke={C.graphite} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          {/* bottom-right squiggle */}
          <path d="M calc(100% - 100px) calc(100% - 160px) Q calc(100% - 90px) calc(100% - 168px) calc(100% - 80px) calc(100% - 160px)" stroke={C.graphite} strokeWidth="2" fill="none" strokeLinecap="round"/>
        </svg>
      </div>

      {/* Topbar */}
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
        <div style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 700, color: C.muted }}>
          안녕하세요,{' '}
          <strong style={{ color: C.body, fontWeight: 900 }}>멜로디킹</strong> 님!
        </div>
        <div style={{
          width: 40, height: 40,
          ...sk(C.blue, true),
          backgroundColor: C.blueLight,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: F.ui, fontSize: 17, fontWeight: 900, color: C.blue,
        }}>
          멜
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 24px 120px', position: 'relative', zIndex: 1 }}>

        {/* Action bar */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn variant="primary" size="md" onClick={() => nav('waiting')}>+ 방 만들기</Btn>
          <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
            <SketchInput
              value={code} onChange={setCode}
              placeholder="초대 코드 입력..."
              style={{ flex: 1, fontSize: '15px', padding: '10px 14px', fontWeight: 700 }}
            />
            <Btn onClick={() => nav('waiting')}>코드 입장</Btn>
          </div>
          <SketchInput
            value={search} onChange={setSearch}
            placeholder="방 이름 / 장르 검색..."
            style={{ width: 230, fontSize: '15px', padding: '10px 14px', fontWeight: 700 }}
          />
        </div>

        {/* Section label */}
        <div style={{
          fontFamily: F.ui, fontSize: 13, fontWeight: 800,
          color: C.muted, marginBottom: 14, paddingLeft: 2,
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          공개 방 목록 ({filtered.length})
        </div>

        {/* Room cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(room => {
            const pct = room.players / room.max
            const full = pct >= 1
            return (
              <div
                key={room.id}
                onClick={() => !full && nav('waiting')}
                style={{
                  ...sk(),
                  backgroundColor: C.card,
                  padding: '16px 24px',
                  display: 'flex', alignItems: 'center', gap: 16,
                  cursor: full ? 'not-allowed' : 'pointer',
                  opacity: full ? 0.72 : 1,
                  transition: 'transform 0.1s, box-shadow 0.1s',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  if (full) return
                  const el = e.currentTarget as HTMLDivElement
                  el.style.transform = 'translate(-2px,-2px)'
                  el.style.boxShadow = `4.5px 4.5px 0 ${C.graphite}, 6.5px 6.5px 0 ${C.graphite}55, 8px 8px 0 ${C.graphite}18`
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.transform = ''
                  el.style.boxShadow = `2.5px 2.5px 0 ${C.graphite}, 4px 4px 0 ${C.graphite}60, 5.5px 5.5px 0 ${C.graphite}18`
                }}
              >
                {/* Genre chip */}
                <Tag color={C.blue}>{room.genre}</Tag>

                {/* Room name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: F.ui, fontSize: 17, fontWeight: 800,
                    color: C.body, lineHeight: 1.3, letterSpacing: '0.01em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {room.priv ? '🔒 ' : ''}{room.name}
                  </div>
                </div>

                {/* Player count + bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{
                    fontFamily: F.ui, fontSize: 15, fontWeight: 900,
                    color: pct > 0.8 ? C.red : C.body, minWidth: 40, textAlign: 'right',
                  }}>
                    {room.players}/{room.max}
                  </span>
                  <div style={{
                    width: 72, height: 7,
                    backgroundColor: `${C.graphite}20`,
                    borderRadius: 4, overflow: 'hidden',
                    border: `1.5px solid ${C.graphite}30`,
                  }}>
                    <div style={{
                      width: `${pct * 100}%`, height: '100%',
                      backgroundColor: pct > 0.8 ? C.red : C.blue,
                      borderRadius: 4,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>

                {/* CTA */}
                <Btn size="sm" variant={full ? 'default' : room.priv ? 'default' : 'primary'} disabled={full}>
                  {full ? '가득 참' : room.priv ? '🔒 비공개' : '입장'}
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

const PLAYERS = [
  { id: 1, name: '노래박사', ready: true,  isHost: true  },
  { id: 2, name: '멜로디킹', ready: true,  isHost: false },
  { id: 3, name: '음악천재', ready: false, isHost: false },
  { id: 4, name: '리듬퀸',   ready: true,  isHost: false },
  { id: 5, name: '박자달인', ready: false, isHost: false },
]

function WaitingScreen({ nav }: { nav: (s: Screen) => void }) {
  const [players]   = useState(PLAYERS)
  const [chatInput, setChatInput] = useState('')
  const [myReady, setMyReady]     = useState(false)
  const [chats, setChats]         = useState([
    { id: 1, user: '노래박사', text: '반갑습니다~!',         self: false },
    { id: 2, user: '리듬퀸',   text: '오늘 K-POP으로 해요', self: false },
  ])
  const [genre, setGenre]   = useState('K-POP')
  const [qCount, setQCount] = useState(20)
  const [maxP, setMaxP]     = useState(10)
  const [priv, setPriv]     = useState(false)
  const chatRef             = useRef<HTMLDivElement>(null)
  const isHost              = true

  const sendChat = () => {
    if (!chatInput.trim()) return
    setChats(c => [...c, { id: Date.now(), user: '나', text: chatInput, self: true }])
    setChatInput('')
  }

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chats])

  const selBtn = (val: string | number, current: string | number) => ({
    ...sk(current === val ? C.blue : C.graphite, true),
    backgroundColor: current === val ? C.blueLight : C.card,
    color: current === val ? C.blue : C.body,
    fontFamily: F.ui,
    fontSize: '14px',
    fontWeight: 800 as const,
    padding: '5px 14px',
    cursor: 'pointer',
    border: `2px solid ${current === val ? C.blue : C.graphite}`,
    borderRadius: '5px 4px 6px 4px / 4px 5px 4px 5px',
    outline: 'none',
    letterSpacing: '0.02em',
    filter: 'url(#pencilRough)',
  })

  return (
    <div style={{ minHeight: '100vh', ...notebookLines }}>
      <div style={{ backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`, boxShadow: `0 3px 0 ${C.graphite}50`, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 14, filter: 'url(#pencilRough)' }}>
        <Btn size="sm" onClick={() => nav('lobby')}>← 로비</Btn>
        <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, flex: 1, color: C.body }}>케이팝 고수 모여라 🎵</div>
        <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.muted }}>
          {players.filter(p => p.ready).length}/{players.length} 준비 완료
        </div>
      </div>

      <div style={{ maxWidth: 1020, margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <NoteCard>
            <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 16, color: C.body, letterSpacing: '0.01em' }}>참가자 ({players.length}/10)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {players.map(p => (
                <div key={p.id} style={{
                  ...sk(p.ready ? C.green : C.graphite, true),
                  backgroundColor: p.ready ? C.greenLight : C.card,
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 32, height: 32, flexShrink: 0,
                    ...sk(p.isHost ? C.yellow : C.graphite, true),
                    backgroundColor: p.isHost ? C.yellow : C.blueLight,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: F.ui, fontSize: 14, fontWeight: 900,
                    color: p.isHost ? C.body : C.blue,
                  }}>{p.name[0]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 800, color: C.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.01em' }}>
                      {p.isHost ? '👑 ' : ''}{p.name}
                    </div>
                    <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 700, color: p.ready ? C.green : C.muted, marginTop: 1 }}>
                      {p.ready ? '준비 완료 ✓' : '대기 중...'}
                    </div>
                  </div>
                </div>
              ))}
              {Array.from({ length: Math.max(0, 4 - players.length) }).map((_, i) => (
                <div key={`e${i}`} style={{ border: `2px dashed ${C.line}`, borderRadius: 6, padding: '10px 14px', fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.line, display: 'flex', alignItems: 'center' }}>빈 자리</div>
              ))}
            </div>
          </NoteCard>

          {isHost && (
            <NoteCard>
              <div style={{ fontFamily: F.ui, fontSize: 17, fontWeight: 900, marginBottom: 16, color: C.body }}>방장 설정 ✏️</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 7, letterSpacing: '0.06em', textTransform: 'uppercase' }}>장르</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {['K-POP','발라드','복고','인디','전체'].map(g => <button key={g} onClick={() => setGenre(g)} style={selBtn(g, genre)}>{g}</button>)}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 7, letterSpacing: '0.06em', textTransform: 'uppercase' }}>문제 수</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[10, 20, 30].map(n => <button key={n} onClick={() => setQCount(n)} style={selBtn(n, qCount)}>{n}문제</button>)}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 7, letterSpacing: '0.06em', textTransform: 'uppercase' }}>최대 인원</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[4, 6, 8, 10].map(n => <button key={n} onClick={() => setMaxP(n)} style={selBtn(n, maxP)}>{n}명</button>)}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 7, letterSpacing: '0.06em', textTransform: 'uppercase' }}>공개 여부</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['공개','비공개'].map(v => <button key={v} onClick={() => setPriv(v === '비공개')} style={selBtn(v, priv ? '비공개' : '공개')}>{v}</button>)}
                  </div>
                </div>
              </div>
            </NoteCard>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            {isHost
              ? <Btn variant="primary" size="lg" onClick={() => nav('game')} fullWidth>게임 시작 →</Btn>
              : <Btn variant={myReady ? 'default' : 'yellow'} size="lg" onClick={() => setMyReady(r => !r)} fullWidth>{myReady ? '준비 취소' : '준비 완료!'}</Btn>
            }
          </div>
        </div>

        <NoteCard style={{ display: 'flex', flexDirection: 'column', padding: '16px', minHeight: 400 }}>
          <div style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 900, marginBottom: 12, paddingBottom: 8, borderBottom: `1.5px solid ${C.line}`, color: C.body }}>대기실 채팅</div>
          <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, minHeight: 0 }}>
            {chats.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: c.self ? 'flex-end' : 'flex-start', animation: 'slideUp 0.2s ease-out both' }}>
                <div style={{ ...sk(c.self ? C.blue : C.graphite, true), backgroundColor: c.self ? C.blueLight : C.card, padding: '6px 12px', maxWidth: '85%' }}>
                  {!c.self && <div style={{ fontFamily: F.ui, fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 2 }}>{c.user}</div>}
                  <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.body }}>{c.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <SketchInput value={chatInput} onChange={setChatInput} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="채팅..." style={{ flex: 1, fontSize: '14px', padding: '7px 11px' }} />
            <Btn size="sm" variant="primary" onClick={sendChat}>전송</Btn>
          </div>
        </NoteCard>
      </div>
    </div>
  )
}

// ── Game ───────────────────────────────────────────────────────

const INIT_MSGS = [
  { id: 1, user: '노래박사', text: '다들 잘 부탁해요!',              type: 'chat', self: false },
  { id: 2, user: '나',       text: '고고!',                           type: 'chat', self: true  },
  { id: 3, user: '',         text: '노래박사가 제목을 맞혔습니다! +1점', type: 'correct', self: false },
  { id: 4, user: '음악천재', text: '이거 뭔 노래야 ㅋㅋ',             type: 'chat', self: false },
  { id: 5, user: '',         text: '과반수 스킵 → 정답 공개: "밤편지" (IU)', type: 'skip', self: false },
  { id: 6, user: '리듬퀸',   text: '아 이거였구나!!',                 type: 'chat', self: false },
]
const SCORES = [
  { name: '노래박사', score: 8 },
  { name: '나',       score: 5 },
  { name: '멜로디킹', score: 4 },
  { name: '리듬퀸',   score: 3 },
]

function GameScreen({ nav }: { nav: (s: Screen) => void }) {
  const [timer, setTimer] = useState(40)
  const [input, setInput] = useState('')
  const [msgs,  setMsgs]  = useState(INIT_MSGS)
  const [skipCt,setSkipCt]= useState(2)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setInterval(() => setTimer(v => Math.max(0, v - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (timer === 0) { const t = setTimeout(() => nav('augment'), 800); return () => clearTimeout(t) }
  }, [timer, nav])
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, [msgs])

  const send = useCallback(() => {
    if (!input.trim()) return
    setMsgs(m => [...m, { id: Date.now(), user: '나', text: input, type: 'chat', self: true }])
    setInput('')
  }, [input])

  const skip = () => {
    setSkipCt(n => n + 1)
    setMsgs(m => [...m, { id: Date.now(), user: '', text: `내가 스킵 요청 (${skipCt + 1}/5)`, type: 'skip', self: false }])
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', ...notebookLines }}>
      <div style={{ backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`, boxShadow: `0 3px 0 ${C.graphite}50`, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap', filter: 'url(#pencilRough)' }}>
        <TimerRing value={timer} />
        <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: C.muted, flexShrink: 0 }}>Q11/20</div>
        <div style={{ ...sk(C.graphite, true), backgroundColor: C.blueLight, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Equalizer />
          <span style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: C.blue }}>노래 재생 중</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {['제목','가수'].map(s => (
            <div key={s} style={{ ...sk(C.graphite, true), backgroundColor: C.paper, padding: '4px 14px', fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{s}</span><span style={{ letterSpacing: 4 }}>_ _ _</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {SCORES.map((s, i) => (
            <span key={s.name} style={{ fontFamily: F.ui, fontSize: 13, fontWeight: s.name === '나' ? 900 : 700, color: s.name === '나' ? C.blue : C.muted }}>
              {['🥇','🥈','🥉','4️⃣'][i]}{s.name} {s.score}pt
            </span>
          ))}
        </div>
        <div style={{ ...sk(C.yellow, true), backgroundColor: '#FFF9E0', padding: '4px 10px', fontFamily: F.ui, fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>⚡ 황금 귀</div>
        <Btn size="sm" onClick={skip}>스킵 {skipCt}/5</Btn>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 15 }}>🔊</span>
          <input type="range" min={0} max={100} defaultValue={70} style={{ width: 56, accentColor: C.blue }} />
        </div>
      </div>

      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.map(msg => {
          if (msg.type === 'correct' || msg.type === 'skip') {
            return (
              <div key={msg.id} style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ ...sk(msg.type === 'correct' ? C.green : C.muted, true), backgroundColor: msg.type === 'correct' ? C.greenLight : '#EDEAE0', padding: '5px 18px', fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: msg.type === 'correct' ? C.green : C.muted, textAlign: 'center', animation: 'popIn 0.25s ease-out both' }}>
                  {msg.type === 'correct' ? '🎯 ' : '⏭ '}{msg.text}
                </div>
              </div>
            )
          }
          return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.self ? 'flex-end' : 'flex-start', gap: 7, alignItems: 'flex-end', animation: 'slideUp 0.18s ease-out both' }}>
              {!msg.self && (
                <div style={{ width: 28, height: 28, flexShrink: 0, ...sk(C.graphite, true), backgroundColor: C.blueLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.ui, fontSize: 12, fontWeight: 900, color: C.blue }}>
                  {msg.user?.[0]}
                </div>
              )}
              <div style={{ maxWidth: '62%' }}>
                {!msg.self && <div style={{ fontFamily: F.ui, fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 2, paddingLeft: 2 }}>{msg.user}</div>}
                <div style={{ ...sk(msg.self ? C.blue : C.graphite, true), backgroundColor: msg.self ? C.blueLight : C.card, padding: '8px 14px', fontFamily: F.ui, fontSize: 15, fontWeight: 700, color: C.body, lineHeight: 1.5 }}>
                  {msg.text}
                </div>
              </div>
            </div>
          )
        })}
        {timer === 0 && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ ...sk(C.yellow), backgroundColor: C.yellow, padding: '14px 36px', fontFamily: F.ui, fontSize: 20, fontWeight: 900, color: C.body, textAlign: 'center', animation: 'popIn 0.3s ease-out both' }}>
              ✏️ 정답: "밤편지" (IU)
            </div>
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      <div style={{ backgroundColor: C.card, borderTop: `2.5px solid ${C.graphite}`, boxShadow: `0 -3px 0 ${C.graphite}30`, padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, filter: 'url(#pencilRough)' }}>
        <SketchInput value={input} onChange={setInput} onKeyDown={e => e.key === 'Enter' && send()} placeholder="정답 또는 채팅 입력... (Enter로 제출)" style={{ flex: 1, fontSize: '16px', padding: '10px 16px', backgroundColor: C.paper }} />
        <Btn variant="primary" onClick={send}>제출</Btn>
        <Btn onClick={skip}>스킵</Btn>
      </div>
    </div>
  )
}

// ── Augment ────────────────────────────────────────────────────

const AUGMENTS = [
  { id: 1, name: '박자 감지기', desc: '정답 첫 음절이 맞으면 자동 힌트 제공', icon: '🥁', tier: 'bronze' as const },
  { id: 2, name: '가수 리스트', desc: '3초 후 가수 이름 초성 자동 공개',         icon: '🎤', tier: 'silver' as const },
  { id: 3, name: '황금 귀',     desc: '이번 라운드 제출 횟수 +2회 추가',          icon: '👂', tier: 'gold'   as const },
]
const TIER_COL = { bronze: '#A0601A', silver: '#606878', gold: '#A07820' }
const TIER_BG  = { bronze: '#FFF0E0', silver: '#F0F0F4', gold: '#FFF8D8' }

function AugmentScreen({ nav }: { nav: (s: Screen) => void }) {
  const [timer,    setTimer]    = useState(20)
  const [selected, setSelected] = useState<number | null>(null)
  const [rerolled, setRerolled] = useState(false)
  const owned = [{ id: 10, name: '가수 리스트', icon: '🎤', tier: 'silver' as const }]

  useEffect(() => {
    if (timer <= 0) { nav('game'); return }
    const t = setInterval(() => setTimer(v => v - 1), 1000)
    return () => clearInterval(t)
  }, [timer, nav])

  return (
    <div style={{ minHeight: '100vh', ...notebookLines, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px 100px' }}>
      <div style={{ maxWidth: 820, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-block', ...sk(C.graphite, true), backgroundColor: C.yellow, fontFamily: F.ui, fontSize: 13, fontWeight: 800, padding: '2px 14px', marginBottom: 8, transform: 'rotate(-0.8deg)', letterSpacing: '0.03em' }}>
            10문제 완료!
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 42, fontWeight: 900, color: C.text, lineHeight: 1.1, letterSpacing: '-0.01em' }}>증강 선택</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 800, color: timer <= 5 ? C.red : C.muted }}>{timer}초 안에 고르세요</span>
            <div style={{ width: 180, height: 7, backgroundColor: `${C.graphite}20`, borderRadius: 4, overflow: 'hidden', border: `1.5px solid ${C.graphite}25` }}>
              <div style={{ width: `${(timer / 20) * 100}%`, height: '100%', backgroundColor: timer <= 5 ? C.red : C.blue, borderRadius: 4, transition: 'width 1s linear, background-color 0.3s' }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 22 }}>
          {AUGMENTS.map(aug => (
            <div key={aug.id} onClick={() => setSelected(aug.id)} style={{
              ...sk(selected === aug.id ? C.blue : C.graphite, false),
              backgroundColor: selected === aug.id ? C.blueLight : TIER_BG[aug.tier],
              padding: '32px 20px', cursor: 'pointer', textAlign: 'center',
              transform: selected === aug.id ? 'translate(-2px,-2px)' : undefined,
              transition: 'all 0.12s', position: 'relative', animation: 'popIn 0.25s ease-out both',
            }}>
              <div style={{ position: 'absolute', top: 10, right: 12, fontFamily: F.ui, fontSize: 11, fontWeight: 900, color: TIER_COL[aug.tier], letterSpacing: '0.1em', textTransform: 'uppercase' }}>{aug.tier}</div>
              <div style={{ fontSize: 52, marginBottom: 14 }}>{aug.icon}</div>
              <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, color: C.body, marginBottom: 8, letterSpacing: '0.01em' }}>{aug.name}</div>
              <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, lineHeight: 1.6 }}>{aug.desc}</div>
              {selected === aug.id && <div style={{ marginTop: 18, ...sk(C.blue, true), backgroundColor: C.blue, color: '#fff', fontFamily: F.ui, fontSize: 13, fontWeight: 800, padding: '5px 0' }}>선택됨 ✓</div>}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 28 }}>
          <Btn disabled={rerolled} onClick={() => setRerolled(true)}>{rerolled ? '리롤 사용함' : '🔄 리롤 (1회)'}</Btn>
          <Btn variant="primary" size="lg" disabled={selected === null} onClick={() => nav('game')}>보관하기 →</Btn>
        </div>

        <div style={{ ...sk(), backgroundColor: C.card, padding: '14px 20px' }}>
          <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>보유 증강</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {owned.map(a => (
              <div key={a.id} style={{ ...sk(C.graphite, true), backgroundColor: TIER_BG[a.tier], padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 6, fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: C.body }}>{a.icon} {a.name}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Result ─────────────────────────────────────────────────────

const RESULTS = [
  { rank: 1, name: '노래박사', score: 18, correct: 12 },
  { rank: 2, name: '멜로디킹', score: 14, correct: 9  },
  { rank: 3, name: '나',       score: 11, correct: 8  },
  { rank: 4, name: '음악천재', score: 7,  correct: 5  },
  { rank: 5, name: '박자달인', score: 4,  correct: 3  },
]

function ResultScreen({ nav }: { nav: (s: Screen) => void }) {
  const myRank = RESULTS.find(r => r.name === '나')?.rank ?? 0
  return (
    <div style={{ minHeight: '100vh', ...notebookLines, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px 100px' }}>
      <div style={{ maxWidth: 640, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 58, lineHeight: 1, animation: 'popIn 0.4s ease-out both' }}>🏆</div>
          <div style={{ fontFamily: F.ui, fontSize: 42, fontWeight: 900, color: C.text, lineHeight: 1.1, letterSpacing: '-0.01em' }}>게임 종료!</div>
          <div style={{ fontFamily: F.ui, fontSize: 16, fontWeight: 700, color: C.muted, marginTop: 6 }}>
            나의 순위: <strong style={{ color: myRank <= 3 ? C.blue : C.body, fontWeight: 900 }}>{myRank}위</strong>
          </div>
        </div>

        <div style={{ ...sk(), backgroundColor: C.card, overflow: 'hidden', animation: 'slideUp 0.35s ease-out both' }}>
          <div style={{ backgroundColor: C.graphite, padding: '11px 24px', display: 'grid', gridTemplateColumns: '48px 1fr 80px 80px', gap: 8, fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.05em' }}>
            <div>순위</div><div>닉네임</div>
            <div style={{ textAlign: 'right' }}>정답</div>
            <div style={{ textAlign: 'right' }}>점수</div>
          </div>
          {RESULTS.map((r, i) => (
            <div key={r.rank} style={{ padding: '14px 24px', display: 'grid', gridTemplateColumns: '48px 1fr 80px 80px', gap: 8, alignItems: 'center', backgroundColor: r.name === '나' ? C.blueLight : i % 2 === 0 ? C.card : '#F2EDD8', borderBottom: `1.5px solid ${C.line}` }}>
              <div style={{ fontFamily: F.ui, fontSize: 22, fontWeight: 900 }}>
                {['🥇','🥈','🥉'][r.rank - 1] ?? `${r.rank}`}
              </div>
              <div style={{ fontFamily: F.ui, fontSize: 17, fontWeight: r.name === '나' ? 900 : 700, color: r.name === '나' ? C.blue : C.body, letterSpacing: '0.01em' }}>
                {r.name === '나' ? '★ ' : ''}{r.name}
              </div>
              <div style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 700, color: C.muted, textAlign: 'right' }}>{r.correct}개</div>
              <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, color: C.body, textAlign: 'right' }}>{r.score}pt</div>
            </div>
          ))}
        </div>

        <div style={{ ...sk(C.red, true), backgroundColor: '#FFF0F0', padding: '12px 20px', marginTop: 18, fontFamily: F.ui, fontSize: 15, fontWeight: 700, color: C.red, transform: 'rotate(-0.6deg)', lineHeight: 1.6 }}>
          ✏️ 오늘도 수고했어요! 다음엔 더 잘할 수 있을 거예요 :)
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 24, justifyContent: 'center' }}>
          <Btn variant="primary" size="lg" onClick={() => nav('waiting')}>다시하기</Btn>
          <Btn size="lg" onClick={() => nav('lobby')}>로비로</Btn>
        </div>
      </div>
    </div>
  )
}

// ── App Root ──────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>('lobby')

  const render = () => {
    switch (screen) {
      case 'home':    return <HomeScreen    nav={setScreen} />
      case 'login':   return <LoginScreen   nav={setScreen} />
      case 'lobby':   return <LobbyScreen   nav={setScreen} />
      case 'waiting': return <WaitingScreen nav={setScreen} />
      case 'game':    return <GameScreen    nav={setScreen} />
      case 'augment': return <AugmentScreen nav={setScreen} />
      case 'result':  return <ResultScreen  nav={setScreen} />
    }
  }

  return (
    <>
      <PencilFilters />
      {render()}
      <DemoNav current={screen} nav={setScreen} />
    </>
  )
}
