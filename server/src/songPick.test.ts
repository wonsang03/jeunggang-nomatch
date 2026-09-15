import { describe, it, expect } from 'vitest'
import {
  MAX_WINDOW,
  markSongPlayed,
  memoryWindow,
  pruneSongMemory,
  songWeight,
  weightedShuffle,
  type SongMemory,
} from './songPick.js'

function emptyMemory(): SongMemory {
  return { songLastPlayed: new Map(), gameSeq: 0 }
}

function makeBank(n: number) {
  return Array.from({ length: n }, (_, i) => `q${i}`)
}

/**
 * socket.ts 의 pickQuestions 가 장르마다 하는 일.
 * (socket.ts 를 import 하면 prisma·socket.io 가 딸려와서 여기서 못 쓴다)
 */
function pickOnce(bank: string[], count: number, mem: SongMemory, penalty: number) {
  const window = memoryWindow(bank.length, count)
  return weightedShuffle(bank, (id) => songWeight(mem, id, window, penalty)).slice(0, count)
}

/** 한 방에서 games 판을 연속으로 돌렸을 때 "직전 판과 겹친 곡 수"의 평균 */
function averageOverlap(bank: string[], count: number, penalty: number, games: number) {
  const mem = emptyMemory()
  let prev: string[] = []
  let overlap = 0
  let measured = 0
  for (let g = 0; g < games; g += 1) {
    mem.gameSeq += 1
    const picked = pickOnce(bank, count, mem, penalty)
    if (g > 0) {
      const before = new Set(prev)
      overlap += picked.filter((id) => before.has(id)).length
      measured += 1
    }
    for (const id of picked) markSongPlayed(mem, id)
    prev = picked
  }
  return overlap / Math.max(1, measured)
}

describe('memoryWindow', () => {
  it('은행을 한 바퀴 도는 판 수 — 은행이 작을수록 짧게 기억한다', () => {
    expect(memoryWindow(59, 20)).toBe(3)   // 게임 은행
    expect(memoryWindow(311, 40)).toBe(8)  // 한국 은행
  })

  it('은행이 작아도 최소 2판은 누른다 — 직전 판까지 그대로 나오면 안 된다', () => {
    expect(memoryWindow(55, 30)).toBe(2)
    expect(memoryWindow(10, 10)).toBe(2)
  })

  it('아무리 커도 상한에서 멈춘다 — 그보다 오래된 곡은 안 나온 곡과 똑같이 친다', () => {
    expect(memoryWindow(311, 20)).toBe(MAX_WINDOW)
    expect(memoryWindow(100_000, 1)).toBe(MAX_WINDOW)
  })

  it('출제 수가 0이어도 터지지 않는다', () => {
    expect(memoryWindow(59, 0)).toBe(2)
  })
})

describe('songWeight', () => {
  it('설정 OFF(0)면 전부 같은 가중치 — 균등 추첨과 같아야 한다', () => {
    const mem = emptyMemory()
    mem.gameSeq = 5
    markSongPlayed(mem, 'q0')
    expect(songWeight(mem, 'q0', 3, 0)).toBe(1)
    expect(songWeight(mem, 'never', 3, 0)).toBe(1)
  })

  it('한 번도 안 나온 곡이 가장 잘 나온다', () => {
    const mem = emptyMemory()
    mem.gameSeq = 5
    expect(songWeight(mem, 'never', 3, 1)).toBe(1)
  })

  it('방금 나온 곡도 확률이 0은 아니다 — 0이면 은행이 작을 때 후보가 마른다', () => {
    const mem = emptyMemory()
    mem.gameSeq = 5
    markSongPlayed(mem, 'q0')
    const w = songWeight(mem, 'q0', 3, 1)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(0.05)
  })

  it('오래될수록 회복하고, 기억 기간을 넘기면 안 나온 곡과 같아진다', () => {
    const mem = emptyMemory()
    markSongPlayed(mem, 'q0')  // gameSeq 0 에 나옴
    const window = 4
    mem.gameSeq = 1
    const after1 = songWeight(mem, 'q0', window, 1)
    mem.gameSeq = 3
    const after3 = songWeight(mem, 'q0', window, 1)
    mem.gameSeq = 4
    const after4 = songWeight(mem, 'q0', window, 1)
    mem.gameSeq = 9
    const after9 = songWeight(mem, 'q0', window, 1)

    expect(after1).toBeLessThan(after3)
    expect(after3).toBeLessThan(after4)
    expect(after4).toBe(1)
    expect(after9).toBe(1)
  })

  it('penalty 를 낮추면 눌리는 정도도 약해진다', () => {
    const mem = emptyMemory()
    mem.gameSeq = 1
    markSongPlayed(mem, 'q0')
    const strong = songWeight(mem, 'q0', 3, 1)
    const weak = songWeight(mem, 'q0', 3, 0.5)
    expect(weak).toBeGreaterThan(strong)
    expect(weak).toBeLessThan(1)
  })
})

describe('weightedShuffle', () => {
  it('원소를 잃거나 더하지 않는다', () => {
    const bank = makeBank(30)
    const out = weightedShuffle(bank, () => 1)
    expect(out).toHaveLength(30)
    expect([...out].sort()).toEqual([...bank].sort())
  })

  it('빈 배열도 안전하다', () => {
    expect(weightedShuffle([], () => 1)).toEqual([])
  })

  it('가중치가 전부 같으면 균등하다', () => {
    const bank = makeBank(10)
    const hits = new Map<string, number>()
    const rounds = 6000
    for (let i = 0; i < rounds; i += 1) {
      for (const id of weightedShuffle(bank, () => 1).slice(0, 3)) {
        hits.set(id, (hits.get(id) || 0) + 1)
      }
    }
    // 기대 1800회 · 7σ 여유
    for (const id of bank) {
      expect(hits.get(id) || 0).toBeGreaterThan(1550)
      expect(hits.get(id) || 0).toBeLessThan(2050)
    }
  })

  it('가중치가 같을 때 목록 앞쪽이 유리하지 않다 — 동률을 정렬 순서로 깨면 안 된다', () => {
    // LRU 정렬 방식에서 실제로 밟는 함정: 미출현 곡의 키가 전부 같으면
    // 은행 조회 순서(=등록 순서)가 그대로 영구 편향이 된다.
    const bank = makeBank(20)
    let firstHalf = 0
    let secondHalf = 0
    for (let i = 0; i < 4000; i += 1) {
      for (const id of weightedShuffle(bank, () => 1).slice(0, 5)) {
        if (Number(id.slice(1)) < 10) firstHalf += 1
        else secondHalf += 1
      }
    }
    const diff = Math.abs(firstHalf - secondHalf)
    expect(diff).toBeLessThan(500)  // 총 20000회 중 · 기대 0
  })

  it('가중치가 높은 쪽이 더 자주 앞에 온다', () => {
    const bank = makeBank(10)
    let heavyPicked = 0
    for (let i = 0; i < 3000; i += 1) {
      // q0 만 10배
      for (const id of weightedShuffle(bank, (q) => (q === 'q0' ? 10 : 1)).slice(0, 1)) {
        if (id === 'q0') heavyPicked += 1
      }
    }
    // 10/(10+9) ≈ 0.53 · 균등이면 0.1
    expect(heavyPicked / 3000).toBeGreaterThan(0.4)
  })
})

describe('markSongPlayed · pruneSongMemory', () => {
  it('기록은 현재 판 번호로 남는다', () => {
    const mem = emptyMemory()
    mem.gameSeq = 7
    markSongPlayed(mem, 'q0')
    expect(mem.songLastPlayed.get('q0')).toBe(7)
  })

  it('가중치가 1로 포화된 오래된 기록만 버린다 — 결과는 안 바뀐다', () => {
    const mem = emptyMemory()
    mem.gameSeq = 1
    markSongPlayed(mem, 'old')
    mem.gameSeq = MAX_WINDOW + 5
    markSongPlayed(mem, 'fresh')

    const beforeOld = songWeight(mem, 'old', 3, 1)
    pruneSongMemory(mem)

    expect(mem.songLastPlayed.has('old')).toBe(false)
    expect(mem.songLastPlayed.has('fresh')).toBe(true)
    expect(songWeight(mem, 'old', 3, 1)).toBe(beforeOld)  // 버려도 가중치는 동일(=1)
  })
})

describe('연속 판 회귀', () => {
  it('작은 은행에서도 ON 이 OFF 보다 확실히 덜 겹친다', () => {
    // 예전 하드 제외 방식이 정확히 여기서 무너졌다. 게임 은행(59)은 서너 판이면
    // 전 곡이 "최근곡"이 돼서 뺄 게 없어지고, ON 과 OFF 가 같은 결과를 냈다.
    const bank = makeBank(59)
    const trials = 120
    let on = 0
    let off = 0
    for (let i = 0; i < trials; i += 1) {
      on += averageOverlap(bank, 20, 1, 12)
      off += averageOverlap(bank, 20, 0, 12)
    }
    on /= trials
    off /= trials

    expect(off).toBeGreaterThan(5)          // 균등이면 20 * 20/59 ≈ 6.8곡
    expect(on).toBeLessThan(off * 0.6)      // 실측 ON ≈ 1.4곡 / OFF ≈ 6.8곡
  })

  it('은행 대비 출제 수가 커도 요청한 곡 수를 그대로 채운다', () => {
    // 버튜버(55곡)에서 30곡 — 예전엔 여기서 "은행 부족 → 최근곡 재사용" 분기로 샜다
    const bank = makeBank(55)
    const mem = emptyMemory()
    for (let g = 0; g < 10; g += 1) {
      mem.gameSeq += 1
      const picked = pickOnce(bank, 30, mem, 1)
      expect(picked).toHaveLength(30)
      expect(new Set(picked).size).toBe(30)   // 같은 판 안에 중복 없음
      for (const id of picked) markSongPlayed(mem, id)
    }
  })

  it('매 판 확률 1로 나오는 곡이 없다', () => {
    // 하드 제외 시절 혼합 방의 증상: 안 나온 곡이 출제 수보다 적어지면
    // 그 곡들이 매 판 확정 출현했다 (= 랜덤이 아니라 순번제).
    const bank = makeBank(59)
    const mem = emptyMemory()
    const games = 15
    const hits = new Map<string, number>()
    for (let g = 0; g < games; g += 1) {
      mem.gameSeq += 1
      const picked = pickOnce(bank, 20, mem, 1)
      for (const id of picked) {
        hits.set(id, (hits.get(id) || 0) + 1)
        markSongPlayed(mem, id)
      }
    }
    expect(Math.max(...hits.values())).toBeLessThan(games)
  })

  it('큰 은행에서도 특정 곡만 편애하지 않는다', () => {
    const bank = makeBank(311)
    const mem = emptyMemory()
    const hits = new Map<string, number>()
    for (let g = 0; g < 200; g += 1) {
      mem.gameSeq += 1
      for (const id of pickOnce(bank, 40, mem, 1)) {
        hits.set(id, (hits.get(id) || 0) + 1)
        markSongPlayed(mem, id)
      }
    }
    const counts = bank.map((id) => hits.get(id) || 0)
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    // 8000회 출제 / 311곡 ≈ 25.7회. 골고루 돌면 폭이 좁아야 한다.
    expect(Math.min(...counts)).toBeGreaterThan(mean * 0.5)
    expect(Math.max(...counts)).toBeLessThan(mean * 1.5)
  })
})
