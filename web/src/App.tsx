import { useState, useEffect, useRef, useCallback } from 'react'
import { useGame } from './GameContext'
import { api, avatarSrc } from './api'
import { GENRES, emptyGenreCounts, type GenreName } from './genres'
import { normalizeSongTags } from './tags'
import { playSfx } from './sfx'

// ── Types ─────────────────────────────────────────────────────
type Screen = 'home' | 'login' | 'lobby' | 'waiting' | 'game' | 'augment' | 'result' | 'bank' | 'profile'

// ── Design Tokens ─────────────────────────────────────────────
// Soft blue + paper white (stationery aesthetic)
const C = {
  paper:      '#EEF3F8',
  card:       '#F7FAFC',
  panel:      '#F7FAFC',
  graphite:   '#2A3340',
  blue:       '#5D8CD7',
  blueLight:  '#D6E8F7',
  yellow:     '#F5E6A3',
  red:        '#E05252',
  green:      '#3D9E62',
  greenLight: '#DAEEE5',
  text:       '#1A1A1A',
  body:       '#222831',
  muted:      '#5A6570',
  line:       '#C6DCE8',
  margin:     '#C85040',
}

/** 구겨진 종이 사진 배경 */
const crumpledPaper: React.CSSProperties = {
  backgroundColor: '#E8F1F7',
  backgroundImage: 'url(/crumpled-paper.png)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundAttachment: 'fixed',
  position: 'relative',
}

const notebookLines = crumpledPaper

function CrumpleOverlay() {
  // 실 질감 이미지가 배경이므로 추가 CSS 구김 레이어는 쓰지 않음
  return null
}

function PaperShell({
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
const F = {
  brand: "'Gaegu', cursive",   // 타이틀·채팅 큰 글씨
  chat:  "'Gaegu', cursive",
  ui:    "'Jua', sans-serif",  // 작은 라벨·UI (비슷한 느낌, 작은 크기에서 더 또렷)
}

/** 긴 제목/가수: 공개 전이면 초성 힌트(있으면) 또는 ？？？ */
function FitAnswer({
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
  const text = revealed && value ? value : (hint || '？？？')
  const isHint = !revealed && !!hint
  const len = text.length
  const size = len > 24 ? 15 : len > 16 ? 18 : len > 10 ? 22 : 26
  return (
    <div style={{ flex: 1, minWidth: 0, maxWidth: 280, textAlign: 'center' }}>
      <div style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 400, color: C.muted, marginBottom: 4 }}>{label}</div>
      <div
        title={revealed && value ? value : undefined}
        style={{
          fontFamily: F.brand,
          fontSize: size,
          fontWeight: 700,
          color: revealed ? C.body : isHint ? C.blue : C.line,
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
      backgroundColor: C.panel,
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

/** 링만 250ms 갱신 — GameScreen 전체 리렌더 방지 */
function RoundTimer({ endsAt, max = 40, size = 58 }: { endsAt: number; max?: number; size?: number }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [endsAt])
  return <TimerRing value={left} max={max} size={size} />
}

function SketchInput({ value, onChange, onKeyDown, placeholder, style, noPaste }: {
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

function MarginLine() {
  return null
}

// Tag chip for genre labels, status badges
function Tag({ children, color = C.blue, bg }: { children: React.ReactNode; color?: string; bg?: string }) {
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

function Avatar({
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

// ── Screens ───────────────────────────────────────────────────

function HomeScreen({ nav }: { nav: (s: Screen) => void }) {
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
        {['최대 10인', '증강 시스템', '실시간 채팅', '장르별 플레이', '10문제마다 보상'].map(t => (
          <div key={t} style={{
            ...sk(C.blue, true), backgroundColor: C.blueLight, color: C.blue,
            fontFamily: F.ui, fontSize: 14, fontWeight: 400, padding: '6px 14px',
          }}>{t}</div>
        ))}
      </div>
    </div>
  )
}

function LoginScreen({ nav }: { nav: (s: Screen) => void }) {
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

// ── Lobby ──────────────────────────────────────────────────────

function LobbyScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, rooms, connected, pingMs, musicVolume, sfxVolume, setMusicVolume, setSfxVolume, createRoom, joinRoom, logout } = useGame()
  const [search, setSearch] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const filtered = rooms.filter(r => r.name.includes(search) || r.genre.includes(search))

  useEffect(() => {
    if (!user) nav('login')
  }, [user, nav])

  const makeRoom = async () => {
    setBusy(true); setErr('')
    try {
      await createRoom({ name: `${user?.nickname || '나'}의 방`, genreCounts: emptyGenreCounts('K팝', 20), maxPlayers: 10 })
      nav('waiting')
    } catch (e) { setErr(e instanceof Error ? e.message : '실패') }
    finally { setBusy(false) }
  }

  const enter = async (roomId: string) => {
    setBusy(true); setErr('')
    try {
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

  const pingColor = !connected ? C.red : pingMs == null ? C.muted : pingMs < 80 ? C.green : pingMs < 160 ? C.blue : C.red

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
            <span style={{ color: pingColor, fontVariantNumeric: 'tabular-nums' }}>
              {pingMs == null ? '…ms' : `${pingMs}ms`}
            </span>
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
          <Btn variant="primary" size="md" onClick={makeRoom} disabled={busy || !connected}>+ 방 만들기</Btn>
          <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
            <SketchInput
              value={code} onChange={setCode}
              placeholder="초대 코드 입력..."
              style={{ flex: 1, fontSize: '15px', padding: '10px 14px', fontWeight: 700 }}
            />
            <Btn onClick={enterCode} disabled={busy || !connected}>코드 입장</Btn>
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
            const pct = room.players / room.max
            const full = pct >= 1
            return (
              <div
                key={room.id}
                onClick={() => !full && !busy && enter(room.id)}
                style={{
                  ...sk(),
                  backgroundColor: C.card,
                  padding: '16px 24px',
                  display: 'flex', alignItems: 'center', gap: 16,
                  cursor: full ? 'not-allowed' : 'pointer',
                  opacity: full ? 0.72 : 1,
                }}
              >
                <Tag color={C.blue}>{room.genre}</Tag>
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
                  color: pct > 0.8 ? C.red : C.body, minWidth: 40, textAlign: 'right',
                }}>
                  {room.players}/{room.max}
                </span>
                <Btn size="sm" variant={full ? 'default' : 'primary'} disabled={full || busy}>
                  {full ? '가득 참' : '입장'}
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

function WaitingScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, roomCode, chats, setReady, updateSettings, startGame, sendChat, leaveRoom } = useGame()
  const [chatInput, setChatInput] = useState('')
  const [err, setErr] = useState('')
  const [leaveOpen, setLeaveOpen] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!room) nav('lobby')
  }, [room, nav])

  useEffect(() => {
    if (room?.status === 'playing' || room?.status === 'revealing' || room?.status === 'countdown' || room?.status === 'duel') nav('game')
    if (room?.status === 'augment') nav('augment')
  }, [room?.status, nav])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chats])

  if (!room || !user) return null

  const players = room.members
  const me = players.find(p => p.userId === user.id)
  const isHost = room.hostId === user.id
  const qCount = GENRES.reduce((sum, g) => sum + (room.genreCounts[g] || 0), 0)

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
    const next: Record<string, number> = {}
    for (const g of GENRES) next[g] = g === genre ? n : (room.genreCounts[g] || 0)
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

  return (
    <div style={{ minHeight: '100vh', ...notebookLines }}>
      <div style={{ backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`, boxShadow: `0 3px 0 ${C.graphite}50`, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 14, filter: 'url(#pencilRough)' }}>
        <Btn size="sm" onClick={() => setLeaveOpen(true)}>← 로비</Btn>
        <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, flex: 1, color: C.body }}>{room.name}</div>
        {roomCode && <div style={{ fontFamily: F.ui, fontSize: 14, color: C.blue }}>코드: {roomCode}</div>}
        <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.muted }}>
          {players.filter(p => p.ready).length}/{players.length} 준비 완료
        </div>
      </div>

      <div style={{ maxWidth: 1020, margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <NoteCard>
            <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 16, color: C.body }}>참가자 ({players.length}/{room.maxPlayers})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {players.map(p => (
                <div key={p.userId} style={{
                  ...sk(p.ready ? C.green : C.graphite, true),
                  backgroundColor: p.ready ? C.greenLight : C.card,
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <Avatar name={p.nickname} url={p.avatarUrl} size={32} host={p.isHost} />
                  <div style={{ flex: 1, fontFamily: F.ui, fontSize: 15, fontWeight: 800 }}>{p.nickname}{p.isHost ? ' 👑' : ''}</div>
                  <div style={{ fontFamily: F.ui, fontSize: 13, color: p.ready ? C.green : C.muted }}>{p.ready ? '준비' : '대기'}</div>
                </div>
              ))}
            </div>
          </NoteCard>

          <NoteCard>
            <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 12 }}>채팅</div>
            <div ref={chatRef} style={{ height: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {chats.map(m => (
                <div key={m.id} style={{ fontFamily: F.chat, fontSize: 18 }}>
                  <strong style={{ color: m.system ? C.green : C.blue }}>{m.nickname}</strong>: {m.text}
                </div>
              ))}
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
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 10 }}>장르별 출제 수 (총 {qCount}곡)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              {GENRES.map(g => {
                const n = room.genreCounts[g] || 0
                return (
                  <div key={g}>
                    <div style={{ fontFamily: F.ui, fontSize: 13, color: C.body, fontWeight: 800, marginBottom: 4 }}>{g}: {n}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {[0, 5, 10, 15, 20].map(v => (
                        <button key={`${g}-${v}`} type="button" style={selBtn(v, n)} onClick={() => { playSfx('click'); setGenreCount(g, v) }}>{v}</button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>최대 인원: {room.maxPlayers}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[4, 6, 8, 10].map(n => (
                <button key={n} type="button" style={selBtn(n, room.maxPlayers)} onClick={() => isHost && updateSettings({ maxPlayers: n })}>{n}명</button>
              ))}
            </div>
          </NoteCard>

          {err && <div style={{ fontFamily: F.ui, color: C.red }}>{err}</div>}
          <Btn variant={me?.ready ? 'default' : 'primary'} fullWidth onClick={setReady}>
            {me?.ready ? '준비 취소' : '준비하기'}
          </Btn>
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

// ── Game ───────────────────────────────────────────────────────

type CutsceneItem = {
  name: string
  description?: string
  imageUrl?: string | null
  mult?: number | null
  subtitle?: string
  usedBy?: string
}

function AugmentCutscene({
  item,
  onDone,
}: {
  item: CutsceneItem
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in')
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    playSfx('augment')
    setPhase('in')
    const t1 = setTimeout(() => setPhase('hold'), 450)
    const t2 = setTimeout(() => setPhase('out'), 2400)
    const t3 = setTimeout(() => onDoneRef.current(), 2900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [item])

  const scale = phase === 'in' ? 0.82 : phase === 'out' ? 1.06 : 1
  const opacity = phase === 'out' ? 0 : 1
  const y = phase === 'in' ? 28 : phase === 'out' ? -12 : 0

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90,
      backgroundColor: phase === 'out' ? 'rgba(30,40,50,0)' : 'rgba(30,40,50,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background-color 0.4s ease',
      pointerEvents: 'none',
    }}>
      <div style={{
        width: 'min(300px, 86vw)',
        ...sk(C.graphite),
        backgroundColor: C.card,
        padding: 18,
        textAlign: 'center',
        transform: `translateY(${y}px) scale(${scale})`,
        opacity,
        transition: 'transform 0.45s cubic-bezier(.2,1.2,.3,1), opacity 0.4s ease',
        boxShadow: `0 8px 0 ${C.graphite}40`,
      }}>
        <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: C.blue, marginBottom: 10, letterSpacing: '0.06em' }}>
          증강 적용
        </div>
        {item.usedBy && (
          <div style={{ fontFamily: F.ui, fontSize: 15, fontWeight: 700, color: C.muted, marginBottom: 10 }}>
            {item.usedBy} 사용
          </div>
        )}
        <div style={{
          width: '100%', aspectRatio: '1', marginBottom: 12,
          ...sk(C.graphite, true), overflow: 'hidden', backgroundColor: '#F2F0EB',
        }}>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{
              width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: F.brand, fontSize: 42, fontWeight: 700, color: C.muted,
            }}>{item.name[0]}</div>
          )}
        </div>
        <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 6, lineHeight: 1.2 }}>
          {item.name}
        </div>
        {item.mult && item.mult > 1 && (
          <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 800, color: C.blue, marginBottom: 6 }}>
            점수 ×{item.mult}
          </div>
        )}
        {item.subtitle && (
          <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.muted, marginBottom: 8 }}>
            {item.subtitle}
          </div>
        )}
        {item.description && (
          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
            {item.description}
          </div>
        )}
      </div>
    </div>
  )
}

function ytId(url: string) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)
  return m?.[1] || ''
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string
          width?: number
          height?: number
          playerVars?: Record<string, number | string>
          events?: {
            onReady?: (e: { target: YtPlayer }) => void
            onStateChange?: (e: { data: number; target: YtPlayer }) => void
            onError?: (e: { data: number }) => void
          }
        },
      ) => YtPlayer
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

type YtPlayer = {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (sec: number, allowSeekAhead: boolean) => void
  setVolume: (n: number) => void
  setPlaybackRate: (rate: number) => void
  getAvailablePlaybackRates: () => number[]
  unMute: () => void
  mute: () => void
  destroy: () => void
  getPlayerState: () => number
}

let ytApiPromise: Promise<void> | null = null
function loadYtApi() {
  if (window.YT?.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
    // 이미 로드된 경우
    const check = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(check)
        resolve()
      }
    }, 50)
  })
  return ytApiPromise
}

function HiddenYouTube({
  url,
  startSec,
  volume,
  durationSec,
  paused = false,
  playbackRate = 1,
  playLabel = '🎵 탭해서 노래 재생',
  audioUnlockAt = null,
}: {
  url: string
  startSec: number
  volume: number
  /** 있으면 start부터 이 초만큼만 재생 */
  durationSec?: number
  /** true면 일시정지 (컷신 등) */
  paused?: boolean
  /** YouTube 재생 배속 (지원 목록에 스냅) */
  playbackRate?: number
  playLabel?: string
  /** 슬로우 스타터: 이 시각 이후에만 들리기 시작 */
  audioUnlockAt?: number | null
}) {
  const id = ytId(url)
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const rateRef = useRef(playbackRate)
  rateRef.current = playbackRate
  const volumeRef = useRef(volume)
  volumeRef.current = volume
  const unlockAtRef = useRef(audioUnlockAt)
  unlockAtRef.current = audioUnlockAt
  const audioLockedRef = useRef(!!(audioUnlockAt && audioUnlockAt > Date.now()))
  const [blocked, setBlocked] = useState(false)
  const [ready, setReady] = useState(false)
  const start = Math.max(0, Math.floor(startSec))
  const end = durationSec && durationSec > 0 ? start + Math.floor(durationSec) : undefined

  const applyRate = (p: YtPlayer, desired: number) => {
    try {
      const available = typeof p.getAvailablePlaybackRates === 'function'
        ? p.getAvailablePlaybackRates()
        : [0.25, 0.5, 0.75, 1]
      let best = available[0] ?? 1
      let bestDist = Math.abs(best - desired)
      for (const a of available) {
        const d = Math.abs(a - desired)
        if (d < bestDist) {
          best = a
          bestDist = d
        }
      }
      p.setPlaybackRate(best)
    } catch { /* ignore */ }
  }

  /** 항상 뮤트로 재생 시작(자동재생 허용) → volume>0이면 언뮤트 */
  const syncPlayback = (p: YtPlayer, opts?: { seek?: boolean }) => {
    try {
      if (opts?.seek) p.seekTo(start, true)
      applyRate(p, rateRef.current)
      if (pausedRef.current || audioLockedRef.current) {
        p.pauseVideo()
        p.mute()
        return
      }
      const vol = Math.max(0, Math.min(100, volumeRef.current))
      p.setVolume(vol)
      // 먼저 뮤트 재생으로 확보한 뒤, 볼륨 있으면 언뮤트
      p.mute()
      p.playVideo()
      if (vol > 0) {
        p.unMute()
        p.setVolume(vol)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!id || !hostRef.current) return
    let cancelled = false
    let player: YtPlayer | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null
    let delayTimer: ReturnType<typeof setTimeout> | null = null
    let checkTimer: ReturnType<typeof setTimeout> | null = null

    ;(async () => {
      await loadYtApi()
      if (cancelled || !hostRef.current || !window.YT) return
      hostRef.current.innerHTML = ''
      const mount = document.createElement('div')
      hostRef.current.appendChild(mount)

      player = new window.YT.Player(mount, {
        videoId: id,
        width: 320,
        height: 180,
        playerVars: {
          autoplay: 1,
          mute: 1,
          start,
          ...(end != null ? { end } : {}),
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return
            playerRef.current = e.target
            const unlockAt = unlockAtRef.current
            const waitMs = unlockAt != null ? Math.max(0, unlockAt - Date.now()) : 0
            const kick = () => {
              if (cancelled) return
              syncPlayback(e.target, { seek: true })
              if (durationSec && durationSec > 0 && !pausedRef.current) {
                stopTimer = setTimeout(() => {
                  try { e.target.pauseVideo() } catch { /* ignore */ }
                }, durationSec * 1000)
              }
              checkTimer = setTimeout(() => {
                if (cancelled || pausedRef.current || audioLockedRef.current) return
                try {
                  const st = e.target.getPlayerState()
                  // 1=playing, 3=buffering
                  if (st !== 1 && st !== 3) setBlocked(true)
                  else if (volumeRef.current > 0) {
                    // 재생 중인데 소리만 막힌 경우 대비
                    e.target.unMute()
                    e.target.setVolume(volumeRef.current)
                  }
                } catch {
                  setBlocked(true)
                }
              }, 1000)
            }
            if (waitMs > 0) {
              audioLockedRef.current = true
              try {
                e.target.mute()
                e.target.pauseVideo()
                e.target.seekTo(start, true)
              } catch { /* ignore */ }
              delayTimer = setTimeout(() => {
                audioLockedRef.current = false
                kick()
              }, waitMs)
            } else {
              kick()
            }
            setReady(true)
          },
          onStateChange: (e) => {
            if (e.data === 1) {
              setBlocked(false)
              if (!pausedRef.current && !audioLockedRef.current && volumeRef.current > 0) {
                try {
                  e.target.unMute()
                  e.target.setVolume(volumeRef.current)
                } catch { /* ignore */ }
              }
            }
          },
          onError: () => setBlocked(true),
        },
      })
      setTimeout(() => {
        const iframe = hostRef.current?.querySelector('iframe')
        if (iframe) {
          iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
          iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share')
        }
      }, 0)
    })()

    return () => {
      cancelled = true
      if (stopTimer) clearTimeout(stopTimer)
      if (delayTimer) clearTimeout(delayTimer)
      if (checkTimer) clearTimeout(checkTimer)
      try { player?.destroy() } catch { /* ignore */ }
      playerRef.current = null
      setReady(false)
    }
  }, [id, start, end, durationSec, audioUnlockAt])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    applyRate(p, playbackRate)
  }, [playbackRate, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready) return
    syncPlayback(p)
  }, [paused, ready])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !ready || paused || audioLockedRef.current) return
    try {
      const vol = Math.max(0, Math.min(100, volume))
      p.setVolume(vol)
      if (vol <= 0) p.mute()
      else {
        p.unMute()
        p.playVideo()
      }
    } catch { /* ignore */ }
  }, [volume, ready, paused])

  const forcePlay = () => {
    const p = playerRef.current
    if (!p) return
    audioLockedRef.current = false
    try {
      p.seekTo(start, true)
      applyRate(p, rateRef.current)
      const vol = Math.max(0, Math.min(100, volume))
      p.setVolume(vol)
      if (vol <= 0) p.mute()
      else p.unMute()
      p.playVideo()
      setBlocked(false)
    } catch { /* ignore */ }
  }

  if (!id) return null

  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          bottom: 0,
          width: 320,
          height: 180,
          opacity: 0.001,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
        }}
      >
        <div ref={hostRef} />
      </div>
      {blocked && (
        <button
          type="button"
          onClick={forcePlay}
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            zIndex: 50,
            ...sk(C.blue),
            backgroundColor: C.blue,
            color: '#fff',
            fontFamily: F.ui,
            fontSize: 16,
            fontWeight: 800,
            padding: '12px 22px',
            cursor: 'pointer',
            border: `2.5px solid ${C.graphite}`,
          }}
        >
          {playLabel}
        </button>
      )}
    </>
  )
}

function GameScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, chats, round, skip, skipVoted, augmentHint, startCountdown, musicVolume, setMusicVolume, sfxVolume, setSfxVolume, submitAnswer, voteSkip, useAugment, fetchGahoCandidates, leaveRoom } = useGame()
  const [input, setInput] = useState('')
  const [showUsedList, setShowUsedList] = useState(false)
  const [augHover, setAugHover] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [targetPickOpen, setTargetPickOpen] = useState(false)
  const [genrePickOpen, setGenrePickOpen] = useState(false)
  const [gahoPickOpen, setGahoPickOpen] = useState(false)
  const [gahoCandidates, setGahoCandidates] = useState<Array<{
    id: string
    name: string
    description?: string
    tier: string
    imageUrl?: string | null
  }>>([])
  const [gahoBusy, setGahoBusy] = useState(false)
  const [chatCardHover, setChatCardHover] = useState<number | null>(null)
  const [cutQueue, setCutQueue] = useState<CutsceneItem[]>([])
  const [now, setNow] = useState(Date.now())
  const chatRef = useRef<HTMLDivElement>(null)
  const cutShownForRound = useRef<number | null>(null)

  useEffect(() => {
    if (!room) nav('lobby')
    else if (room.status === 'augment') nav('augment')
    else if (room.status === 'ended') nav('result')
    else if (room.status === 'lobby') nav('waiting')
  }, [room, nav])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [chats])

  // 다음 라운드부터 적용되는 증강 → 카드 컷신
  useEffect(() => {
    if (!round || !room || room.status !== 'playing' || !user) return
    if (cutShownForRound.current === round.index) return
    const self = room.members.find(m => m.userId === user.id)
    if (!self) return

    // room:state가 아직 이전(pending)이면 한 박자 기다림
    const waitingBuff = (self.activeBuffs || []).some(b => b.startIndex === round.index && b.pending)
    const waitingMute = self.chatMuteStartIndex === round.index && !!self.chatMutePending
    if (waitingBuff || waitingMute) return

    const items: CutsceneItem[] = (self.activeBuffs || [])
      .filter(b => b.active && b.startIndex === round.index)
      .map(b => ({
        name: b.name,
        description: b.description,
        imageUrl: b.imageUrl,
        mult: b.mult,
        usedBy: b.usedByNickname,
        subtitle: b.rate && b.rate !== 1
          ? `배속 ×${b.rate} · 이번 라운드`
          : b.roundsLeft > 1 ? `${b.roundsLeft}라운드 동안 적용` : '이번 라운드 적용',
      }))

    if (self.chatMuted && self.chatMuteStartIndex === round.index) {
      items.push({
        name: self.chatMuteBy || '감옥',
        description: '이번 라운드 동안 채팅·정답 제출을 할 수 없습니다',
        usedBy: self.chatMuteByNickname || undefined,
        subtitle: '감옥',
      })
    }

    if (self.answerBlocked && self.answerBlockRoundsLeft) {
      const fromKnowBuff = (self.activeBuffs || []).some(
        b => b.effectType === 'know_but_cant' && (b.active || b.pending),
      )
      if (!fromKnowBuff) {
        items.push({
          name: self.answerBlockBy || '쉬었음청년',
          description: '이번 라운드 동안 정답이 인정되지 않습니다 (채팅은 가능)',
          subtitle: `${self.answerBlockRoundsLeft}라운드 남음`,
        })
      }
    }

    if ((self.politeActive || self.politePending) && self.politeRoundsLeft) {
      items.push({
        name: self.politeBy || '예의바른청년',
        description: `답 끝에 「${self.politeSuffix || '입니다'}」를 붙여야 정답으로 인정됩니다`,
        subtitle: self.politePending ? '다음 라운드부터' : `${self.politeRoundsLeft}라운드 남음`,
      })
    }

    if (self.answerDelayed && self.answerDelayRoundsLeft) {
      items.push({
        name: self.answerDelayBy || '님아 매너좀',
        description: `라운드 시작 ${self.answerDelaySec || 5}초 뒤에만 정답을 입력할 수 있습니다`,
        usedBy: undefined,
        subtitle: `${self.answerDelayRoundsLeft}라운드 남음`,
      })
    }

    if (self.accuseWatchActive) {
      items.push({
        name: self.accuseWatchBy || '범인은 당신이야!',
        description: '이번 라운드에 문제를 맞히면 다음 라운드에 수면(정답 불가)이 걸립니다',
        subtitle: '감시 중',
      })
    }

    cutShownForRound.current = round.index
    if (items.length) setCutQueue(items)
  }, [round?.index, room?.status, room?.members, user, round])

  if (!room || !user) return null

  const me = room.members.find(m => m.userId === user.id)
  const timer = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0
  const maxTime = round?.duration || 40
  const titleSlot = round?.slots.find(s => !s.hidden && s.label.includes('제목'))
  const artistSlot = round?.slots.find(s => !s.hidden && s.label.includes('가수'))
  const hiddenSlot = round?.slots.find(s => s.hidden)
  const titleRevealed = titleSlot?.revealed
    ? (titleSlot.answer || null)
    : (me?.knowSpoilTitle || null)
  const artistRevealed = artistSlot?.revealed
    ? (artistSlot.answer || null)
    : (me?.knowSpoilArtist || null)
  const hiddenRevealed = hiddenSlot?.revealed ? (hiddenSlot.answer || null) : null
  const openAllDone = (round?.slots || []).filter(s => !s.hidden).every(s => s.revealed)
  const showHidden = !!hiddenSlot && (hiddenSlot.unlocked || openAllDone)
  const answerDelayLocked = !!(me?.answerDelayUnlockAt && now < me.answerDelayUnlockAt)
  const answerDelayLeftSec = answerDelayLocked
    ? Math.max(0, Math.ceil((me!.answerDelayUnlockAt! - now) / 1000))
    : 0
  const duel = room.duel
  const inDuel = room.status === 'duel'
  const isDuelist = !!(duel && user && (duel.challengerId === user.id || duel.opponentId === user.id))
  const duelSpectating = inDuel && !!duel && !isDuelist
  const submitBlocked = !!me?.chatMuted || answerDelayLocked
  const visibleChats = chats.filter((msg) => !(msg.spectator && isDuelist))
  const ranked = [...room.members].sort((a, b) => b.score - a.score)
  const myBuffs = me?.activeBuffs || []
  const deafMode = myBuffs.some(b => b.active && b.effectType === 'score_mult_hint_only')
  const inCountdown = room.status === 'countdown'
  const songPlaybackRate = (!inDuel && me?.playbackRate && me.playbackRate > 0 && me.playbackRate !== 1)
    ? me.playbackRate
    : 1
  const needsTargetPick =
    me?.heldAugmentEffectType === 'mute_chat'
    || me?.heldAugmentEffectType === 'slow_playback'
    || me?.heldAugmentEffectType === 'answer_proxy'
    || me?.heldAugmentEffectType === 'sakura_decoy'
    || me?.heldAugmentEffectType === 'named_decoy'
    || me?.heldAugmentEffectType === 'answer_delay'
    || me?.heldAugmentEffectType === 'yacha_duel'
    || me?.heldAugmentEffectType === 'polite_suffix'
    || me?.heldAugmentEffectType === 'answer_block'
    || me?.heldAugmentEffectType === 'rock_throw'
    || me?.heldAugmentEffectType === 'score_steal'
    || me?.heldAugmentEffectType === 'pair_average'
    || me?.heldAugmentEffectType === 'accuse_sleep'
  const isAutoAugment = me?.heldAugmentEffectType === 'water_ghost'
  const isPassiveHeld = me?.heldAugmentEffectType === 'reflect_debuff'
  const useLocked = isAutoAugment || isPassiveHeld
  const needsGahoPick = me?.heldAugmentEffectType === 'gaho_select'
  const needsGenrePick = me?.heldAugmentEffectType === 'ban_genre'
  const upcomingGenreEntries = Object.entries(room.upcomingGenreCounts || {})
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))

  const openGahoPick = async () => {
    setGahoBusy(true)
    setGahoPickOpen(true)
    try {
      const list = await fetchGahoCandidates()
      setGahoCandidates(list)
    } finally {
      setGahoBusy(false)
    }
  }
  const noHintMode = myBuffs.some(b => b.active && b.effectType === 'score_mult_no_hint')
  const playVolume = deafMode ? 0 : musicVolume
  // 카운트다운 중에는 뮤트로 프리로드(브라우저 자동재생 허용) → 시작 시 같은 플레이어로 언뮤트
  const ytVolume = inCountdown ? 0 : playVolume
  const showGenre = !noHintMode
  const songUrl = (inDuel ? null : me?.decoyYoutubeUrl) || round?.youtubeUrl || ''
  const songStartSec = (!inDuel && me?.decoyYoutubeUrl != null)
    ? (me.decoyStartSec ?? round?.startSec ?? 0)
    : (round?.startSec ?? 0)
  const showYt = !!(round && songUrl && (room.status === 'playing' || room.status === 'duel' || room.status === 'countdown'))
  // 초성은 위쪽 제목/가수 칸, 증강 정답 안내는 증강 적용 칸
  const titleHint = !noHintMode && !titleRevealed && (deafMode || timer <= 10) ? (round?.titleChosung || null) : null
  const artistHint = !noHintMode && !artistRevealed && (deafMode || timer <= 20) ? (round?.artistChosung || null) : null
  const visibleBuffs = myBuffs.filter(b => b.active || b.pending)
  const scoreMult = Math.max(
    1,
    ...myBuffs.filter(b => b.active && b.mult).map(b => b.mult || 1),
    me?.sakuraActive && me.sakuraScoreMult ? me.sakuraScoreMult : 1,
  )
  const activeBuffLabel = [
    ...visibleBuffs.map(b => {
      const multPart = b.mult && b.mult > 1 ? ` ×${b.mult}` : ''
      const ratePart = b.rate && b.rate !== 1 ? ` ×${b.rate}배속` : ''
      return b.pending ? `${b.name}(대기)${multPart}${ratePart}` : `${b.name} ${b.roundsLeft}R${multPart}${ratePart}`
    }),
    me?.sakuraActive
      ? `${me.sakuraBy || '다른 곡'}${me.sakuraScoreMult && me.sakuraScoreMult > 1 ? ` · 정답×${me.sakuraScoreMult}` : ''}`
      : '',
    me?.answerDelayPending
      ? '님아 매너좀(대기)'
      : (me?.answerDelayRoundsLeft
        ? `님아 매너좀 ${me.answerDelayRoundsLeft}R · ${me.answerDelaySec || 5}초 딜레이`
        : ''),
    me?.politePending
      ? '예의바른청년(대기)'
      : (me?.politeActive
        ? `예의바른청년 ${me.politeRoundsLeft ?? '?'}R · 「${me.politeSuffix || '입니다'}」`
        : ''),
    me?.answerBlockPending
      ? `${me.answerBlockBy || '쉬었음청년'}(대기)`
      : (me?.answerBlocked
        ? `${me.answerBlockBy || '쉬었음청년'} ${me.answerBlockRoundsLeft ?? '?'}R · 정답 불가`
        : ''),
    me?.accuseWatchPending
      ? `${me.accuseWatchBy || '범인은 당신이야!'}(감시 대기)`
      : (me?.accuseWatchActive
        ? `${me.accuseWatchBy || '범인은 당신이야!'} · 맞히면 다음 R 수면`
        : ''),
    me?.answerProxyActive
      ? (me.answerProxyPending
        ? `신속정확대리(대기)`
        : `신속정확대리 ${me.answerProxyRoundsLeft ?? '?'}R · 적립 ${me.answerProxyPendingScore ?? 0}`)
      : '',
  ].filter(Boolean).join(' · ')

  const send = () => {
    if (me?.chatMuted) return
    if (me?.answerDelayUnlockAt && now < me.answerDelayUnlockAt) return
    if (!input.trim()) return
    submitAnswer(input.trim())
    setInput('')
  }

  const panelBox: React.CSSProperties = {
    ...sk(), backgroundColor: C.panel, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0,
  }
  const surf = C.panel
  const chip = (ok: boolean, label: string, value: string | null) => (
    <div style={{
      ...sk(ok ? C.green : C.graphite, true),
      backgroundColor: ok ? C.greenLight : surf,
      padding: '6px 12px', fontFamily: F.ui, fontSize: 16, fontWeight: 400,
      color: ok ? C.green : C.muted, maxWidth: 160,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {label} {ok && value ? value : '＿＿'}
    </div>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', ...crumpledPaper, overflow: 'hidden' }}>
      {startCountdown != null && startCountdown > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 90,
          backgroundColor: 'rgba(30, 40, 50, 0.55)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div
            key={startCountdown}
            style={{
              fontFamily: F.brand,
              fontSize: 'min(28vw, 180px)',
              fontWeight: 800,
              color: C.card,
              textShadow: `4px 4px 0 ${C.graphite}`,
              lineHeight: 1,
              animation: 'countdownPop 0.45s ease-out',
            }}
          >
            {startCountdown}
          </div>
          <div style={{
            marginTop: 12,
            fontFamily: F.ui,
            fontSize: 22,
            fontWeight: 700,
            color: C.card,
            textShadow: `2px 2px 0 ${C.graphite}`,
          }}>
            곧 시작합니다
          </div>
          <style>{`@keyframes countdownPop {
            0% { transform: scale(0.55); opacity: 0.2; }
            55% { transform: scale(1.08); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }`}</style>
        </div>
      )}
      {cutQueue[0] && (
        <AugmentCutscene
          key={`${round?.index}-${cutQueue[0].name}-${cutQueue.length}`}
          item={cutQueue[0]}
          onDone={() => setCutQueue(q => q.slice(1))}
        />
      )}
      {showYt && (
        <HiddenYouTube
          key={`yt-${round!.index}-${ytId(songUrl)}`}
          url={songUrl}
          startSec={songStartSec}
          volume={ytVolume}
          paused={cutQueue.length > 0}
          playbackRate={songPlaybackRate}
          audioUnlockAt={inCountdown ? null : (me?.audioDelaySec ? (me.audioDelayUntil ?? null) : null)}
        />
      )}
      <div style={{
        position: 'relative', zIndex: 2, backgroundColor: C.card,
        borderBottom: `2.5px solid ${C.graphite}`, boxShadow: `0 3px 0 ${C.graphite}40`,
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        filter: 'url(#pencilRough)',
      }}>
        <RoundTimer endsAt={round?.endsAt ?? now} max={maxTime} size={58} />
        <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 400, color: C.body }}>
          Q{(round?.index ?? 0) + 1}/{round?.total ?? '?'}
        </div>
        <div style={{ ...sk(C.blue, true), backgroundColor: C.blueLight, padding: '5px 12px', fontFamily: F.ui, fontSize: 16, color: C.blue }}>
          {round?.genre || '-'}
        </div>
        <div style={{ ...sk(C.graphite, true), backgroundColor: C.blueLight, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Equalizer />
          <span style={{ fontFamily: F.ui, fontSize: 16, color: C.blue }}>
            {inDuel
              ? `야차룰 · ${(round?.duelChallenger || duel?.challengerNickname || '?')} vs ${(round?.duelOpponent || duel?.opponentNickname || '?')}`
              : me?.audioDelayUntil && now < me.audioDelayUntil
                ? `슬로우 스타터 · ${Math.max(0, Math.ceil((me.audioDelayUntil - now) / 1000))}초 후`
                : me?.sakuraActive
                  ? `${me.sakuraBy || '다른 곡'} · 다른 곡`
                  : songPlaybackRate !== 1
                    ? `재생 ×${songPlaybackRate}`
                    : '재생 중'}
          </span>
        </div>
        {chip(!!titleRevealed, '제목', titleRevealed)}
        {!inDuel && chip(!!artistRevealed, '가수', artistRevealed)}
        {inDuel && (
          <div style={{
            ...sk(C.blue, true), backgroundColor: C.blueLight, padding: '5px 12px',
            fontFamily: F.ui, fontSize: 15, color: C.blue, fontWeight: 700,
          }}>
            제목만 · 패자 −{round?.duelPenalty || duel?.penalty || 5}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted }}>노래</span>
            <input type="range" min={0} max={100} value={musicVolume} onChange={e => setMusicVolume(Number(e.target.value))} style={{ width: 64, accentColor: C.blue }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted }}>효과</span>
            <input
              type="range" min={0} max={100} value={sfxVolume}
              onChange={e => setSfxVolume(Number(e.target.value))}
              onMouseUp={() => playSfx('click')}
              style={{ width: 64, accentColor: C.blue }}
            />
          </div>
        </div>
        <Btn size="sm" variant="danger" disabled={skipVoted || room.status !== 'playing' || inDuel} onClick={voteSkip}>
          {inDuel ? '야차룰 중' : room.status === 'revealing' ? '공개 중' : room.status === 'countdown' ? '대기 중' : `스킵 ${skip.votes}/${skip.need}`}
        </Btn>
        <Btn size="sm" onClick={() => setLeaveOpen(true)}>나가기</Btn>
      </div>

      <div style={{
        position: 'relative', zIndex: 2, flex: 1, minHeight: 0,
        display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr) 220px', gap: 14, padding: '14px 14px 0',
      }}>
        <div style={{ ...panelBox, backgroundColor: surf }}>
          <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center' }}>전체 순위</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
            {ranked.map((s, i) => {
              const mine = s.userId === user.id
              return (
                <div key={s.userId} style={{
                  display: 'grid', gridTemplateColumns: '36px 32px 1fr auto', gap: 6, alignItems: 'center',
                  padding: '8px 8px', ...sk(mine ? C.blue : C.graphite, true),
                  backgroundColor: mine ? C.blueLight : surf,
                }}>
                  <span style={{ fontFamily: F.ui, fontSize: 15, color: mine ? C.blue : C.body, textAlign: 'center' }}>{i + 1}</span>
                  <Avatar name={s.nickname} url={s.avatarUrl} size={28} />
                  <span style={{ fontFamily: F.ui, fontSize: 15, color: mine ? C.blue : C.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nickname}</span>
                  <span style={{ fontFamily: F.ui, fontSize: 15 }}>{s.score}점</span>
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, minWidth: 0 }}>
          <div style={{ ...sk(), backgroundColor: surf, padding: '14px 18px', textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 10 }}>
              {showGenre ? (round?.genre || '') : '???'} · 이번 문제
              {activeBuffLabel ? ` · ${activeBuffLabel}` : ''}
              {deafMode ? ' · 청각 OFF' : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <FitAnswer label="제목" value={titleRevealed} hint={titleHint} revealed={!!titleRevealed} />
              <div style={{ width: 2, alignSelf: 'stretch', backgroundColor: C.line, flexShrink: 0 }} />
              <FitAnswer label="가수" value={artistRevealed} hint={artistHint} revealed={!!artistRevealed} />
            </div>
            {showHidden && hiddenSlot && (
              <div style={{
                marginTop: 14, paddingTop: 12,
                borderTop: `2px dashed ${C.blue}`,
              }}>
                <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 800, color: C.blue, marginBottom: 8 }}>
                  히든 문제
                </div>
                <FitAnswer
                  label={hiddenSlot.label || '히든'}
                  value={hiddenRevealed}
                  hint={null}
                  revealed={!!hiddenRevealed}
                />
              </div>
            )}
            {hiddenSlot && !showHidden && (
              <div style={{ marginTop: 12, fontFamily: F.ui, fontSize: 13, color: C.muted }}>
                제목·가수를 모두 맞히면 히든 문제가 등장합니다
              </div>
            )}
          </div>

          <div style={{ ...panelBox, flex: 1, backgroundColor: surf }}>
            <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center' }}>
              {duelSpectating ? '관전 채팅' : '채팅'}
              {duelSpectating && (
                <span style={{ fontSize: 13, marginLeft: 6, opacity: 0.7 }}>· 당사자에게 안 보임</span>
              )}
            </div>
            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, padding: '4px 2px' }}>
              {visibleChats.map(msg => {
                if (msg.system) {
                  return (
                    <div
                      key={msg.id}
                      style={{ display: 'flex', justifyContent: 'center', position: 'relative', opacity: msg.spectator ? 0.55 : 1 }}
                      onMouseEnter={() => msg.augmentCard && setChatCardHover(msg.id)}
                      onMouseLeave={() => setChatCardHover(null)}
                    >
                      <div style={{
                        ...sk(msg.augmentCard ? C.blue : C.green, true),
                        backgroundColor: msg.augmentCard ? C.blueLight : C.greenLight,
                        padding: '8px 16px', fontFamily: F.ui, fontSize: 17,
                        color: msg.augmentCard ? C.blue : C.green, textAlign: 'center',
                        cursor: msg.augmentCard ? 'help' : undefined,
                      }}>{msg.text}</div>
                      {chatCardHover === msg.id && msg.augmentCard && (
                        <div style={{
                          position: 'absolute', left: '50%', bottom: 'calc(100% + 8px)',
                          transform: 'translateX(-50%)', width: 220, zIndex: 30,
                          ...sk(C.graphite, true), backgroundColor: C.card, padding: 12,
                          boxShadow: `0 4px 0 ${C.graphite}30`, pointerEvents: 'none',
                          textAlign: 'left',
                        }}>
                          <div style={{
                            width: '100%', aspectRatio: '1.4', marginBottom: 8,
                            ...sk(C.graphite, true), overflow: 'hidden', backgroundColor: '#F2F0EB',
                          }}>
                            {msg.augmentCard.imageUrl ? (
                              <img src={msg.augmentCard.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            ) : (
                              <div style={{
                                width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontFamily: F.ui, fontSize: 12, color: C.muted, fontWeight: 700,
                              }}>사진 없음</div>
                            )}
                          </div>
                          <div style={{ fontFamily: F.brand, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                            {msg.augmentCard.name}
                          </div>
                          {msg.augmentCard.tier && (
                            <div style={{ fontFamily: F.ui, fontSize: 12, color: C.blue, fontWeight: 800, marginBottom: 6 }}>
                              {msg.augmentCard.tier}
                            </div>
                          )}
                          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.body, lineHeight: 1.45 }}>
                            {msg.augmentCard.description}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }
                const self = msg.userId === user.id
                const spect = !!msg.spectator
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      justifyContent: self ? 'flex-end' : 'flex-start',
                      gap: 8,
                      alignItems: 'flex-end',
                      opacity: spect ? 0.52 : 1,
                    }}
                  >
                    {!self && (
                      <div style={{
                        width: 34, height: 34, flexShrink: 0, ...sk(C.graphite, true),
                        backgroundColor: spect ? '#E8EEF3' : C.blueLight,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: F.ui, fontSize: 16, color: C.blue,
                      }}>{msg.nickname?.[0]}</div>
                    )}
                    <div style={{ maxWidth: '72%' }}>
                      {!self && (
                        <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 3 }}>
                          {msg.nickname}{spect ? ' · 관전' : ''}
                        </div>
                      )}
                      <div style={{
                        ...sk(self ? C.blue : C.graphite, true),
                        backgroundColor: spect
                          ? (self ? 'rgba(74, 144, 186, 0.22)' : 'rgba(255,255,255,0.45)')
                          : (self ? C.blueLight : '#FFFFFF'),
                        padding: '10px 14px',
                        fontFamily: F.chat,
                        fontSize: 22,
                        fontWeight: 700,
                        color: C.body,
                        lineHeight: 1.45,
                        backdropFilter: spect ? 'blur(2px)' : undefined,
                      }}>{msg.text}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <div style={{ ...panelBox, flex: 1.2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted }}>증강</div>
              <Btn size="sm" onClick={() => setShowUsedList(true)}>사용 목록</Btn>
            </div>
            <div style={{
              flex: 1, ...sk(), backgroundColor: C.card, padding: '14px 12px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', gap: 10, minHeight: 160, position: 'relative',
            }}>
              {me?.heldAugmentId ? (
                <>
                  <div style={{
                    width: 88, height: 88, flexShrink: 0, ...sk(C.graphite, true),
                    overflow: 'hidden', backgroundColor: '#F2F0EB',
                  }}>
                    {me.heldAugmentImageUrl ? (
                      <img
                        src={me.heldAugmentImageUrl}
                        alt={me.heldAugmentName || '증강'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: F.ui, fontSize: 12, color: C.muted, fontWeight: 700,
                      }}>사진 없음</div>
                    )}
                  </div>
                  <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
                    {me.heldAugmentName || '보유 중'}
                  </div>
                  <div
                    style={{ width: '100%', position: 'relative' }}
                    onMouseEnter={() => setAugHover(true)}
                    onMouseLeave={() => setAugHover(false)}
                  >
                    <Btn
                      variant="primary"
                      fullWidth
                      disabled={useLocked}
                      onClick={() => {
                        if (useLocked) return
                        if (needsGahoPick) void openGahoPick()
                        else if (needsTargetPick) setTargetPickOpen(true)
                        else if (needsGenrePick) setGenrePickOpen(true)
                        else useAugment()
                      }}
                    >
                      {isPassiveHeld
                        ? '피격 시 자동'
                        : isAutoAugment
                          ? '자동 적용'
                          : needsGahoPick
                            ? '가호 선택'
                            : needsTargetPick
                              ? '대상 선택'
                              : needsGenrePick
                                ? '장르 선택'
                                : '사용'}
                    </Btn>
                    {augHover && me.heldAugmentDescription && (
                      <div style={{
                        position: 'absolute', left: '50%', bottom: 'calc(100% + 8px)',
                        transform: 'translateX(-50%)', width: 'min(220px, 90vw)',
                        ...sk(C.graphite, true), backgroundColor: C.card,
                        padding: '12px 14px', textAlign: 'left', zIndex: 20,
                        boxShadow: `0 4px 0 ${C.graphite}30`,
                        pointerEvents: 'none',
                      }}>
                        <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: C.blue, marginBottom: 6 }}>
                          증강 설명
                        </div>
                        <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
                          {me.heldAugmentDescription}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted }}>
                    {isPassiveHeld
                      ? '지목당하면 자동 반사'
                      : isAutoAugment
                        ? '선택 후 자동 적용'
                        : needsGahoPick
                          ? '가호 중 하나를 골라 적용'
                          : needsTargetPick
                            ? '대상을 골라 사용'
                            : needsGenrePick
                              ? '밴할 장르를 골라 사용'
                              : '사용 버튼에 올리면 설명'}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: F.ui, fontSize: 16, color: C.muted }}>보유 증강 없음</div>
              )}
            </div>
          </div>
          <div style={{ ...panelBox, flex: 1 }}>
            <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, textAlign: 'center' }}>
              증강 적용{scoreMult > 1 ? ` · 점수 ×${scoreMult}` : ''}
            </div>
            <div style={{
              flex: 1, ...sk(C.graphite, true), backgroundColor: C.card, padding: '12px 12px',
              display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto',
              textAlign: 'left',
            }}>
              {visibleBuffs.length === 0 && !me?.answerProxyActive && !me?.sakuraActive && !me?.answerDelayRoundsLeft && !me?.answerDelayPending && !augmentHint ? (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: F.ui, fontSize: 15, color: C.muted, textAlign: 'center',
                }}>
                  적용 중인 증강이 없습니다
                </div>
              ) : (
                <>
                  {visibleBuffs.map((b, i) => (
                    <div key={`${b.name}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: C.blue }}>
                        {b.name}
                        {b.pending ? ' · 다음 라운드부터' : ` · ${b.roundsLeft}R`}
                        {b.mult && b.mult > 1 ? ` · ×${b.mult}` : ''}
                      </div>
                      {b.description && (
                        <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
                          {b.description}
                        </div>
                      )}
                    </div>
                  ))}
                  {me?.sakuraActive && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: C.blue }}>
                        {me.sakuraBy || '다른 곡'}
                        {me.sakuraScoreMult && me.sakuraScoreMult > 1
                          ? ` · 다른 곡 · 정답 ×${me.sakuraScoreMult}`
                          : ' · 다른 곡'}
                      </div>
                      <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
                        {me.sakuraScoreMult && me.sakuraScoreMult > 1
                          ? '지금 들리는 곡은 실제 문제와 다릅니다. 그래도 맞히면 점수가 배율 적용됩니다.'
                          : '지금 들리는 곡은 실제 문제와 다릅니다. 정답은 원래 문제 기준입니다.'}
                      </div>
                    </div>
                  )}
                  {(me?.answerDelayPending || (me?.answerDelayRoundsLeft && me.answerDelayRoundsLeft > 0)) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: C.blue }}>
                        {me.answerDelayBy || '님아 매너좀'}
                        {me.answerDelayPending
                          ? ' · 다음 라운드부터'
                          : ` · ${me.answerDelayRoundsLeft}R · ${me.answerDelaySec || 5}초 딜레이`}
                      </div>
                      <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
                        매 라운드 시작 {me.answerDelaySec || 5}초 뒤에만 정답을 입력할 수 있습니다.
                      </div>
                    </div>
                  )}
                  {me?.answerProxyActive && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: C.blue }}>
                        신속정확대리
                        {me.answerProxyPending
                          ? ' · 다음 라운드부터'
                          : ` · ${me.answerProxyRoundsLeft ?? '?'}R · 적립 ${me.answerProxyPendingScore ?? 0}점`}
                      </div>
                      <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
                        대상은 비공개입니다. 3라운드 후 적립 점수가 결산됩니다.
                      </div>
                    </div>
                  )}
                  {(me?.accuseWatchPending || me?.accuseWatchActive) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 800, color: C.blue }}>
                        {me.accuseWatchBy || '범인은 당신이야!'}
                        {me.accuseWatchPending ? ' · 다음 라운드부터 감시' : ' · 감시 중'}
                      </div>
                      <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, lineHeight: 1.45 }}>
                        감시 라운드에 문제를 맞히면 다음 라운드에 수면(정답 불가)이 걸립니다.
                      </div>
                    </div>
                  )}
                  {augmentHint && (
                    <div style={{
                      marginTop: (visibleBuffs.length || me?.answerProxyActive || me?.sakuraActive || me?.answerDelayRoundsLeft || me?.answerDelayPending) ? 4 : 0,
                      paddingTop: (visibleBuffs.length || me?.answerProxyActive || me?.sakuraActive || me?.answerDelayRoundsLeft || me?.answerDelayPending) ? 10 : 0,
                      borderTop: (visibleBuffs.length || me?.answerProxyActive || me?.sakuraActive || me?.answerDelayRoundsLeft || me?.answerDelayPending) ? `2px solid ${C.line}` : undefined,
                      fontFamily: F.ui, fontSize: 16, color: C.body, lineHeight: 1.5,
                      whiteSpace: 'pre-line', textAlign: 'center',
                    }}>
                      {augmentHint}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showUsedList && (
        <div onClick={() => setShowUsedList(false)} style={{
          position: 'fixed', inset: 0, zIndex: 50, backgroundColor: 'rgba(30,40,50,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', width: '100%', maxWidth: 420, textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 32, fontWeight: 700, marginBottom: 18 }}>사용한 증강</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {(me?.usedAugments || []).length === 0 ? (
                <div style={{ fontFamily: F.ui, fontSize: 20, color: C.muted }}>아직 없음</div>
              ) : (
                me!.usedAugments.map((name, i) => (
                  <div key={`${name}-${i}`} style={{ ...sk(C.blue, true), backgroundColor: C.blueLight, padding: '12px 16px', fontFamily: F.ui, fontSize: 22 }}>
                    {i + 1}. {name}
                  </div>
                ))
              )}
            </div>
            <Btn variant="primary" onClick={() => setShowUsedList(false)}>닫기</Btn>
          </div>
        </div>
      )}

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

      {targetPickOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(30,40,50,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
              {me?.heldAugmentName || '대상 선택'}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>
              {me?.heldAugmentEffectType === 'slow_playback'
                ? '산데비스탄을 꽂을 플레이어를 선택하세요'
                : me?.heldAugmentEffectType === 'answer_proxy'
                  ? '대리할 플레이어를 선택하세요 (대상은 공개되지 않습니다)'
                  : me?.heldAugmentEffectType === 'sakura_decoy'
                    ? '다른 노래를 들려줄 플레이어를 선택하세요'
                    : me?.heldAugmentEffectType === 'named_decoy'
                      ? '연애서큘레이션을 틀어줄 플레이어를 선택하세요'
                      : me?.heldAugmentEffectType === 'answer_delay'
                      ? '매너를 강제할 플레이어를 선택하세요'
                      : me?.heldAugmentEffectType === 'yacha_duel'
                        ? '야차룰로 맞붙을 플레이어를 선택하세요'
                        : me?.heldAugmentEffectType === 'polite_suffix'
                          ? '예의를 강요할 플레이어를 선택하세요'
                          : me?.heldAugmentEffectType === 'answer_block'
                            ? '쉬게 할 플레이어를 선택하세요'
                            : me?.heldAugmentEffectType === 'rock_throw'
                              ? '돌을 던질 플레이어를 선택하세요'
                              : me?.heldAugmentEffectType === 'score_steal'
                                ? '점수를 뜯을 플레이어를 선택하세요'
                                : me?.heldAugmentEffectType === 'pair_average'
                                  ? '점수를 맞출 플레이어를 선택하세요'
                                  : me?.heldAugmentEffectType === 'accuse_sleep'
                                    ? '범인으로 지목할 플레이어를 선택하세요'
                                    : me?.heldAugmentEffectType === 'mute_chat'
                                    ? '채팅·제출을 막을 플레이어를 선택하세요'
                                    : '대상을 선택하세요'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {room.members.filter(p => p.userId !== user.id).map(p => (
                <Btn
                  key={p.userId}
                  fullWidth
                  variant="primary"
                  onClick={() => {
                    useAugment({ targetUserId: p.userId })
                    setTargetPickOpen(false)
                  }}
                >
                  {p.nickname}
                </Btn>
              ))}
              {room.members.filter(p => p.userId !== user.id).length === 0 && (
                <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>선택할 대상이 없습니다</div>
              )}
            </div>
            <Btn onClick={() => setTargetPickOpen(false)}>취소</Btn>
          </div>
        </div>
      )}

      {genrePickOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(30,40,50,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
              {me?.heldAugmentName || '장르 밴'}
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>
              밴할 장르를 선택하세요 (남은 곡은 다른 장르로 랜덤 배분)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {upcomingGenreEntries.map(([g, c]) => (
                <Btn
                  key={g}
                  fullWidth
                  variant="primary"
                  onClick={() => {
                    useAugment({ genreName: g })
                    setGenrePickOpen(false)
                  }}
                >
                  {g} · 남은 {c}곡
                </Btn>
              ))}
              {upcomingGenreEntries.length === 0 && (
                <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>밴할 장르가 없습니다</div>
              )}
            </div>
            <Btn onClick={() => setGenrePickOpen(false)}>취소</Btn>
          </div>
        </div>
      )}

      {gahoPickOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(30,40,50,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ ...sk(), backgroundColor: C.card, padding: '28px 32px', maxWidth: 520, width: '100%', textAlign: 'center' }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
              가호 선택
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>
              적용할 가호를 고르세요
            </div>
            {gahoBusy ? (
              <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, marginBottom: 18 }}>불러오는 중…</div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 10,
                marginBottom: 18,
                maxHeight: '50vh',
                overflowY: 'auto',
                textAlign: 'left',
              }}>
                {gahoCandidates.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      useAugment({ gahoAugmentId: g.id })
                      setGahoPickOpen(false)
                      setGahoCandidates([])
                    }}
                    style={{
                      ...sk(C.graphite, true),
                      backgroundColor: C.card,
                      padding: 10,
                      cursor: 'pointer',
                      border: `2.5px solid ${C.graphite}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{
                      width: '100%', aspectRatio: '1', ...sk(C.graphite, true),
                      overflow: 'hidden', backgroundColor: '#F2F0EB',
                    }}>
                      {g.imageUrl ? (
                        <img src={g.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{
                          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: F.ui, fontSize: 12, color: C.muted, fontWeight: 700,
                        }}>가호</div>
                      )}
                    </div>
                    <div style={{ fontFamily: F.brand, fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{g.name}</div>
                    {g.description && (
                      <div style={{ fontFamily: F.ui, fontSize: 12, color: C.body, lineHeight: 1.4 }}>{g.description}</div>
                    )}
                  </button>
                ))}
                {gahoCandidates.length === 0 && (
                  <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, gridColumn: '1 / -1', textAlign: 'center' }}>
                    선택 가능한 가호가 없습니다
                  </div>
                )}
              </div>
            )}
            <Btn onClick={() => { setGahoPickOpen(false); setGahoCandidates([]) }}>취소</Btn>
          </div>
        </div>
      )}

      <div style={{
        position: 'relative', zIndex: 2, backgroundColor: C.card,
        borderTop: `2.5px solid ${C.graphite}`, boxShadow: `0 -3px 0 ${C.graphite}28`,
        padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0,
        filter: 'url(#pencilRough)',
      }}>
        <SketchInput
          value={input}
          onChange={setInput}
          onKeyDown={e => e.key === 'Enter' && !submitBlocked && send()}
          placeholder={
            me?.chatMuted
              ? '채팅·제출 금지 중 (감옥)'
              : me?.answerBlocked
                ? `${me.answerBlockBy || '쉬었음청년'} · 이번 라운드 정답 불가`
                : me?.politeActive
                  ? `예의바른청년 · 답 끝「${me.politeSuffix || '입니다'}」필수`
                  : answerDelayLocked
                ? `님아 매너좀 · ${answerDelayLeftSec}초 후 입력 가능`
                : duelSpectating
                  ? '관전 채팅 · 대결 당사자에겐 안 보여요'
                  : inDuel
                    ? '야차룰 · 제목만 맞히세요!'
                    : '정답 여러 번 제출 가능 · 제목/가수 둘 다 맞혀도 OK'
          }
          style={{
            flex: 1,
            fontSize: '22px',
            padding: '12px 16px',
            backgroundColor: submitBlocked ? '#E8EEF3' : C.card,
            textAlign: 'center',
            fontFamily: F.chat,
          }}
          noPaste
        />
        <Btn variant="primary" disabled={submitBlocked} onClick={send}>제출</Btn>
      </div>
    </div>
  )
}

// ── Augment ────────────────────────────────────────────────────

const AUGMENT_BGM_URL = 'https://www.youtube.com/watch?v=L422Qs3K6_I'
const AUGMENT_BGM_SEC = 20

function AugmentScreen({ nav }: { nav: (s: Screen) => void }) {
  const { room, augmentOffer, pickAugment, rerollAugment, musicVolume } = useGame()
  const [timer, setTimer] = useState(20)
  const [selected, setSelected] = useState<string | null>(null)
  const [rerollsLeft, setRerollsLeft] = useState(1)
  const [candidates, setCandidates] = useState(augmentOffer?.candidates || [])
  const selectedRef = useRef(selected)
  const doneRef = useRef(false)
  selectedRef.current = selected

  useEffect(() => {
    if (room?.status === 'playing' || room?.status === 'revealing' || room?.status === 'countdown' || room?.status === 'duel') nav('game')
    if (room?.status === 'ended') nav('result')
    if (!room) nav('lobby')
  }, [room, nav])

  useEffect(() => {
    if (augmentOffer) {
      setCandidates(augmentOffer.candidates)
      setRerollsLeft(augmentOffer.rerolls)
      setTimer(augmentOffer.timeoutSec)
      doneRef.current = false
    }
  }, [augmentOffer])

  useEffect(() => {
    if (augmentOffer?.candidates) setCandidates(augmentOffer.candidates)
  }, [augmentOffer?.candidates])

  useEffect(() => {
    const t = setInterval(() => {
      setTimer(v => {
        if (v <= 1) {
          if (!doneRef.current) {
            doneRef.current = true
            pickAugment(selectedRef.current)
          }
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [pickAugment])

  const onReroll = async () => {
    if (rerollsLeft <= 0) return
    await rerollAugment()
    setRerollsLeft(r => r - 1)
    setSelected(null)
  }

  const confirm = () => {
    if (!selected || doneRef.current) return
    doneRef.current = true
    pickAugment(selected)
  }

  return (
    <div style={{ minHeight: '100vh', ...crumpledPaper, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <HiddenYouTube
        url={AUGMENT_BGM_URL}
        startSec={0}
        durationSec={AUGMENT_BGM_SEC}
        volume={musicVolume}
        playLabel="🎵 탭해서 증강 BGM 재생"
      />
      <div style={{ ...sk(), backgroundColor: C.card, padding: '36px 32px', maxWidth: 720, width: '100%', textAlign: 'center' }}>
        <div style={{ fontFamily: F.brand, fontSize: 42, fontWeight: 700, marginBottom: 8 }}>증강 선택</div>
        <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, marginBottom: 8 }}>남은 시간 {timer}초 · 1개 보관</div>
        <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 22 }}>
          효과는 선택 시 알 수 없습니다 · 게임에서 사용 버튼에 올리면 설명
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginBottom: 22,
        }}>
          {candidates.map(a => {
            const on = selected === a.id
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a.id)}
                style={{
                  ...sk(on ? C.blue : C.graphite),
                  backgroundColor: on ? C.blueLight : C.card,
                  padding: 12,
                  cursor: 'pointer',
                  border: `2.5px solid ${on ? C.blue : C.graphite}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{
                  width: '100%',
                  aspectRatio: '1',
                  ...sk(C.graphite, true),
                  overflow: 'hidden',
                  backgroundColor: '#F2F0EB',
                  position: 'relative',
                }}>
                  {a.imageUrl ? (
                    <img
                      src={a.imageUrl}
                      alt={a.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 6,
                      border: `2px dashed ${C.line}`,
                      boxSizing: 'border-box',
                      margin: 0,
                      background:
                        'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(60,55,50,0.04) 8px, rgba(60,55,50,0.04) 16px)',
                    }}>
                      <div style={{
                        width: '42%', height: '42%',
                        border: `2px solid ${C.muted}`,
                        borderRadius: 4,
                        opacity: 0.45,
                      }} />
                      <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 700, color: C.muted }}>
                        사진 없음
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{a.name}</div>
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Btn disabled={rerollsLeft <= 0} onClick={onReroll}>{rerollsLeft <= 0 ? '리롤 사용함' : `리롤 (${rerollsLeft}회)`}</Btn>
          <Btn variant="primary" size="lg" disabled={!selected} onClick={confirm}>보관하기</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Result ─────────────────────────────────────────────────────

function ResultScreen({ nav }: { nav: (s: Screen) => void }) {
  const { results, leaveRoom, clearResults, room } = useGame()
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
        <Btn variant="primary" size="lg" onClick={() => { clearResults(); leaveRoom(); nav('lobby') }}>로비로</Btn>
      </div>
    </div>
  )
}

// ── Profile ────────────────────────────────────────────────────

function ProfileScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, updateProfile, uploadAvatar, removeAvatar } = useGame()
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) nav('login')
  }, [user, nav])

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
      </div>
    </div>
  )
}

// ── Admin Question Bank ────────────────────────────────────────

type BankSlotDraft = { label: string; answer: string; accepts: string; hidden: boolean }
type BankQuestion = {
  id: string
  youtubeUrl: string
  startSec: number
  endSec: number
  genre: string
  tags: string[]
  slots: Array<{ id: string; label: string; answer?: string; acceptAnswers?: string[]; hidden?: boolean }>
}

function BankScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user } = useGame()
  const [list, setList] = useState<BankQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [genres, setGenres] = useState<Array<{ name: string; count: number }>>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [startSec, setStartSec] = useState('30')
  const [endSec, setEndSec] = useState('70')
  const [genreName, setGenreName] = useState<GenreName>('K팝')
  const [formTags, setFormTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [slots, setSlots] = useState<BankSlotDraft[]>([
    { label: '제목', answer: '', accepts: '', hidden: false },
    { label: '가수', answer: '', accepts: '', hidden: false },
  ])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [filterGenre, setFilterGenre] = useState<GenreName | ''>('')
  const [filterTag, setFilterTag] = useState('')
  const [filterTagInput, setFilterTagInput] = useState('')
  const [bulkJson, setBulkJson] = useState('')
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const parseAccepts = (raw: string) =>
    [...new Set(raw.split(/[,，、/|]+/).map(x => x.trim()).filter(Boolean))]

  const emptySlots = (): BankSlotDraft[] => [
    { label: '제목', answer: '', accepts: '', hidden: false },
    { label: '가수', answer: '', accepts: '', hidden: false },
  ]

  const resetForm = () => {
    setEditingId(null)
    setYoutubeUrl('')
    setStartSec('30')
    setEndSec('70')
    setGenreName('K팝')
    setFormTags([])
    setTagInput('')
    setSlots(emptySlots())
  }

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (searchQ.trim()) params.set('q', searchQ.trim())
      if (filterGenre) params.set('genre', filterGenre)
      if (filterTag) params.set('tag', filterTag)
      const [q, g] = await Promise.all([
        api<{ questions: BankQuestion[]; total: number }>(`/api/questions?${params}`),
        api<{ genres: Array<{ name: string; count: number }> }>('/api/questions/genres'),
      ])
      setList(q.questions)
      setTotal(q.total)
      setGenres(g.genres)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '목록 불러오기 실패')
    }
  }, [searchQ, filterGenre, filterTag])

  useEffect(() => {
    if (!user?.isAdmin) { nav('lobby'); return }
    load()
  }, [user, nav, load])

  const addSlot = (label = `슬롯${slots.length + 1}`, hidden = false) => {
    if (slots.length >= 8) {
      setErr('슬롯은 최대 8개까지입니다')
      return
    }
    if (hidden && slots.some(s => s.hidden)) {
      setErr('히든 문제는 1개만 넣을 수 있습니다')
      return
    }
    setErr('')
    setSlots(s => [...s, {
      label: hidden ? (label === `슬롯${slots.length + 1}` ? '히든 질문' : label) : label,
      answer: '',
      accepts: '',
      hidden,
    }])
  }
  const removeSlot = (i: number) => setSlots(s => s.length <= 1 ? s : s.filter((_, idx) => idx !== i))
  const updateSlot = (i: number, patch: Partial<BankSlotDraft>) =>
    setSlots(s => s.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl)))

  const genreBtn = (g: GenreName, selected: boolean) => ({
    ...sk(selected ? C.blue : C.graphite, true),
    backgroundColor: selected ? C.blueLight : C.card,
    color: selected ? C.blue : C.body,
    fontFamily: F.ui, fontSize: '13px', fontWeight: 800 as const,
    padding: '6px 12px', cursor: 'pointer', outline: 'none' as const,
    border: `2px solid ${selected ? C.blue : C.graphite}`,
  })

  const addFormTag = () => {
    const next = tagInput.trim()
    if (!next) return
    setFormTags(normalizeSongTags([...formTags, next]))
    setTagInput('')
  }

  const removeFormTag = (tag: string) => {
    setFormTags(formTags.filter(t => t !== tag))
  }

  const startEdit = (q: BankQuestion) => {
    setEditingId(q.id)
    setYoutubeUrl(q.youtubeUrl)
    setStartSec(String(q.startSec))
    setEndSec(String(q.endSec))
    setGenreName((GENRES.includes(q.genre as GenreName) ? q.genre : '기타') as GenreName)
    setFormTags(normalizeSongTags(q.tags || []))
    setTagInput('')
    setSlots(q.slots.map(s => ({
      label: s.label,
      answer: s.answer || '',
      accepts: (s.acceptAnswers || []).filter(a => a !== s.answer).join(', '),
      hidden: !!s.hidden,
    })))
    setErr('')
    setOkMsg('수정 모드 · 아래 폼에서 저장하세요')
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const submit = async () => {
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const start = Number(startSec)
      const end = Number(endSec)
      if (!youtubeUrl.trim()) throw new Error('유튜브 URL을 입력하세요')
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('구간(초)을 확인하세요')
      if (slots.some(s => !s.label.trim() || !s.answer.trim())) throw new Error('슬롯 라벨/정답을 모두 입력하세요')

      const body = {
        youtubeUrl: youtubeUrl.trim(),
        startSec: start,
        endSec: end,
        genreName,
        tags: normalizeSongTags(formTags),
        slots: slots.map(s => ({
          label: s.label.trim(),
          answer: s.answer.trim(),
          acceptAnswers: parseAccepts(s.accepts),
          hidden: !!s.hidden,
        })),
      }

      if (editingId) {
        await api(`/api/questions/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setOkMsg(`수정 완료 · 슬롯 ${slots.length}개`)
      } else {
        await api('/api/questions', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setOkMsg(`등록 완료 · 슬롯 ${slots.length}개`)
      }
      resetForm()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : (editingId ? '수정 실패' : '등록 실패'))
    } finally {
      setBusy(false)
    }
  }

  const submitBulk = async (raw: string) => {
    setBusy(true); setErr(''); setOkMsg('')
    try {
      const parsed = JSON.parse(raw) as unknown
      const questions = Array.isArray(parsed)
        ? parsed
        : (parsed as { questions?: unknown }).questions
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('JSON 배열(또는 { questions: [...] }) 형식이 필요합니다')
      }
      const res = await api<{ created: number; failed: number; errors: Array<{ index: number; error: string }> }>('/api/questions/bulk', {
        method: 'POST',
        body: JSON.stringify({ questions }),
      })
      setOkMsg(`${res.created}곡 등록 완료` + (res.failed ? ` / 실패 ${res.failed}곡` : ''))
      if (res.errors?.length) {
        setErr(`일부 실패 예: #${res.errors[0].index} ${res.errors[0].error}`)
      }
      setBulkJson('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '대량 등록 실패')
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (file: File | null) => {
    if (!file) return
    const text = await file.text()
    setBulkJson(text)
    await submitBulk(text)
  }

  const remove = async (id: string) => {
    if (!confirm('이 문제를 삭제할까요?')) return
    setBusy(true); setErr('')
    try {
      await api(`/api/questions/${id}`, { method: 'DELETE' })
      if (editingId === id) resetForm()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제 실패')
    } finally {
      setBusy(false)
    }
  }

  if (!user?.isAdmin) return null

  return (
    <div style={{ minHeight: '100vh', ...notebookLines }}>
      <div style={{
        backgroundColor: C.card, borderBottom: `2.5px solid ${C.graphite}`,
        boxShadow: `0 3px 0 ${C.graphite}50`, padding: '12px 28px',
        display: 'flex', alignItems: 'center', gap: 14, filter: 'url(#pencilRough)',
      }}>
        <Btn size="sm" onClick={() => nav('lobby')}>← 로비</Btn>
        <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 900, flex: 1, color: C.body }}>문제 은행</div>
        <Tag color={C.blue}>총 {total}곡</Tag>
        <Tag color={C.blue}>관리자</Tag>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <NoteCard>
          <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 8 }}>대량 등록 (1000곡+ 추천)</div>
          <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
            JSON 파일/텍스트로 한 번에 넣을 수 있습니다. 장르는{' '}
            <strong>{GENRES.join(', ')}</strong> 중 하나여야 합니다.
            선택으로 <code>tags</code> 문자열 배열을 넣을 수 있습니다 (예: <code>["남돌","10년대"]</code>).
          </div>
          <textarea
            value={bulkJson}
            onChange={e => setBulkJson(e.target.value)}
            placeholder={`[\n  {\n    "youtubeUrl": "https://www.youtube.com/watch?v=...",\n    "startSec": 30,\n    "endSec": 70,\n    "genreName": "버튜버",\n    "tags": ["여돌", "20년대"],\n    "slots": [\n      { "label": "제목", "answer": "네리사에게 혼났습니다", "acceptAnswers": "네리사에게 혼났습니다.., Nerissa" },\n      { "label": "가수", "answer": "아오쿠모 린", "acceptAnswers": ["아오쿠모 린", "AOKUMO RIN"] },\n      { "label": "출시 연도는?", "answer": "2024", "hidden": true }\n    ]\n  }\n]`}
            style={{
              width: '100%', minHeight: 160, marginBottom: 12,
              ...sk(), backgroundColor: C.card, fontFamily: 'ui-monospace, monospace',
              fontSize: 13, padding: 12, color: C.body, resize: 'vertical', outline: 'none',
            }}
          />
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
            acceptAnswers는 배열 또는 쉼표 문자열 모두 OK. 슬롯은 문제당 최대 8개.
            히든은 <code>{`"hidden": true`}</code> (문제당 최대 1개, 없어도 됨).
          </div>          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <Btn variant="primary" onClick={() => submitBulk(bulkJson)} disabled={busy || !bulkJson.trim()}>JSON 등록</Btn>
            <Btn onClick={() => fileRef.current?.click()} disabled={busy}>.json 파일 선택</Btn>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={e => onPickFile(e.target.files?.[0] || null)}
            />
          </div>
        </NoteCard>

        <NoteCard>
          <div ref={formRef} style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 16 }}>
            {editingId ? '문제 수정' : '단건 등록'}
            {editingId && (
              <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, color: C.blue }}>수정 중</span>
            )}
          </div>
          <Field label="유튜브 URL" value={youtubeUrl} onChange={setYoutubeUrl} placeholder="https://www.youtube.com/watch?v=..." />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="시작(초)" value={startSec} onChange={setStartSec} placeholder="30" />
            <Field label="종료(초)" value={endSec} onChange={setEndSec} placeholder="70" />
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 8 }}>장르</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {GENRES.map(g => (
              <button key={g} type="button" style={genreBtn(g, genreName === g)} onClick={() => setGenreName(g)}>{g}</button>
            ))}
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 8 }}>태그</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SketchInput
              value={tagInput}
              onChange={setTagInput}
              placeholder="예: 남돌, 10년대, 발라드…"
              style={{ flex: 1, minWidth: 160 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addFormTag()
                }
              }}
            />
            <Btn size="sm" variant="primary" onClick={addFormTag} disabled={!tagInput.trim()}>
              태그 추가하기
            </Btn>
          </div>
          {formTags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {formTags.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => removeFormTag(t)}
                  title="클릭하여 제거"
                  style={{
                    ...sk(C.blue, true),
                    backgroundColor: C.blueLight,
                    color: C.blue,
                    fontFamily: F.ui,
                    fontSize: 13,
                    fontWeight: 800,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    outline: 'none',
                    border: `2px solid ${C.blue}`,
                  }}
                >
                  {t} ×
                </button>
              ))}
            </div>
          )}
          {formTags.length === 0 && (
            <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginBottom: 16 }}>
              태그가 없으면 비워 둡니다. (남돌+여돌을 같이 넣으면 성별 태그는 자동 제거)
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: '0.06em' }}>
              정답 슬롯 ({slots.length}/8)
            </div>
            <div style={{ flex: 1 }} />
            <Btn size="sm" onClick={() => addSlot('제목')} disabled={slots.length >= 8}>+ 제목</Btn>
            <Btn size="sm" onClick={() => addSlot('가수')} disabled={slots.length >= 8}>+ 가수</Btn>
            <Btn size="sm" onClick={() => addSlot('키워드')} disabled={slots.length >= 8}>+ 키워드</Btn>
            <Btn
              size="sm"
              variant="primary"
              onClick={() => addSlot('출시 연도는?', true)}
              disabled={slots.length >= 8 || slots.some(s => s.hidden)}
            >
              + 히든
            </Btn>
            <Btn size="sm" onClick={() => addSlot()} disabled={slots.length >= 8}>+ 슬롯</Btn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {slots.map((s, i) => {
              const acceptsPreview = parseAccepts(s.accepts)
              return (
                <div
                  key={i}
                  style={{
                    ...sk(s.hidden ? C.blue : C.graphite, true),
                    backgroundColor: s.hidden ? C.blueLight : C.card,
                    padding: 12,
                  }}
                >
                  <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: s.hidden ? C.blue : C.muted, marginBottom: 8 }}>
                    {s.hidden ? '히든 문제' : `슬롯 ${i + 1}`} · 맞히면 +1점
                    {s.hidden && ' · 제목·가수 맞힌 뒤 등장'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    <SketchInput
                      value={s.label}
                      onChange={v => updateSlot(i, { label: v })}
                      placeholder={s.hidden ? '히든 질문 (예: 출시 연도는?)' : '라벨 (제목/가수/키워드)'}
                      style={{ flex: '0 0 160px', minWidth: 120 }}
                    />
                    <SketchInput value={s.answer} onChange={v => updateSlot(i, { answer: v })} placeholder="대표 정답" style={{ flex: 1, minWidth: 120 }} />
                    <Btn size="sm" variant="danger" onClick={() => removeSlot(i)} disabled={slots.length <= 1}>삭제</Btn>
                  </div>
                  <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted, marginBottom: 4 }}>
                    인정 답안 (쉼표로 구분)
                  </div>
                  <SketchInput
                    value={s.accepts}
                    onChange={v => updateSlot(i, { accepts: v })}
                    placeholder="예: 네리사에게 혼났습니다.., Nerissa, 네리사"
                    style={{ width: '100%' }}
                  />
                  {(s.answer.trim() || acceptsPreview.length > 0) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {s.answer.trim() && <Tag color={C.green}>정답: {s.answer.trim()}</Tag>}
                      {acceptsPreview.map(a => (
                        <Tag key={a} color={C.blue}>{a}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 12, lineHeight: 1.55 }}>
            인정 답안 예: <code>아이유, IU, iu</code> · 구분자 <code>,</code> <code>/</code> <code>|</code> 가능.
            히든은 선택(0~1개). 라벨이 질문으로 표시되며, 제목·가수를 모두 맞히면 등장합니다.
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <Btn variant="primary" onClick={submit} disabled={busy}>
              {editingId ? '수정 저장' : '등록하기'}
            </Btn>
            {editingId && (
              <Btn onClick={() => { resetForm(); setOkMsg(''); setErr('') }} disabled={busy}>수정 취소</Btn>
            )}
          </div>
          {err && <div style={{ fontFamily: F.ui, color: C.red, marginBottom: 8 }}>{err}</div>}
          {okMsg && <div style={{ fontFamily: F.ui, color: C.green, marginBottom: 8 }}>{okMsg}</div>}
          <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            장르 현황: {genres.map(g => `${g.name} ${g.count}곡`).join(' · ') || '없음'}
          </div>
        </NoteCard>

        <NoteCard>
          <div style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 12 }}>
            등록 목록 ({list.length}/{total})
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <SketchInput
              value={searchInput}
              onChange={setSearchInput}
              placeholder="제목·가수·인정답·URL 검색"
              style={{ flex: 1, minWidth: 180 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearchQ(searchInput.trim())
              }}
            />
            <Btn size="sm" variant="primary" onClick={() => setSearchQ(searchInput.trim())} disabled={busy}>검색</Btn>
            {(searchQ || filterGenre || filterTag) && (
              <Btn
                size="sm"
                onClick={() => {
                  setSearchInput('')
                  setSearchQ('')
                  setFilterGenre('')
                  setFilterTag('')
                  setFilterTagInput('')
                }}
                disabled={busy}
              >
                초기화
              </Btn>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={genreBtn('K팝', filterGenre === '')}
              onClick={() => setFilterGenre('')}
            >
              전체 장르
            </button>
            {GENRES.map(g => (
              <button
                key={g}
                type="button"
                style={genreBtn(g, filterGenre === g)}
                onClick={() => setFilterGenre(g)}
              >
                {g}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <SketchInput
              value={filterTagInput}
              onChange={setFilterTagInput}
              placeholder="태그로 필터 (예: 남돌)"
              style={{ flex: 1, minWidth: 140 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setFilterTag(filterTagInput.trim())
              }}
            />
            <Btn size="sm" onClick={() => setFilterTag(filterTagInput.trim())} disabled={busy}>태그 필터</Btn>
            {filterTag && (
              <Btn size="sm" onClick={() => { setFilterTag(''); setFilterTagInput('') }} disabled={busy}>태그 해제</Btn>
            )}
          </div>
          {(searchQ || filterGenre || filterTag) && (
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 10 }}>
              {[
                searchQ ? `검색어: "${searchQ}"` : '',
                filterGenre ? `장르: ${filterGenre}` : '',
                filterTag ? `태그: ${filterTag}` : '',
              ].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.length === 0 && (
              <div style={{ fontFamily: F.ui, color: C.muted, textAlign: 'center', padding: 20 }}>
                {searchQ || filterGenre || filterTag ? '검색 결과가 없습니다' : '아직 문제가 없습니다'}
              </div>
            )}
            {list.map(q => (
              <div
                key={q.id}
                style={{
                  ...sk(editingId === q.id ? C.blue : C.graphite, true),
                  backgroundColor: editingId === q.id ? C.blueLight : C.card,
                  padding: '12px 14px',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <Tag>{q.genre}</Tag>
                  {(q.tags || []).map(t => (
                    <Tag key={t} color={C.blue}>{t}</Tag>
                  ))}
                  <Tag color={C.muted}>{q.slots.length}슬롯</Tag>
                  {q.slots.some(s => s.hidden) && <Tag color={C.blue}>히든</Tag>}
                  <div style={{ flex: 1, fontFamily: F.ui, fontSize: 13, color: C.muted }}>
                    {q.startSec}s ~ {q.endSec}s
                  </div>
                  <Btn size="sm" onClick={() => startEdit(q)} disabled={busy}>수정</Btn>
                  <Btn size="sm" variant="danger" onClick={() => remove(q.id)} disabled={busy}>삭제</Btn>
                </div>
                <div style={{
                  fontFamily: F.ui, fontSize: 13, color: C.body, marginBottom: 6,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {q.youtubeUrl}
                </div>
                <div style={{ fontFamily: F.ui, fontSize: 14, color: C.body, marginBottom: 4 }}>
                  {q.slots.map(s => `${s.hidden ? '[히든] ' : ''}${s.label}: ${s.answer || '?'}`).join(' / ')}
                </div>
                {q.slots.some(s => (s.acceptAnswers?.length || 0) > 1) && (
                  <div style={{ fontFamily: F.ui, fontSize: 12, color: C.muted }}>
                    인정: {q.slots.map(s => {
                      const extras = (s.acceptAnswers || []).filter(a => a !== s.answer)
                      if (!extras.length) return null
                      return `${s.label}[${extras.join(', ')}]`
                    }).filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </NoteCard>
      </div>
    </div>
  )
}

// ── App Root ──────────────────────────────────────────────────

export default function App() {
  const { user, room, results } = useGame()
  const [screen, setScreen] = useState<Screen>('home')
  const [manual, setManual] = useState(false)

  useEffect(() => {
    if (manual) return
    if (!user) { setScreen(s => (s === 'login' ? s : 'home')); return }
    if (results || room?.status === 'ended') { setScreen('result'); return }
    if (!room) { setScreen(s => (s === 'bank' || s === 'profile' ? s : 'lobby')); return }
    if (room.status === 'lobby') setScreen('waiting')
    else if (room.status === 'playing' || room.status === 'revealing' || room.status === 'countdown' || room.status === 'duel') setScreen('game')
    else if (room.status === 'augment') setScreen('augment')
  }, [user, room, results, manual])

  const nav = (s: Screen) => {
    setManual(true)
    setScreen(s)
    setTimeout(() => setManual(false), 50)
  }

  const render = () => {
    switch (screen) {
      case 'home':    return <HomeScreen    nav={nav} />
      case 'login':   return <LoginScreen   nav={nav} />
      case 'lobby':   return <LobbyScreen   nav={nav} />
      case 'waiting': return <WaitingScreen nav={nav} />
      case 'game':    return <GameScreen    nav={nav} />
      case 'augment': return <AugmentScreen nav={nav} />
      case 'result':  return <ResultScreen  nav={nav} />
      case 'bank':    return <BankScreen    nav={nav} />
      case 'profile': return <ProfileScreen nav={nav} />
    }
  }

  return (
    <>
      <PencilFilters />
      <div style={{ position: 'fixed', inset: 0, ...crumpledPaper, zIndex: 0 }}>
        <CrumpleOverlay />
      </div>
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
        {render()}
      </div>
    </>
  )
}
