import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { notifyVaultNoteChanged } from '@/store/vault-events'
import { isSecondaryWindow } from '@/store/windows'
import { notifyWorkspaceChanged } from '@/store/workspace-events'

import { $voiceServerUrl } from '../voice/store'

import { BOTVAULT_PATH } from './use-vault-tree'

const RECONNECT_MAX_MS = 15_000
const VAULT_EVENTS_PORT = '9128'

interface VaultChangeMessage {
  kind: 'created' | 'deleted' | 'modified'
  path: string
  timestamp: number
  type: 'note.changed'
}

export function vaultEventsUrl(voiceServerUrl: string): string | null {
  try {
    const url = new URL(voiceServerUrl)
    url.protocol = url.protocol === 'wss:' ? 'wss:' : 'ws:'
    url.port = VAULT_EVENTS_PORT
    url.pathname = '/events'
    url.search = ''
    url.hash = ''

    return url.toString()
  } catch {
    return null
  }
}

export function parseVaultChangeMessage(raw: unknown): VaultChangeMessage | null {
  if (typeof raw !== 'string') {
    return null
  }

  try {
    const message = JSON.parse(raw) as Partial<VaultChangeMessage>
    const path = typeof message.path === 'string' ? message.path.replaceAll('\\', '/') : ''

    if (
      message.type !== 'note.changed' ||
      !['created', 'deleted', 'modified'].includes(String(message.kind)) ||
      !(path === BOTVAULT_PATH || path.startsWith(`${BOTVAULT_PATH}/`))
    ) {
      return null
    }

    return {
      kind: message.kind as VaultChangeMessage['kind'],
      path,
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
      type: 'note.changed'
    }
  } catch {
    return null
  }
}

/**
 * One app-level connection to CT115's authoritative vault watcher. It remains
 * mounted when the BotVault panel is dismissed so background changes still
 * refresh the tree state when the panel returns. The watcher never changes
 * note focus; explicit panel commands own navigation.
 */
export function VaultLiveEventBridge() {
  const voiceServerUrl = useStore($voiceServerUrl)

  useEffect(() => {
    if (isSecondaryWindow()) {
      return
    }

    const url = vaultEventsUrl(voiceServerUrl)

    if (!url) {
      return
    }

    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0

    const connect = () => {
      if (cancelled) {
        return
      }

      socket = new WebSocket(url)

      socket.onopen = () => {
        reconnectAttempt = 0
        console.info('[botvault-live] authoritative event feed connected:', url)
      }

      socket.onmessage = event => {
        const change = parseVaultChangeMessage(event.data)

        if (!change) {
          return
        }

        notifyWorkspaceChanged()
        notifyVaultNoteChanged(change.path, 'background')
      }

      socket.onerror = () => socket?.close()

      socket.onclose = () => {
        socket = null

        if (cancelled || reconnectTimer) {
          return
        }

        const delay = Math.min(RECONNECT_MAX_MS, 1_000 * 2 ** Math.min(reconnectAttempt, 4))
        reconnectAttempt += 1
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, delay)
      }
    }

    connect()

    return () => {
      cancelled = true

      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }

      socket?.close()
    }
  }, [voiceServerUrl])

  return null
}
