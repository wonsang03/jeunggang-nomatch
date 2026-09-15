import { randomInt } from 'node:crypto'

/**
 * 곡 뽑기 가중치 — 방 상태를 건드리지 않는 순수 함수들.
 *
 * 예전엔 "최근에 나온 곡은 후보에서 아예 뺀다"였는데, 은행이 작은 장르에서 그게 깨졌다.
 * 게임(59곡)·버튜버(55곡)처럼 작은 은행은 서너 판이면 은행 전체가 최근곡이 돼서
 * 뺄 게 하나도 안 남는다 → 매판 전체 균등 추첨 → 설정을 켜나 끄나 똑같아졌다.
 * 반대로 큰 장르와 섞어 돌리면 작은 장르의 "안 나온 곡"이 출제 수보다 적어져서
 * 그 곡들이 매판 확률 1로 나왔다 (= 순번제).
 *
 * 그래서 제외 대신 가중치로 간다. 최근에 나온 곡도 확률이 0은 아니라서 후보가
 * 마르지 않고, 기억 기간을 은행 크기에 맞추므로 은행이 커도 작아도 같은 규칙이 돈다.
 */

/** 이 방에서 곡이 마지막으로 나온 판 번호 */
export type SongMemory = {
  /** questionId → 그 곡이 마지막으로 나온 gameSeq */
  songLastPlayed: Map<string, number>
  /** 이 방에서 시작한 판 번호. 판을 시작할 때마다 +1 */
  gameSeq: number
}

/** 기억 기간(판) 하한 — 은행이 아무리 작아도 직전 판은 눌러야 한다 */
const MIN_WINDOW = 2
/** 기억 기간(판) 상한 — 이보다 오래된 곡은 "한 번도 안 나온 곡"과 같게 친다 */
export const MAX_WINDOW = 10
/** 방금 나온 곡의 최소 가중치 — 한 번도 안 나온 곡의 1/50 (0이 아니라서 후보가 안 마른다) */
const MIN_WEIGHT_RATIO = 0.02
/** 최근일수록 가파르게 눌리도록 (1이면 선형, 클수록 최근 곡만 집중적으로 눌림) */
const RECENCY_EXP = 3

/**
 * 기억 기간 = 이 장르 은행을 한 바퀴 도는 데 걸리는 판 수.
 *
 * 게임 20곡/은행 59 → 3판, 한국 40곡/은행 311 → 8판.
 * 은행 대비 출제 수가 많을수록 짧아지는 게 맞다. 곡이 몇 개 없는데 오래 기억하면
 * 누를 곡만 남고 뽑을 곡이 없어진다 (= 예전 하드 제외가 깨진 지점).
 */
export function memoryWindow(bankSize: number, count: number) {
  if (count <= 0) return MIN_WINDOW
  const cycle = Math.ceil(Math.max(0, bankSize) / count)
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, cycle))
}

/**
 * 이 곡을 뽑을 상대 가중치.
 *
 * penalty 0 이면 전부 1 — 균등 추첨(설정 OFF)과 분포가 완전히 같다.
 * penalty 1 이면 방금 나온 곡이 한 번도 안 나온 곡의 1/50.
 */
export function songWeight(mem: SongMemory, questionId: string, window: number, penalty: number) {
  if (penalty <= 0) return 1
  const last = mem.songLastPlayed.get(questionId)
  // 한 번도 안 나온 곡은 age = Infinity → recency 1 (가장 잘 나온다)
  const age = last === undefined ? Infinity : mem.gameSeq - last
  /** 0 = 방금 나옴, 1 = 충분히 오래됐거나 처음 */
  const recency = Math.min(1, age / Math.max(1, window))
  const soft = MIN_WEIGHT_RATIO + (1 - MIN_WEIGHT_RATIO) * recency ** RECENCY_EXP
  return (1 - penalty) + penalty * soft
}

/** 이 곡이 이번 판에 나왔다고 기록 — 큐에 들어간 시점이 아니라 실제로 틀 때 부른다 */
export function markSongPlayed(mem: SongMemory, questionId: string) {
  mem.songLastPlayed.set(questionId, mem.gameSeq)
}

/**
 * MAX_WINDOW 를 넘게 오래된 기록은 가중치가 1로 포화돼 "안 나온 곡"과 구별되지 않는다.
 * 들고 있어봐야 뽑기 결과가 안 바뀌므로 버려서 방이 오래 살아도 메모리가 안 는다.
 */
export function pruneSongMemory(mem: SongMemory) {
  for (const [id, seq] of mem.songLastPlayed) {
    if (mem.gameSeq - seq > MAX_WINDOW + 2) mem.songLastPlayed.delete(id)
  }
}

/** CSPRNG 균등 난수 (0, 1) — 0과 1은 키 계산에서 터지므로 뺀다 */
function u01() {
  return (randomInt(2 ** 48 - 1) + 1) / 2 ** 48
}

/**
 * 가중 셔플 — 가중치가 큰 항목이 앞에 올 확률이 높은 임의 순열.
 *
 * Efraimidis–Spirakis: 각 항목에 키 u^(1/w) 를 매기고 내림차순으로 세우면
 * 앞에서부터 k개를 떼는 것이 곧 가중 비복원 추출이 된다. u^(1/w) 는 w가 작을 때
 * 언더플로로 0이 뭉개지므로, 순서가 같은 log(u)/w 로 비교한다.
 *
 * 가중치가 전부 같으면 균등 셔플(Fisher–Yates)과 분포가 같다.
 */
export function weightedShuffle<T>(list: readonly T[], weightOf: (item: T) => number): T[] {
  const keyed = list.map((item) => ({
    item,
    // w 가 0이면 -Infinity(= 영구 제외)가 되므로 바닥을 깐다. 제외는 이 모듈의 정책이 아니다.
    key: Math.log(u01()) / Math.max(weightOf(item), 1e-6),
  }))
  keyed.sort((a, b) => b.key - a.key)
  return keyed.map((k) => k.item)
}
