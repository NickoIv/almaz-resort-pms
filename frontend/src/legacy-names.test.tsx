import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToken, setToken } from './api'
import RestoreModal from './components/RestoreModal'
import { renderApp } from './test-utils'

/**
 * The project was renamed from "Almaz Resort" to Taura on 2026-08-10, and two
 * identifiers changed with it. Both had a stored artefact pointing at the old
 * name, and in both cases the rename on its own would have thrown that artefact
 * away silently — a signed-in browser would show the PIN screen as though the
 * session had expired, and a backup file would be refused as "not a Taura
 * backup" at the moment someone needed it most.
 *
 * These are the tests that keep the compatibility from being tidied away later
 * as dead code. It is not dead: it is what makes the rename invisible.
 */
describe('§21 the rename does not throw away what was stored under the old name', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('adopts a session stored under the old token key', () => {
    localStorage.setItem('almaz_pms_token', 'still-valid')

    expect(getToken()).toBe('still-valid')
    // Moved rather than merely read, so the old key stops being consulted.
    expect(localStorage.getItem('taura_pms_token')).toBe('still-valid')
    expect(localStorage.getItem('almaz_pms_token')).toBeNull()
  })

  it('prefers the current key when both exist', () => {
    localStorage.setItem('almaz_pms_token', 'stale')
    localStorage.setItem('taura_pms_token', 'fresh')

    expect(getToken()).toBe('fresh')
  })

  it('clears both keys on sign-out, so the old one cannot hand the session back', () => {
    localStorage.setItem('almaz_pms_token', 'stale')
    setToken('fresh')
    setToken(null)

    expect(getToken()).toBeNull()
    expect(localStorage.getItem('almaz_pms_token')).toBeNull()
    expect(localStorage.getItem('taura_pms_token')).toBeNull()
  })

  /** A backup file as the export endpoint writes it, under either marker. */
  function backupFile(format: string) {
    return new File(
      [
        JSON.stringify({
          format,
          format_version: 1,
          schema_version: '0018_booking_verification.sql',
          exported_at_almaty: '2026-08-09 04:15',
          counts: { bookings: 12, payments: 30 },
          tables: {},
        }),
      ],
      'backup.json',
      { type: 'application/json' }
    )
  }

  it('opens a backup written under the old marker', async () => {
    renderApp(<RestoreModal onClose={() => {}} onRestored={() => {}} />)

    await userEvent.upload(
      document.querySelector('input[type=file]') as HTMLInputElement,
      backupFile('almaz-resort-pms-backup')
    )

    // Accepted: the counts are summarised, which only happens once the file has
    // been recognised as a backup this build can restore.
    await waitFor(() => expect(screen.getByText(/bookings/)).toBeInTheDocument())
    expect(screen.queryByText('Это не резервная копия Taura PMS')).not.toBeInTheDocument()
  })

  it('opens a backup written under the current marker', async () => {
    renderApp(<RestoreModal onClose={() => {}} onRestored={() => {}} />)

    await userEvent.upload(
      document.querySelector('input[type=file]') as HTMLInputElement,
      backupFile('taura-pms-backup')
    )

    await waitFor(() => expect(screen.getByText(/bookings/)).toBeInTheDocument())
  })

  it('still refuses a file that is not a backup at all', async () => {
    renderApp(<RestoreModal onClose={() => {}} onRestored={() => {}} />)

    await userEvent.upload(
      document.querySelector('input[type=file]') as HTMLInputElement,
      backupFile('some-other-app-backup')
    )

    expect(await screen.findByText('Это не резервная копия Taura PMS')).toBeInTheDocument()
  })
})
