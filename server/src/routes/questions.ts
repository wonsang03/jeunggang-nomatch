import { Router } from 'express'
import { z } from 'zod'
import type { Request } from 'express'
import { prisma } from '../config.js'
import { adminMiddleware, authMiddleware, type AuthUser } from '../auth.js'
import { GENRES } from '../genres.js'
import { extractYoutubeId, normalizeAnswer, parseAcceptList, expandArtistAccepts, splitDuoArtists } from '../answer.js'
import { normalizeSongTags, parseTagsJson, tagsToJson, SONG_TAGS } from '../tags.js'

export const questionRouter = Router()

questionRouter.get('/genres', async (_req, res) => {
  const genres = await prisma.genre.findMany({
    include: { _count: { select: { questions: true } } },
    orderBy: { name: 'asc' },
  })
  res.json({
    genres: genres.map((g) => ({ id: g.id, name: g.name, count: g._count.questions })),
  })
})

questionRouter.get('/tags', (_req, res) => {
  res.json({ tags: SONG_TAGS })
})

function mapQuestion(q: {
  id: string
  youtubeUrl: string
  startSec: number
  endSec: number
  tags?: string | null
  genre: { name: string }
  slots: Array<{ id: string; label: string; answer: string; acceptAnswers: string; hidden: boolean }>
}, isAdmin: boolean) {
  return {
    id: q.id,
    youtubeUrl: q.youtubeUrl,
    startSec: q.startSec,
    endSec: q.endSec,
    genre: q.genre.name,
    tags: parseTagsJson(q.tags),
    slots: q.slots.map((s) => ({
      id: s.id,
      label: s.label,
      ...(isAdmin
        ? {
            answer: s.answer,
            acceptAnswers: JSON.parse(s.acceptAnswers || '[]') as string[],
            hidden: s.hidden,
          }
        : { hidden: s.hidden }),
    })),
  }
}

questionRouter.get('/', authMiddleware, async (req, res) => {
  const isAdmin = !!(req as Request & { user: AuthUser }).user?.isAdmin
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10))
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
  const skip = (page - 1) * limit
  const q = String(req.query.q || '').trim()
  const genreName = String(req.query.genre || '').trim()
  const tag = String(req.query.tag || '').trim()

  const where: {
    enabled: boolean
    genre?: { name: string }
    tags?: { contains: string }
    OR?: Array<Record<string, unknown>>
  } = { enabled: true }

  if (genreName && (GENRES as readonly string[]).includes(genreName)) {
    where.genre = { name: genreName }
  }

  if (tag) {
    // JSON 배열 문자열 안 부분 매칭
    where.tags = { contains: tag }
  }

  if (q) {
    where.OR = [
      { youtubeUrl: { contains: q } },
      { slots: { some: { label: { contains: q } } } },
      { slots: { some: { answer: { contains: q } } } },
      { slots: { some: { acceptAnswers: { contains: q } } } },
    ]
  }

  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: { genre: true, slots: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.question.count({ where }),
  ])

  const pageCount = Math.max(1, Math.ceil(total / limit))
  res.json({
    total,
    page,
    limit,
    pageCount,
    questions: questions.map((item) => mapQuestion(item, isAdmin)),
  })
})

questionRouter.get('/augments', async (_req, res) => {
  const augments = await prisma.augment.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } })
  res.json({ augments })
})

questionRouter.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const id = req.params.id
  try {
    await prisma.question.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: '문제를 찾을 수 없습니다' })
  }
})

const createSchema = z.object({
  youtubeUrl: z.string().min(1),
  startSec: z.number().int().min(0),
  endSec: z.number().int().min(1),
  genreName: z.enum(GENRES),
  tags: z.array(z.string()).optional().default([]),
  slots: z.array(z.object({
    label: z.string().min(1),
    answer: z.string().min(1),
    // 배열 또는 "IU, 아이유" / "IU/아이유" 문자열
    acceptAnswers: z.union([z.array(z.string()), z.string()]).optional().default([]),
    hidden: z.boolean().optional().default(false),
  })).min(1).max(8),
})

function buildSlots(data: z.infer<typeof createSchema>) {
  if (data.endSec <= data.startSec) throw new Error('종료 시간이 시작보다 커야 합니다')

  const ytId = extractYoutubeId(data.youtubeUrl)
  if (!ytId) throw new Error('유튜브 URL에서 영상 ID를 찾을 수 없습니다')

  const hiddenCount = data.slots.filter((s) => s.hidden).length
  if (hiddenCount > 1) throw new Error('히든 문제는 문제당 1개만 넣을 수 있습니다')

  const slotsRaw = data.slots.map((s) => ({
    label: s.label.trim(),
    answer: s.answer.trim(),
    acceptAnswers: parseAcceptList(s.acceptAnswers),
    hidden: !!s.hidden,
  }))

  // 가수 슬롯 답에 공동 표기(쉼표 등)면 슬롯을 여러 개로 분리
  const slotsExpanded: typeof slotsRaw = []
  for (const s of slotsRaw) {
    if (!s.hidden && s.label.includes('가수')) {
      const parts = splitDuoArtists(s.answer)
      const isDuo = parts.length >= 2 && /[,，&＆×]| 와 | 과 |\band\b/i.test(s.answer)
      if (isDuo) {
        for (const part of parts) {
          const partAccepts = s.acceptAnswers.filter((a) => {
            const t = a.trim()
            if (!t || /[,，&＆]| 와 | 과 /i.test(t)) return false
            return normalizeAnswer(t) === normalizeAnswer(part) || t.includes(part) || part.includes(t)
          })
          slotsExpanded.push({
            label: '가수',
            answer: part,
            acceptAnswers: expandArtistAccepts(part, partAccepts),
            hidden: false,
          })
        }
        continue
      }
      slotsExpanded.push({
        ...s,
        acceptAnswers: expandArtistAccepts(s.answer, s.acceptAnswers),
      })
      continue
    }
    slotsExpanded.push({
      ...s,
      acceptAnswers: [...new Set([s.answer, ...s.acceptAnswers].map((x) => x.trim()).filter(Boolean))],
    })
  }

  const slots = slotsExpanded.map((s) => ({
    label: s.label,
    answer: s.answer,
    acceptAnswers: s.acceptAnswers,
    hidden: s.hidden,
  }))

  const seen = new Set<string>()
  for (const s of slots) {
    const slotNorms = new Set([s.answer, ...s.acceptAnswers].map(normalizeAnswer).filter(Boolean))
    for (const n of slotNorms) {
      if (seen.has(n)) {
        throw new Error(`같은 문제 안에서 정답/인정답이 겹칩니다: "${n}" (슬롯별로 다르게 적어주세요)`)
      }
      seen.add(n)
    }
  }

  return { ytId, slots, tagsJson: tagsToJson(normalizeSongTags(data.tags)) }
}

async function assertYoutubeUnique(ytId: string, excludeId?: string) {
  const existing = await prisma.question.findMany({
    where: { enabled: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, youtubeUrl: true },
  })
  const dup = existing.find((q) => extractYoutubeId(q.youtubeUrl) === ytId)
  if (dup) throw new Error('이미 등록된 유튜브 영상입니다')
}

async function createOneQuestion(data: z.infer<typeof createSchema>) {
  const { ytId, slots, tagsJson } = buildSlots(data)
  await assertYoutubeUnique(ytId)

  const genre = await prisma.genre.upsert({
    where: { name: data.genreName },
    update: {},
    create: { name: data.genreName },
  })
  return prisma.question.create({
    data: {
      youtubeUrl: data.youtubeUrl,
      startSec: data.startSec,
      endSec: data.endSec,
      genreId: genre.id,
      tags: tagsJson,
      slots: {
        create: slots.map((s, i) => ({
          label: s.label,
          answer: s.answer,
          acceptAnswers: JSON.stringify(s.acceptAnswers),
          hidden: s.hidden,
          sortOrder: i,
        })),
      },
    },
    include: { genre: true, slots: true },
  })
}

async function updateOneQuestion(id: string, data: z.infer<typeof createSchema>) {
  const existing = await prisma.question.findUnique({ where: { id } })
  if (!existing) throw new Error('문제를 찾을 수 없습니다')

  const { ytId, slots, tagsJson } = buildSlots(data)
  await assertYoutubeUnique(ytId, id)

  const genre = await prisma.genre.upsert({
    where: { name: data.genreName },
    update: {},
    create: { name: data.genreName },
  })

  await prisma.$transaction([
    prisma.answerSlot.deleteMany({ where: { questionId: id } }),
    prisma.question.update({
      where: { id },
      data: {
        youtubeUrl: data.youtubeUrl,
        startSec: data.startSec,
        endSec: data.endSec,
        genreId: genre.id,
        tags: tagsJson,
        slots: {
          create: slots.map((s, i) => ({
            label: s.label,
            answer: s.answer,
            acceptAnswers: JSON.stringify(s.acceptAnswers),
            hidden: s.hidden,
            sortOrder: i,
          })),
        },
      },
    }),
  ])

  return prisma.question.findUniqueOrThrow({
    where: { id },
    include: { genre: true, slots: { orderBy: { sortOrder: 'asc' } } },
  })
}

questionRouter.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: `입력값을 확인해주세요 (장르: ${GENRES.join(', ')})`,
      detail: parsed.error.flatten(),
    })
  }
  try {
    const question = await createOneQuestion(parsed.data)
    res.status(201).json({ question: mapQuestion(question, true) })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : '등록 실패' })
  }
})

questionRouter.patch('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      error: `입력값을 확인해주세요 (장르: ${GENRES.join(', ')})`,
      detail: parsed.error.flatten(),
    })
  }
  try {
    const question = await updateOneQuestion(req.params.id, parsed.data)
    res.json({ question: mapQuestion(question, true) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '수정 실패'
    res.status(msg.includes('찾을 수 없') ? 404 : 400).json({ error: msg })
  }
})

questionRouter.post('/bulk', authMiddleware, adminMiddleware, async (req, res) => {
  const bulkSchema = z.object({
    questions: z.array(createSchema).min(1).max(2000),
  })
  const parsed = bulkSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'JSON 형식을 확인해주세요 (최대 2000곡)', detail: parsed.error.flatten() })
  }

  let created = 0
  const errors: Array<{ index: number; error: string }> = []

  for (let i = 0; i < parsed.data.questions.length; i++) {
    try {
      await createOneQuestion(parsed.data.questions[i])
      created += 1
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : '실패' })
    }
  }

  res.status(201).json({ created, failed: errors.length, errors: errors.slice(0, 20) })
})
