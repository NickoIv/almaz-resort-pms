/**
 * The notification chime.
 *
 * Synthesised rather than loaded from a file: it is two short sine tones, so
 * shipping an audio asset would cost a network request and a binary in the
 * bundle to say the same thing.
 *
 * Browsers refuse to start audio until the user has interacted with the page,
 * and an AudioContext created before that starts suspended. `unlockSound` is
 * wired to the first click or keypress after login and resumes it; until then
 * `playChime` does nothing at all. It never throws — a browser that will not
 * make a sound must not take the visible alert down with it.
 */

let context: AudioContext | null = null
let unlocked = false

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

function audioContext(): AudioContext | null {
  if (context) return context
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
  if (!Ctor) return null
  try {
    context = new Ctor()
    return context
  } catch {
    return null
  }
}

/** Call from a real user gesture. Safe to call repeatedly. */
export function unlockSound(): void {
  const ctx = audioContext()
  if (!ctx) return
  // resume() returns a promise that rejects when there was no gesture after
  // all; there is nothing useful to do about it.
  void ctx.resume().then(
    () => {
      unlocked = true
    },
    () => undefined
  )
}

export function isSoundUnlocked(): boolean {
  return unlocked
}

/**
 * Two soft descending notes, about a third of a second in total.
 *
 * Quiet on purpose: this fires while someone is working, possibly with guests
 * in earshot, and an alarm that makes people jump gets muted within a day.
 */
export function playChime(): void {
  if (!unlocked) return
  const ctx = audioContext()
  if (!ctx || ctx.state !== 'running') return

  try {
    const now = ctx.currentTime
    for (const [index, frequency] of [880, 660].entries()) {
      const start = now + index * 0.16
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.value = frequency

      // A quick fade in and out: a square-edged tone clicks.
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)

      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.18)
    }
  } catch {
    // A sound that cannot play is not a reason to break anything else.
  }
}