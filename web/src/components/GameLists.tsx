import { memo } from 'react'
import type { ChatMsg, RoomMember } from '../GameContext'
import { Avatar, C, chatColorOf, F, sk } from '../ui'

/**
 * 채팅 목록은 GameScreen의 1초 타이머 리렌더와 분리한다.
 * props가 모두 안정적인 참조라 새 메시지가 올 때만 다시 그린다.
 */
/** 순위표도 시간과 무관하다 — room:state로 명단·점수가 바뀔 때만 다시 그린다. */
export const GameScoreboard = memo(function GameScoreboard({
  ranked,
  spectators,
  selfId,
  style,
}: {
  ranked: RoomMember[]
  spectators: RoomMember[]
  selfId: string
  style?: React.CSSProperties
}) {
  const surf = C.panel
  return (
    <div style={{
      ...sk(), backgroundColor: surf, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, minWidth: 0,
      ...style,
    }}>
      <div style={{ fontFamily: F.ui, fontSize: 20, color: C.muted, textAlign: 'center', flexShrink: 0 }}>전체 순위</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {ranked.map((s, i) => {
          const mine = s.userId === selfId
          // 채팅에서 고른 색을 순위표에도 그대로 (관전자는 색 없음)
          const cc = chatColorOf(s.chatColor)
          const line = cc?.line || (mine ? C.blue : C.graphite)
          const nameColor = cc?.line || (mine ? C.blue : C.body)
          return (
            <div key={s.userId} style={{
              display: 'grid', gridTemplateColumns: '40px 36px 1fr auto', gap: 8, alignItems: 'center',
              padding: '10px 10px', ...sk(line, true),
              backgroundColor: cc?.fill || (mine ? C.blueLight : surf),
              borderWidth: mine ? 3.5 : 2.5,
              // 끊긴 사람은 자리·점수를 지켜주되 지금 못 맞힌다는 걸 보이게
              opacity: s.disconnected ? 0.45 : 1,
            }}>
              <span style={{ fontFamily: F.ui, fontSize: 17, fontWeight: mine ? 900 : 500, color: nameColor, textAlign: 'center' }}>{i + 1}</span>
              <Avatar name={s.nickname} url={s.avatarUrl} size={32} border={cc?.line} tint={cc?.fill} />
              <span style={{ fontFamily: F.ui, fontSize: 17, fontWeight: mine ? 900 : 500, color: nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.disconnected ? '📵 ' : ''}{s.nickname}{mine ? ' · 나' : ''}
              </span>
              <span style={{ fontFamily: F.ui, fontSize: 17, fontWeight: mine ? 900 : 700, color: C.body }}>{s.score}점</span>
            </div>
          )
        })}
        {spectators.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1.5px dashed ${C.graphite}55` }}>
            <div style={{ fontFamily: F.ui, fontSize: 13, color: C.muted, marginBottom: 6 }}>관전</div>
            {spectators.map((s) => (
              <div key={s.userId} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', opacity: 0.85,
              }}>
                <Avatar name={s.nickname} url={s.avatarUrl} size={24} />
                <span style={{ fontFamily: F.ui, fontSize: 14, color: C.muted }}>{s.nickname}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

/** 정답·증강 등 시스템 알림만 모은 로그 (사람 채팅과 분리) */
export const ROUND_LOG_DIVIDER_RE = /^-+\d+R?-+$/

export const GameLogList = memo(function GameLogList({
  logs,
  setChatCardHover,
  setChatCardAnchor,
}: {
  logs: ChatMsg[]
  setChatCardHover: (id: number | null) => void
  setChatCardAnchor: (rect: DOMRect | null) => void
}) {
  return (
    <>
      {logs.map((msg) => {
        const dividerMatch = msg.text.trim().match(/^-+(\d+)R?-+$/)
        if (dividerMatch) {
          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '2px 2px',
                minWidth: 0,
                opacity: 0.85,
              }}
            >
              <div style={{ flex: 1, height: 1, background: C.muted, opacity: 0.35 }} />
              <div style={{
                fontFamily: F.ui,
                fontSize: 12,
                fontWeight: 800,
                color: C.muted,
                letterSpacing: 0.4,
                whiteSpace: 'nowrap',
              }}>
                {dividerMatch[1]}R
              </div>
              <div style={{ flex: 1, height: 1, background: C.muted, opacity: 0.35 }} />
            </div>
          )
        }
        return (
        <div
          key={msg.id}
          style={{ display: 'flex', position: 'relative', opacity: msg.spectator ? 0.55 : 1, minWidth: 0 }}
          onMouseEnter={(e) => {
            if (!msg.augmentCard) return
            setChatCardHover(msg.id)
            setChatCardAnchor(e.currentTarget.getBoundingClientRect())
          }}
          onMouseLeave={() => {
            setChatCardHover(null)
            setChatCardAnchor(null)
          }}
        >
          <div style={{
            ...sk(msg.augmentCard ? C.red : C.green, true),
            backgroundColor: msg.augmentCard ? C.redLight : C.greenLight,
            padding: '6px 10px', fontFamily: F.ui, fontSize: 14, lineHeight: 1.4,
            color: msg.augmentCard ? C.red : C.green,
            cursor: msg.augmentCard ? 'help' : undefined,
            width: '100%',
            boxSizing: 'border-box',
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
          }}>{msg.text}</div>
        </div>
        )
      })}
    </>
  )
})

export const GameChatList = memo(function GameChatList({
  chats,
  selfId,
  metaByUser,
}: {
  chats: ChatMsg[]
  selfId: string
  metaByUser: Record<string, { color: number | null; avatarUrl: string | null }>
}) {
  return (
    <>
      {chats.map(msg => {
        const self = msg.userId === selfId
        const spect = !!msg.spectator
        // 관전자는 색 없음 · 나머지는 방에서 고른 색
        const meta = metaByUser[msg.userId]
        const cc = spect ? null : chatColorOf(meta?.color)
        const lineColor = cc?.line || C.graphite
        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              justifyContent: 'flex-start',
              gap: 8,
              alignItems: 'flex-end',
              opacity: spect ? 0.52 : 1,
              minWidth: 0,
              width: '100%',
            }}
          >
            <Avatar
              name={msg.nickname}
              url={meta?.avatarUrl}
              size={34}
              border={lineColor}
              tint={spect ? '#E8EEF3' : (cc?.fill || C.blueLight)}
            />
            <div style={{ maxWidth: 'min(76%, 100%)', minWidth: 0, boxSizing: 'border-box' }}>
              <div style={{
                fontFamily: F.ui, fontSize: 14, fontWeight: self ? 800 : 500,
                color: spect ? C.muted : lineColor, marginBottom: 3,
              }}>
                {msg.nickname}{spect ? ' · 관전' : self ? ' · 나' : ''}
              </div>
              <div style={{
                ...sk(lineColor, true),
                backgroundColor: spect
                  ? 'rgba(255,255,255,0.45)'
                  : (cc?.fill || '#FFFFFF'),
                padding: '10px 14px',
                fontFamily: F.chat,
                fontSize: 22,
                fontWeight: 700,
                color: C.body,
                lineHeight: 1.45,
                backdropFilter: spect ? 'blur(2px)' : undefined,
                boxSizing: 'border-box',
                maxWidth: '100%',
                wordBreak: 'keep-all',
                overflowWrap: 'anywhere',
              }}>{msg.text}</div>
            </div>
          </div>
        )
      })}
    </>
  )
})
