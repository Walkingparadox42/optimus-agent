import { type ChatMessage, textPart } from '@/lib/chat-messages'
import { $messages, setMessages } from '@/store/session'

let activeAssistantId: string | null = null

function id(prefix: string, turnId?: null | string): string {
  return `${prefix}-voice-${turnId || Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function viaVoice(text: string): string {
  return `[via voice] ${text.trim()}`
}

function firstText(message: ChatMessage): string {
  const part = message.parts[0]

  return part?.type === 'text' ? part.text : ''
}

export function mirrorVoiceUserTranscript(text: string, turnId?: null | string): void {
  const body = text.trim()

  if (!body) {
    return
  }

  setMessages(current => [
    ...current,
    {
      id: id('user', turnId),
      parts: [textPart(viaVoice(body))],
      role: 'user'
    }
  ])
}

export function mirrorVoiceAssistantDelta(delta: string, turnId?: null | string): void {
  if (!delta) {
    return
  }

  const current = $messages.get()
  const existingId = activeAssistantId && current.some(message => message.id === activeAssistantId) ? activeAssistantId : null
  const messageId = existingId || id('assistant', turnId)
  activeAssistantId = messageId

  setMessages(messages => {
    if (!messages.some(message => message.id === messageId)) {
      return [
        ...messages,
        {
          id: messageId,
          parts: [textPart(viaVoice(delta))],
          pending: true,
          role: 'assistant'
        }
      ]
    }

    return messages.map(message =>
      message.id === messageId
        ? {
            ...message,
            parts: [textPart(`${firstText(message)}${delta}`)],
            pending: true
          }
        : message
    )
  })
}

export function finalizeVoiceAssistant(): void {
  const messageId = activeAssistantId
  activeAssistantId = null

  if (!messageId) {
    return
  }

  setMessages(messages =>
    messages.map((message): ChatMessage => (message.id === messageId ? { ...message, pending: false } : message))
  )
}

export function resetVoiceChatMirror(): void {
  activeAssistantId = null
}
