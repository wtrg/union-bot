let audioCtx: AudioContext | null = null;

export function playChime(type: 'soft' | 'success' = 'soft') {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    const now = audioCtx.currentTime;
    const notes = type === 'success' ? [587.33, 739.99, 880, 1174.66] : [659.25, 987.77];
    notes.forEach((freq, i) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.06);
      gain.gain.setValueAtTime(0.03, now + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + i * 0.06 + 0.32);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.35);
    });
  } catch {
    // Audio unsupported or user interaction needed
  }
}
