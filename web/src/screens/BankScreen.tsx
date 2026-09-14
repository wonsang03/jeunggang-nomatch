// 관리자 문제은행 (등록·수정·미리듣기).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from '../GameContext'
import { api } from '../api'
import { BANK_GENRES, YACHA_GENRE } from '../genres'
import type { BankGenreName } from '../genres'
import { normalizeSongTags } from '../tags'
import { loadYtApi, ytId } from '../youtubePlayer'
import type { YtPlayer } from '../youtubePlayer'
import { Btn, C, F, Field, NoteCard, SketchInput, Tag, notebookLines, sk } from '../ui'
import type { Screen } from './types'

export type BankSlotDraft = { label: string; answer: string; accepts: string; hidden: boolean }
export type BankQuestion = {
  id: string
  youtubeUrl: string
  startSec: number
  endSec: number
  genre: string
  tags: string[]
  slots: Array<{ id: string; label: string; answer?: string; acceptAnswers?: string[]; hidden?: boolean }>
}

export function BankSegmentPreview({
  url,
  startSec,
  endSec,
  volume = 70,
  onClose,
  title,
}: {
  url: string
  startSec: number
  endSec: number
  volume?: number
  onClose: () => void
  title?: string
}) {
  const id = ytId(url)
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const start = Math.max(0, Math.floor(startSec))
  const end = Math.max(start + 1, Math.floor(endSec))
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id || !hostRef.current) return
    let cancelled = false
    let player: YtPlayer | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    ;(async () => {
      await loadYtApi()
      if (cancelled || !hostRef.current || !window.YT) return
      hostRef.current.innerHTML = ''
      const mount = document.createElement('div')
      hostRef.current.appendChild(mount)
      const https = window.location.protocol === 'https:'
      player = new window.YT.Player(mount, {
        videoId: id,
        width: 276,
        height: 155,
        playerVars: {
          autoplay: 1,
          mute: 1,
          start,
          // end 는 API에 안 넣고 폴링으로 컷 (http 임베드 오류 줄임)
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          ...(https ? { origin: window.location.origin } : {}),
        },
        events: {
          onReady: (e) => {
            if (cancelled) return
            playerRef.current = e.target
            try {
              e.target.seekTo(start, true)
              e.target.setVolume(Math.max(0, Math.min(100, volume)))
              e.target.mute()
              e.target.playVideo()
              e.target.unMute()
              e.target.setVolume(Math.max(0, Math.min(100, volume)))
            } catch { /* ignore */ }
            poll = setInterval(() => {
              try {
                const t = e.target.getCurrentTime?.() ?? 0
                if (t >= end - 0.15) {
                  e.target.pauseVideo()
                  if (poll) clearInterval(poll)
                }
              } catch { /* ignore */ }
            }, 200)
          },
          onError: (e) => {
            if (cancelled) return
            if (e.data === 101 || e.data === 150 || e.data === 153) {
              setErr('이 영상은 외부 재생이 막혀 있습니다. 유튜브 링크를 바꿔주세요')
            } else {
              setErr('미리듣기를 재생할 수 없습니다')
            }
          },
        },
      })
    })()

    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try { player?.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
  }, [id, start, end, volume])

  if (!id) {
    return (
      <div style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 90,
        ...sk(C.red, true), backgroundColor: C.card, padding: 12, maxWidth: 320,
      }}>
        <div style={{ fontFamily: F.ui, color: C.red }}>유효한 유튜브 URL이 아닙니다</div>
        <div style={{ marginTop: 8 }}>
          <Btn size="sm" onClick={onClose}>닫기</Btn>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed',
      right: 16,
      bottom: 16,
      zIndex: 90,
      ...sk(C.blue, true),
      backgroundColor: C.card,
      padding: 12,
      width: 300,
      boxShadow: `0 8px 0 ${C.graphite}40`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 13, color: C.blue, flex: 1, lineHeight: 1.35 }}>
          미리듣기 {title ? `· ${title}` : ''}
          <div style={{ fontWeight: 700, color: C.muted, fontSize: 12 }}>{start}s ~ {end}s</div>
        </div>
        <Btn size="sm" onClick={onClose}>정지</Btn>
      </div>
      {err && <div style={{ fontFamily: F.ui, color: C.red, marginBottom: 8, fontSize: 13 }}>{err}</div>}
      <div ref={hostRef} style={{ borderRadius: 8, overflow: 'hidden', width: 276, height: 155 }} />
    </div>
  )
}

export function BankScreen({ nav }: { nav: (s: Screen) => void }) {
  const { user } = useGame()
  const PAGE_SIZE = 10
  const [list, setList] = useState<BankQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [genres, setGenres] = useState<Array<{ name: string; count: number }>>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [startSec, setStartSec] = useState('30')
  const [endSec, setEndSec] = useState('70')
  const [genreName, setGenreName] = useState<BankGenreName>('한국노래')
  const [formTags, setFormTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [slots, setSlots] = useState<BankSlotDraft[]>([
    { label: '노래 제목', answer: '', accepts: '', hidden: false },
    { label: '가수', answer: '', accepts: '', hidden: false },
  ])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [filterGenre, setFilterGenre] = useState<BankGenreName | ''>('')
  const [filterTag, setFilterTag] = useState('')
  const [filterTagInput, setFilterTagInput] = useState('')
  const [filterHidden, setFilterHidden] = useState<'all' | 'yes' | 'no'>('all')
  const [bulkJson, setBulkJson] = useState('')
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [clipPreview, setClipPreview] = useState<{ url: string; startSec: number; endSec: number; title?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const listTopRef = useRef<HTMLDivElement>(null)

  const parseAccepts = (raw: string) =>
    [...new Set(raw.split(/[,，、/|]+/).map(x => x.trim()).filter(Boolean))]

  const defaultTitleLabel = (genre: BankGenreName) => {
    if (genre === '애니') return '애니 제목'
    if (genre === '한국노래' || genre === '일본노래' || genre === '해외노래' || genre === '버튜버') return '노래 제목'
    return '제목'
  }

  const emptySlots = (genre: BankGenreName = genreName): BankSlotDraft[] => [
    { label: defaultTitleLabel(genre), answer: '', accepts: '', hidden: false },
    { label: '가수', answer: '', accepts: '', hidden: false },
  ]

  const resetForm = () => {
    setEditingId(null)
    setYoutubeUrl('')
    setStartSec('30')
    setEndSec('70')
    setGenreName('한국노래')
    setFormTags([])
    setTagInput('')
    setSlots(emptySlots('한국노래'))
  }

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(page),
      })
      if (searchQ.trim()) params.set('q', searchQ.trim())
      if (filterGenre) params.set('genre', filterGenre)
      if (filterTag) params.set('tag', filterTag)
      if (filterHidden === 'yes') params.set('hidden', 'yes')
      if (filterHidden === 'no') params.set('hidden', 'no')
      const [q, g] = await Promise.all([
        api<{ questions: BankQuestion[]; total: number; page: number; pageCount: number }>(`/api/questions?${params}`),
        api<{ genres: Array<{ name: string; count: number }> }>('/api/questions/genres'),
      ])
      setList(q.questions)
      setTotal(q.total)
      const pc = Math.max(1, q.pageCount || 1)
      setPageCount(pc)
      if (page > pc) setPage(pc)
      setGenres(g.genres)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '목록 불러오기 실패')
    }
  }, [searchQ, filterGenre, filterTag, filterHidden, page])

  useEffect(() => {
    if (!user?.isAdmin) { nav('lobby'); return }
    load()
  }, [user, nav, load])

  useEffect(() => {
    setPage(1)
  }, [searchQ, filterGenre, filterTag, filterHidden])

  const goPage = (p: number) => {
    const next = Math.max(1, Math.min(pageCount, p))
    setPage(next)
    setTimeout(() => listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40)
  }

  const pageItems = (() => {
    const totalPages = pageCount
    if (totalPages <= 9) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const items: Array<number | '…'> = []
    const push = (x: number | '…') => {
      if (items[items.length - 1] !== x) items.push(x)
    }
    push(1)
    const start = Math.max(2, page - 2)
    const end = Math.min(totalPages - 1, page + 2)
    if (start > 2) push('…')
    for (let i = start; i <= end; i += 1) push(i)
    if (end < totalPages - 1) push('…')
    push(totalPages)
    return items
  })()

  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(total, page * PAGE_SIZE)

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

  const genreBtn = (_g: string, selected: boolean) => ({
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
    setGenreName((BANK_GENRES.includes(q.genre as BankGenreName) ? q.genre : YACHA_GENRE) as BankGenreName)
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
            <strong>{BANK_GENRES.join(', ')}</strong> 중 하나여야 합니다. (<code>{YACHA_GENRE}</code>는 야차룰 전용 · 일반전에 안 나옴)
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
          <div style={{ marginBottom: 14 }}>
            <Btn
              size="sm"
              variant="primary"
              disabled={!youtubeUrl.trim()}
              onClick={() => {
                const start = Number(startSec)
                const end = Number(endSec)
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
                  setErr('구간(초)을 확인하세요')
                  return
                }
                setErr('')
                setClipPreview({
                  url: youtubeUrl.trim(),
                  startSec: start,
                  endSec: end,
                  title: slots[0]?.answer || '폼 구간',
                })
              }}
            >
              미리듣기
            </Btn>
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 8 }}>장르</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {BANK_GENRES.map(g => (
              <button key={g} type="button" style={genreBtn(g, genreName === g)} onClick={() => {
                setGenreName(g)
                setSlots(prev => {
                  if (prev.length === 0) return emptySlots(g)
                  const next = [...prev]
                  const first = next[0]
                  if (first && !first.hidden && (first.label === '제목' || first.label === '노래 제목' || first.label === '애니 제목')) {
                    next[0] = { ...first, label: defaultTitleLabel(g) }
                  }
                  return next
                })
              }}>{g}</button>
            ))}
          </div>
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 8 }}>태그</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SketchInput
              value={tagInput}
              onChange={setTagInput}
              placeholder="예: 남돌, 10년대, 드라마…"
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
                    {s.hidden ? '히든 문제' : `슬롯 ${i + 1}`} · 맞히면 {s.hidden ? '+3점' : '+1점'}
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
          <div ref={listTopRef} style={{ fontFamily: F.ui, fontSize: 18, fontWeight: 900, marginBottom: 12 }}>
            등록 목록 ({rangeFrom}-{rangeTo} / 총 {total}곡)
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
            {(searchQ || filterGenre || filterTag || filterHidden !== 'all') && (
              <Btn
                size="sm"
                onClick={() => {
                  setSearchInput('')
                  setSearchQ('')
                  setFilterGenre('')
                  setFilterTag('')
                  setFilterTagInput('')
                  setFilterHidden('all')
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
              style={genreBtn('한국노래', filterGenre === '')}
              onClick={() => setFilterGenre('')}
            >
              전체 장르
            </button>
            {BANK_GENRES.map(g => (
              <button
                key={g}
                type="button"
                style={genreBtn(g, filterGenre === g)}
                onClick={() => setFilterGenre(g)}
              >
                {g}{g === YACHA_GENRE ? ' (야차)' : ''}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginRight: 4 }}>히든</span>
            {([
              ['all', '전체'],
              ['yes', '히든 있음'],
              ['no', '히든 없음'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                style={genreBtn(k, filterHidden === k)}
                onClick={() => setFilterHidden(k)}
              >
                {label}
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
          {(searchQ || filterGenre || filterTag || filterHidden !== 'all') && (
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 10 }}>
              {[
                searchQ ? `검색어: "${searchQ}"` : '',
                filterGenre ? `장르: ${filterGenre}` : '',
                filterTag ? `태그: ${filterTag}` : '',
                filterHidden === 'yes' ? '히든: 있음' : filterHidden === 'no' ? '히든: 없음' : '',
              ].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.length === 0 && (
              <div style={{ fontFamily: F.ui, color: C.muted, textAlign: 'center', padding: 20 }}>
                {searchQ || filterGenre || filterTag || filterHidden !== 'all' ? '검색 결과가 없습니다' : '아직 문제가 없습니다'}
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
                  <Btn
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      const title = q.slots.find(s => s.label.includes('제목'))?.answer || q.slots[0]?.answer
                      setClipPreview({
                        url: q.youtubeUrl,
                        startSec: q.startSec,
                        endSec: q.endSec,
                        title,
                      })
                    }}
                    disabled={busy}
                  >
                    미리듣기
                  </Btn>
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

          {pageCount > 1 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center',
              alignItems: 'center', marginTop: 16, paddingTop: 12,
              borderTop: `2px dashed ${C.line}`,
            }}>
              <Btn size="sm" disabled={page <= 1 || busy} onClick={() => goPage(page - 1)}>이전</Btn>
              {pageItems.map((item, idx) => (
                item === '…' ? (
                  <span key={`e-${idx}`} style={{ fontFamily: F.ui, fontSize: 14, color: C.muted, padding: '0 4px' }}>…</span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    disabled={busy}
                    onClick={() => goPage(item)}
                    style={{
                      ...sk(item === page ? C.blue : C.graphite, true),
                      backgroundColor: item === page ? C.blueLight : C.card,
                      color: item === page ? C.blue : C.body,
                      fontFamily: F.ui,
                      fontSize: 14,
                      fontWeight: 800,
                      minWidth: 34,
                      padding: '6px 10px',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {item}
                  </button>
                )
              ))}
              <Btn size="sm" disabled={page >= pageCount || busy} onClick={() => goPage(page + 1)}>다음</Btn>
              <span style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginLeft: 6 }}>
                {page} / {pageCount} 페이지
              </span>
            </div>
          )}
        </NoteCard>
      </div>
      {clipPreview && (
        <BankSegmentPreview
          url={clipPreview.url}
          startSec={clipPreview.startSec}
          endSec={clipPreview.endSec}
          title={clipPreview.title}
          volume={user?.musicVolume ?? 70}
          onClose={() => setClipPreview(null)}
        />
      )}
    </div>
  )
}
