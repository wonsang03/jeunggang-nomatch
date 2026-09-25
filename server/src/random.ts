/** 암호학적 난수 기반 섞기·뽑기 (Math.random 은 예측 가능해서 쓰지 않는다) */
import { randomInt } from 'node:crypto'

/** CSPRNG Fisher–Yates */
export function shuffleArray<T>(arr: T[] | Iterable<T> | null | undefined): T[] {
  const a = [...(arr ?? [])]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

export function pickRandomIndex(length: number) {
  if (length <= 0) return 0
  return randomInt(length)
}
