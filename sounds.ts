
// sounds.ts

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!audioContext && (window.AudioContext || (window as any).webkitAudioContext)) {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser", e);
        }
    }
    return audioContext;
};

// A function to generate a specific sound
const playTone = (
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number = 0.5,
    callback?: () => void
) => {
    const context = getAudioContext();
    if (!context) return;

    if (context.state === 'suspended') {
        context.resume().catch(e => console.error("Could not resume audio context", e));
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, context.currentTime);

    gainNode.gain.setValueAtTime(volume, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + duration);

    if (callback) {
        oscillator.onended = callback;
    }
};

const playNoise = (duration: number, volume: number = 0.5) => {
    const context = getAudioContext();
    if (!context) return;

    if (context.state === 'suspended') {
        context.resume().catch(e => console.error("Could not resume audio context", e));
    }

    const bufferSize = context.sampleRate * duration;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    const noiseSource = context.createBufferSource();
    noiseSource.buffer = buffer;

    const gainNode = context.createGain();
    gainNode.gain.setValueAtTime(volume, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    noiseSource.connect(gainNode);
    gainNode.connect(context.destination);
    noiseSource.start();
};

// Specific sound effects
export const playJumpSound = (silent = false) => {
    const context = getAudioContext();
    if (!context) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(300, context.currentTime);
    osc.frequency.linearRampToValueAtTime(600, context.currentTime + 0.1);
    const startVol = silent ? 0 : 0.1;
    gain.gain.setValueAtTime(startVol, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.1);
};

export const playLandSound = (silent = false) => {
    playNoise(0.1, silent ? 0 : 0.12);
};

export const playCollectSound = (silent = false) => {
    const vol = silent ? 0 : 0.2;
    playTone(523.25, 0.05, 'sine', vol, () => {
        playTone(659.25, 0.05, 'sine', vol, () => {
            playTone(783.99, 0.1, 'sine', vol);
        });
    });
};

export const playDeathSound = (silent = false) => {
    const context = getAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(440, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(55, context.currentTime + 0.5);
    const startVol = silent ? 0 : 0.3;
    gainNode.gain.setValueAtTime(startVol, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.5);
};

export const playWinSound = (silent = false) => {
    const vol = silent ? 0 : 0.3;
    playTone(523.25, 0.1, 'triangle', vol, () => {
        playTone(659.25, 0.1, 'triangle', vol, () => {
            playTone(783.99, 0.1, 'triangle', vol, () => {
                playTone(1046.50, 0.2, 'triangle', vol);
            });
        });
    });
};

export const playTeleportSound = (silent = false) => {
    const context = getAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(200, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1200, context.currentTime + 0.3);
    const startVol = silent ? 0 : 0.2;
    gainNode.gain.setValueAtTime(startVol, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
};

export const playSpringSound = (silent = false) => {
    const context = getAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(600, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1200, context.currentTime + 0.1);
    oscillator.frequency.exponentialRampToValueAtTime(600, context.currentTime + 0.2);
    const startVol = silent ? 0 : 0.3;
    gainNode.gain.setValueAtTime(startVol, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
};

export const playDoorOpenSound = (silent = false) => {
    playNoise(0.2, silent ? 0 : 0.3);
    playTone(110, 0.2, 'square', silent ? 0 : 0.15);
};

export const playPowerDownSound = (silent = false) => {
    const context = getAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(300, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(100, context.currentTime + 0.2);
    const startVol = silent ? 0 : 0.2;
    gainNode.gain.setValueAtTime(startVol, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
};

// Spring Loaded
export const playRetroClickSound = (silent = false) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(e => console.error(e));

    const totalDuration = 0.15;
    const bufferSize = ctx.sampleRate * totalDuration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // First fast click (press)
    for (let i = 0; i < bufferSize * 0.36; i++) {
        const envelope = Math.exp(-i / (bufferSize * 0.36 * 0.09));
        data[i] = (Math.random() * 2 - 1) * envelope * 0.5;
    }

    // Second click (spring release)
    const gap = Math.floor(bufferSize * 0.48);
    for (let i = 0; i < bufferSize * 0.36; i++) {
        if (gap + i < bufferSize) {
            const envelope = Math.exp(-i / (bufferSize * 0.36 * 0.09));
            data[gap + i] = (Math.random() * 2 - 1) * envelope * 0.48;
        }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = silent ? 0 : 0.3;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
};

export const playRetroNavigateSound = (silent = false) => {
    // Reuse the exact spring loaded sound for navigation (opening folders)
    playRetroClickSound(silent);
};

export const playRetroErrorSound = (silent = false) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(e => console.error(e));

    const totalDuration = 0.15;
    const bufferSize = ctx.sampleRate * totalDuration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Warm beep at 380Hz
    for (let i = 0; i < bufferSize; i++) {
        const t = i / ctx.sampleRate;
        const envelope = Math.exp(-t * 8);
        data[i] = Math.sin(2 * Math.PI * 380 * t) * envelope * 0.5;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = silent ? 0 : 0.3;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
};

/**
 * Very Fast
 * Sharp and snappy - faster decay
 * File explorer success sound
 */
export const playRetroPromptSound = (silent = false) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(e => console.error(e));

    const totalDuration = 0.15;
    const bufferSize = ctx.sampleRate * totalDuration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // First note: 550Hz
    const noteDuration = bufferSize * 0.3;
    for (let i = 0; i < noteDuration; i++) {
        const t = i / ctx.sampleRate;
        const envelope = Math.exp(-t * 9.5);
        data[i] = Math.sin(2 * Math.PI * 550 * t) * envelope * 0.4;
    }

    // Second note: 720Hz
    const secondNoteStart = bufferSize * 0.32;
    for (let i = 0; i < noteDuration; i++) {
        if (secondNoteStart + i < bufferSize) {
            const t = i / ctx.sampleRate;
            const envelope = Math.exp(-t * 9.5);
            data[secondNoteStart + i] = Math.sin(2 * Math.PI * 720 * t) * envelope * 0.4;
        }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = silent ? 0 : 0.3;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
};

// Function to initialize audio on user gesture
export const initAudio = () => {
    const context = getAudioContext();
    if (context && context.state === 'suspended') {
        context.resume().catch(e => console.error("Could not resume audio context on user gesture", e));
    }
};

export const preloadSounds = () => {
    initAudio();
    playJumpSound(true);
    playLandSound(true);
    playCollectSound(true);
    playDeathSound(true);
    playWinSound(true);
    playTeleportSound(true);
    playSpringSound(true);
    playDoorOpenSound(true);
    playPowerDownSound(true);
    playRetroClickSound(true);
    playRetroNavigateSound(true);
    playRetroErrorSound(true);
    playRetroPromptSound(true);
};
