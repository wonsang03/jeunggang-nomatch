import { useState, useEffect, useRef } from 'react'
import { useGame } from '../GameContext'
import { serverNow } from '../clockSync'
import type { Screen } from './types'
import {
  AugmentNoPhoto,
  AugmentTargetBadge,
  Btn,
  C,
  crumpledPaper,
  F,
  prismBackdrop,
  PrismKeyframes,
  sk,
  tierBorderColor,
  tierDisplayName,
} from '../ui'
import { SyncStatus } from '../components/PingStatus'

export function AugmentScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user, room, augmentOffer, pickAugment, rerollAugment, fetchGahoCandidates } = useGame()
  const [timer, setTimer] = useState(20)
  const [selected, setSelected] = useState<string | null>(null)
  const [rerollsLeft, setRerollsLeft] = useState(1)
  const [candidates, setCandidates] = useState(augmentOffer?.candidates || [])
  const [gahoOpen, setGahoOpen] = useState(false)
  const [gahoBusy, setGahoBusy] = useState(false)
  const [gahoCandidates, setGahoCandidates] = useState<Array<{
    id: string
    name: string
    description?: string
    tier: string
    imageUrl?: string | null
  }>>([])
  const [selectedGahoId, setSelectedGahoId] = useState<string | null>(null)
  const selectedRef = useRef(selected)
  const selectedGahoIdRef = useRef<string | null>(null)
  const doneRef = useRef(false)
  selectedRef.current = selected
  selectedGahoIdRef.current = selectedGahoId

  useEffect(() => {
    if (room?.status === 'playing' || room?.status === 'revealing' || room?.status === 'countdown' || room?.status === 'duel') nav('game')
    if (room?.status === 'ended') nav('result')
    if (!room) nav('lobby')
  }, [room, nav])

  useEffect(() => {
    if (augmentOffer) {
      setCandidates(augmentOffer.candidates)
      setRerollsLeft(augmentOffer.rerolls)
      if (augmentOffer.endsAt) {
        setTimer(Math.max(0, Math.ceil((augmentOffer.endsAt - serverNow()) / 1000)))
      } else {
        setTimer(augmentOffer.timeoutSec)
      }
      // 가호 고르는 중이면 오퍼 갱신해도 창 유지
      if (!gahoOpen) {
        doneRef.current = false
        setGahoCandidates([])
      }
    }
  }, [augmentOffer, gahoOpen])

  useEffect(() => {
    if (augmentOffer?.candidates) setCandidates(augmentOffer.candidates)
  }, [augmentOffer?.candidates])

  useEffect(() => {
    const endsAt = augmentOffer?.endsAt
    const finalize = () => {
      if (doneRef.current) return
      // 프리즘 선택 중이면 타임아웃에도 랜덤 확정하되, 고른 가호가 있으면 그걸 보냄
      if (gahoOpen && selectedGahoIdRef.current) {
        doneRef.current = true
        pickAugment(selectedRef.current, selectedGahoIdRef.current)
        setGahoOpen(false)
        return
      }
      if (gahoOpen) {
        doneRef.current = true
        pickAugment(selectedRef.current)
        setGahoOpen(false)
        return
      }
      doneRef.current = true
      pickAugment(selectedRef.current)
      setGahoOpen(false)
    }
    const tick = () => {
      if (endsAt) {
        const left = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000))
        setTimer(left)
        if (left <= 0) finalize()
        return
      }
      setTimer((v) => {
        if (v <= 1) {
          finalize()
          return 0
        }
        return v - 1
      })
    }
    tick()
    const t = setInterval(tick, endsAt ? 250 : 1000)
    return () => clearInterval(t)
  }, [augmentOffer?.endsAt, pickAugment, gahoOpen])

  const onReroll = async () => {
    if (rerollsLeft <= 0 || gahoOpen) return
    await rerollAugment()
    setRerollsLeft(r => r - 1)
    setSelected(null)
  }

  const openGahoFromOffer = async (augmentId: string) => {
    setGahoBusy(true)
    setGahoOpen(true)
    setSelectedGahoId(null)
    try {
      const { candidates: list } = await fetchGahoCandidates()
      setGahoCandidates(list)
    } finally {
      setGahoBusy(false)
    }
    // augmentId는 selected로 유지
    setSelected(augmentId)
  }

  const confirm = () => {
    if (!selected || doneRef.current || gahoOpen) return
    const card = candidates.find((c) => c.id === selected)
    if (card?.effectType === 'gaho_select') {
      void openGahoFromOffer(selected)
      return
    }
    doneRef.current = true
    pickAugment(selected)
  }

  const confirmGaho = (gahoId: string) => {
    if (!selected || doneRef.current) return
    doneRef.current = true
    pickAugment(selected, gahoId)
    setGahoOpen(false)
    setSelectedGahoId(null)
  }

  return (
    <div style={{ minHeight: '100vh', ...crumpledPaper, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* 증강 BGM YouTube 제거: 방 노래 플레이어와 동시에 뜨면 다음 라운드 자동재생이 번갈아 깨짐 */}
      <div style={{ ...sk(), backgroundColor: C.card, padding: '36px 32px', maxWidth: 720, width: '100%', textAlign: 'center' }}>
        <div style={{ fontFamily: F.brand, fontSize: 42, fontWeight: 700, marginBottom: 8 }}>증강 선택</div>
        <div style={{ fontFamily: F.ui, fontSize: 18, color: C.muted, marginBottom: 8 }}>남은 시간 {timer}초 · 1개 보관</div>
        <SyncStatus />
        {augmentOffer?.lockedTier && (
          <div style={{
            display: 'inline-block',
            fontFamily: F.ui,
            fontSize: 15,
            fontWeight: 800,
            color: tierBorderColor(augmentOffer.lockedTier),
            border: `2px solid ${tierBorderColor(augmentOffer.lockedTier)}`,
            borderRadius: 6,
            padding: '4px 12px',
            marginBottom: 12,
            backgroundColor: C.card,
          }}>
            이번 등급 · {tierDisplayName(augmentOffer.lockedTier)}만
          </div>
        )}
        <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 22 }}>
          카드를 고른 뒤 보관 · 뱃지로 본인/상대 구분 · 설명은 카드 아래
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginBottom: 22,
        }}>
          {candidates.map(a => {
            const on = selected === a.id
            const tierC = tierBorderColor(a.tier)
            const borderC = on ? C.blue : tierC
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => !gahoOpen && setSelected(a.id)}
                style={{
                  ...sk(borderC),
                  backgroundColor: on ? C.blueLight : C.card,
                  padding: 12,
                  cursor: gahoOpen ? 'default' : 'pointer',
                  border: `2.5px solid ${borderC}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  opacity: gahoOpen && !on ? 0.55 : 1,
                  textAlign: 'center',
                  minWidth: 0,
                }}
              >
                <div style={{
                  width: '100%',
                  aspectRatio: '1',
                  ...sk(tierC, true),
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
                    <AugmentNoPhoto name={a.name} accent={tierC} />
                  )}
                </div>
                <div style={{
                  fontFamily: F.ui, fontSize: 12, fontWeight: 800,
                  color: tierC, letterSpacing: 0.3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap',
                }}>
                  {tierDisplayName(a.tier)}
                  <AugmentTargetBadge effectType={a.effectType} />
                </div>
                <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{a.name}</div>
                {a.description && (
                  <div style={{
                    fontFamily: F.ui,
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.body,
                    lineHeight: 1.45,
                    wordBreak: 'keep-all',
                    overflowWrap: 'anywhere',
                  }}>
                    {a.description}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Btn disabled={rerollsLeft <= 0 || gahoOpen} onClick={onReroll}>{rerollsLeft <= 0 ? '리롤 사용함' : `리롤 (${rerollsLeft}회)`}</Btn>
          <Btn variant="primary" size="lg" disabled={!selected || gahoOpen} onClick={confirm}>보관하기</Btn>
        </div>
      </div>

      {gahoOpen && (
        <div style={prismBackdrop}>
          <PrismKeyframes />
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: '-20%',
              background: 'linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.35) 50%, transparent 65%)',
              animation: 'prismShine 4.5s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />
          <div style={{
            ...sk(C.tierGaho),
            position: 'relative',
            backgroundColor: 'rgba(247,250,252,0.92)',
            padding: '28px 32px',
            maxWidth: 720,
            width: '100%',
            textAlign: 'center',
            boxShadow: `0 0 0 1px ${C.tierGaho}55, 0 12px 40px rgba(80,40,120,0.25)`,
          }}>
            <div style={{ fontFamily: F.brand, fontSize: 28, fontWeight: 700, marginBottom: 8, color: C.tierGaho }}>
              프리즘 선택
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 16, color: C.body, marginBottom: 6, fontWeight: 700 }}>
              남은 시간 {timer}초
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, marginBottom: 22 }}>
              3장 중 1개 · 리롤 없음 · 이름·사진만 (효과는 선택 후 확인) · 시간 종료 시 랜덤
            </div>
            {gahoBusy ? (
              <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted }}>불러오는 중…</div>
            ) : (
              <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 14,
                marginBottom: 18,
              }}>
                {gahoCandidates.map((g) => {
                  const tierC = C.tierGaho
                  const on = selectedGahoId === g.id
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGahoId(g.id)}
                      style={{
                        ...sk(on ? C.blue : tierC),
                        backgroundColor: on ? C.blueLight : C.card,
                        padding: 12,
                        cursor: 'pointer',
                        border: `2.5px solid ${on ? C.blue : tierC}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 8,
                        textAlign: 'center',
                        minWidth: 0,
                      }}
                    >
                      <div style={{
                        width: '100%',
                        aspectRatio: '1',
                        ...sk(tierC, true),
                        overflow: 'hidden',
                        backgroundColor: '#F2F0EB',
                      }}>
                        {g.imageUrl ? (
                          <img src={g.imageUrl} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <AugmentNoPhoto name={g.name} accent={tierC} />
                        )}
                      </div>
                      <div style={{ fontFamily: F.ui, fontSize: 12, fontWeight: 800, color: tierC }}>프리즘</div>
                      <div style={{ fontFamily: F.brand, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{g.name}</div>
                    </button>
                  )
                })}
                {gahoCandidates.length === 0 && (
                  <div style={{ fontFamily: F.ui, fontSize: 15, color: C.muted, gridColumn: '1 / -1', textAlign: 'center' }}>
                    선택 가능한 프리즘이 없습니다
                  </div>
                )}
              </div>
              <Btn
                variant="primary"
                size="lg"
                disabled={!selectedGahoId}
                onClick={() => selectedGahoId && confirmGaho(selectedGahoId)}
              >
                이 프리즘으로 보관
              </Btn>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
