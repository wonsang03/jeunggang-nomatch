import { useState, useEffect, useRef, useCallback } from 'react'

/** 채팅 하단 고정 판정 여유 (px) */
export const CHAT_BOTTOM_EPS = 48

/**
 * 채팅 자동 스크롤.
 * - 맨 아래에 붙어 있으면 새 글·이미지 로딩으로 높이가 변해도 계속 따라 내려간다.
 * - 휠/드래그로 위로 올리는 순간에만 자동 스크롤을 멈춘다.
 *   (메시지 2개가 연달아 오면 높이가 먼저 늘어 nearBottom이 잠깐 false가 되는데,
 *    그걸 사용자 스크롤로 오인해 고정이 풀리던 문제를 막는다)
 * - 다시 맨 아래까지 내리면(또는 「최근 채팅으로」) 자동 스크롤을 재개한다.
 */
export function useStickyChatScroll(dep: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  /** 우리가 건 스크롤인지 (사용자 스크롤과 구분) */
  const autoRef = useRef(false)
  /** pin 세대 — 연속 pin 시 이전 rAF가 auto 플래그를 너무 빨리 끄는 것 방지 */
  const pinGenRef = useRef(0)
  /** 「최근 채팅으로」 직후 관성/잔여 휠로 다시 풀리는 것 방지 */
  const jumpGuardUntilRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const [stick, setStick] = useState(true)
  const [hasNew, setHasNew] = useState(false)

  const isNearBottom = useCallback((el: HTMLDivElement) => (
    el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_BOTTOM_EPS
  ), [])

  const pin = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const gen = ++pinGenRef.current
    autoRef.current = true
    el.scrollTop = el.scrollHeight
    lastScrollTopRef.current = el.scrollTop
    // 연달아 온 메시지·버튼 제거 등으로 높이가 한 박자 늦게 바뀌는 경우 재고정
    requestAnimationFrame(() => {
      if (gen !== pinGenRef.current) return
      const cur = scrollRef.current
      if (cur && stickRef.current) {
        cur.scrollTop = cur.scrollHeight
        lastScrollTopRef.current = cur.scrollTop
      }
      requestAnimationFrame(() => {
        if (gen !== pinGenRef.current) return
        const cur2 = scrollRef.current
        if (cur2 && stickRef.current) {
          cur2.scrollTop = cur2.scrollHeight
          lastScrollTopRef.current = cur2.scrollTop
        }
        autoRef.current = false
      })
    })
  }, [])

  const setStickBoth = useCallback((v: boolean) => {
    if (stickRef.current === v) return
    stickRef.current = v
    setStick(v)
  }, [])

  // 새 메시지
  useEffect(() => {
    if (stickRef.current) {
      pin()
      setHasNew(false)
    } else {
      setHasNew(true)
    }
  }, [dep, pin])

  // 아바타 로딩·줄바꿈 등으로 나중에 높이가 늘어도 하단 고정 유지
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) pin()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [pin])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop
    const prevTop = lastScrollTopRef.current
    lastScrollTopRef.current = top
    if (autoRef.current) return

    const nearBottom = isNearBottom(el)
    if (nearBottom) {
      setStickBoth(true)
      setHasNew(false)
      return
    }

    // 점프 직후 가드
    if (performance.now() < jumpGuardUntilRef.current) return

    // 사용자가 위로 스크롤한 경우에만 고정 해제.
    // 메시지 동시 도착으로 scrollHeight만 커진 경우(top 동일·증가)는 무시하고, 붙어 있으면 다시 붙인다.
    if (top < prevTop - 1) {
      setStickBoth(false)
      return
    }
    if (stickRef.current) pin()
  }, [isNearBottom, pin, setStickBoth])

  // 휠로 위로 올리는 순간 바로 끊음 (관성으로 도로 끌려 내려가는 것 방지)
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (performance.now() < jumpGuardUntilRef.current) return
    if (e.deltaY >= 0) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.clientHeight <= CHAT_BOTTOM_EPS) return
    // 맨 아래에 붙어 있을 때의 미세한 위쪽 휠·관성까지 «올렸다»로 치면
    // 가만히 있어도 자동 스크롤이 풀린다. 실제로 올라간 뒤에 끊는다.
    if (isNearBottom(el) && -e.deltaY < CHAT_BOTTOM_EPS) return
    setStickBoth(false)
  }, [isNearBottom, setStickBoth])

  const jumpToLatest = useCallback(() => {
    stickRef.current = true
    setStick(true)
    setHasNew(false)
    jumpGuardUntilRef.current = performance.now() + 450
    pin()
    window.setTimeout(() => {
      if (!stickRef.current) return
      pin()
    }, 40)
    window.setTimeout(() => {
      if (!stickRef.current) return
      pin()
    }, 120)
  }, [pin])

  return { scrollRef, contentRef, stick, hasNew, onScroll, onWheel, jumpToLatest }
}
