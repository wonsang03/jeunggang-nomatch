/**
 * 증강 카탈로그(DB 캐시)와 증강 페이즈 후보 뽑기 · 전환/프리즘 선택 치환.
 */
import { prisma } from './config.js'
import type { Member, Room } from './gameTypes.js'
import { setHeldAugment } from './heldAugments.js'
import { parseEffectValue } from './roundRules.js'
import { shuffleArray, pickRandomIndex } from './random.js'

export type CachedAugment = {
  id: string
  name: string
  description: string
  effectType: string
  effectValue: string | null
  imageUrl: string | null
  tier: string
}

export function normalizeAugmentTier(raw: string | null | undefined): string {
  const t = (raw || '').trim().toLowerCase()
  if (!t) return 'bronze'
  if (t === 'prism' || t === '프리즘' || t === '가호' || t === 'gaho') return 'prism'
  return t
}

let augmentCache: { at: number; list: CachedAugment[] } | null = null
const AUGMENT_CACHE_MS = 60_000

export async function getEnabledAugments(): Promise<CachedAugment[]> {
  if (augmentCache && Date.now() - augmentCache.at < AUGMENT_CACHE_MS) {
    return augmentCache.list
  }
  const rows = await prisma.augment.findMany({ where: { enabled: true } })
  // DB 티어 표기 흔들림(대소문자·공백·'gaho')을 서버 로직 기준값으로 맞춘다.
  const list = rows.map((a) => ({ ...a, tier: normalizeAugmentTier(a.tier) }))
  augmentCache = { at: Date.now(), list }
  return list
}

/** 증강 페이즈 직전에 DB 최신값을 다시 읽게 캐시를 비운다 */
export function clearAugmentCache() {
  augmentCache = null
}

/** 선택 화면용 — 이름·사진·설명 포함 */
export function toOfferAugment(a: {
  id: string
  name: string
  description?: string
  effectType: string
  tier: string
  imageUrl?: string | null
}) {
  return {
    id: a.id,
    name: a.name,
    description: a.description || '',
    effectType: a.effectType,
    tier: a.tier,
    imageUrl: a.imageUrl || null,
  }
}

/** 프리즘 선택 후보 3장 */
export function ensureGahoPickCandidates(m: Member, list: CachedAugment[], count = 3) {
  const used = new Set(m.usedAugments || [])
  const unused = list.filter((a) => a.tier === 'prism' && !used.has(a.name))
  const pool = unused.length ? unused : list.filter((a) => a.tier === 'prism')
  if (!m.gahoPickIds || m.gahoPickIds.length === 0) {
    const picked: string[] = []
    const seenNames = new Set<string>()
    for (const a of shuffleArray(pool)) {
      if (seenNames.has(a.name)) continue
      seenNames.add(a.name)
      picked.push(a.id)
      if (picked.length >= count) break
    }
    m.gahoPickIds = picked
  }
  const byId = new Map(list.map((a) => [a.id, a]))
  const out = (m.gahoPickIds || [])
    .map((id) => byId.get(id))
    .filter((a): a is CachedAugment => !!a && a.tier === 'prism')
  // 삭제·비활성 등으로 비면 다시 뽑음
  if (out.length === 0 && pool.length) {
    m.gahoPickIds = null
    return ensureGahoPickCandidates(m, list, count)
  }
  return out.map(toOfferAugment)
}

// 테스트용 강제 오퍼 제거됨 — 일반 랜덤 티어 오퍼만 사용

export type OfferTier = 'bronze' | 'silver' | 'gold'

export function shouldOfferAugment(room: Room) {
  // 시작(index 0) 제외 · 20곡마다 (20, 40, …)
  return (
    room.augmentsEnabled !== false
    && room.index > 0
    && room.index % 20 === 0
    && room.lastAugmentAt !== room.index
  )
}

/** 브론즈·실버·골드 등급 추첨 확률 1:1:1 */
export function pickRandomOfferTier(
  list: Array<{ tier: string }>,
): OfferTier {
  const order: OfferTier[] = shuffleArray(['bronze', 'silver', 'gold'] as OfferTier[])
  for (const t of order) {
    if (list.some((a) => a.tier === t)) return t
  }
  return 'bronze'
}

/** 엄→준→식처럼 requires / 이미 획득한 조각 필터 */
export function isCollectPieceOfferable(
  a: { effectType: string; effectValue: string | null; name: string },
  collectedPieces: string[],
) {
  if (a.effectType !== 'collect_piece') return true
  const v = parseEffectValue(a.effectValue)
  const piece = String(v.piece || a.name)
  if (collectedPieces.includes(piece)) return false
  const requires = Array.isArray(v.requires) ? v.requires.map(String) : []
  return requires.every((r) => collectedPieces.includes(r))
}

export type OfferPickOpts = {
  /** 이번 페이즈에서 이미 뜬 카드 (리롤 제외) */
  excludeIds?: Iterable<string>
  /** 이미 사용한 증강 이름 (이번 판 재등장 금지) */
  excludeNames?: Iterable<string>
  /** 이 방에서 의미가 없는 effectType (제목만 방의 히든런 등) */
  excludeTypes?: Iterable<string>
}

/** 이 방 큐에 히든 슬롯이 하나라도 있는가 (제목만·리딩방은 없음) */
export function roomHasHiddenSlots(room: Room) {
  return room.queue.some((q) => q.slots.some((s) => s.hidden))
}

/**
 * 방 구성상 아무 효과도 못 내는 증강은 아예 안 띄운다.
 * 히든런은 「히든 ×3 · 일반 슬롯 0점」이라 히든이 없는 방에서 뽑으면
 * 3라운드 동안 득점이 완전히 막힌다.
 */
export function offerExcludedTypes(room: Room): string[] {
  return roomHasHiddenSlots(room) ? [] : ['hidden_run']
}

export function filterOfferPool<T extends {
  id: string
  name: string
  effectType: string
  effectValue: string | null
  tier: string
  imageUrl: string | null
}>(
  list: T[],
  collectedPieces: string[],
  lockedTier?: OfferTier | null,
  opts?: OfferPickOpts,
): T[] {
  const excludeIds = new Set(opts?.excludeIds || [])
  const excludeNames = new Set(opts?.excludeNames || [])
  const excludeTypes = new Set(opts?.excludeTypes || [])
  const base = list.filter(
    (a) => a.tier !== 'prism'
      && !excludeTypes.has(a.effectType)
      && isCollectPieceOfferable(a, collectedPieces),
  )
  let tierPool = lockedTier ? base.filter((a) => a.tier === lockedTier) : base
  if (tierPool.length === 0) tierPool = base

  // 1) 사용·이미본 둘 다 제외
  let pool = tierPool.filter((a) => !excludeIds.has(a.id) && !excludeNames.has(a.name))
  // 2) 모자라면 리롤 제외만 풀고, 사용 증강은 유지
  if (pool.length === 0) {
    pool = tierPool.filter((a) => !excludeNames.has(a.name))
  }
  // 3) 그래도 없으면(전부 사용) 티어 풀 전체
  if (pool.length === 0) pool = tierPool
  return pool
}

/**
 * 후보 3장: 해당 등급 풀에서 균등 랜덤 (이름/id 중복 방지 · 계열 필터 없음).
 * 여기에 더해 **방 안에서 서로 겹치지 않게** 나눠준다.
 *
 * 플레이어마다 유효 풀이 다르므로(엄준식 조각·이미 쓴 증강·히든 없는 방의 히든런)
 * 덱 하나를 그대로 잘라 나눠줄 수는 없다. 대신 이번 페이즈에 이미 나간 카드를
 * `dealt` 로 들고 다니면서, 각자 자기 풀에서 **아직 안 나간 카드부터** 채우고
 * 모자랄 때만 이미 나간 카드로 메운다.
 *
 * 카드 하나를 받을 확률은 기존과 같다(풀 안에서 균등). 서로 안 겹친다는 조건만 붙는다.
 * 8인방 브론즈처럼 필요 장수(24)가 풀(16)보다 크면 일부는 어쩔 수 없이 겹친다.
 */
export function pickOfferCandidatesRoomUnique(
  list: Array<{
    id: string
    name: string
    effectType: string
    effectValue: string | null
    tier: string
    imageUrl: string | null
  }>,
  collectedPieces: string[],
  count: number,
  lockedTier: OfferTier | null | undefined,
  opts: OfferPickOpts | undefined,
  dealt: Set<string>,
) {
  const pool = filterOfferPool(list, collectedPieces, lockedTier, opts)
  // 아직 아무에게도 안 나간 카드를 먼저, 그 다음 이미 나간 카드
  const fresh = shuffleArray(pool.filter((a) => !dealt.has(a.id)))
  const reused = shuffleArray(pool.filter((a) => dealt.has(a.id)))
  const picked: typeof pool = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const a of [...fresh, ...reused]) {
    if (picked.length >= count) break
    if (seenIds.has(a.id) || seenNames.has(a.name)) continue
    seenIds.add(a.id)
    seenNames.add(a.name)
    picked.push(a)
  }
  for (const a of picked) dealt.add(a.id)
  return shuffleArray(picked).map(toOfferAugment)
}

export function pickRandomFromOfferPool<T extends {
  id: string
  name: string
  effectType: string
  effectValue: string | null
  imageUrl: string | null
  tier: string
}>(
  list: T[],
  collectedPieces: string[],
  lockedTier?: OfferTier | null,
  opts?: OfferPickOpts,
): T | undefined {
  const pool = filterOfferPool(list, collectedPieces, lockedTier, opts)
  if (pool.length) return pool[pickRandomIndex(pool.length)]
  const nonGaho = list.filter((a) => a.tier !== 'prism')
  if (nonGaho.length) return nonGaho[pickRandomIndex(nonGaho.length)]
  if (!list.length) return undefined
  return list[pickRandomIndex(list.length)]
}

/** 오퍼에 띄운 후보 id를 이번 페이즈 시야·현재 화면에 기록 */
export function rememberOfferSeen(m: Member, candidates: Array<{ id: string }>) {
  const set = new Set(m.offerSeenAugmentIds)
  for (const c of candidates) set.add(c.id)
  m.offerSeenAugmentIds = [...set]
  m.lastOfferCandidateIds = candidates.map((c) => c.id)
}

/** 전환: 상위 등급 중 랜덤 1장 */
export function pickTierUpgradeTarget(
  list: CachedAugment[],
  aug: { effectType: string; effectValue: string | null; tier: string },
  excludeNames?: Iterable<string>,
): CachedAugment | null {
  const value = parseEffectValue(aug.effectValue)
  const rawTiers = Array.isArray(value.higherTiers) ? value.higherTiers.map(String) : []
  const higherTiers = rawTiers.length
    ? rawTiers
    : (aug.tier === 'bronze' ? ['silver'] : ['gold'])
  const used = new Set(excludeNames || [])
  const pool = list.filter(
    (a) =>
      higherTiers.includes(a.tier)
      && a.effectType !== 'tier_upgrade'
      && a.effectType !== 'chaos_cast'
      && a.effectType !== 'gaho_select'
      && a.tier !== 'prism'
      && !used.has(a.name),
  )
  const fallback = list.filter(
    (a) =>
      higherTiers.includes(a.tier)
      && a.effectType !== 'tier_upgrade'
      && a.effectType !== 'chaos_cast'
      && a.effectType !== 'gaho_select'
      && a.tier !== 'prism',
  )
  const finalPool = pool.length ? pool : fallback
  if (!finalPool.length) return null
  return finalPool[pickRandomIndex(finalPool.length)]
}

/** 증강 선택 확정 시 전환·프리즘 선택은 즉시 실제 카드로 치환해 보관 */
export function assignHeldFromOfferPick(
  m: Member,
  list: CachedAugment[],
  aug: CachedAugment,
  gahoAugmentId?: string,
) {
  if (aug.effectType === 'tier_upgrade') {
    const pick = pickTierUpgradeTarget(list, aug, m.usedAugments)
    setHeldAugment(m, pick || aug)
    return
  }
  if (aug.effectType === 'gaho_select') {
    const used = new Set(m.usedAugments)
    const gahos = list.filter((a) => a.tier === 'prism' && !used.has(a.name))
    const allGahos = list.filter((a) => a.tier === 'prism')
    const pool = gahos.length ? gahos : allGahos
    const locked = (m.gahoPickIds || [])
      .map((id) => list.find((a) => a.id === id && a.tier === 'prism'))
      .filter((a): a is CachedAugment => !!a)
    const pickPool = locked.length ? locked : pool
    const pick = gahoAugmentId
      ? pickPool.find((a) => a.id === gahoAugmentId)
        || (locked.length ? undefined : allGahos.find((a) => a.id === gahoAugmentId))
      : pickPool[pickRandomIndex(pickPool.length)]
    setHeldAugment(m, pick || aug)
    m.gahoPickIds = null
    return
  }
  setHeldAugment(m, aug)
}
