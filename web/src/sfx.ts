/** Web Audio로 합성한 짧은 게임 효과음 (외부 파일 없음) — 낮은·부드러운 톤 */

type SfxName = 'correct' | 'roundStart' | 'reveal' | 'skip' | 'augment' | 'augmentUse' | 'gameEnd' | 'click' | 'countdown'

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let lowpass: BiquadFilterNode | null = null
let volume = 0.35
let muted = false

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC()
    lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 1800
    lowpass.Q.value = 0.5
    masterGain = ctx.createGain()
    masterGain.gain.value = muted ? 0 : volume
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
  if (masterGain) masterGain.gain.value = muted ? 0 : volume
}

export function setSfxMuted(m: boolean) {
  muted = m
  if (masterGain) masterGain.gain.value = muted ? 0 : volume
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.12,
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
  g.gain.exponentialRampToValueAtTime(gain, start + 0.025)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g)
  g.connect(lowpass)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

function softThump(start: number, dur = 0.12, gain = 0.1) {
  const c = ensureCtx()
  if (!lowpass) return
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.5
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 280
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
    tone(220, t, 0.05, 'sine', 0.07)
  },
  correct() {
    const t = ensureCtx().currentTime
    tone(261.63, t, 0.12, 'sine', 0.11)
    tone(329.63, t + 0.09, 0.14, 'triangle', 0.1)
    tone(392.0, t + 0.18, 0.2, 'sine', 0.11)
  },
  roundStart() {
    const t = ensureCtx().currentTime
    tone(196, t, 0.1, 'sine', 0.09)
    tone(246.94, t + 0.08, 0.14, 'sine', 0.1)
  },
  reveal() {
    const t = ensureCtx().currentTime
    tone(174.61, t, 0.18, 'triangle', 0.1)
    tone(146.83, t + 0.06, 0.24, 'sine', 0.09)
  },
  skip() {
    const t = ensureCtx().currentTime
    softThump(t, 0.14, 0.09)
    tone(220, t, 0.16, 'sine', 0.07, 110)
  },
  augment() {
    const t = ensureCtx().currentTime
    ;[196, 246.94, 293.66, 349.23].forEach((f, i) => tone(f, t + i * 0.08, 0.16, 'sine', 0.08))
  },
  augmentUse() {
    const t = ensureCtx().currentTime
    tone(220, t, 0.22, 'sine', 0.1, 330)
    tone(330, t + 0.1, 0.2, 'triangle', 0.08)
  },
  gameEnd() {
    const t = ensureCtx().currentTime
    ;[196, 246.94, 293.66, 349.23].forEach((f, i) => {
      tone(f, t + i * 0.13, 0.3, 'triangle', 0.1)
    })
    tone(392, t + 0.55, 0.4, 'sine', 0.11)
  },
  countdown() {
    const t = ensureCtx().currentTime
    tone(392, t, 0.12, 'sine', 0.12)
    softThump(t, 0.08, 0.07)
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
