import { z } from 'zod'
import { BANK_GENRES } from './genres.js'

/**
 * 소켓 페이로드 스키마.
 *
 * 이 파일이 생기기 전에는 핸들러가 payload를 타입 주석만 믿고 그대로 썼다.
 * 클라이언트는 무엇이든 보낼 수 있으므로 `{ code: 123 }` 한 방에
 * `payload.code.toUpperCase()` 가 터지고, index.ts의 uncaughtException 훅이
 * 프로세스를 내린다. 즉 아무나 서버를 끌 수 있었다.
 *
 * 원칙:
 *  - 모든 필드는 optional·nullable 을 명시하고, 모르는 키는 버린다(strip).
 *  - 길이·범위는 여기서 1차로 자르고, 도메인 규칙(clamp 등)은 핸들러에 남긴다.
 *  - 스키마가 실패하면 핸들러를 아예 호출하지 않는다.
 */

const shortId = z.string().trim().min(1).max(64)
const nickname = z.string().trim().min(1).max(64)

/** 장르별 출제 수. 알 수 없는 장르 키는 조용히 버린다. */
const genreCounts = z
  .record(z.string(), z.number().int().min(0).max(500))
  .transform((rec) => {
    const out: Record<string, number> = {}
    for (const g of BANK_GENRES) {
      if (typeof rec[g] === 'number') out[g] = rec[g]
    }
    return out
  })

const answerMode = z.enum(['title', 'title_artist'])
const gameMode = z.enum(['nomatch', 'reading'])

const roomSettingsFields = {
  genreCounts: genreCounts.optional(),
  maxPlayers: z.number().int().min(2).max(10).optional(),
  name: z.string().max(200).optional(),
  answerMode: answerMode.optional(),
  augmentsEnabled: z.boolean().optional(),
  gameMode: gameMode.optional(),
  readingTargetScore: z.number().int().min(1).max(1000).optional(),
  recentSongPenalty: z.number().int().min(0).max(10000).optional(),
  isPrivate: z.boolean().optional(),
}

export const S = {
  /** payload를 아예 안 보는 이벤트들 */
  none: z.unknown().optional().transform(() => ({}) as Record<string, never>),

  roomCreate: z.object({
    ...roomSettingsFields,
  }).strip(),

  roomSettings: z.object(roomSettingsFields).strip(),

  roomJoin: z.object({
    roomId: shortId.optional(),
    code: z.string().trim().min(1).max(16).optional(),
    asSpectator: z.boolean().optional(),
  }).strip(),

  setSpectator: z.object({ spectator: z.boolean().optional() }).strip(),

  chatColor: z.object({
    color: z.number().int().min(0).max(99).nullable().optional(),
  }).strip(),

  /** 길이 상한은 서버 cleanText가 다시 자르지만, 여기서 먼저 막아 로그·메모리를 아낀다 */
  text: z.object({ text: z.string().max(2000).optional() }).strip(),

  readingVote: z.object({ vote: z.enum(['yes', 'no']).optional() }).strip(),

  peckDone: z.object({ id: shortId.optional() }).strip(),

  offerDone: z.object({
    augmentId: shortId.optional(),
    gahoAugmentId: shortId.optional(),
  }).strip(),

  unplayable: z.object({
    index: z.number().int().min(0).max(10_000).optional(),
    code: z.number().int().optional(),
  }).strip(),

  augmentUse: z.object({
    /** 보유 2칸이 될 수 있으므로 어느 카드를 쓰는지 (없으면 쓸 수 있는 첫 장) */
    augmentId: shortId.optional(),
    targetUserId: shortId.optional(),
    targetUserIds: z.array(shortId).max(20).optional(),
    gahoAugmentId: shortId.optional(),
    genreName: z.string().trim().max(40).optional(),
  }).strip(),
} as const

export type RoomCreatePayload = z.infer<typeof S.roomCreate>
export type RoomSettingsPayload = z.infer<typeof S.roomSettings>
export type RoomJoinPayload = z.infer<typeof S.roomJoin>
export type AugmentUsePayload = z.infer<typeof S.augmentUse>
export { nickname }
