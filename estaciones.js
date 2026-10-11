// estaciones.js - Sistema de estaciones de Rainster
// Sirve para el navegador (<script src="estaciones.js">) y para Node (require).
// Año = 100 días, estación = 25 días, 1 día = 1 hora.
// Ciclo: otoño -> invierno -> primavera -> verano -> otoño...

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();      // servidor.js (Node)
  } else {
    root.Estaciones = factory();     // rainster.html / juego.js (navegador)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DIAS_POR_ESTACION = 25;
  const DIAS_POR_ANIO = 100;
  const MS_POR_DIA = 60 * 60 * 1000; // 1 hora

  // modificadores = multiplicadores (1 = normal).
  // Hoy el juego usa: velocidad, luz y lluvia. Los demás (cultivos, recursos,
  // frio, sed) quedan listos para cuando agregues esas mecánicas.
  // cielo = color del cielo/niebla (0 a 1), tinte = color que se le aplica al mundo.
  const ESTACIONES = [
    {
      id: 'otono',
      nombre: 'Otoño',
      beneficio: 'Cosecha abundante; hojas y frutos para recolectar.',
      problema: 'Lluvias frecuentes, barro y días más cortos.',
      cielo: [0.17, 0.13, 0.10],
      tinte: [1.08, 0.95, 0.80],
      modificadores: { cultivos: 1.0, recursos: 1.5, velocidad: 0.9, lluvia: 1.6, luz: 0.8, frio: 0.4, sed: 0.7 },
    },
    {
      id: 'invierno',
      nombre: 'Invierno',
      beneficio: 'Lagos y ríos congelados que se pueden cruzar; sin plagas ni insectos.',
      problema: 'Frío (hace falta abrigo o fogata), cultivos detenidos y poca luz.',
      cielo: [0.20, 0.23, 0.28],
      tinte: [0.92, 0.98, 1.12],
      modificadores: { cultivos: 0.0, recursos: 0.7, velocidad: 0.85, lluvia: 0.8, luz: 0.6, frio: 1.5, sed: 0.5 },
    },
    {
      id: 'primavera',
      nombre: 'Primavera',
      beneficio: 'Las plantas crecen más rápido y nacen animales.',
      problema: 'Inundaciones por deshielo, polen (alergias) y más enfermedades.',
      cielo: [0.12, 0.18, 0.15],
      tinte: [0.95, 1.08, 0.95],
      modificadores: { cultivos: 1.5, recursos: 1.2, velocidad: 1.0, lluvia: 1.3, luz: 1.0, frio: 0.5, sed: 0.8 },
    },
    {
      id: 'verano',
      nombre: 'Verano',
      beneficio: 'Días largos; se puede pescar y nadar.',
      problema: 'Calor y sed, sequías, riesgo de incendios y mosquitos.',
      cielo: [0.20, 0.17, 0.11],
      tinte: [1.12, 1.05, 0.88],
      modificadores: { cultivos: 0.9, recursos: 1.0, velocidad: 0.95, lluvia: 0.4, luz: 1.4, frio: 0.0, sed: 1.6 },
    },
  ];

  const OPCIONES_ESTACION_INICIAL = ['otono', 'invierno', 'primavera', 'verano', 'aleatoria'];

  const ETIQUETAS = {
    otono: 'Otoño',
    invierno: 'Invierno',
    primavera: 'Primavera',
    verano: 'Verano',
    aleatoria: 'Aleatoria',
  };

  /** Índice (0-3) de la estación inicial según la opción elegida. */
  function resolverEstacionInicial(opcion, rng) {
    opcion = opcion || 'otono';
    rng = rng || Math.random;
    if (opcion === 'aleatoria') return Math.floor(rng() * ESTACIONES.length);
    const idx = ESTACIONES.findIndex(function (e) { return e.id === opcion; });
    return idx === -1 ? 0 : idx; // opción inválida -> otoño
  }

  /**
   * Crea el reloj estacional (es un objeto simple, se puede guardar como JSON).
   * - Online: lo crea servidor.js y se usa la hora real desde inicioMs.
   * - Offline: inicioMs = 0 y se le pasa el tiempo jugado a obtenerEstado().
   */
  function crearReloj(opciones) {
    opciones = opciones || {};
    return {
      inicioMs: opciones.inicioMs != null ? opciones.inicioMs : Date.now(),
      indiceInicial: resolverEstacionInicial(opciones.estacionInicial, opciones.rng),
    };
  }

  /** Estado actual (día, año, estación). ahoraMs = hora actual (online) o tiempo jugado (offline). */
  function obtenerEstado(reloj, ahoraMs) {
    ahoraMs = ahoraMs != null ? ahoraMs : Date.now();
    const diaTotal = Math.floor(Math.max(0, ahoraMs - reloj.inicioMs) / MS_POR_DIA) + 1;
    const diaDelAnio = ((diaTotal - 1) % DIAS_POR_ANIO) + 1;          // 1..100
    const anio = Math.floor((diaTotal - 1) / DIAS_POR_ANIO) + 1;
    const pasos = Math.floor((diaTotal - 1) / DIAS_POR_ESTACION);
    const indice = (reloj.indiceInicial + pasos) % ESTACIONES.length;
    const diaEnEstacion = ((diaTotal - 1) % DIAS_POR_ESTACION) + 1;   // 1..25
    return {
      diaTotal: diaTotal,
      anio: anio,
      diaDelAnio: diaDelAnio,
      diaEnEstacion: diaEnEstacion,
      diasRestantesEstacion: DIAS_POR_ESTACION - diaEnEstacion,
      indice: indice,
      estacion: ESTACIONES[indice],
    };
  }

  /**
   * (Solo navegador) Agrega el botón "Más opciones" dentro de una ventanita de crear
   * partida o servidor, con el mismo estilo del menú.
   * Devuelve { obtener(): string, reiniciar() }.
   */
  function montarOpciones(contenedor) {
    let elegida = 'otono'; // si no toca nada: empieza en otoño

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'enlace';
    boton.style.cssText = 'display:block;margin:1.2rem auto 0;';

    const panel = document.createElement('div');
    panel.hidden = true;

    const etiqueta = document.createElement('div');
    etiqueta.className = 'etiqueta';
    etiqueta.textContent = 'Estación del día 1';

    const fila = document.createElement('div');
    fila.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.4rem;';

    const botones = {};
    OPCIONES_ESTACION_INICIAL.forEach(function (id) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'subpestana';
      b.style.cssText = 'font-size:1rem;padding:0.25rem 0.9rem;';
      b.textContent = ETIQUETAS[id];
      b.addEventListener('click', function () { elegir(id); });
      botones[id] = b;
      fila.appendChild(b);
    });

    const descripcion = document.createElement('div');
    descripcion.className = 'partidaInfo';
    descripcion.style.marginTop = '0.8rem';

    const info = document.createElement('div');
    info.className = 'partidaInfo';
    info.style.marginTop = '0.6rem';
    info.textContent = 'El año tiene 100 días: cada estación dura 25 días y 1 día dura 1 hora.';

    panel.append(etiqueta, fila, descripcion, info);
    contenedor.append(boton, panel);

    function pintar() {
      OPCIONES_ESTACION_INICIAL.forEach(function (id) {
        botones[id].classList.toggle('activa', id === elegida);
      });
      if (elegida === 'aleatoria') {
        descripcion.textContent = 'Se elige una estación al azar cuando empieza la partida.';
      } else {
        const e = ESTACIONES.find(function (x) { return x.id === elegida; });
        descripcion.textContent = '+ ' + e.beneficio + '  − ' + e.problema;
      }
      boton.textContent = panel.hidden ? 'Más opciones ▾' : 'Menos opciones ▴';
    }

    function elegir(id) {
      elegida = id;
      pintar();
    }

    boton.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      pintar();
    });

    pintar();

    return {
      obtener: function () { return elegida; },
      reiniciar: function () {
        elegida = 'otono';
        panel.hidden = true;
        pintar();
      },
    };
  }

  return {
    DIAS_POR_ESTACION: DIAS_POR_ESTACION,
    DIAS_POR_ANIO: DIAS_POR_ANIO,
    MS_POR_DIA: MS_POR_DIA,
    ESTACIONES: ESTACIONES,
    OPCIONES_ESTACION_INICIAL: OPCIONES_ESTACION_INICIAL,
    crearReloj: crearReloj,
    obtenerEstado: obtenerEstado,
    montarOpciones: montarOpciones,
  };
});