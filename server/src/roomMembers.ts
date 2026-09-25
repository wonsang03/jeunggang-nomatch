/** 방 인원 구분 (플레이어 / 관전) · 정원 판정 · 새 멤버 기본값 */
import type { Member, Room } from './gameTypes.js'

export function isPlayingMember(m: Member) {
  return !m.isSpectator
}

export function playerMembers(room: Room) {
  return [...room.members.values()].filter(isPlayingMember)
}

export function playerCount(room: Room) {
  return playerMembers(room).length
}

/**
 * 스킵 정족수는 "지금 대답할 수 있는 사람" 기준이어야 한다.
 * 끊긴 사람을 분모에 넣으면 남은 사람이 전원 스킵해도 과반을 못 넘겨 라운드가 멈춘다.
 * 자리(정원) 계산에는 쓰지 않는다 — 끊긴 사람의 자리는 유예 동안 지켜준다.
 */
export function connectedPlayerCount(room: Room) {
  const n = playerMembers(room).filter((m) => m.disconnectedAt == null).length
  return Math.max(1, n)
}

export const MAX_SPECTATORS = 4

export function spectatorMembers(room: Room) {
  return [...room.members.values()].filter((m) => m.isSpectator)
}

export function spectatorCount(room: Room) {
  return spectatorMembers(room).length
}

export function canJoinAsPlayer(room: Room) {
  return playerCount(room) < room.maxPlayers
}

export function canJoinAsSpectator(room: Room) {
  return spectatorCount(room) < MAX_SPECTATORS
}

export function isDuelParticipant(room: Room, userId: string): boolean {
  return !!(room.duel && (userId === room.duel.challengerId || userId === room.duel.opponentId))
}

export function emptyMember(
  userId: string,
  nickname: string,
  avatarUrl: string | null,
  socketId: string,
  opts?: { spectator?: boolean },
): Member {
  return {
    userId,
    nickname,
    avatarUrl,
    ready: false,
    score: 0,
    socketId,
    disconnectedAt: null,
    isSpectator: !!opts?.spectator,
    chatColor: null,
    heldAugments: [],
    usedAugments: [],
    offerSeenAugmentIds: [],
    lastOfferCandidateIds: [],
    gahoPickIds: null,
    activeBuffs: [],
    collectedPieces: [],
    chatMute: null,
    chatMuteUntil: null,
    answerDelay: null,
    politeSuffix: null,
    answerBlock: null,
    answerBlockUntil: null,
    answerBlockUntilBy: null,
    audioDelayUntil: null,
    duelEarlyChosung: false,
    accuseMark: null,
    gabuki: null,
    answerProxy: null,
    sakuraDecoy: null,
    flameKim: null,
    peckSong: null,
    songMuteUntil: null,
    roundScoreGain: 0,
  }
}
