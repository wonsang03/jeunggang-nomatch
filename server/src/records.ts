import { prisma } from './config.js'

/**
 * 한 판의 결과를 DB에 남긴다.
 *
 * 이 파일이 생기기 전에는 게임이 끝나도 아무것도 저장되지 않았다.
 * 결과는 game:end 소켓 payload 로 한 번 지나가고 끝이라, 창을 닫으면 사라졌다.
 * (스키마에 Score 모델이 있었지만 어디에서도 쓰이지 않았다)
 */

export type FinishedEntry = {
  userId: string
  nickname: string
  score: number
}

export type FinishedGame = {
  roomName: string
  gameMode: string
  answerMode: string
  totalRounds: number
  /** 점수 내림차순일 필요는 없다 — 여기서 정렬해 등수를 매긴다 */
  entries: FinishedEntry[]
}

/**
 * 같은 점수는 같은 등수 (1,1,3 식).
 */
function withRanks(entries: FinishedEntry[]) {
  const sorted = [...entries].sort((a, b) => b.score - a.score)
  let lastScore: number | null = null
  let lastRank = 0
  return sorted.map((e, i) => {
    const rank = lastScore != null && e.score === lastScore ? lastRank : i + 1
    lastScore = e.score
    lastRank = rank
    return { ...e, rank }
  })
}

/**
 * 게임 종료 시 호출. 실패해도 게임 흐름을 막지 않는다 (로그만 남기고 삼킨다).
 * 결과를 못 남기는 것보다 결과 화면이 안 뜨는 게 더 나쁘다.
 */
export async function saveGameRecord(game: FinishedGame): Promise<void> {
  const entries = withRanks(game.entries).filter((e) => e.userId && e.nickname)
  if (!entries.length) return

  try {
    // 탈퇴한 유저가 섞여 있으면 FK 때문에 판 전체가 날아간다 → 실제 존재하는 유저만
    const known = await prisma.user.findMany({
      where: { id: { in: entries.map((e) => e.userId) } },
      select: { id: true },
    })
    const alive = new Set(known.map((u) => u.id))
    const rows = entries.filter((e) => alive.has(e.userId))
    if (!rows.length) return

    await prisma.gameRecord.create({
      data: {
        roomName: game.roomName.slice(0, 100),
        gameMode: game.gameMode,
        answerMode: game.answerMode,
        totalRounds: game.totalRounds,
        entries: {
          create: rows.map((e) => ({
            userId: e.userId,
            nickname: e.nickname.slice(0, 60),
            score: e.score,
            rank: e.rank,
          })),
        },
      },
    })
  } catch (err) {
    console.error('[records] 전적 저장 실패', err)
  }
}

export type UserStats = {
  games: number
  wins: number
  totalScore: number
  bestScore: number
  avgScore: number
  avgRank: number
  recent: Array<{
    playedAt: string
    roomName: string
    gameMode: string
    score: number
    rank: number
    players: number
  }>
}

/** 프로필에 보여줄 개인 전적 */
export async function loadUserStats(userId: string, recentLimit = 10): Promise<UserStats> {
  const entries = await prisma.gameRecordEntry.findMany({
    where: { userId },
    orderBy: { game: { playedAt: 'desc' } },
    include: { game: { select: { playedAt: true, roomName: true, gameMode: true, _count: { select: { entries: true } } } } },
  })

  const games = entries.length
  const wins = entries.filter((e) => e.rank === 1).length
  const totalScore = entries.reduce((sum, e) => sum + e.score, 0)
  const bestScore = entries.reduce((best, e) => Math.max(best, e.score), 0)
  const rankSum = entries.reduce((sum, e) => sum + e.rank, 0)

  return {
    games,
    wins,
    totalScore,
    bestScore,
    avgScore: games ? Math.round((totalScore / games) * 10) / 10 : 0,
    avgRank: games ? Math.round((rankSum / games) * 10) / 10 : 0,
    recent: entries.slice(0, recentLimit).map((e) => ({
      playedAt: e.game.playedAt.toISOString(),
      roomName: e.game.roomName,
      gameMode: e.game.gameMode,
      score: e.score,
      rank: e.rank,
      players: e.game._count.entries,
    })),
  }
}
