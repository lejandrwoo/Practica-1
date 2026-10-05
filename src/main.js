import './styles.css';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

const canvas = document.querySelector('#stage');
const startMessage = document.querySelector('#start');

const params = createParameters();
const simulation = createSimulation({ canvas, params });

// ---------------- DETECTOR DE GOLPES ----------------
// Flujo espectral: mide cuánto SUBE la energía de una banda de un frame al siguiente y lo
// compara con el flujo reciente (media + k·desviación). Se adapta solo al volumen.
class OnsetDetector {
  constructor(getConfig, historySize = 45) {
    this.getConfig = getConfig; // () => { sensitivity, minFlux, cooldown } (se lee en vivo)
    this.history = new Float32Array(historySize);
    this.cursor = 0;
    this.filled = 0;
    this.prev = 0;
    this.last = -Infinity;
  }

  // Devuelve 0 si no hay golpe, o su fuerza (0.4–1) si lo hay
  update(value, now) {
    const { sensitivity, minFlux, cooldown } = this.getConfig();
    const flux = Math.max(0, value - this.prev);
    this.prev = value;

    const n = this.filled;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += this.history[i];
    mean = n ? mean / n : 0;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (this.history[i] - mean) ** 2;
    const std = n ? Math.sqrt(variance / n) : 0;

    const threshold = Math.max(mean + sensitivity * std, minFlux);

    this.history[this.cursor] = flux;
    this.cursor = (this.cursor + 1) % this.history.length;
    this.filled = Math.min(this.filled + 1, this.history.length);

    if (flux > threshold && now - this.last > cooldown) {
      this.last = now;
      return Math.min(1, Math.max(0.4, flux / (threshold * 2)));
    }
    return 0;
  }
}

const kickDetector = new OnsetDetector(() => ({
  sensitivity: params.kickSensitivity,
  minFlux: params.kickMinFlux,
  cooldown: params.kickCooldown
}));
const voiceDetector = new OnsetDetector(() => ({
  sensitivity: params.voiceSensitivity,
  minFlux: params.voiceMinFlux,
  cooldown: params.voiceCooldown
}));

// ---------------- AUDIO ----------------
let audioContext, analyser, dataArray, timeArray, audioEl;
let binHz = 1;
let panel;

const env = { bass: 0, voice: 0 }; // envolventes: ataque instantáneo, caída suave
let voiceSlow = 0; // promedio lento de la voz, para saber cuándo "destaca"
let warmup = 0; // segundos sin detección tras dar play (evita un falso golpe)

const isAudioPlaying = () => !!audioEl && !audioEl.paused;

function initAudio() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  // BASE_URL respeta la subcarpeta de GitHub Pages y también funciona en local
  audioEl = new Audio(import.meta.env.BASE_URL + params.audioFile);
  audioEl.crossOrigin = 'anonymous';
  audioEl.loop = true;

  const source = audioContext.createMediaElementSource(audioEl);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.4; // poco suavizado: los golpes se notan más
  analyser.minDecibels = -90;
  analyser.maxDecibels = -20;
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  dataArray = new Uint8Array(analyser.frequencyBinCount); // espectro
  timeArray = new Uint8Array(analyser.fftSize); // forma de onda (la dibujan los hilos)
  binHz = audioContext.sampleRate / analyser.fftSize;

  audioEl.addEventListener('timeupdate', () => {
    panel?.updateAudioTime(audioEl.currentTime, audioEl.duration);
  });
}

// Debe llamarse desde un gesto del usuario. Devuelve true si queda sonando.
async function toggleAudio() {
  if (!ready) return false;
  try {
    if (!audioContext) initAudio();
    if (audioContext.state === 'suspended') await audioContext.resume();

    if (audioEl.paused) {
      warmup = 0.15;
      await audioEl.play();
      startMessage.classList.add('hidden');
      return true;
    }
    audioEl.pause();
    return false;
  } catch (error) {
    console.error(error);
    startMessage.classList.remove('hidden');
    startMessage.textContent = `No se pudo reproducir ${params.audioFile} (revisa que esté en /public).`;
    return false;
  }
}

const seekAudio = (percent) => {
  if (audioEl && audioEl.duration) audioEl.currentTime = (percent / 100) * audioEl.duration;
};

const bandLevel = (fromHz, toHz) => {
  const from = Math.max(1, Math.round(fromHz / binHz));
  const to = Math.min(dataArray.length, Math.max(from + 1, Math.round(toHz / binHz)));
  let sum = 0;
  for (let i = from; i < to; i++) sum += dataArray[i];
  return sum / (to - from) / 255;
};

// Devuelve: bass / voice (0–1, envolventes), kick / voiceHit (0, o fuerza 0.4–1)
function analyseAudio(dt, now) {
  let bass = 0;
  let voice = 0;
  let kick = 0;
  let wave = null; // forma de onda actual (solo mientras suena)
  let voiceHit = 0;
  let voiceRel = 0; // voz actual ÷ su promedio reciente: >1 = la voz destaca, <1 = baja

  if (isAudioPlaying() && analyser) {
    analyser.getByteFrequencyData(dataArray);
    analyser.getByteTimeDomainData(timeArray);
    wave = timeArray;
    bass = bandLevel(params.bassLow, params.bassHigh);
    voice = bandLevel(params.voiceLow, params.voiceHigh);

    if (warmup > 0) {
      // Recién dado play: el promedio se iguala a la voz actual para no abrir bocas de más
      voiceSlow = voice;
      warmup = Math.max(0, warmup - dt);
    } else {
      voiceSlow += (voice - voiceSlow) * Math.min(dt * 0.5, 1);
    }
    voiceRel = voiceSlow > 0.01 ? voice / voiceSlow : 0;

    if (warmup === 0) {
      kick = kickDetector.update(bass, now);
      const voiceFlux = voiceDetector.update(voice, now);
      // Solo salta con la voz si de verdad está por encima de su nivel habitual
      if (voiceFlux && voice > voiceSlow * params.voiceProminence) voiceHit = voiceFlux;
    }
  }

  const release = Math.exp(-dt * 8);
  env.bass = Math.max(bass, env.bass * release);
  env.voice = Math.max(voice, env.voice * release);

  return { bass: env.bass, voice: env.voice, voiceRel, kick, voiceHit, wave };
}

// ---------------- UI ----------------
let ready = false;
let beatCount = 0;
let lastChange = -Infinity;

const toggleFullscreen = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};

panel = createLabPanel({
  params,
  onToggleAudio: toggleAudio,
  onSeekAudio: seekAudio,
  onToggleOrder: () => simulation.toggleOrder(),
  onReset: () => {
    simulation.reset();
    beatCount = 0;
  },
  onFullscreen: toggleFullscreen
});

// Reproducir desde el lienzo o con la tecla Espacio
const togglePlayback = async () => {
  const playing = await toggleAudio();
  panel.setPlaying(playing);
};

canvas.addEventListener('click', togglePlayback);
startMessage.addEventListener('click', togglePlayback);

// ---------------- TECLADO ----------------
addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const code = event.code;

  if (code === 'Space') {
    // Dentro del panel, Espacio ya activa el botón enfocado
    if (event.target.closest?.('.panel')) return;
    event.preventDefault();
    togglePlayback();
  }
  if (code === 'KeyP') panel.setVisible(!panel.isVisible());
  if (code === 'KeyM') {
    simulation.toggleOrder();
    panel.refresh();
  }
  if (code === 'KeyF') toggleFullscreen();
  if (code === 'KeyR') {
    simulation.reset();
    beatCount = 0;
  }
});

addEventListener('resize', () => {
  simulation.resize();
  simulation.draw();
});

// El cursor se oculta solo tras unos segundos sin moverse
let cursorTimer;
addEventListener('pointermove', () => {
  document.body.classList.remove('idle');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
});

// ---------------- CARGA DE IMÁGENES ----------------
simulation
  .load()
  .then(() => {
    ready = true;
    simulation.draw();
  })
  .catch((error) => {
    console.error(error);
    startMessage.textContent = 'No se encontraron las imágenes en /public (1.png … 10.png).';
  });

// ---------------- LOOP ----------------
let last = performance.now() / 1000;

function frame(time) {
  const now = time / 1000;
  const dt = Math.min(now - last, 1 / 30);
  last = now;

  const audio = analyseAudio(dt, now);

  // Bombo fuerte: salta hacia un punto nuevo de la pantalla (lejos, cerca, a un lado...)
  // y, cada N bombos, cambia de mono
  if (audio.kick) {
    beatCount++;

    const moveEvery = Math.round(params.beatsPerMove);
    const travels = moveEvery > 0 && beatCount % moveEvery === 0;
    if (travels) simulation.hop(audio.kick);
    else simulation.jump(audio.kick);
    // Onda de choque en el suelo (más grande cuando el mono viaja a otro punto)
    simulation.beat(audio.kick, travels);

    const changeEvery = Math.max(1, Math.round(params.beatsPerChange));
    if (beatCount % changeEvery === 0 && now - lastChange > params.minChangeInterval) {
      simulation.next();
      lastChange = now;
    }
  }

  // Voz destacada: salto menor en el sitio + balanceo + pequeño deslizamiento lateral
  if (audio.voiceHit) {
    simulation.jump(audio.voiceHit, params.voiceFactor);
    simulation.wiggle(audio.voiceHit);
    simulation.drift(audio.voiceHit);
  }

  simulation.update(dt, audio);
  simulation.draw(audio);
  if (DEBUG) simulation.drawDebug(audio);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);