import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const profileMocks = vi.hoisted(() => ({
  refreshProfiles: vi.fn<() => Promise<unknown>>(),
  selectProfile: vi.fn<(name: string) => void>()
}))

vi.mock('@/store/profile', async () => {
  const { atom } = await import('nanostores')

  return {
    $activeGatewayProfile: atom('optimus'),
    $profileOrder: atom(['optimus', 'egon']),
    $profiles: atom([
      { is_default: true, name: 'default' },
      { is_default: false, name: 'egon' },
      { is_default: false, name: 'optimus' }
    ]),
    normalizeProfileKey: (name: string | null | undefined) => name?.trim() || 'default',
    refreshProfiles: profileMocks.refreshProfiles,
    selectProfile: profileMocks.selectProfile,
    sortByProfileOrder: <T extends { name: string }>(profiles: T[], order: string[]) =>
      [...profiles].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  }
})

import { CanvasProfileSwitcher } from './dock'

describe('CanvasProfileSwitcher', () => {
  beforeEach(() => {
    profileMocks.refreshProfiles.mockReset()
    profileMocks.refreshProfiles.mockResolvedValue(undefined)
    profileMocks.selectProfile.mockReset()
  })

  afterEach(cleanup)

  it('shows the active profile and switches through the shared profile action', async () => {
    render(<CanvasProfileSwitcher />)

    expect(screen.getByRole('combobox', { name: 'Profiles' }).textContent).toContain('optimus')
    await waitFor(() => expect(profileMocks.refreshProfiles).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('combobox', { name: 'Profiles' }))
    fireEvent.click(screen.getByRole('option', { name: 'egon' }))

    expect(profileMocks.selectProfile).toHaveBeenCalledWith('egon')
  })
})
