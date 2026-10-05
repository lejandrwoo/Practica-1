// Todos los valores ajustables viven aquí. El panel (labPanel.js) los modifica en vivo
// y createSimulation.js / main.js los leen en cada frame.

export function createParameters() {
  return {
    // ---------- assets (carpeta /public) ----------
    audioFile: 'musiquita.mp3',
    imageCount: 10, // monos: 1.png ... 10.png
    imageExt: 'png',
    sealOpenFile: 'foca abierta.png',
    sealClosedFile: 'foca cerrada.png',

    // ---------- visual ----------
    background: '#000000',
    imageScale: 0.5, // tamaño base del mono: fracción del lado menor de la ventana
    smoothing: true, // false si tus imágenes son pixel art
    order: 'sequential', // 'sequential' | 'random'
    beatsPerChange: 4, // cambia de mono cada N bombos
    minChangeInterval: 0.6, // segundos mínimos entre dos cambios de imagen

    // ---------- recorrido del mono por la pantalla (tranquilo) ----------
    beatsPerMove: 8, // viaja a un punto nuevo cada N bombos (0 = se queda en el sitio)
    travelStiffness: 14, // velocidad del viaje: más bajo = más lento y suave
    monkeyRange: 0.35, // cuánto se aleja del centro en horizontal (deja libres a las focas)
    depthMin: 0.7, // tamaño cuando está lejos (× tamaño base)
    depthMax: 1.25, // tamaño cuando está cerca de la cámara (× tamaño base)
    approachChance: 0.15, // probabilidad de acercarse mucho en cada viaje
    voiceDrift: 0.06, // cuánto se desliza de lado cuando la voz destaca
    flipToDirection: 0, // 1 = se voltea hacia donde va (puede marear), 0 = siempre mira igual
    lean: 0.03, // inclinación al moverse

    // ---------- focas (solo reaccionan a la voz) ----------
    sealScale: 0.28, // tamaño de cada foca: fracción del lado menor de la ventana
    sealOpenRatio: 1.12, // abre la boca si la voz supera su promedio por este factor (más bajo = abre más)
    sealStretch: 5.0, // estirado vertical al abrir la boca
    sealSquash: 3.0, // aplastado al cerrarla
    sealPump: 0.04, // "respiración" continua con el nivel de la voz
    sealMinOpen: 0.09, // segundos mínimos con la boca abierta (evita parpadeo)
    sealMinClosed: 0.06, // segundos mínimos con la boca cerrada
    sealMirrorRight: 0, // 1 = las de la derecha miran hacia el centro (espejadas)

    // ---------- visuales que unen todo (paleta compartida) ----------
    // Todo comparte un color que cambia con cada mono: halos, ondas, hilos y arcos de voz.
    hueBase: 200, // color inicial (0–360)
    hueStep: 36, // cuántos grados cambia el color al pasar al siguiente mono
    fxSaturation: 85, // 0 = blanco y negro, 100 = colores vivos
    fxHalo: 1.0, // resplandor detrás de cada personaje (mono = bajos, focas = voz)
    fxRings: 1.0, // ondas de choque en el suelo con cada bombo
    fxVoiceWaves: 1.0, // arcos que salen de la boca de las focas hacia el mono
    fxThreads: 1.0, // hilos con la forma de onda del sonido entre las focas y el mono

    // ---------- bandas de frecuencia (Hz) ----------
    bassLow: 40,
    bassHigh: 150, // bombo y bajos
    voiceLow: 300,
    voiceHigh: 3400, // rango de la voz

    // ---------- detección de golpes ----------
    // sensitivity: más bajo = más golpes detectados.
    // minFlux: piso mínimo de subida de energía. cooldown: segundos entre golpes.
    kickSensitivity: 1.4,
    kickMinFlux: 0.02,
    kickCooldown: 0.2,
    voiceSensitivity: 1.6,
    voiceMinFlux: 0.02,
    voiceCooldown: 0.14,
    voiceProminence: 1.08, // la voz "destaca" si supera su promedio por este factor

    // ---------- movimiento / squash & stretch del mono (suave) ----------
    gravity: 28, // en alturas-de-mono por segundo²
    kickHeight: 0.09, // salto máximo con un bombo fuerte (en alturas-de-mono)
    voiceFactor: 0.5, // la voz salta este porcentaje de lo que salta un bombo
    stretchKick: 2.5, // estiramiento al despegar
    squashOnLand: 0.5, // aplastamiento al aterrizar
    restitution: 0.12, // rebote pequeño al caer
    tiltKick: 0.3, // balanceo lateral con la voz
    pumpBass: 0.04, // "respiración" continua con los bajos
    pumpVoice: 0.03 // "respiración" continua con la voz
  };
}