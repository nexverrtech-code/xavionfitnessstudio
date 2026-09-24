// Tiny audio/haptic feedback for the attendance scanner (no audio files needed).

let context: AudioContext | null = null

export function beep(kind: 'success' | 'warning' | 'error'): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    context ??= new Ctx()
    const now = context.currentTime
    const tones = kind === 'success' ? [880, 1320] : kind === 'warning' ? [660, 660] : [300, 220]
    tones.forEach((frequency, index) => {
      const oscillator = context!.createOscillator()
      const gain = context!.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const start = now + index * 0.12
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1)
      oscillator.connect(gain).connect(context!.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.11)
    })
  } catch {
    /* audio not available */
  }
  if ('vibrate' in navigator) navigator.vibrate(kind === 'success' ? 40 : [60, 40, 60])
}
