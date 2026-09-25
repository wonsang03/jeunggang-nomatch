/** 플레이어 보유 증강 슬롯 (최대 2칸 · 잠긴 카드 포함) */
import type { HeldAugment, Member } from './gameTypes.js'

/**
 * 보유 슬롯은 최대 2칸.
 * 증강 선택은 «빈손일 때만» 받으므로 평소엔 0~1장이고,
 * 2칸이 차는 건 혼돈(2장 보관)과 인수인계(남이 떠넘긴 잠긴 카드)뿐이다.
 */
export const MAX_HELD_AUGMENTS = 2

export type HeldSource = {
  id: string
  name: string
  description: string
  effectType?: string
  effectValue?: string | null
  imageUrl?: string | null
  tier?: string | null
}

export function heldList(m: Member): HeldAugment[] {
  if (!Array.isArray(m.heldAugments)) m.heldAugments = []
  return m.heldAugments
}

export function heldCount(m: Member) {
  return heldList(m).length
}

/** 지금 쓸 수 있는 카드 — 인수인계로 떠넘겨진 잠긴 카드는 빠진다 */
export function usableHeld(m: Member) {
  return heldList(m).filter((h) => !h.locked)
}

export function findHeldById(m: Member, id: string | null | undefined) {
  if (!id) return null
  return heldList(m).find((h) => h.id === id) || null
}

export function findHeldByName(m: Member, name: string) {
  return heldList(m).find((h) => h.name === name) || null
}

/** 보유 중인 해당 효과 카드 (잠긴 건 제외) — 반사·차차차처럼 «들고만 있어도» 도는 것들 */
export function findHeldByType(m: Member | null | undefined, effectType: string) {
  if (!m) return null
  return heldList(m).find((h) => !h.locked && h.effectType === effectType) || null
}

export function hasHeldSpace(m: Member) {
  return heldCount(m) < MAX_HELD_AUGMENTS
}

export function toHeldAugment(aug: HeldSource, opts?: { locked?: boolean; lockedByNickname?: string }): HeldAugment {
  return {
    id: aug.id,
    name: aug.name,
    description: aug.description,
    imageUrl: aug.imageUrl || null,
    effectType: aug.effectType || null,
    effectValue: aug.effectValue ?? null,
    tier: aug.tier || null,
    locked: !!opts?.locked,
    lockedByNickname: opts?.locked ? (opts.lockedByNickname || null) : null,
  }
}

/** 빈 칸에 한 장 넣는다. 칸이 없으면 false */
export function addHeldAugment(
  m: Member,
  aug: HeldSource | null | undefined,
  opts?: { locked?: boolean; lockedByNickname?: string },
) {
  if (!aug || !hasHeldSpace(m)) return false
  heldList(m).push(toHeldAugment(aug, opts))
  return true
}

export function removeHeldById(m: Member, id: string | null | undefined) {
  if (!id) return false
  const list = heldList(m)
  const i = list.findIndex((h) => h.id === id)
  if (i < 0) return false
  list.splice(i, 1)
  if (!list.length) m.gahoPickIds = null
  return true
}

export function clearHeldAugment(m: Member) {
  m.heldAugments = []
  m.gahoPickIds = null
}

/**
 * 한 장짜리 보관으로 맞춘다 (증강 선택 배정·전환·프리즘 선택 치환).
 * 잠긴 카드는 남의 것이므로 건드리지 않는다.
 */
export function setHeldAugment(m: Member, aug: HeldSource | null | undefined) {
  const locked = heldList(m).filter((h) => h.locked)
  m.heldAugments = aug ? [...locked, toHeldAugment(aug)] : locked
  if (!m.heldAugments.length) m.gahoPickIds = null
}
