/** Web Audio로 합성한 짧은 게임 효과음 (외부 파일 없음) */

type SfxName =
  | 'correct'
  | 'allCorrect'
  | 'roundStart'
  | 'reveal'
  | 'skip'
  | 'skipVote'
  | 'augment'
  | 'augmentUse'
  | 'gaho'
  | 'gameEnd'
  | 'click'
  | 'countdown'

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let lowpass: BiquadFilterNode | null = null
/** 슬라이더 0~1 · 실제 출력은 MASTER_BOOST 배 */
let volume = 0.85
let muted = false
/** 음악(YouTube) 위에 묻히지 않게 마스터 증폭 */
const MASTER_BOOST = 2.4

function applyMasterGain() {
  if (!masterGain) return
  masterGain.gain.value = muted ? 0 : Math.min(1, volume * MASTER_BOOST)
}

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC()
    lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    // 정답 「띵」 고음이 죽지 않게 (너무 낮으면 음악에 묻힘)
    lowpass.frequency.value = 5200
    lowpass.Q.value = 0.45
    masterGain = ctx.createGain()
    applyMasterGain()
    lowpass.connect(masterGain)
    masterGain.connect(ctx.destination)
  }
  return ctx
}

export function unlockSfx() {
  const c = ensureCtx()
  if (c.state === 'suspended') void c.resume()
}

export function setSfxVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  applyMasterGain()
}

export function setSfxMuted(m: boolean) {
  muted = m
  applyMasterGain()
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.22,
  slideTo?: number,
) {
  const c = ensureCtx()
  if (!lowpass) return
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.018)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g)
  g.connect(lowpass)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

function softThump(start: number, dur = 0.12, gain = 0.18) {
  const c = ensureCtx()
  if (!lowpass) return
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.55
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 320
  const g = c.createGain()
  g.gain.setValueAtTime(gain, start)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(lowpass)
  src.start(start)
  src.stop(start + dur)
}

const plays: Record<SfxName, () => void> = {
  click() {
    const t = ensureCtx().currentTime
    tone(220, t, 0.05, 'sine', 0.12)
  },
  correct() {
    // 정답 = allCorrect와 동일 팡파르
    plays.allCorrect()
  },
  /** 정답 / 전부 맞춤 공통 팡파르 */
  allCorrect() {
    const t = ensureCtx().currentTime
    tone(988, t, 0.22, 'sine', 0.72)
    tone(1480, t, 0.16, 'triangle', 0.48)
    tone(1175, t + 0.14, 0.2, 'sine', 0.58)
    tone(1480, t + 0.26, 0.24, 'triangle', 0.62)
    tone(1976, t + 0.38, 0.45, 'sine', 0.55)
    softThump(t + 0.26, 0.14, 0.28)
  },
  roundStart() {
    const t = ensureCtx().currentTime
    tone(196, t, 0.12, 'sine', 0.4)
    tone(246.94, t + 0.08, 0.16, 'sine', 0.46)
  },
  reveal() {
    const t = ensureCtx().currentTime
    tone(174.61, t, 0.2, 'triangle', 0.42)
    tone(146.83, t + 0.06, 0.26, 'sine', 0.38)
  },
  skip() {
    const t = ensureCtx().currentTime
    softThump(t, 0.16, 0.32)
    tone(220, t, 0.18, 'sine', 0.34, 110)
  },
  /** 스킵 버튼을 누른 본인에게만 — 짧은 「똑-똑」 */
  skipVote() {
    const t = ensureCtx().currentTime
    tone(523.25, t, 0.06, 'square', 0.22)
    tone(392, t + 0.075, 0.1, 'square', 0.2)
  },
  augment() {
    const t = ensureCtx().currentTime
    ;[196, 246.94, 293.66, 349.23].forEach((f, i) => tone(f, t + i * 0.08, 0.18, 'sine', 0.38))
  },
  augmentUse() {
    const t = ensureCtx().currentTime
    tone(220, t, 0.24, 'sine', 0.46, 330)
    tone(330, t + 0.1, 0.22, 'triangle', 0.38)
  },
  /** 가호 강림 — 깊고 화려한 팡파르 */
  gaho() {
    const t = ensureCtx().currentTime
    softThump(t, 0.22, 0.42)
    tone(130.81, t, 0.35, 'sine', 0.55)
    tone(164.81, t + 0.08, 0.32, 'triangle', 0.4)
    ;[261.63, 329.63, 392, 523.25].forEach((f, i) => {
      tone(f, t + 0.18 + i * 0.11, 0.28, 'sine', 0.48 - i * 0.04)
      tone(f * 2, t + 0.22 + i * 0.11, 0.2, 'triangle', 0.22)
    })
    tone(659.25, t + 0.72, 0.55, 'sine', 0.5)
    tone(783.99, t + 0.78, 0.6, 'triangle', 0.32)
    softThump(t + 0.7, 0.18, 0.3)
  },
  gameEnd() {
    const t = ensureCtx().currentTime
    ;[196, 246.94, 293.66, 349.23].forEach((f, i) => {
      tone(f, t + i * 0.13, 0.32, 'triangle', 0.44)
    })
    tone(392, t + 0.55, 0.42, 'sine', 0.5)
  },
  countdown() {
    const t = ensureCtx().currentTime
    tone(392, t, 0.14, 'sine', 0.5)
    softThump(t, 0.09, 0.24)
  },
}

export function playSfx(name: SfxName) {
  if (muted) return
  try {
    unlockSfx()
    plays[name]()
  } catch {
    // AudioContext 미지원/차단 시 무시
  }
}

/** 첫 클릭/키 입력에서 오디오 잠금 해제 */
export function installSfxUnlock() {
  const once = () => {
    unlockSfx()
    window.removeEventListener('pointerdown', once)
    window.removeEventListener('keydown', once)
  }
  window.addEventListener('pointerdown', once)
  window.addEventListener('keydown', once)
}
