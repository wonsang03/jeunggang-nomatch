import { io, type Socket } from 'socket.io-client'
import { API_BASE, getToken } from './api'

let socket: Socket | null = null

export function getSocket() {
  return socket
}

export function connectSocket() {
  const token = getToken()
  if (!token) return null
  if (socket?.connected) return socket

  socket?.disconnect()
  socket = io(API_BASE || undefined, {
    auth: { token },
    // polling 먼저 타면 RTT가 커지고 불안정 — websocket만 사용
    transports: ['websocket'],
    upgrade: false,
    rememberUpgrade: true,
  })
  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}
