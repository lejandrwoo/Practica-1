function rangeRow(parent, label, params, key, min, max, step) {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const lab = document.createElement('label');
  const name = document.createElement('span');
  const value = document.createElement('span');
  value.className = 'value';
  name.textContent = label;
  lab.append(name, value);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);

  const digits = step >= 1 ? 0 : step < 0.01 ? 3 : 2;
  const current = () => Number(params[key]);
  const show = (val) => (value.textContent = val.toFixed(digits));

  input.value = String(current());
  show(current());
  input.addEventListener('input', () => {
    const val = Number(input.value);
    params[key] = val;
    show(val);
  });

  wrap.append(lab, input);
  parent.append(wrap);
  return {
    refresh() {
      const next = current();
      input.value = String(next);
      show(next);
    }
  };
}

function button(parent, label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
}

function group(panel, title) {
  const g = document.createElement('div');
  g.className = 'group';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  g.append(h2);
  panel.append(g);
  return g;
}

const orderLabel = (order) => `Orden de monos: ${order === 'random' ? 'aleatorio' : 'secuencial'}`;

export function createLabPanel({
  params,
  onToggleAudio,
  onSeekAudio,
  onToggleOrder,
  onReset,
  onFullscreen
}) {
  const refreshers = [];
  const panel = document.createElement('aside');
  panel.className = 'panel hidden'; // arranca oculto: la pantalla se ve limpia

  const h1 = document.createElement('h1');
  h1.textContent = 'Monos al ritmo';
  const intro = document.createElement('p');
  intro.innerHTML = 'Pulsa <b>P</b> para mostrar u ocultar este panel.';
  panel.append(h1, intro);

  // --- Música ---
  const audioGroup = group(panel, 'Música');
  const playBtn = button(audioGroup, '▶️ PLAY', async () => {
    const playing = await onToggleAudio();
    setPlaying(playing);
  });

  const progressWrap = document.createElement('div');
  progressWrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:10px';
  const progressSlider = document.createElement('input');
  progressSlider.type = 'range';
  progressSlider.min = 0;
  progressSlider.max = 100;
  progressSlider.step = 0.1;
  progressSlider.value = 0;
  progressSlider.style.flex = '1';
  const progressLabel = document.createElement('span');
  progressLabel.textContent = '0:00 / 0:00';
  progressLabel.style.cssText = 'font-size:12px;color:#fff';

  let isDragging = false;
  progressSlider.addEventListener('pointerdown', () => (isDragging = true));
  progressSlider.addEventListener('pointerup', () => (isDragging = false));
  progressSlider.addEventListener('input', () => onSeekAudio(Number(progressSlider.value)));
  progressWrap.append(progressSlider, progressLabel);
  audioGroup.append(progressWrap);

  function setPlaying(playing) {
    playBtn.textContent = playing ? '⏸ PAUSE' : '▶️ PLAY';
    playBtn.style.background = playing ? '#a600ff' : '';
    playBtn.style.color = playing ? '#fff' : '';
  }

  // --- Cambio de mono ---
  const changeGroup = group(panel, 'Cambio de mono');
  const orderBtn = button(changeGroup, orderLabel(params.order), () => {
    orderBtn.textContent = orderLabel(onToggleOrder());
  });
  const C = (label, key, min, max, step) =>
    refreshers.push(rangeRow(changeGroup, label, params, key, min, max, step));
  C('Bombos por cambio', 'beatsPerChange', 1, 8, 1);
  C('Intervalo mínimo (s)', 'minChangeInterval', 0.05, 1, 0.05);

  // --- Recorrido por la pantalla ---
  const travelGroup = group(panel, 'Recorrido');
  const T = (label, key, min, max, step) =>
    refreshers.push(rangeRow(travelGroup, label, params, key, min, max, step));
  T('Bombos por viaje (0 = quieto)', 'beatsPerMove', 0, 16, 1);
  T('Velocidad de viaje', 'travelStiffness', 3, 250, 1);
  T('Tamaño lejos', 'depthMin', 0.2, 1, 0.01);
  T('Tamaño cerca', 'depthMax', 1, 2, 0.05);
  T('Prob. de acercarse', 'approachChance', 0, 1, 0.05);
  T('Deriva con la voz', 'voiceDrift', 0, 0.6, 0.01);
  T('Voltear al viajar (0/1)', 'flipToDirection', 0, 1, 1);
  T('Inclinación al correr', 'lean', 0, 0.4, 0.01);
  T('Rango horizontal del mono', 'monkeyRange', 0.2, 1, 0.05);

  // --- Focas (solo reaccionan a la voz) ---
  const sealGroup = group(panel, 'Focas (voz)');
  const S = (label, key, min, max, step) =>
    refreshers.push(rangeRow(sealGroup, label, params, key, min, max, step));
  S('Tamaño de las focas', 'sealScale', 0.1, 0.45, 0.01);
  S('Umbral de voz (bajo = abre más)', 'sealOpenRatio', 1, 1.6, 0.01);
  S('Estirado al abrir', 'sealStretch', 0, 10, 0.1);
  S('Aplastado al cerrar', 'sealSquash', 0, 8, 0.1);
  S('Respiración con la voz', 'sealPump', 0, 0.15, 0.005);
  S('Espejar las de la derecha (0/1)', 'sealMirrorRight', 0, 1, 1);

  // --- Visuales que unen todo ---
  const fxGroup = group(panel, 'Visuales (paleta compartida)');
  const V = (label, key, min, max, step) =>
    refreshers.push(rangeRow(fxGroup, label, params, key, min, max, step));
  V('Color inicial', 'hueBase', 0, 360, 1);
  V('Cambio de color por mono', 'hueStep', 0, 120, 1);
  V('Saturación', 'fxSaturation', 0, 100, 1);
  V('Halos', 'fxHalo', 0, 2, 0.05);
  V('Ondas de choque (bombo)', 'fxRings', 0, 2, 0.05);
  V('Arcos de voz (focas)', 'fxVoiceWaves', 0, 2, 0.05);
  V('Hilos de audio', 'fxThreads', 0, 2, 0.05);

  // --- Reacción al audio ---
  const reactGroup = group(panel, 'Reacción al audio');
  const R = (label, key, min, max, step) =>
    refreshers.push(rangeRow(reactGroup, label, params, key, min, max, step));
  R('Sensibilidad bombo', 'kickSensitivity', 0.5, 3, 0.05);
  R('Sensibilidad voz', 'voiceSensitivity', 0.5, 3, 0.05);
  R('Voz destacada (factor)', 'voiceProminence', 1, 1.5, 0.01);

  // --- Movimiento ---
  const moveGroup = group(panel, 'Movimiento');
  const M = (label, key, min, max, step) =>
    refreshers.push(rangeRow(moveGroup, label, params, key, min, max, step));
  M('Tamaño del mono', 'imageScale', 0.2, 0.9, 0.01);
  M('Altura del salto', 'kickHeight', 0.05, 0.5, 0.01);
  M('Salto de la voz', 'voiceFactor', 0, 1, 0.01);
  M('Gravedad', 'gravity', 10, 60, 1);
  M('Estirado al saltar', 'stretchKick', 0, 8, 0.1);
  M('Aplastado al caer', 'squashOnLand', 0, 2, 0.05);
  M('Balanceo (voz)', 'tiltKick', 0, 3, 0.05);
  M('Respiración bajos', 'pumpBass', 0, 0.15, 0.005);
  M('Respiración voz', 'pumpVoice', 0, 0.15, 0.005);

  // --- Acciones ---
  const actions = group(panel, 'Acciones');
  button(actions, 'Reset', onReset);
  button(actions, 'Pantalla completa', onFullscreen);

  document.body.append(panel);

  const formatTime = (time) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60)
      .toString()
      .padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return {
    element: panel,
    setVisible(visible) {
      panel.classList.toggle('hidden', !visible);
    },
    isVisible: () => !panel.classList.contains('hidden'),
    refresh() {
      for (const item of refreshers) item.refresh();
      orderBtn.textContent = orderLabel(params.order);
    },
    setPlaying,
    updateAudioTime(curr, total) {
      if (!isDragging && total > 0) {
        progressSlider.value = (curr / total) * 100;
        progressLabel.textContent = `${formatTime(curr)} / ${formatTime(total)}`;
      }
    }
  };
}