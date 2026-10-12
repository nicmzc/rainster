const canvas = document.getElementById("juego");
const gl = canvas.getContext("webgl");

if (!gl) {
    alert("Tu computadora no soporta WebGL");
} else {

    // ===== MATEMÁTICA DE LA CÁMARA (no hace falta tocarla) =====
    function multiplicar(a, b) {
        const r = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let fila = 0; fila < 4; fila++) {
                let s = 0;
                for (let k = 0; k < 4; k++) {
                    s += a[k * 4 + fila] * b[col * 4 + k];
                }
                r[col * 4 + fila] = s;
            }
        }
        return r;
    }

    function perspectiva(fov, aspecto, cerca, lejos) {
        const f = 1 / Math.tan(fov / 2);
        const nf = 1 / (cerca - lejos);
        return new Float32Array([
            f / aspecto, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (lejos + cerca) * nf, -1,
            0, 0, 2 * lejos * cerca * nf, 0
        ]);
    }

    function rotarX(a) {
        const c = Math.cos(a), s = Math.sin(a);
        return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
    }

    function rotarY(a) {
        const c = Math.cos(a), s = Math.sin(a);
        return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
    }

    function trasladar(x, y, z) {
        return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
    }

    // ===== ESCENARIO =====
    const datos = [];
    const colisiones = [];

    // Dibuja una caja entre dos esquinas (x1,y1,z1) y (x2,y2,z2)
    function caja(x1, y1, z1, x2, y2, z2, color, solida, destino) {
        const salida = destino || datos;
        const caras = [
            [[x1,y2,z1],[x2,y2,z1],[x2,y2,z2],[x1,y2,z2], 1.00],
            [[x1,y1,z2],[x2,y1,z2],[x2,y2,z2],[x1,y2,z2], 0.85],
            [[x1,y1,z1],[x2,y1,z1],[x2,y2,z1],[x1,y2,z1], 0.70],
            [[x1,y1,z1],[x1,y1,z2],[x1,y2,z2],[x1,y2,z1], 0.60],
            [[x2,y1,z1],[x2,y1,z2],[x2,y2,z2],[x2,y2,z1], 0.75],
            [[x1,y1,z1],[x2,y1,z1],[x2,y1,z2],[x1,y1,z2], 0.50]
        ];
        for (const cara of caras) {
            const brillo = cara[4];
            const c = [color[0] * brillo, color[1] * brillo, color[2] * brillo];
            const orden = [0, 1, 2, 0, 2, 3];
            for (const i of orden) {
                salida.push(cara[i][0], cara[i][1], cara[i][2], c[0], c[1], c[2]);
            }
        }
        if (solida) {
            const col = [x1, z1, x2, z2, y2, y1];     // [x1, z1, x2, z2, techo, base]: ahora la colisión también sabe desde qué altura empieza
            colisiones.push(col);
            return col;
        }
        return null;
    }

    // Una colisión invisible (para vidrios y hojas de puerta, que se dibujan aparte porque se mueven)
    function colisionSola(x1, y1, z1, x2, y2, z2) {
        const col = [x1, z1, x2, z2, y2, y1];
        colisiones.push(col);
        return col;
    }

    // ===== PUERTAS Y VENTANAS =====
    // Cada abertura se dibuja aparte (no va en el buffer fijo) porque se abre y se cierra.
    const COLORES_LLAVE = [
        { n: "roja", c: [0.85, 0.15, 0.15] }, { n: "azul", c: [0.20, 0.40, 0.90] },
        { n: "verde", c: [0.20, 0.70, 0.30] }, { n: "amarilla", c: [0.90, 0.80, 0.20] },
        { n: "violeta", c: [0.60, 0.30, 0.80] }, { n: "naranja", c: [0.95, 0.55, 0.15] },
        { n: "celeste", c: [0.40, 0.80, 0.90] }, { n: "blanca", c: [0.90, 0.90, 0.90] }
    ];
    let PUERTAS = [];       // una por casa
    let VENTANAS = [];      // varias por casa
    // Deja una puerta o ventana en un estado (abierta o cerrada) y activa o apaga su colisión
    function fijarAbertura(o, abierta, trabada) {
        o.abierta = !!abierta;
        if (o.esPuerta) o.trabada = !!trabada;
        else o.rota = !!trabada;      // en las ventanas el 3er dato es "rota" (así viaja por la red sin tocar el servidor)
        // una puerta abierta no frena; las ventanas siempre son sólidas (cerradas, abiertas o rotas): se cruzan con el botón "Pasar"
        o.col[4] = (o.esPuerta && o.abierta) ? -100 : o.alto;
    }

    // ===== MUNDO ALEATORIO =====
    // Cada partida (o cada servidor) tiene una semilla: con la misma semilla sale siempre el mismo mapa,
    // así todos los jugadores de un servidor ven las mismas calles, casas y muebles.
    const MUNDO_MITAD = 45;                 // el mapa va de -45 a 45 (90 x 90)
    const ALTO_PARED = 3;
    let CALLES = [];                        // [x1, z1, x2, z2]
    let CASAS = [];                         // [x1, z1, x2, z2]
    let NPCS = [];                          // gente que vive adentro de las casas
    let CAMAS = [];                         // [x1, z1, x2, z2]
    let MUNDO_INICIAL = [];                 // objetos sueltos { id, x, y, z }
    let SPAWN = { x: 0, z: 9, yaw: 0 };
    let semillaMundo = null;
    let itemsLugar = [];                    // objetos de los estantes del lugar seguro donde estás (no se guardan)
    let dinero = 0;                         // plata del jugador (se guarda con la partida)
    let tiendaAbierta = false;              // el panel de compra y venta está abierto
    let zona = "barrio";                    // dónde estás: "casa" (zona cerrada, no carga nada más) o "barrio" (las casas ya hechas)
    let COMPLETO = null;                    // el barrio entero, guardado mientras estás adentro de tu casa
    let casaPropia = null;                  // { idx, rect, spawnFuera, spawnDentro }

    const PARED = [0.55, 0.50, 0.45];
    const MADERA = [0.45, 0.30, 0.18];
    const CAJA = [0.55, 0.42, 0.22];
    const ESCOMBRO = [0.40, 0.38, 0.36];
    const CALLE_COLOR = [0.38, 0.38, 0.40];
    const TECHO_COLOR = [0.30, 0.18, 0.15];
    const PISO_CASA = [0.32, 0.25, 0.19];

    function crearAzar(semilla) {
        let a = semilla >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const buffer = gl.createBuffer();
    let cantidad = 0;

    function construirMundo(semilla) {
        semilla = (semilla >>> 0) || 1;
        semillaMundo = semilla;
        datos.length = 0;
        colisiones.length = 0;
        CALLES = []; CASAS = []; CAMAS = []; MUNDO_INICIAL = [];
        PUERTAS = []; VENTANAS = []; NPCS = [];

        const R = crearAzar(semilla);
        const rnd = function (a, b) { return a + R() * (b - a); };
        const ent = function (a, b) { return Math.floor(rnd(a, b + 1)); };
        const elegir = function (l) { return l[Math.floor(R() * l.length)]; };
        const M = MUNDO_MITAD;
        const solapa = function (a, b, m) {      // dos rectángulos [x1, z1, x2, z2] (con margen m)
            return a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
        };

        // Suelo
        caja(-M, -0.1, -M, M, 0, M, [0.25, 0.26, 0.28], false);

        // Muro de afuera: que no te dejen salir del mapa
        caja(-M - 1, 0, -M - 1, M + 1, 3, -M, ESCOMBRO, true);
        caja(-M - 1, 0, M, M + 1, 3, M + 1, ESCOMBRO, true);
        caja(-M - 1, 0, -M, -M, 3, M, ESCOMBRO, true);
        caja(M, 0, -M, M + 1, 3, M, ESCOMBRO, true);

        // ----- Calles: 1 o 2 en cada dirección, en lugares y con anchos al azar -----
        function centrosCalles(n) {
            const lista = [];
            for (let i = 0; i < 60 && lista.length < n; i++) {
                const c = rnd(-M + 18, M - 18);
                if (lista.every(function (o) { return Math.abs(o - c) >= 26; })) lista.push(c);
            }
            if (lista.length === 0) lista.push(0);
            return lista.sort(function (a, b) { return a - b; });
        }
        const callesH = centrosCalles(ent(1, 2)).map(function (c) { const w = rnd(4, 5.6); return [c - w / 2, c + w / 2]; });   // z
        const callesV = centrosCalles(ent(1, 2)).map(function (c) { const w = rnd(4, 5.6); return [c - w / 2, c + w / 2]; });   // x
        callesH.forEach(function (c) { CALLES.push([-M, c[0], M, c[1]]); });
        callesV.forEach(function (c) { CALLES.push([c[0], -M, c[1], M]); });
        CALLES.forEach(function (c) { caja(c[0], -0.1, c[1], c[2], 0.02, c[3], CALLE_COLOR, false); });

        // Manzanas: los terrenos que quedan entre las calles
        function tramos(calles) {
            const t = [];
            let ini = -M;
            calles.forEach(function (c) { t.push([ini, c[0]]); ini = c[1]; });
            t.push([ini, M]);
            return t;
        }
        const tx = tramos(callesV), tz = tramos(callesH);
        const manzanas = [];
        tx.forEach(function (ax, i) {
            tz.forEach(function (az, j) {
                manzanas.push({
                    r: [ax[0], az[0], ax[1], az[1]],
                    calle: { xm: i > 0, xM: i < tx.length - 1, zm: j > 0, zM: j < tz.length - 1 }   // qué lados tienen calle
                });
            });
        });

        // ----- Casas -----
        const casas = [];
        const muebles = [];     // en el mundo: [x1, z1, x2, z2, alto]
        const pasillos = [];    // zonas que deben quedar libres afuera (frente de las puertas)

        function construirCasa(W, D, cx, cz, f) {
            const w = W / 2, d = D / 2, t = 0.3;
            // pasa de las coordenadas de la casa (la puerta mira a +z) a las del mundo
            function T(x, z) {
                if (f === 0) return [cx + x, cz + z];
                if (f === 1) return [cx - x, cz - z];
                if (f === 2) return [cx + z, cz - x];
                return [cx - z, cz + x];
            }
            function rectMundo(x1, z1, x2, z2) {
                const a = T(x1, z1), b = T(x2, z2);
                return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
            }
            function cl(x1, y1, z1, x2, y2, z2, col, solida) {
                const r = rectMundo(x1, z1, x2, z2);
                caja(r[0], y1, r[1], r[2], y2, r[3], col, solida);
            }
            // Pared con aberturas (puertas y ventanas). horiz = la pared va a lo largo de x.
            function pared(horiz, fa, fb, a, b, aberturas) {
                const pieza = function (p1, p2, y1, y2, solida, col) {
                    if (p2 - p1 < 0.01) return;
                    if (horiz) cl(p1, y1, fa, p2, y2, fb, col || PARED, solida);
                    else cl(fa, y1, p1, fb, y2, p2, col || PARED, solida);
                };
                let cur = a;
                aberturas.slice().sort(function (p, q) { return p.a - q.a; }).forEach(function (ab) {
                    pieza(cur, ab.a, 0, ALTO_PARED, true);
                    if (ab.y1 > 0) pieza(ab.a, ab.b, 0, ab.y1, true);
                    pieza(ab.a, ab.b, ab.y2, ALTO_PARED, !!ab.esPuerta);
                    cur = ab.b;
                });
                pieza(cur, b, 0, ALTO_PARED, true);
            }

            // Piso de madera
            cl(-w, 0, -d, w, 0.02, d, PISO_CASA, false);

            // Puerta (al frente) y ventanas
            const dp = 1.6;
            const px0 = rnd(-w + 1.6, w - 2.9);
            const puerta = { a: px0 - dp / 2, b: px0 + dp / 2, y1: 0, y2: 2.2, esPuerta: true };
            const ventanasDe = function (lo, hi, max) {
                const lista = [];
                const n = ent(0, max);
                for (let i = 0; i < n; i++) {
                    for (let k = 0; k < 12; k++) {
                        const a = rnd(lo, hi - 1.2);
                        if (hi - 1.2 < lo) break;
                        if (lista.every(function (o) { return a + 1.2 < o.a - 0.5 || a > o.b + 0.5; })) {
                            lista.push({ a: a, b: a + 1.2, y1: 0.9, y2: 2.1 });
                            break;
                        }
                    }
                }
                return lista;
            };
            let vFrente = ventanasDe(-w + t + 0.7, puerta.a - 0.7, 1);
            let vAtras = ventanasDe(-w + t + 0.7, w - t - 0.7, 2);
            let vIzq = ventanasDe(-d + t + 0.7, d - t - 0.7, 1);
            let vDer = ventanasDe(-d + t + 0.7, d - t - 0.7, 1);
            if (vFrente.length + vAtras.length + vIzq.length + vDer.length < 2) {
                vAtras = ventanasDe(-w + t + 0.7, w - t - 0.7, 2);
                if (vAtras.length === 0) vAtras = [{ a: -0.6, b: 0.6, y1: 0.9, y2: 2.1 }];
            }

            pared(true, d - t, d, -w, w, [puerta].concat(vFrente));             // adelante
            pared(true, -d, -d + t, -w, w, vAtras);                              // atrás
            pared(false, -w, -w + t, -d + t, d - t, vIzq);                       // izquierda
            pared(false, w - t, w, -d + t, d - t, vDer);                         // derecha

            // Marco de la puerta (la hoja se dibuja aparte porque se abre y se cierra)
            // (sobresale un poco hacia la abertura: si no, sus caras quedaban pegadas a las de la pared y titilaban)
            cl(puerta.a - 0.1, 0, d - t - 0.05, puerta.a + 0.02, 2.3, d + 0.05, MADERA, false);
            cl(puerta.b - 0.02, 0, d - t - 0.05, puerta.b + 0.1, 2.3, d + 0.05, MADERA, false);
            cl(puerta.a - 0.1, 2.18, d - t - 0.05, puerta.b + 0.1, 2.3, d + 0.05, MADERA, false);

            const idCasa = casas.length;
            const O = T(0, 0);
            const vecMundo = function (dx, dz) { const q = T(dx, dz); return [q[0] - O[0], q[1] - O[1]]; };
            {
                const rc = rectMundo(puerta.a, d - t, puerta.b, d);
                PUERTAS.push({
                    esPuerta: true, k: "p" + idCasa, casa: idCasa,
                    bis: T(puerta.b, d - t / 2),                 // la bisagra
                    dirC: vecMundo(-1, 0), dirA: vecMundo(0, -1),   // hacia dónde mira la hoja cerrada y abierta (se abre hacia adentro)
                    largo: dp - 0.05, rect: rc, centro: T((puerta.a + puerta.b) / 2, d - t / 2),
                    col: colisionSola(rc[0], 0, rc[1], rc[2], 2.2, rc[3]), alto: 2.2,
                    abierta: false, trabada: false, llave: -1, ang: 0, ini: { a: false, t: false }
                });
            }

            // Ventanas: marco fijo + dos hojas de vidrio que se abren hacia adentro (algunas quedan bloqueadas)
            const nuevaVentana = function (v, lado, n) {
                const horiz = lado === "f" || lado === "b";
                let fa, fb, normal;
                if (lado === "f") { fa = d - t; fb = d; normal = [0, -1]; }
                else if (lado === "b") { fa = -d; fb = -d + t; normal = [0, 1]; }
                else if (lado === "l") { fa = -w; fb = -w + t; normal = [1, 0]; }
                else { fa = w - t; fb = w; normal = [-1, 0]; }
                const pc = (fa + fb) / 2;
                const P = function (s0) { return horiz ? T(s0, pc) : T(pc, s0); };    // punto de la pared (s0 = posición a lo largo)
                const mr = 0.06, sa = 0.05;
                if (horiz) {
                    cl(v.a - mr, v.y1 - mr, fa - sa, v.a + 0.02, v.y2 + mr, fb + sa, MADERA, false);
                    cl(v.b - 0.02, v.y1 - mr, fa - sa, v.b + mr, v.y2 + mr, fb + sa, MADERA, false);
                    cl(v.a, v.y2 - 0.02, fa - sa, v.b, v.y2 + mr, fb + sa, MADERA, false);
                    cl(v.a, v.y1 - mr, fa - sa, v.b, v.y1 + 0.015, fb + sa, MADERA, false);
                } else {
                    cl(fa - sa, v.y1 - mr, v.a - mr, fb + sa, v.y2 + mr, v.a + 0.02, MADERA, false);
                    cl(fa - sa, v.y1 - mr, v.b - 0.02, fb + sa, v.y2 + mr, v.b + mr, MADERA, false);
                    cl(fa - sa, v.y2 - 0.02, v.a, fb + sa, v.y2 + mr, v.b, MADERA, false);
                    cl(fa - sa, v.y1 - mr, v.a, fb + sa, v.y1 + 0.015, v.b, MADERA, false);
                }
                const rv = horiz ? rectMundo(v.a, fa, v.b, fb) : rectMundo(fa, v.a, fb, v.b);
                const A0 = P(v.a), A1 = P(v.b);
                const ux = A1[0] - A0[0], uz = A1[1] - A0[1], ul = Math.hypot(ux, uz) || 1;
                VENTANAS.push({
                    esPuerta: false, k: "v" + idCasa + "_" + n, casa: idCasa,
                    a0: A0, a1: A1, u: [ux / ul, uz / ul], dentro: vecMundo(normal[0], normal[1]),
                    y1: v.y1, y2: v.y2, ancho: v.b - v.a, rect: rv, centro: P((v.a + v.b) / 2),
                    col: colisionSola(rv[0], v.y1, rv[1], rv[2], v.y2, rv[3]), alto: v.y2,
                    abierta: false, bloqueada: false, rota: false, ang: 0, ini: { a: false, t: false }
                });
            };
            let nv = 0;
            vFrente.forEach(function (v) { nuevaVentana(v, "f", nv++); });
            vAtras.forEach(function (v) { nuevaVentana(v, "b", nv++); });
            vIzq.forEach(function (v) { nuevaVentana(v, "l", nv++); });
            vDer.forEach(function (v) { nuevaVentana(v, "r", nv++); });

            // Pared de adentro (a veces), con un pasillo
            const prohibido = [];      // zonas libres de muebles, en las coordenadas de la casa
            const tabiques = [];       // paredes de adentro, en el mundo
            prohibido.push([puerta.a - 0.6, d - t - 2.4, puerta.b + dp + 0.4, d]);
            if ((W >= 10 || D >= 10) && R() < 0.65) {
                const zp = rnd(-d + 3.8, d - 3.8);
                const gx = rnd(-w + t + 1.6, w - t - 1.6);
                pared(true, zp - 0.1, zp + 0.1, -w + t, w - t, [{ a: gx - 0.7, b: gx + 0.7, y1: 0, y2: 2.2, esPuerta: true }]);
                tabiques.push(rectMundo(-w + t, zp - 0.1, w - t, zp + 0.1));
                prohibido.push([gx - 1.3, zp - 1.1, gx + 1.3, zp + 1.1]);
                prohibido.push([-w + t, zp - 0.5, w - t, zp + 0.5]);
            }

            // Techo: tres capas, la de abajo se pasa un poco de las paredes
            // (sólido: apoya justo sobre las paredes y no se puede atravesar ni de abajo ni de arriba)
            cl(-w - 0.4, ALTO_PARED, -d - 0.4, w + 0.4, ALTO_PARED + 0.27, d + 0.4, TECHO_COLOR, true);
            cl(-w + 0.6, ALTO_PARED + 0.27, -d + 0.6, w - 0.6, ALTO_PARED + 0.65, d - 0.6, [0.34, 0.21, 0.17], true);
            cl(-w + 2.0, ALTO_PARED + 0.65, -d + 2.0, w - 2.0, ALTO_PARED + 1.0, d - 2.0, [0.28, 0.16, 0.13], true);

            // Muebles
            const tipos = [
                { n: "mesa", a: 2, b: 1, h: 0.8, c: MADERA },
                { n: "estante", a: 1.1, b: 0.9, h: 2, c: MADERA },
                { n: "armario", a: 1.4, b: 0.8, h: 2.2, c: [0.36, 0.24, 0.15] },
                { n: "caja", a: 1, b: 1, h: 1, c: CAJA },
                { n: "cajita", a: 1, b: 1, h: 0.6, c: CAJA },
                { n: "sofa", a: 2.2, b: 0.9, h: 0.7, c: [0.35, 0.40, 0.45] },
                { n: "mesita", a: 0.8, b: 0.8, h: 0.7, c: MADERA }
            ];
            const locales = [];       // [x1, z1, x2, z2, alto]
            function intentarMueble(tipo) {
                for (let k = 0; k < 50; k++) {
                    let a = tipo.a, b = tipo.b;
                    if (R() < 0.5) { const s = a; a = b; b = s; }
                    const lx1 = -w + t + 0.12, lx2 = w - t - 0.12, lz1 = -d + t + 0.12, lz2 = d - t - 0.12;
                    let x = rnd(lx1, lx2 - a), z = rnd(lz1, lz2 - b);
                    if (R() < 0.7) {                                   // pegado a una pared
                        const lado = ent(0, 3);
                        if (lado === 0) x = lx1; else if (lado === 1) x = lx2 - a;
                        else if (lado === 2) z = lz1; else z = lz2 - b;
                    }
                    const r = [x, z, x + a, z + b];
                    if (r[0] < lx1 - 0.001 || r[2] > lx2 + 0.001 || r[1] < lz1 - 0.001 || r[3] > lz2 + 0.001) continue;
                    if (prohibido.some(function (p) { return solapa(r, p, 0); })) continue;
                    if (locales.some(function (o) { return solapa(r, o, 0.55); })) continue;
                    locales.push([r[0], r[1], r[2], r[3], tipo.h]);
                    cl(r[0], 0, r[1], r[2], tipo.h, r[3], tipo.c, true);
                    if (tipo.n === "cama") {
                        cl(r[0], tipo.h, r[1], r[2], tipo.h + 0.12, r[3], [0.78, 0.74, 0.70], false);    // almohada/sábana
                        CAMAS.push(rectMundo(r[0], r[1], r[2], r[3]));
                    }
                    const mw = rectMundo(r[0], r[1], r[2], r[3]);
                    muebles.push([mw[0], mw[1], mw[2], mw[3], tipo.h]);
                    return true;
                }
                return false;
            }
            intentarMueble({ n: "cama", a: 2, b: 2.6, h: 0.5, c: [0.6, 0.3, 0.3] });
            const cuantos = ent(3, 7);
            for (let i = 0; i < cuantos; i++) intentarMueble(elegir(tipos));

            // NPCs: 0 a 2 personas por casa, paradas o paseando por adentro (nunca en la entrada ni en el pasillo de la pared de adentro)
            {
                const RN = crearAzar((semilla ^ Math.imul(idCasa + 1, 0x9e3779b1)) >>> 0);
                const rn = function (a, b) { return a + RN() * (b - a); };
                const libreNpc = function (lx, lz) {
                    if (lx < -w + t + 0.55 || lx > w - t - 0.55 || lz < -d + t + 0.55 || lz > d - t - 0.55) return false;
                    if (prohibido.some(function (q) { return lx > q[0] - 0.4 && lx < q[2] + 0.4 && lz > q[1] - 0.4 && lz < q[3] + 0.4; })) return false;
                    if (locales.some(function (m) { return lx > m[0] - 0.45 && lx < m[2] + 0.45 && lz > m[1] - 0.45 && lz < m[3] + 0.45; })) return false;
                    return true;
                };
                const caminoLibre = function (ax, az, bx, bz) {
                    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
                    for (let i = 1; i <= n; i++) {
                        if (!libreNpc(ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false;
                    }
                    return true;
                };
                const r0 = RN();
                const cuantosNpc = r0 < 0.2 ? 0 : (r0 < 0.7 || W * D < 90) ? 1 : 2;
                const ropa = [["camisa", [0.30, 0.50, 0.80]], ["pantalon", [0.25, 0.30, 0.60]], ["gorra", [0.70, 0.20, 0.20]], ["botas", [0.40, 0.25, 0.12]]];
                const pieles = [[0.85, 0.65, 0.50], [0.70, 0.50, 0.36], [0.55, 0.38, 0.27], [0.92, 0.76, 0.62], [0.45, 0.30, 0.22]];
                const propios = [];
                for (let i = 0; i < cuantosNpc; i++) {
                    for (let k = 0; k < 60; k++) {
                        const lx = rn(-w + t + 0.6, w - t - 0.6), lz = rn(-d + t + 0.6, d - t - 0.6);
                        if (!libreNpc(lx, lz)) continue;
                        if (propios.some(function (o) { return Math.hypot(o.lx - lx, o.lz - lz) < 1.5; })) continue;
                        const eq = {};
                        if (RN() < 0.8) eq.torso = "camisa";
                        if (RN() < 0.7) eq.piernas = "pantalon";
                        if (RN() < 0.4) eq.cabeza = "gorra";
                        if (RN() < 0.5) eq.pies = "botas";
                        const wp = T(lx, lz);
                        const O = T(0, 0), ex = T(1, 0), ez = T(0, 1);
                        const exv = [ex[0] - O[0], ex[1] - O[1]], ezv = [ez[0] - O[0], ez[1] - O[1]];
                        const rt = RN();
                        // carácter: agresivo (te ataca apenas entrás), defensor (tolera hasta que le robás o le pegás),
                        // cobarde (se escapa al fondo), pacífico (no te hace nada ni así)
                        const tipo = rt < 0.35 ? "agresivo" : rt < 0.60 ? "defensor" : rt < 0.80 ? "cobarde" : "pacifico";
                        const npc = {
                            tipo: tipo, hp: { agresivo: 45, defensor: 40, cobarde: 25, pacifico: 30 }[tipo],
                            i: NPCS.length, oyeVoz: false, distVoz: 0, calmaPor: {}, asustadoPor: {}, confPor: {}, dio: false, golpeSeq: 0, ofendidoPor: {}, golpeadoPor: {}, caido: false, blanco: null,
                            alerta: 0, cd: 0, pendiente: 0, golpeT: 99, habloMs: -1e9, vel: 0, giroHuida: 0,
                            aLocal: function (wx, wz) {
                                return [(wx - O[0]) * exv[0] + (wz - O[1]) * exv[1], (wx - O[0]) * ezv[0] + (wz - O[1]) * ezv[1]];
                            },
                            libreMov: function (qx, qz) {       // para perseguir o huir: solo paredes y muebles (la entrada sí se puede pisar)
                                if (qx < -w + t + 0.4 || qx > w - t - 0.4 || qz < -d + t + 0.4 || qz > d - t - 0.4) return false;
                                return !locales.some(function (m) { return qx > m[0] - 0.4 && qx < m[2] + 0.4 && qz > m[1] - 0.4 && qz < m[3] + 0.4; });
                            },
                            casa: idCasa, T: T, libre: libreNpc, camino: caminoLibre, w: w, d: d, t: t,
                            lx: lx, lz: lz, x: wp[0], z: wp[1], tx: lx, tz: lz,
                            estado: "para", espera: rn(0.5, 5),
                            cuerpo: RN() * 6.283, giroCab: 0, fase: RN() * 6, mov: 0,
                            base: pieles[Math.floor(RN() * pieles.length)], eq: eq,
                            col: colisionSola(wp[0] - 0.3, 0, wp[1] - 0.3, wp[0] + 0.3, 1.8, wp[1] + 0.3)
                        };
                        propios.push(npc);
                        NPCS.push(npc);
                        break;
                    }
                }
            }

            const rm = rectMundo(-w, -d, w, d);
            CASAS.push(rm);
            const frente = T(px0, d + 2.8);
            pasillos.push([frente[0] - 2.5, frente[1] - 2.5, frente[0] + 2.5, frente[1] + 2.5]);
            const normal = [[0, 1], [0, -1], [1, 0], [-1, 0]][f];
            casas.push({
                rect: rm, locales: locales, tabiques: tabiques, T: T, w: w, d: d, t: t,
                spawn: { x: T(px0, d + 3)[0], z: T(px0, d + 3)[1], yaw: Math.atan2(normal[0], normal[1]) }
            });
        }

        // Cada manzana recibe 0 a 2 casas, mirando a una de sus calles
        manzanas.forEach(function (mz) {
            const objetivo = ent(1, 2);
            let puestas = 0;
            for (let intento = 0; intento < 25 && puestas < objetivo; intento++) {
                const W = rnd(9.5, 14.5), D = rnd(9.5, 13.5);
                const lados = [];
                if (mz.calle.zM) lados.push(0);       // mira a +z
                if (mz.calle.zm) lados.push(1);       // mira a -z
                if (mz.calle.xM) lados.push(2);       // mira a +x
                if (mz.calle.xm) lados.push(3);       // mira a -x
                const f = elegir(lados);
                const ancho = f < 2 ? W : D, fondo = f < 2 ? D : W;     // tamaño en el mundo
                const r = mz.r;
                const libreX = (r[2] - r[0]) - ancho - 5, libreZ = (r[3] - r[1]) - fondo - 5;
                if (libreX < 0 || libreZ < 0) continue;
                const x1 = r[0] + 2.5 + R() * libreX, z1 = r[1] + 2.5 + R() * libreZ;
                const rect = [x1, z1, x1 + ancho, z1 + fondo];
                if (casas.some(function (c) { return solapa(rect, c.rect, 3.5); })) continue;
                construirCasa(W, D, (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2, f);
                puestas++;
            }
        });
        // por si ninguna entró (no debería pasar): una casa en el centro de la manzana más grande
        if (casas.length === 0) {
            const g = manzanas.slice().sort(function (a, b) { return (b.r[2] - b.r[0]) * (b.r[3] - b.r[1]) - (a.r[2] - a.r[0]) * (a.r[3] - a.r[1]); })[0];
            construirCasa(11, 11, (g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2, g.calle.zM ? 0 : g.calle.zm ? 1 : g.calle.xM ? 2 : 3);
        }

        // Cajas y escombros sueltos afuera
        const afuera = [];      // [x1, z1, x2, z2, alto]
        manzanas.forEach(function (mz) {
            const n = ent(1, 4);
            for (let i = 0; i < n; i++) {
                for (let k = 0; k < 20; k++) {
                    const esCaja = R() < 0.4;
                    const a = esCaja ? 1.2 : rnd(1, 2.2), b = esCaja ? 1.2 : rnd(1, 2.2);
                    const h = esCaja ? rnd(0.7, 1.3) : rnd(1, 4.5);
                    if ((mz.r[2] - mz.r[0]) < a + 3 || (mz.r[3] - mz.r[1]) < b + 3) break;
                    const x = rnd(mz.r[0] + 1.5, mz.r[2] - 1.5 - a), z = rnd(mz.r[1] + 1.5, mz.r[3] - 1.5 - b);
                    const rect = [x, z, x + a, z + b];
                    if (casas.some(function (c) { return solapa(rect, c.rect, 1.5); })) continue;
                    if (pasillos.some(function (p) { return solapa(rect, p, 0); })) continue;
                    if (afuera.some(function (o) { return solapa(rect, o, 1); })) continue;
                    afuera.push([rect[0], rect[1], rect[2], rect[3], h]);
                    caja(rect[0], 0, rect[1], rect[2], h, rect[3], esCaja ? CAJA : ESCOMBRO, true);
                    break;
                }
            }
        });

        // ----- Objetos sueltos -----
        const puestos = [];
        function libreDeOtros(x, z) { return puestos.every(function (p) { return Math.hypot(p.x - x, p.z - z) > 0.9; }); }
        function puntoEnCasa(c) {
            for (let k = 0; k < 300; k++) {
                const lx = rnd(-c.w + c.t + 0.5, c.w - c.t - 0.5), lz = rnd(-c.d + c.t + 0.5, c.d - c.t - 0.5);
                const p = c.T(lx, lz);
                if (!libreDeOtros(p[0], p[1])) continue;
                if (c.tabiques.some(function (q) { return solapa([p[0] - 0.3, p[1] - 0.3, p[0] + 0.3, p[1] + 0.3], q, 0); })) continue;
                let y = 0, ok = true;
                for (const m of muebles) {
                    if (p[0] > m[0] - 0.25 && p[0] < m[2] + 0.25 && p[1] > m[1] - 0.25 && p[1] < m[3] + 0.25) {
                        const dentro = p[0] > m[0] + 0.2 && p[0] < m[2] - 0.2 && p[1] > m[1] + 0.2 && p[1] < m[3] - 0.2;
                        if (dentro && m[4] <= 1.2) y = Math.max(y, m[4]); else ok = false;
                    }
                }
                if (ok) return { x: p[0], y: y, z: p[1] };
            }
            const p = c.T(0, 0);
            return { x: p[0], y: 0, z: p[1] };
        }
        function puntoAfuera() {
            for (let k = 0; k < 80; k++) {
                const mz = elegir(manzanas);
                const x = rnd(mz.r[0] + 1.5, mz.r[2] - 1.5), z = rnd(mz.r[1] + 1.5, mz.r[3] - 1.5);
                const rect = [x - 0.4, z - 0.4, x + 0.4, z + 0.4];
                if (casas.some(function (c) { return solapa(rect, c.rect, 0.8); })) continue;
                if (afuera.some(function (o) { return solapa(rect, o, 0.3); })) continue;
                if (pasillos.some(function (p) { return solapa(rect, p, 0); })) continue;
                if (!libreDeOtros(x, z)) continue;
                return { x: x, y: 0, z: z };
            }
            return { x: SPAWN.x + 3, y: 0, z: SPAWN.z };
        }
        function poner(id, p) { puestos.push({ id: id, x: p.x, y: p.y, z: p.z }); }

        // La casa más cercana al centro es la de arranque: ahí aparecés enfrente y están la mochila y la ropa
        const inicial = casas.slice().sort(function (a, b) {
            const da = Math.hypot((a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2);
            const db = Math.hypot((b.rect[0] + b.rect[2]) / 2, (b.rect[1] + b.rect[3]) / 2);
            return da - db;
        })[0];
        SPAWN = inicial.spawn;
        casaPropia = { idx: casas.indexOf(inicial), rect: inicial.rect, spawnFuera: inicial.spawn, spawnDentro: puntoLibreAdentro(inicial) };
        const R2 = crearAzar((semilla ^ 0x5bd1e995) >>> 0);
        const casasConLlave = [];
        casas.forEach(function (c, i) {
            const pu = PUERTAS[i];
            const esInicial = c === inicial;
            const conLlave = !esInicial && R2() < 0.45;
            if (conLlave) { pu.trabada = true; pu.llave = i; casasConLlave.push(i); }
            const vs = VENTANAS.filter(function (v) { return v.casa === i; });
            const pBloq = esInicial ? 0.2 : (conLlave ? 0.8 : 0.3);
            vs.forEach(function (v) { v.bloqueada = R2() < pBloq; });
            // la casa de arranque (y las que no tienen llave) siempre tienen al menos una ventana que se abre
            if (vs.length && vs.every(function (v) { return v.bloqueada; }) && !conLlave) vs[0].bloqueada = false;
        });
        PUERTAS.concat(VENTANAS).forEach(function (o) {
            o.ini = { a: false, t: !!o.trabada };
            o.ang = 0;
            fijarAbertura(o, false, o.trabada);
        });
        ["mochila", "camisa", "pantalon", "gorra", "botas", "muletas"].forEach(function (id) { poner(id, puntoEnCasa(inicial)); });
        ["agua", "agua", "agua", "comida", "comida", "comida", "jarabe", "jarabe", "palo", "cuchillo"].forEach(function (id) {
            poner(id, puntoEnCasa(elegir(casas)));
        });
        ["anabolico", "hacha"].forEach(function (id) {
            poner(id, R() < 0.5 ? puntoAfuera() : puntoEnCasa(elegir(casas)));
        });
        casasConLlave.forEach(function (i) {
            const libres = casas.filter(function (c, j) { return j !== i && !PUERTAS[j].trabada; });
            const p = (R2() < 0.3 || libres.length === 0) ? puntoAfuera() : puntoEnCasa(libres[Math.floor(R2() * libres.length)]);
            poner("llave" + i, p);
        });
        // vendas (se ponen al final para no cambiar dónde caen los demás objetos del mapa)
        ["venda", "venda", "venda", "venda"].forEach(function (id) { poner(id, puntoEnCasa(elegir(casas))); });
        MUNDO_INICIAL = puestos;

        cantidad = datos.length / 6;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(datos), gl.STATIC_DRAW);

        // el barrio entero queda guardado: mientras estás en tu casa no se dibuja ni se mueve nada de afuera
        COMPLETO = { datos: datos, colisiones: colisiones.slice(), PUERTAS: PUERTAS, VENTANAS: VENTANAS, NPCS: NPCS, casa: null };
        zona = "barrio";
    }

    // ===== ZONAS =====
    // Arrancás adentro de tu casa: una zona cerrada y no carga nada más. Podés salir por la puerta cuando quieras y elegir a dónde ir (ver "SALIR DE CASA"). Por ahora el único lugar que se puede
    // elegir son las casas que ya están hechas (el "barrio"); los demás lugares están los botones pero vacíos.
    const PATIO = 1.8;                 // el terreno cerrado que rodea la casa

    // Un punto libre adentro de la casa (sin tocar el azar del mapa, para que el mapa salga igual que siempre)
    function puntoLibreAdentro(c) {
        for (let r = 0; r <= 4; r += 0.5) {
            for (let k = 0; k < 16; k++) {
                const a = k / 16 * Math.PI * 2;
                const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
                if (lx < -c.w + c.t + 0.6 || lx > c.w - c.t - 0.6 || lz < -c.d + c.t + 0.6 || lz > c.d - c.t - 0.6) continue;
                const p = c.T(lx, lz);
                if (c.locales.some(function (m) { return lx > m[0] - 0.5 && lx < m[2] + 0.5 && lz > m[1] - 0.5 && lz < m[3] + 0.5; })) continue;
                if (c.tabiques.some(function (q) { return p[0] > q[0] - 0.5 && p[0] < q[2] + 0.5 && p[1] > q[1] - 0.5 && p[1] < q[3] + 0.5; })) continue;
                return { x: p[0], z: p[1], yaw: c.spawn.yaw };
            }
        }
        const q = c.T(0, 0);
        return { x: q[0], z: q[1], yaw: c.spawn.yaw };
    }

    // Solo la casa (paredes, techo, muebles, puertas y ventanas) + un patio cerrado alrededor
    function prepararCasa() {
        if (COMPLETO.casa) return COMPLETO.casa;
        const r = casaPropia.rect, m = 1.3;
        const x1 = r[0] - m, z1 = r[1] - m, x2 = r[2] + m, z2 = r[3] + m;
        const d = COMPLETO.datos, out = [];
        const dentro = function (i) { return d[i] >= x1 && d[i] <= x2 && d[i + 2] >= z1 && d[i + 2] <= z2; };
        for (let i = 0; i + 17 < d.length; i += 18) {         // 3 puntas por triángulo, 6 números por punta
            if (dentro(i) && dentro(i + 6) && dentro(i + 12)) for (let k = 0; k < 18; k++) out.push(d[i + k]);
        }
        const px1 = r[0] - PATIO, pz1 = r[1] - PATIO, px2 = r[2] + PATIO, pz2 = r[3] + PATIO;
        caja(px1, -0.1, pz1, px2, 0, pz2, [0.25, 0.26, 0.28], false, out);       // suelo del patio
        const cols = [];
        const esp = 0.8, alto = 4.5;
        [[px1 - esp, pz1 - esp, px2 + esp, pz1], [px1 - esp, pz2, px2 + esp, pz2 + esp], [px1 - esp, pz1, px1, pz2], [px2, pz1, px2 + esp, pz2]].forEach(function (w) {
            caja(w[0], 0, w[1], w[2], alto, w[3], ESCOMBRO, false, out);        // muro que cierra la zona
            cols.push([w[0], w[1], w[2], w[3], alto, 0]);
        });
        const colsNpc = new Set(COMPLETO.NPCS.map(function (n) { return n.col; }));
        COMPLETO.colisiones.forEach(function (c) {
            if (colsNpc.has(c)) return;
            if (c[0] < x2 && c[2] > x1 && c[1] < z2 && c[3] > z1) cols.push(c);
        });
        COMPLETO.casa = {
            datos: out, colisiones: cols,
            PUERTAS: COMPLETO.PUERTAS.filter(function (o) { return o.casa === casaPropia.idx; }),
            VENTANAS: COMPLETO.VENTANAS.filter(function (o) { return o.casa === casaPropia.idx; })
        };
        return COMPLETO.casa;
    }

    function cargarBuffer(arr) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        cantidad = arr.length / 6;
    }

    // Cambia lo que está cargado: "casa" (solo tu casa) o "barrio" (todo)
    function entrarZona(z) {
        if (!COMPLETO || !casaPropia) return;
        if (z === "super" || z === "comercio") { entrarLugar(z); return; }
        itemsLugar = [];
        zona = z;
        colisiones.length = 0;
        if (z === "casa") {
            const h = prepararCasa();
            h.colisiones.forEach(function (c) { colisiones.push(c); });
            PUERTAS = h.PUERTAS; VENTANAS = h.VENTANAS; NPCS = [];
            cargarBuffer(h.datos);
        } else {
            COMPLETO.colisiones.forEach(function (c) { colisiones.push(c); });
            PUERTAS = COMPLETO.PUERTAS; VENTANAS = COMPLETO.VENTANAS; NPCS = COMPLETO.NPCS;
            cargarBuffer(COMPLETO.datos);
        }
    }
    // Puertas y ventanas de TODO el barrio (para guardar, para el servidor y para reiniciar)
    function todasAberturas() {
        return COMPLETO ? COMPLETO.PUERTAS.concat(COMPLETO.VENTANAS) : PUERTAS.concat(VENTANAS);
    }
    function enPatio(x, z) {
        const r = casaPropia && casaPropia.rect;
        return !!r && x > r[0] - PATIO - 0.5 && x < r[2] + PATIO + 0.5 && z > r[1] - PATIO - 0.5 && z < r[3] + PATIO + 0.5;
    }
    // Solo se ven y se tocan entre sí los jugadores que están en la misma zona
    function mismaZona(j) { return ((j && j.zn) | 0) === codigoZona(); }

    construirMundo(1);

    // ===== SHADERS =====
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, `
        attribute vec3 posicion;
        attribute vec3 color;
        uniform mat4 camara;
        uniform vec3 tinte;
        varying vec3 vColor;
        varying float vDist;

        void main() {
            gl_Position = camara * vec4(posicion, 1.0);
            vColor = color * tinte;
            vDist = gl_Position.w;
        }
    `);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, `
        precision mediump float;
        uniform vec3 fondo;
        uniform float nieblaDist;
        uniform float alfa;
        varying vec3 vColor;
        varying float vDist;

        void main() {
            float niebla = clamp(vDist / nieblaDist, 0.0, 1.0);
            
            gl_FragColor = vec4(mix(vColor, fondo, niebla), alfa);
        }
    `);
    gl.compileShader(fragmentShader);

    const programa = gl.createProgram();
    gl.attachShader(programa, vertexShader);
    gl.attachShader(programa, fragmentShader);
    gl.linkProgram(programa);
    gl.useProgram(programa);

    const posicion = gl.getAttribLocation(programa, "posicion");
    gl.enableVertexAttribArray(posicion);
    gl.vertexAttribPointer(posicion, 3, gl.FLOAT, false, 24, 0);

    const color = gl.getAttribLocation(programa, "color");
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);

    const uCamara = gl.getUniformLocation(programa, "camara");

    gl.enable(gl.DEPTH_TEST);

    const uTinte = gl.getUniformLocation(programa, "tinte");
    const uFondo = gl.getUniformLocation(programa, "fondo");
    const uNiebla = gl.getUniformLocation(programa, "nieblaDist");
    gl.uniform3f(uTinte, 1, 1, 1);
    gl.uniform3f(uFondo, 0.10, 0.11, 0.14);
    gl.uniform1f(uNiebla, 35);
    const uAlfa = gl.getUniformLocation(programa, "alfa");
    gl.uniform1f(uAlfa, 1);

    // ===== JUGADOR =====
    let px = 0;
    let pz = 9;
    const altura = 1.6;
    const radio = 0.3;
    let yaw = 0;
    let pitch = 0;

    // Postura: 0 de pie, 1 agachado, 2 arrastrándote
    let postura = 0;
    let alturaCam = altura;
    // Combate: con los puños levantados (modoPelea) podés pegar, con lo que tengas en la mano o sin nada
    let modoPelea = false;
    let peleaHasta = 0;
    let ultimoGolpe = 0;
    let animMov = 0, animFase = 0, animCorre = false;   // animación del cuerpo en la vista previa
    let golpeT = 99;          // segundos desde el último golpe (para la animación)
    let golpesN = 0;          // cuenta de golpes (para que los demás vean tu animación)
    let avisoPeleaT = 0;
    let avisoSaltoT = 0;
    // Ruido: hasta dónde te pueden detectar ahora (agachado y arrastrándote hacen menos)
    let ruidoPulso = 0;       // ruido puntual (saltos, golpes, caídas) que se apaga solo
    let ruidoRadio = 0;

    // Escalón que se sube solo (para "agarrarte" del borde de una caja al saltar)
    const PASO = 0.35;

    // ¿Hay una caja sólida que te frena a esta altura? Si tus pies están más arriba que su techo, pasás por encima.
    // Qué tan alta tenés la cabeza según la postura (para pasar por debajo de cosas)
    function alturaCuerpo() { return (postura === 2 ? 0.45 : postura === 1 ? 1.05 : altura) + 0.1; }

    // Ahora cada caja sabe también desde qué altura empieza (b[5]): el techo solo te frena si te pegás la cabeza con él.
    function choca(x, z, y, h) {
        const cab = y + (h == null ? alturaCuerpo() : h);
        for (const b of colisiones) {
            if (x + radio > b[0] && x - radio < b[2] &&
                z + radio > b[1] && z - radio < b[3] &&
                y < b[4] - PASO && cab > b[5]) {
                return true;
            }
        }
        return false;
    }

    // Al subir (salto) no podés atravesar un techo ni un cabezal: te frena la cabeza
    function limiteCabeza(x, z, yAntes, yNueva) {
        const cab = alturaCuerpo();
        let tope = null;
        for (const b of colisiones) {
            if (x + radio > b[0] && x - radio < b[2] && z + radio > b[1] && z - radio < b[3] &&
                b[5] >= yAntes + cab - 0.001 && yNueva + cab > b[5] &&
                (tope === null || b[5] < tope)) tope = b[5];
        }
        return tope === null ? null : tope - cab - 0.001;
    }

    // Altura del piso bajo (x, z): el techo más alto de las cajas que están a tus pies
    function alturaSuelo(x, z, y, r) {
        const rr = r == null ? radio : r;
        let h = 0;
        for (const b of colisiones) {
            if (x + rr > b[0] && x - rr < b[2] && z + rr > b[1] && z - rr < b[3] &&
                b[4] <= y + PASO && b[4] > h) {
                h = b[4];
            }
        }
        return h;
    }

    // ===== AJUSTES (se guardan en el dispositivo) =====
    const AJUSTES_BASE = {
        sensMouse: 1,
        sensDedo: 1,
        volumen: 1,
        silencio: false,
        invertirY: false,
        colorPersonaje: "",   // "#rrggbb" elegido en Configuración > Personaje (vacío = el color que te toca)
        teclas: {
            adelante: "KeyW",
            atras: "KeyS",
            izquierda: "KeyA",
            derecha: "KeyD",
            saltar: "Space",
            correr: "ShiftLeft",
            agachar: "KeyC",
            arrastrar: "KeyZ",
            pelea: "KeyF",
            inventario: "KeyI",
            interactuar: "KeyE",
            tirar: "KeyQ"
        },
        inventario: null,   // lugar y tamaño del inventario: { fx, fy, k } (fx, fy = esquina de arriba a la izquierda, en fracción de la pantalla)
        botones: {}      // posición de los botones del celular que el jugador movió: { id: { fx, fy } } (centro, en fracción de la pantalla)
    };

    function hexARgb(h) {
        const m = /^#([0-9a-f]{6})$/i.exec(h || "");
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    window.Ajustes = (function () {
        const datos = JSON.parse(JSON.stringify(AJUSTES_BASE));
        try {
            const guardado = JSON.parse(localStorage.getItem("rainster_ajustes"));
            if (guardado) {
                Object.assign(datos, guardado);
                datos.teclas = Object.assign({}, AJUSTES_BASE.teclas, guardado.teclas || {});
            }
        } catch (e) {}
        return {
            datos: datos,
            guardar: function () {
                try { localStorage.setItem("rainster_ajustes", JSON.stringify(datos)); } catch (e) {}
            },
            restablecerControles: function () {
                datos.teclas = Object.assign({}, AJUSTES_BASE.teclas);
                datos.invertirY = false;
                datos.botones = {};
                datos.inventario = null;
                this.guardar();
                if (window.Botones) window.Botones.aplicar();
            },
            volumenFinal: function () {
                return datos.silencio ? 0 : datos.volumen;
            }
        };
    })();
    const A = window.Ajustes.datos;

    // ===== CONTROLES =====
    const teclas = {};

    window.addEventListener("keydown", function (e) {
        teclas[e.code] = true;
    });

    window.addEventListener("keyup", function (e) {
        teclas[e.code] = false;
    });

    canvas.addEventListener("click", function () {
        canvas.requestPointerLock();
    });

    document.addEventListener("mousemove", function (e) {
        if (document.pointerLockElement !== canvas || window.juegoPausado || window.chatAbierto) return;
        yaw -= e.movementX * 0.002 * A.sensMouse;
        pitch -= e.movementY * 0.002 * A.sensMouse * (A.invertirY ? -1 : 1);
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    });

    // ===== CONTROLES TÁCTILES (celular) =====
    let joyAdelante = 0;
    let joyLado = 0;
    let dedoMover = null;
    let dedoMirar = null;
    let inicioX = 0;
    let inicioY = 0;
    let miraX = 0;
    let miraY = 0;

    canvas.style.touchAction = "none";

    // En la pantalla táctil, cualquier dedo sobre el juego mira; para moverte está el joystick de abajo a la izquierda
    canvas.addEventListener("touchstart", function (e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (dedoMirar === null) {
                dedoMirar = t.identifier;
                miraX = t.clientX;
                miraY = t.clientY;
            }
        }
    }, { passive: false });

    canvas.addEventListener("touchmove", function (e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier === dedoMirar) {
                yaw -= (t.clientX - miraX) * 0.005 * A.sensDedo;
                pitch -= (t.clientY - miraY) * 0.005 * A.sensDedo * (A.invertirY ? -1 : 1);
                pitch = Math.max(-1.5, Math.min(1.5, pitch));
                miraX = t.clientX;
                miraY = t.clientY;
            }
        }
    }, { passive: false });

    function soltarDedo(e) {
        for (const t of e.changedTouches) {
            if (t.identifier === dedoMirar) {
                dedoMirar = null;
            }
        }
    }

    canvas.addEventListener("touchend", soltarDedo);
    canvas.addEventListener("touchcancel", soltarDedo);
    // Suelta todas las teclas y dedos (para cuando se abre la pausa)
    window.soltarControles = function () {
        for (const k in teclas) teclas[k] = false;
        joyAdelante = 0;
        joyLado = 0;
        dedoMover = null;
        dedoMirar = null;
        if (window.joystickCentrar) window.joystickCentrar();
    };

    // Cartel de ayuda
    const ayuda = document.createElement("div");
    ayuda.style.cssText =
        "position:fixed;top:190px;left:16px;color:white;" +
        "font-family:sans-serif;font-size:13px;line-height:1.3;" +
        "background:rgba(0,0,0,0.6);padding:10px;border-radius:8px;";
    ayuda.innerHTML =
        "Haz clic para jugar<br>" +
        "W A S D: moverte<br>" +
        "Mouse: mirar<br>" +
        "Flechas: mirar con el teclado<br>" +
        "Shift: correr<br>" +
        "C: agacharte · Z: arrastrarte<br>" +
        "F o click: pegar<br>" +
        "E: recoger / dormir (cerca de la cama) · Q: tirar<br>" +
        "I: inventario · 1-7: barra rápida · B: bailar<br>" +
        "Enter: escribirles a los NPCs · V: micrófono<br>" +
        "Esc: pausa"
    document.body.appendChild(ayuda); 
    if ("ontouchstart" in window) {
        ayuda.innerHTML = "Joystick: mover<br>Pantalla: mirar";
        ayuda.style.top = "210px";
        setTimeout(function () {
            ayuda.style.display = "none";
        }, 5000);
    }

    document.addEventListener("pointerlockchange", function () {
        ayuda.style.display =
            document.pointerLockElement === canvas ? "none" : "block";
    });

    // Al cambiar el tamaño el canvas se borra. En pausa el juego no dibuja, así que hay que avisar
    // para que vuelva a dibujar la escena (si no, detrás del menú de pausa se ve todo blanco).
    let pantallaCambio = false;
    function ajustarPantalla() {
        if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
        if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
        pantallaCambio = true;
    }

    window.addEventListener("resize", ajustarPantalla);
    // al girar el celular el tamaño nuevo a veces llega un rato después
    window.addEventListener("orientationchange", function () { setTimeout(ajustarPantalla, 150); setTimeout(ajustarPantalla, 500); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) pantallaCambio = true; });
    ajustarPantalla();

    // ===== MULTIJUGADOR =====
    let miId = null;
    let otros = {};
    const bufferOtros = gl.createBuffer();

    // Dibuja una caja girada hacia donde mira el jugador
    function cajaGirada(lista, cx, cz, giro, ancho, y1, y2, largo, desvio, col, lado) {
        const c = Math.cos(giro);
        const s = Math.sin(giro);

        function punto(lx, y, lz) {
            lz += desvio;
            lx += (lado || 0);
            return [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
        }

        const a = ancho / 2;
        const l = largo / 2;
        const p = [
            punto(-a, y1, -l), punto(a, y1, -l),
            punto(a, y1, l), punto(-a, y1, l),
            punto(-a, y2, -l), punto(a, y2, -l),
            punto(a, y2, l), punto(-a, y2, l)
        ];

        const caras = [
            [4, 5, 6, 7, 1.00],
            [0, 1, 5, 4, 0.85],
            [3, 2, 6, 7, 0.70],
            [0, 3, 7, 4, 0.60],
            [1, 2, 6, 5, 0.75],
            [0, 1, 2, 3, 0.50]
        ];

        for (const cara of caras) {
            const brillo = cara[4];
            const orden = [0, 1, 2, 0, 2, 3];
            for (const i of orden) {
                const v = p[cara[i]];
                lista.push(
                    v[0], v[1], v[2],
                    col[0] * brillo, col[1] * brillo, col[2] * brillo
                );
            }
        }
    }

    // Caja con cualquier orientación: centro c, ejes R (ancho), U (alto) y F (largo), con sus medias medidas
    function cajaOri(lista, c, R, U, F, hx, hy, hz, col) {
        function p(sx, sy, sz) {
            return [
                c[0] + R[0] * hx * sx + U[0] * hy * sy + F[0] * hz * sz,
                c[1] + R[1] * hx * sx + U[1] * hy * sy + F[1] * hz * sz,
                c[2] + R[2] * hx * sx + U[2] * hy * sy + F[2] * hz * sz
            ];
        }
        const v = [p(-1,-1,-1), p(1,-1,-1), p(1,1,-1), p(-1,1,-1), p(-1,-1,1), p(1,-1,1), p(1,1,1), p(-1,1,1)];
        const caras = [[3,2,6,7,1.0],[0,1,2,3,0.7],[4,5,6,7,0.85],[0,3,7,4,0.6],[1,2,6,5,0.75],[0,1,5,4,0.5]];
        for (const cara of caras) {
            for (const i of [0, 1, 2, 0, 2, 3]) {
                const q = v[cara[i]];
                lista.push(q[0], q[1], q[2], col[0] * cara[4], col[1] * cara[4], col[2] * cara[4]);
            }
        }
    }

    function configurarAtributos(b) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.vertexAttribPointer(posicion, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
    }

    // Los demás jugadores se ven igual que vos en el inventario: el mismo modelo (brazos, ropa puesta,
    // objetos en las manos, piernas lastimadas, cabeza que gira) y las mismas animaciones.
    // Cada cliente manda su estado y acá se arma el modelo con cajasPersonaje().
    const animOtros = {};
    const COLORES_OTROS = [
        [1.0, 0.55, 0.0], [0.3, 0.6, 1.0], [0.4, 0.9, 0.4],
        [0.95, 0.4, 0.7], [0.95, 0.9, 0.3], [0.6, 0.4, 0.95]
    ];
    const SLOTS_EQUIPO = ["cabeza", "torso", "piernas", "pies", "espalda"];
    function itemValido(id) { return typeof id === "string" && ITEMS[id] ? id : null; }
    function equipoRemoto(q) {
        const eq = {};
        if (typeof q !== "string") return eq;
        const partes = q.split(",");
        SLOTS_EQUIPO.forEach(function (k, i) {
            const id = itemValido(partes[i]);
            if (id && ITEMS[id].slot === k) eq[k] = id;
        });
        return eq;
    }

    // caras de un cubo cuyas 8 puntas se ordenan como ix + 2*iy + 4*iz
    const CARAS_CUBO = [[2, 3, 7, 6], [0, 1, 5, 4], [4, 5, 7, 6], [0, 1, 3, 2], [0, 4, 6, 2], [1, 5, 7, 3]];
    function cuboATriangulos(lista, P, col) {
        let cx = 0, cy = 0, cz = 0;
        for (const q of P) { cx += q[0]; cy += q[1]; cz += q[2]; }
        cx /= 8; cy /= 8; cz /= 8;
        for (const f of CARAS_CUBO) {
            const a = P[f[0]], b = P[f[1]], c = P[f[2]], d = P[f[3]];
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const l = Math.hypot(n[0], n[1], n[2]) || 1;
            n = [n[0] / l, n[1] / l, n[2] / l];
            const m = [(a[0] + b[0] + c[0] + d[0]) / 4 - cx, (a[1] + b[1] + c[1] + d[1]) / 4 - cy, (a[2] + b[2] + c[2] + d[2]) / 4 - cz];
            if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];   // que apunte hacia afuera
            const br = Math.max(0.5, Math.min(1, 0.72 + 0.28 * n[1] + 0.1 * n[0] - 0.08 * n[2]));
            for (const i of [0, 1, 2, 0, 2, 3]) {
                const q = P[f[i]];
                lista.push(q[0], q[1], q[2], col[0] * br, col[1] * br, col[2] * br);
            }
        }
    }

    // Pasa las cajas del modelo del personaje (que ya traen sus giros) al mundo, en (wx, wy, wz).
    // El modelo mira hacia +z y su derecha es -x; en el mundo "adelante" es -z, por eso se invierten x y z.
    function personajeATriangulos(lista, cajas, wx, wy, wz) {
        for (const b of cajas) {
            const rots = b.r || [];
            const yaT = b.ya || 0, cY = Math.cos(yaT), sY = Math.sin(yaT);
            const llevar = function (qx, qy, qz) {
                for (const r of rots) {
                    const dy = qy - r[1], dz = qz - r[2], c = Math.cos(r[0]), sn = Math.sin(r[0]);
                    qy = r[1] + dy * c - dz * sn;
                    qz = r[2] + dz * c + dy * sn;
                }
                qy += b.oy || 0;
                if (yaT) { const nx = qx * cY + qz * sY; qz = -qx * sY + qz * cY; qx = nx; }
                return [wx - qx, wy + qy, wz - qz];
            };
            const xs = [b.x - b.a, b.x + b.a], ys = [b.y1, b.y2], zs = [b.z - b.l, b.z + b.l];
            const P = [];
            for (let i = 0; i < 8; i++) P.push(llevar(xs[i & 1], ys[(i >> 1) & 1], zs[(i >> 2) & 1]));
            cuboATriangulos(lista, P, b.c);
            if (b.g) {
                // huesos trizados: marcas oscuras en el frente de la pierna
                GRIETA.forEach(function (q) {
                    const u = Math.max(0.1, Math.min(0.9, q[0] + (b.g - 2) * 0.12));
                    const gx = b.x - b.a + 2 * b.a * u, gy = b.y1 + (b.y2 - b.y1) * q[1], gz = b.z + b.l + 0.004;
                    const C = [];
                    for (let i = 0; i < 8; i++) C.push(llevar(gx + ((i & 1) ? 0.025 : -0.025), gy + (((i >> 1) & 1) ? 0.025 : -0.025), gz + ((i >> 2) & 1 ? 0.01 : -0.004)));
                    cuboATriangulos(lista, C, [0.1, 0, 0]);
                });
            }
        }
    }

    function dibujarOtros() {
        const lista = [];
        const ahoraS = performance.now() / 1000;
        for (const id in animOtros) if (!otros[id]) delete animOtros[id];
        for (const id in otros) {
            if (id === String(miId)) continue;
            const j = otros[id];
            if (!mismaZona(j)) continue;
            const y = j.y || 0;
            const p = (j.p === 1 || j.p === 2) ? j.p : 0;

            // estado propio de cada jugador visto desde acá (cuerpo que sigue a la cabeza, fase del paso, golpe)
            let an = animOtros[id];
            if (!an) an = animOtros[id] = { g: j.g || 0, t0: -9, cuerpo: j.yaw || 0, fase: 0, mov: 0, ult: ahoraS, x: j.x, z: j.z, vel: 0, ba: "", bt0: ahoraS };
            const dt = Math.min(0.1, Math.max(0, ahoraS - an.ult));
            an.ult = ahoraS;
            if (dt > 0) {
                const v = Math.hypot(j.x - an.x, j.z - an.z) / dt;
                an.vel += (Math.min(v, 12) - an.vel) * Math.min(1, dt * 6);
                an.x = j.x; an.z = j.z;
                an.mov += ((typeof j.am === "number" ? j.am : 0) - an.mov) * Math.min(1, dt * 10);
                if (an.mov > 0.1) an.fase += dt * (p === 2 ? 3.5 : Math.max(2.5, Math.min(16, an.vel * 2.4)));
                // igual que tu inventario: la cabeza gira hasta cierto límite y después arrastra al cuerpo
                const LIM = 0.9;
                let d = angDif(j.yaw, an.cuerpo);
                if (Math.abs(d) > LIM) { an.cuerpo += d - Math.sign(d) * LIM; d = angDif(j.yaw, an.cuerpo); }
                an.cuerpo += d * Math.min(1, dt * (an.mov > 0.1 ? 8 : 1.5));
            }
            // baile: el tiempo se cuenta desde que lo vemos empezar
            if ((j.ba || "") !== an.ba) { an.ba = j.ba || ""; an.bt0 = ahoraS; }
            // golpe: cuando cambia su contador se ve el manotazo
            if ((j.g || 0) !== an.g) { an.g = j.g || 0; an.t0 = ahoraS; }

            const est = {
                base: hexARgb(j.col) || COLORES_OTROS[(j.c || 0) % COLORES_OTROS.length],
                eq: equipoRemoto(j.q),
                acc: accDeTexto(j.ad),
                baile: baileValido(j.ba),
                baileT: ahoraS - an.bt0,
                manoD: itemValido(j.md) || (j.md === undefined ? itemValido(j.m) : null),
                manoI: itemValido(j.mi),
                pl: [Math.floor((j.pl || 0) / 3) % 3, (j.pl || 0) % 3],
                postura: p,
                pelea: !!j.pe,
                fase: an.fase,
                mov: an.mov,
                corre: !!j.ac,
                golpeT: ahoraS - an.t0,
                pitch: typeof j.pi === "number" ? j.pi : 0,
                giroCuerpo: an.cuerpo,
                giroCab: angDif(j.yaw, an.cuerpo)
            };
            personajeATriangulos(lista, cajasPersonaje(est), j.x, y, j.z);
        }
        if (lista.length === 0) return;

        configurarAtributos(bufferOtros);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lista), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, lista.length / 6);
    }

        // Conexión con el servidor (solo cuando entrás a un servidor desde el menú)
    let conexion = null;
    let soyAutoridad = false;           // ¿mi cliente maneja a los NPCs? (uno solo por servidor; si se va, pasa al siguiente)
    let itemsRed = { ret: {}, suel: {} };   // objetos del mapa que ya se llevaron (i#) y objetos tirados por jugadores (d#_#)
    let snapHola = null, snapNpcs = null, snapNuevo = false;
    let contSuelto = 0, acumFotoNpc = 0;
    function enviarRed(o) {
        if (conexion && conexion.readyState === WebSocket.OPEN) { try { conexion.send(JSON.stringify(o)); } catch (e) {} }
    }
    function esAutoridad() { return !conexion || soyAutoridad; }

    window.desconectarServidor = function () {
        if (conexion) {
            conexion.onclose = null;
            conexion.onerror = null;
            try { conexion.close(); } catch (e) {}
            conexion = null;
        }
        miId = null;
        otros = {};
        soyAutoridad = false;
        itemsRed = { ret: {}, suel: {} };
        snapHola = null; snapNpcs = null; snapNuevo = false;
    };

    window.conectarServidor = function (sala, nombre, alEntrar, alFallar) {
        window.desconectarServidor();
        let entro = false;
        let fallo = false;
        let cerradoPorHost = false;

        function fallar(motivo) {
            if (fallo || entro) return;
            fallo = true;
            window.desconectarServidor();
            alFallar(motivo);
        }

        const direccion =
            (location.protocol === "https:" ? "wss://" : "ws://") + location.host +
            "/?sala=" + encodeURIComponent(sala) + "&nombre=" + encodeURIComponent(nombre);

        let ws;
        try {
            ws = new WebSocket(direccion);
        } catch (error) {
            fallar("No se pudo conectar al servidor");
            return;
        }
        conexion = ws;

        ws.onmessage = function (e) {
            try {
                const mensaje = JSON.parse(e.data);
                if (mensaje.tipo === "hola") {
                    miId = mensaje.id;
                    entro = true;
                    if (mensaje.reloj) {
                        window.iniciarEstaciones({
                            modo: "online",
                            reloj: mensaje.reloj,
                            semilla: mensaje.semilla,
                            desfaseMs: (mensaje.ahora || Date.now()) - Date.now()
                        });
                    }
                    if (mensaje.aberturas) aplicarEstados(mensaje.aberturas, true);
                    soyAutoridad = !!mensaje.autoridad;
                    itemsRed = { ret: {}, suel: {} };
                    if (mensaje.items) {
                        (mensaje.items.ret || []).forEach(function (k) { itemsRed.ret[k] = 1; });
                        itemsRed.suel = mensaje.items.suel || {};
                    }
                    snapHola = Array.isArray(mensaje.npcs) ? mensaje.npcs : null;
                    if (mensaje.pausada && window.alPausaRemota) window.alPausaRemota(true, mensaje.host);
                    alEntrar();
                }
                if (mensaje.tipo === "error") fallar(mensaje.motivo);
                if (mensaje.tipo === "pausa") {
                    // al reanudar, el servidor manda el reloj de estaciones ya descontando la pausa
                    if (mensaje.reloj && estacionesJuego.activo) {
                        estacionesJuego.reloj = mensaje.reloj;
                        estacionesJuego.desfaseMs = (mensaje.ahora || Date.now()) - Date.now();
                    }
                    if (window.alPausaRemota) window.alPausaRemota(mensaje.pausado, mensaje.host);
                }
                if (mensaje.tipo === "jugadores") otros = mensaje.jugadores;
                if (mensaje.tipo === "abertura") aplicarEstados({ [mensaje.k]: [mensaje.a, mensaje.t] }, false, true);
                if (mensaje.tipo === "golpe") recibirGolpe(mensaje.dano, mensaje.nombre);
                if (mensaje.tipo === "soltar") redItemPuesto(mensaje);
                if (mensaje.tipo === "recoger") redItemSacado(mensaje.k);
                if (mensaje.tipo === "npcs") { snapNpcs = mensaje.n; snapNuevo = true; }
                if (mensaje.tipo === "autoridad") tomarMandoNpcs();
                if (mensaje.tipo === "npcgolpe" && esAutoridad()) { const nn = NPCS[mensaje.i]; if (nn) golpearNpc(nn, mensaje.dano, String(mensaje.de)); }
                if (mensaje.tipo === "robo" && esAutoridad()) robarNpcs(String(mensaje.de), mensaje.x, mensaje.z);
                if (mensaje.tipo === "npchabla") mostrarHablaNpc(mensaje.i, mensaje.t);
                if (mensaje.tipo === "vozdice" && esAutoridad()) reaccionarVoz(String(mensaje.de), mensaje.x, mensaje.z, mensaje.intent, mensaje.r, !!mensaje.g, String(mensaje.t || "").slice(0, 140));
                if (mensaje.tipo === "cerrado") {
                    cerradoPorHost = true;
                    if (!window.cerrandoMiServidor) alert("El host cerró el servidor");
                    location.reload();
                }
            } catch (error) {}
        };

        ws.onerror = function () {
            fallar("No se pudo conectar al servidor");
        };

        ws.onclose = function () {
            if (cerradoPorHost) return;
            if (!entro) { fallar("No se pudo conectar al servidor"); return; }
            alert("Se perdió la conexión con el servidor");
            location.reload();
        };
    };

    setInterval(function () {
        if (conexion && conexion.readyState === WebSocket.OPEN) {
            conexion.send(JSON.stringify({
                x: px, z: pz, yaw: yaw, y: saltoY,
                p: postura, m: itemMano() || "", pe: modoPelea ? 1 : 0, col: A.colorPersonaje || "",
                r: Math.round(ruidoRadio * 10) / 10, g: golpesN,
                // para que te vean igual que en tu inventario: cabeza, manos, ropa, piernas y movimiento
                pi: Math.round(pitch * 100) / 100,
                md: inv.manoD || "", mi: inv.manoI || "",
                q: [inv.equipo.cabeza, inv.equipo.torso, inv.equipo.piernas, inv.equipo.pies, inv.equipo.espalda].map(function (x) { return x || ""; }).join(","),
                ad: accATexto(inv.acc),
                ba: baile ? baile.id : "",
                zn: codigoZona(),
                pl: sv.piernas[0].n * 3 + sv.piernas[1].n,
                am: Math.round(animMov * 100) / 100, ac: animCorre ? 1 : 0
            }));
        }
    }, 50);
  
   window.enviarPausa = function (pausado, token) {
        if (conexion && conexion.readyState === WebSocket.OPEN) {
            conexion.send(JSON.stringify({ tipo: "pausa", pausado: !!pausado, token: token }));
        }
    };

   // ===== SALTO Y CORRER =====
    let saltoY = 0;
    let velY = 0;
    let correrCelu = false;
    let pidioSaltar = false;
    let botonCorrerRef = null;

    // ===== TAMAÑO DE LA INTERFAZ DE ABAJO (se adapta a cada pantalla) =====
    // Una sola medida (--slot, en píxeles) manda sobre la barra de abajo (vida, cordura, sed, hambre,
    // sueño y barra rápida), el inventario y los botones del celular. Sale del ALTO de la pantalla
    // (así no se ve gigante en un celular acostado ni chiquito en una compu grande) y se achica
    // si el ancho no alcanza. Si en un celular la barra y los botones no entran en la misma fila,
    // los botones se apilan arriba de la barra en vez de taparla.
    const esTactil = "ontouchstart" in window;
    const UI = { u: 52, apilado: false };
    const UI_PORC_ALTO = 0.074;   // una casilla mide ~7,4 % del alto de la pantalla
    const UI_ANCHO_BARRA = 12.5;  // ancho de la barra de abajo, en casillas (medido con la barra real)
    const UI_ALTO_BARRA = 2.5;    // alto de la barra de abajo, en casillas
    const UI_LADOS = 5.4;         // lugar para el joystick y el botón de saltar a los costados, en casillas

    // Zonas que tapan el notch o la barra de inicio del celular
    const sondaSegura = document.createElement("div");
    sondaSegura.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
        "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);";
    document.body.appendChild(sondaSegura);
    function margenSeguro() {
        const c = getComputedStyle(sondaSegura);
        return { der: parseFloat(c.paddingRight) || 0, aba: parseFloat(c.paddingBottom) || 0, izq: parseFloat(c.paddingLeft) || 0 };
    }

    function medirUI() {
        const W = window.innerWidth, H = window.innerHeight;
        let u = H * UI_PORC_ALTO;
        if (esTactil) u = Math.min(u, W / (UI_ANCHO_BARRA + UI_LADOS));
        const minimo = Math.min(esTactil ? 38 : 34, (W - 8) / UI_ANCHO_BARRA);   // legible, pero siempre entra a lo ancho
        u = Math.max(minimo, Math.min(92, u));
        UI.u = u;
        UI.apilado = esTactil && W < u * (UI_ANCHO_BARRA + UI_LADOS);
        const raiz = document.documentElement.style;
        raiz.setProperty("--slot", u.toFixed(1) + "px");
        raiz.setProperty("--s2", (u * 0.86).toFixed(1) + "px");
    }
    medirUI();

    // Botones del celular: se pueden mover desde Configuración (A.botones guarda dónde quedó cada uno).
    // Su tamaño y su lugar por defecto se miden en "casillas" (--slot), así crecen y se achican con la pantalla.
    const botonesUI = {};
    function aplicarBotones() {
        const W = window.innerWidth, H = window.innerHeight, u = UI.u, seg = margenSeguro();
        const subir = UI.apilado ? UI_ALTO_BARRA * u + 8 + u * 0.2 + seg.aba : 0;
        for (const id in botonesUI) {
            const b = botonesUI[id], el = b.el, c = A.botones && A.botones[id];
            const esc = (c && isFinite(c.esc)) ? Math.max(0.4, Math.min(2.2, c.esc)) : 1;   // tamaño que eligió el jugador
            b.esc = esc;
            b.w = Math.round(b.k * u * esc);
            el.style.width = b.w + "px";
            el.style.height = b.w + "px";
            el.style.fontSize = Math.max(9, Math.round(b.w * 0.18)) + "px";
            if (b.alAplicar) b.alAplicar(b.w);
            if (c && isFinite(c.fx) && isFinite(c.fy)) {
                el.style.left = Math.max(0, Math.min(W - b.w, c.fx * W - b.w / 2)) + "px";
                el.style.top = Math.max(0, Math.min(H - b.w, c.fy * H - b.w / 2)) + "px";
                el.style.right = "auto";
                el.style.bottom = "auto";
            } else {
                const mx = Math.round(b.kx * u + (b.der ? seg.der : seg.izq));
                el.style.left = b.der ? "auto" : mx + "px";
                el.style.right = b.der ? mx + "px" : "auto";
                el.style.bottom = Math.round(b.ky * u + subir + seg.aba * 0.5) + "px";
                el.style.top = "auto";
            }
        }
    }
    // k = tamaño, kx = margen lateral, ky = margen de abajo (todo en casillas)
    function registrarBoton(id, nombre, el, k, der, kx, ky) {
        botonesUI[id] = { el: el, nombre: nombre, k: k, w: Math.round(k * UI.u), der: der, kx: kx, ky: ky, alAplicar: null };
        aplicarBotones();
    }
    window.addEventListener("resize", function () { medirUI(); aplicarBotones(); });
    window.addEventListener("orientationchange", function () { setTimeout(function () { medirUI(); aplicarBotones(); }, 250); });
    window.Botones = {
        lista: function () {
            return Object.keys(botonesUI).map(function (id) {
                const b = botonesUI[id], r = b.el.getBoundingClientRect();
                return { id: id, nombre: b.nombre, w: b.w, esc: b.esc || 1, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
            });
        },
        poner: function (id, fx, fy, esc) {
            if (!botonesUI[id]) return;
            A.botones = A.botones || {};
            A.botones[id] = { fx: fx, fy: fy };
            if (esc && isFinite(esc) && Math.abs(esc - 1) > 0.01) A.botones[id].esc = esc;
        },
        aplicar: aplicarBotones,
        restablecer: function () { A.botones = {}; aplicarBotones(); }
    };

    function crearBoton(texto, estilo) {
        const b = document.createElement("div");
        b.innerHTML = texto;
        b.style.cssText =
            "position:fixed;z-index:900;bottom:30px;width:90px;height:90px;" +
            "border-radius:50%;background:rgba(255,255,255,0.25);" +
            "color:white;font-family:sans-serif;font-size:16px;" +
            "display:flex;align-items:center;justify-content:center;" +
            "user-select:none;touch-action:none;" + estilo;
        document.body.appendChild(b);
        return b;
    }

    if ("ontouchstart" in window) {
        const botonSaltar = crearBoton("Saltar", "right:30px;");
        registrarBoton("saltar", "Saltar", botonSaltar, 1.7, true, 0.45, 0.45);

        botonSaltar.addEventListener("touchstart", function (e) {
            e.preventDefault();
            pidioSaltar = true;
        }, { passive: false });


        // Joystick: cuanto más lo alejás del centro, más rápido vas (despacio = caminás, a fondo = corrés)
        let JOY_R = 50;      // cuánto se mueve la perilla (se ajusta al tamaño del joystick)
        const joyBase = document.createElement("div");
        joyBase.style.cssText =
            "position:fixed;z-index:900;left:30px;bottom:30px;width:120px;height:120px;border-radius:50%;" +
            "background:rgba(255,255,255,0.22);border:2px solid rgba(255,255,255,0.35);box-sizing:border-box;" +
            "touch-action:none;user-select:none;-webkit-user-select:none;";
        const joyPerilla = document.createElement("div");
        joyPerilla.style.cssText =
            "position:absolute;border-radius:50%;" +
            "background:rgba(255,255,255,0.75);pointer-events:none;";
        joyBase.appendChild(joyPerilla);
        document.body.appendChild(joyBase);
        registrarBoton("joystick", "Joystick", joyBase, 2.2, false, 0.45, 0.45);
        botonesUI.joystick.alAplicar = function (w) {
            JOY_R = w * 0.416;
            const p = Math.round(w * 0.467);
            joyPerilla.style.width = p + "px";
            joyPerilla.style.height = p + "px";
            joyPerilla.style.left = Math.round((w - 4 - p) / 2) + "px";
            joyPerilla.style.top = Math.round((w - 4 - p) / 2) + "px";
        };
        botonesUI.joystick.alAplicar(botonesUI.joystick.w);
        let joyDedo = null;

        function joyCentrar() {
            joyDedo = null;
            joyAdelante = 0;
            joyLado = 0;
            joyPerilla.style.transform = "translate(0px,0px)";
        }
        window.joystickCentrar = joyCentrar;
        function joyMover(t) {
            const r = joyBase.getBoundingClientRect();
            let dx = (t.clientX - (r.left + r.width / 2)) / JOY_R;
            let dy = (t.clientY - (r.top + r.height / 2)) / JOY_R;
            const m = Math.hypot(dx, dy);
            if (m > 1) { dx /= m; dy /= m; }
            joyPerilla.style.transform = "translate(" + (dx * JOY_R).toFixed(1) + "px," + (dy * JOY_R).toFixed(1) + "px)";
            if (Math.min(m, 1) < 0.12) { joyAdelante = 0; joyLado = 0; }       // centro: quieto
            else { joyLado = dx; joyAdelante = -dy; }
        }
        joyBase.addEventListener("touchstart", function (e) {
            e.preventDefault();
            if (joyDedo !== null) return;
            const t = e.changedTouches[0];
            joyDedo = t.identifier;
            joyMover(t);
        }, { passive: false });
        joyBase.addEventListener("touchmove", function (e) {
            e.preventDefault();
            for (const t of e.changedTouches) if (t.identifier === joyDedo) joyMover(t);
        }, { passive: false });
        function joyFin(e) {
            for (const t of e.changedTouches) if (t.identifier === joyDedo) joyCentrar();
        }
        joyBase.addEventListener("touchend", joyFin);
        joyBase.addEventListener("touchcancel", joyFin);
    }
   
        // ===== ESTACIONES DEL AÑO =====
    // Se activan al empezar una partida (offline) o cuando el servidor te manda su reloj (online).
    // Efectos de hoy: velocidad, luz, niebla/lluvia y color del mundo. El resto de los
    // modificadores (cultivos, recursos, frío, sed) están listos en estaciones.js.
    const estacionesJuego = {
        activo: false,
        modo: null,           // "offline" u "online"
        reloj: null,
        desfaseMs: 0,         // online: diferencia entre el reloj del servidor y el tuyo
        tiempoJugadoMs: 0,    // offline: el tiempo solo corre mientras jugás
        indiceAnterior: -1,
        textoHud: "",
        reiniciarAmbiente: true,
        ambiente: { cielo: [0.10, 0.11, 0.14], tinte: [1, 1, 1], niebla: 35 }
    };

    // ----- Rueda de estaciones + mapa (arriba a la izquierda) -----
    // La estación actual brilla y una flechita marca en qué día de la estación estás.
    const COLORES_RUEDA = {
        otono:     { apagado: "#7d5c3d", brillo: "#e0a057" },
        invierno:  { apagado: "#4a7476", brillo: "#72c9cc" },
        primavera: { apagado: "#4f734b", brillo: "#80c776" },
        verano:    { apagado: "#7d7343", brillo: "#dcc864" }
    };
    const CUADRANTES = [
        { id: "otono", ini: -90, fin: 0, arriba: true },
        { id: "invierno", ini: 0, fin: 90, arriba: false },
        { id: "primavera", ini: 90, fin: 180, arriba: false },
        { id: "verano", ini: 180, fin: 270, arriba: true }
    ];
    const R_RUEDA = 84;

    const estiloHud = document.createElement("style");
    estiloHud.textContent =
        "#hudTiempo{position:fixed;top:16px;left:16px;z-index:800;display:none;" +
        "align-items:flex-start;gap:14px;pointer-events:none;--tam:160px;--mapa:140px;--tmapa:20px;}" +
        "#hudTiempo .rueda{width:var(--tam);height:var(--tam);display:block;" +
        "filter:drop-shadow(0 0 9px rgba(0,0,0,0.9));}" +
        "#hudTiempo .hCol{display:flex;flex-direction:column;align-items:flex-start;width:var(--tam);}" +
        "#hudTiempo .hHora{margin-top:4px;white-space:nowrap;font-family:'Cinzel Decorative',serif;font-size:1rem;" +
        "letter-spacing:1px;color:#f3e9d6;text-shadow:0 0 6px #000,0 0 3px #000;}" +
        "#hudTiempo .hEstado{margin-top:2px;width:max-content;max-width:260px;font-family:'Cinzel Decorative',serif;" +
        "font-size:0.8rem;letter-spacing:1px;line-height:1.25;color:#e8c9c9;text-shadow:0 0 6px #000,0 0 3px #000;}" +
        "#hudTiempo .hEstado:empty{display:none;}" +
        "#hudTiempo .rLabel{font-size:12px;letter-spacing:1px;}" +
        "#hudTiempo .rCentro{font-size:15px;}" +
        "#hudTiempo .rNombre{font-size:12px;}" +
        "#hudTiempo .mapaTitulo{height:var(--tmapa);line-height:var(--tmapa);text-align:center;" +
        "font-family:'Cinzel Decorative',serif;font-size:0.95rem;letter-spacing:2px;" +
        "color:#d6d6d6;text-shadow:0 0 6px #000;}" +
        "#hudTiempo .mapaCaja{display:block;width:var(--mapa);height:var(--mapa);" +
        "box-sizing:border-box;border:3px solid #7c7c7c;border-radius:8px;background:#3a3a3a;" +
        "box-shadow:0 0 10px rgba(0,0,0,0.85);}" +
        // celular (vertical u horizontal) y pantallas táctiles: todo más chico
        "@media (max-width:600px),(max-height:520px),(pointer:coarse){" +
        "#hudTiempo{--tam:108px;--mapa:86px;--tmapa:16px;top:10px;left:10px;gap:8px;}" +
        "#hudTiempo .hHora{font-size:0.75rem;margin-top:2px;}" +
        "#hudTiempo .hEstado{font-size:0.62rem;max-width:200px;}" +
        "#hudTiempo .rCentro{font-size:17px;}" +
        "#hudTiempo .rNombre{font-size:13px;}" +
        "#hudTiempo .mapaTitulo{font-size:0.7rem;letter-spacing:1px;}" +
        "#hudTiempo .mapaCaja{border-width:2px;border-radius:6px;}}";
    document.head.appendChild(estiloHud);

    function polar(a, r) {
        const t = a * Math.PI / 180;
        return (100 + r * Math.cos(t)).toFixed(2) + "," + (100 + r * Math.sin(t)).toFixed(2);
    }

    const FUENTE = "font-family=\"'Cinzel Decorative',serif\"";
    let svg = "";
    for (const q of CUADRANTES) {
        svg += '<path id="rQ_' + q.id + '" fill="' + COLORES_RUEDA[q.id].apagado + '" ' +
            'stroke="rgba(0,0,0,0.45)" stroke-width="1.5" ' +
            'd="M100,100 L' + polar(q.ini, R_RUEDA) + " A" + R_RUEDA + "," + R_RUEDA + " 0 0 1 " + polar(q.fin, R_RUEDA) + ' Z"/>';
    }
    // brillo suave del borde + contorno oscuro
    svg += '<circle id="rBrilloC" cx="100" cy="100" r="' + R_RUEDA + '" fill="url(#rBrillo)"/>' +
        '<circle cx="100" cy="100" r="' + R_RUEDA + '" fill="none" stroke="rgba(0,0,0,0.7)" stroke-width="3"/>';
    for (const q of CUADRANTES) {
        const r = q.arriba ? 58 : 71;
        const arco = q.arriba
            ? "M" + polar(q.ini, r) + " A" + r + "," + r + " 0 0 1 " + polar(q.fin, r)
            : "M" + polar(q.fin, r) + " A" + r + "," + r + " 0 0 0 " + polar(q.ini, r);
        svg += '<path id="rArco_' + q.id + '" d="' + arco + '" fill="none"/>' +
            '<text id="rT_' + q.id + '" class="rLabel" text-anchor="middle" ' + FUENTE + '>' +
            '<textPath href="#rArco_' + q.id + '" startOffset="50%">' + q.id.toUpperCase().replace("OTONO", "OTOÑO") + '</textPath></text>';
    }
    const letra = 'text-anchor="middle" x="100" fill="#f3e9d6" ' + FUENTE + ' font-weight="700"';
    svg += '<circle cx="100" cy="100" r="50" fill="rgba(0,0,0,0.38)"/>' +
        '<text id="rAnio" class="rCentro" ' + letra + ' y="91"></text>' +
        '<text id="rDia" class="rCentro" ' + letra + ' y="109"></text>' +
        '<text id="rNombre" class="rNombre" ' + letra + ' y="127"></text>' +
        // flechita: apunta al centro desde el borde (se gira alrededor de la rueda)
        '<g id="rFlecha"><polygon points="' + (100 + R_RUEDA + 2) + ',100 ' + (100 + R_RUEDA + 14) + ',93 ' +
        (100 + R_RUEDA + 14) + ',107" fill="#fff3d6" stroke="rgba(0,0,0,0.8)" stroke-width="1" ' +
        'stroke-linejoin="round"/></g>';

    const hudEstacion = document.createElement("div");
    hudEstacion.id = "hudTiempo";
    hudEstacion.innerHTML =
        '<div class="hCol"><svg class="rueda" viewBox="0 0 200 200">' +
        '<defs><radialGradient id="rBrillo" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#fff" stop-opacity="0.10"/>' +
        '<stop offset="70%" stop-color="#fff" stop-opacity="0"/>' +
        '<stop offset="100%" stop-color="#000" stop-opacity="0.30"/>' +
        '</radialGradient>' +
        '<filter id="rResplandor" x="-30%" y="-30%" width="160%" height="160%">' +
        '<feGaussianBlur stdDeviation="3.5" result="b"/>' +
        '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        '</filter></defs>' + svg + '</svg>' +
        '<div class="hHora" id="hHora"></div><div class="hEstado" id="hbEstado"></div></div>' +
        '<div><div class="mapaTitulo">Mapa</div><canvas class="mapaCaja"></canvas></div>';
    document.body.appendChild(hudEstacion);

    const rAnio = hudEstacion.querySelector("#rAnio");
    const rDia = hudEstacion.querySelector("#rDia");
    const rNombre = hudEstacion.querySelector("#rNombre");
    const rFlecha = hudEstacion.querySelector("#rFlecha");
    const rBrilloC = hudEstacion.querySelector("#rBrilloC");
    const rHora = hudEstacion.querySelector("#hHora");

    // Flechita: se desliza suave hasta el día nuevo
    let angFlecha = null;
    let animFlecha = 0;
    function ponerFlecha(grados) {
        angFlecha = grados;
        rFlecha.setAttribute("transform", "rotate(" + grados.toFixed(2) + " 100 100)");
    }
    function moverFlecha(objetivo) {
        if (angFlecha === null) { ponerFlecha(objetivo); return; }
        let delta = (((objetivo - angFlecha) % 360) + 360) % 360;
        if (delta > 180) delta -= 360;
        const desde = angFlecha;
        const t0 = performance.now();
        cancelAnimationFrame(animFlecha);
        (function paso(t) {
            const k = Math.min(1, (t - t0) / 700);
            ponerFlecha(desde + delta * (1 - Math.pow(1 - k, 3)));
            if (k < 1) animFlecha = requestAnimationFrame(paso);
        })(t0);
    }
    window.reiniciarFlechaEstacion = function () { angFlecha = null; };

    function pintarRueda(estado) {
        rAnio.textContent = "Año: " + estado.anio;
        rDia.textContent = "Día: " + estado.diaEnEstacion;
        rNombre.textContent = estado.estacion.nombre;
        for (const q of CUADRANTES) {
            const activa = q.id === estado.estacion.id;
            const trozo = hudEstacion.querySelector("#rQ_" + q.id);
            trozo.setAttribute("fill", activa ? COLORES_RUEDA[q.id].brillo : COLORES_RUEDA[q.id].apagado);
            if (activa) {
                trozo.setAttribute("filter", "url(#rResplandor)");
                trozo.parentNode.insertBefore(trozo, rBrilloC); // arriba de las otras, para que el brillo se vea
            } else {
                trozo.removeAttribute("filter");
            }
            const rotulo = hudEstacion.querySelector("#rT_" + q.id);
            rotulo.setAttribute("fill", activa ? "#1a120a" : "#e6d9c2");
            rotulo.setAttribute("fill-opacity", activa ? "1" : "0.8");
        }
        const q = CUADRANTES.find(function (c) { return c.id === estado.estacion.id; });
        const avance = (estado.diaEnEstacion - 0.5) / Estaciones.DIAS_POR_ESTACION;
        moverFlecha(q.ini + avance * 90);
    }

    // ----- Mapa -----
    // Terreno gris oscuro, calles grises, casas gris claro.
    // Punto rojo = vos (cada jugador se ve rojo a sí mismo), puntos blancos = los demás.
    const MAPA_PX = 280;
    const mapaCanvas = hudEstacion.querySelector("canvas");
    mapaCanvas.width = MAPA_PX;
    mapaCanvas.height = MAPA_PX;
    const mapaCtx = mapaCanvas.getContext("2d");

    // El mapa te sigue: vos quedás siempre en el medio y el mundo se mueve.
    // RADIO_VISTA = cuántas unidades del mundo se ven hacia cada lado (más chico = más zoom).
    const RADIO_VISTA = 20;
    const MAPA_ESCALA = MAPA_PX / (2 * RADIO_VISTA);
    const MAPA_MEDIO = MAPA_PX / 2;

    function puntoMapa(x, z, color, radio) {
        const mx = Math.max(radio, Math.min(MAPA_PX - radio, MAPA_MEDIO + (x - px) * MAPA_ESCALA));
        const mz = Math.max(radio, Math.min(MAPA_PX - radio, MAPA_MEDIO + (z - pz) * MAPA_ESCALA));
        mapaCtx.beginPath();
        mapaCtx.arc(mx, mz, radio, 0, Math.PI * 2);
        mapaCtx.fillStyle = color;
        mapaCtx.fill();
        mapaCtx.lineWidth = 2;
        mapaCtx.strokeStyle = "rgba(0,0,0,0.6)";
        mapaCtx.stroke();
    }

    function rectMapa(r, color) {
        mapaCtx.fillStyle = color;
        mapaCtx.fillRect(
            MAPA_MEDIO + (r[0] - px) * MAPA_ESCALA,
            MAPA_MEDIO + (r[1] - pz) * MAPA_ESCALA,
            (r[2] - r[0]) * MAPA_ESCALA,
            (r[3] - r[1]) * MAPA_ESCALA
        );
    }

    function dibujarMapa() {
        if (!estacionesJuego.activo) return;
        mapaCtx.fillStyle = "#1f1f1f";                                      // fuera del mundo
        mapaCtx.fillRect(0, 0, MAPA_PX, MAPA_PX);
        if (zona === "casa" && casaPropia) {                                // adentro de tu casa: solo se ve ella y su patio
            const r = casaPropia.rect;
            rectMapa([r[0] - PATIO, r[1] - PATIO, r[2] + PATIO, r[3] + PATIO], "#3a3a3a");   // terreno
            rectMapa(r, "#c4c4c4");                                          // casa
        } else if ((zona === "super" || zona === "comercio") && LUGARES[zona]) {
            rectMapa(LUGARES[zona].rect, "#c4c4c4");                         // el edificio
        } else {
            rectMapa([-MUNDO_MITAD, -MUNDO_MITAD, MUNDO_MITAD, MUNDO_MITAD], "#3a3a3a"); // terrenos
            for (const calle of CALLES) rectMapa(calle, "#777777");         // calles
            for (const casa of CASAS) rectMapa(casa, "#c4c4c4");            // casas
        }
        for (const id in otros) {
            if (id === String(miId)) continue;
            const j = otros[id];
            if (!mismaZona(j)) continue;
            // sigilo: agachado o arrastrándose solo lo ves si está dentro del radio de su ruido
            if ((j.p === 1 || j.p === 2) && Math.hypot(j.x - px, j.z - pz) > (j.r || 0)) continue;
            puntoMapa(j.x, j.z, "#ffffff", 6);                              // los demás
        }
        if (ruidoRadio > 0.5) {                      // hasta dónde te pueden detectar
            mapaCtx.beginPath();
            mapaCtx.arc(MAPA_MEDIO, MAPA_MEDIO, Math.min(ruidoRadio * MAPA_ESCALA, MAPA_MEDIO), 0, Math.PI * 2);
            mapaCtx.lineWidth = 1.5;
            mapaCtx.strokeStyle = "rgba(255,255,255,0.4)";
            mapaCtx.setLineDash([4, 4]);
            mapaCtx.stroke();
            mapaCtx.setLineDash([]);
        }
        puntoMapa(px, pz, "#e02b2b", 7);             // vos
    }

    window.iniciarEstaciones = function (config) {
        const e = estacionesJuego;
        e.activo = true;
        e.modo = config.modo;
        // el mapa sale de la semilla: misma semilla = mismo mapa (en un servidor lo ven todos igual)
        if (config.semilla && config.semilla !== semillaMundo) construirMundo(config.semilla);
        irACasa();      // siempre se arranca adentro de tu casa
        e.reloj = config.reloj;
        e.desfaseMs = config.desfaseMs || 0;
        e.tiempoJugadoMs = config.tiempoJugadoMs || 0;
        e.indiceAnterior = -1;
        e.textoHud = "";
        e.textoHora = "";
        e.reiniciarAmbiente = true;
        window.reiniciarFlechaEstacion();
        hudEstacion.style.display = "flex";
        reiniciarAberturas();
        iniciarSupervivencia(config.supervivencia);
        iniciarInventario(config.inventario);
        importarMemoriaNpcs(config.modo === "offline" ? config.memoriaNpcs : null);
    };

    // Tiempo jugado (para guardarlo en la partida offline)
    window.tiempoJugadoEstaciones = function () {
        return Math.floor(estacionesJuego.tiempoJugadoMs);
    };

    function estadoEstacion() {
        const e = estacionesJuego;
        const ahora = e.modo === "online" ? Date.now() + e.desfaseMs : e.tiempoJugadoMs;
        return Estaciones.obtenerEstado(e.reloj, ahora);
    }

    // Se llama en cada cuadro. Devuelve el multiplicador de velocidad de la estación.
    function actualizarEstaciones(dt, msReales) {
        const e = estacionesJuego;
        if (!e.activo || !e.reloj) return 1;

        // Offline: el reloj avanza solo mientras jugás (no cuenta la pausa)
        if (e.modo === "offline") e.tiempoJugadoMs += Math.min(msReales, 1000);

        const estado = estadoEstacion();

        // Hora del día: 1 día = 20 minutos reales, y el día arranca a las 7:00 a.m.
        const msJuego = e.modo === "online" ? Date.now() + e.desfaseMs : e.tiempoJugadoMs;
        const frac = (Math.max(0, msJuego - e.reloj.inicioMs) % Estaciones.MS_POR_DIA) / Estaciones.MS_POR_DIA;
        const minDia = Math.floor(frac * 1440 + 7 * 60) % 1440;
        e.minDia = minDia;
        actualizarSalidaCasa();
        const h24 = Math.floor(minDia / 60), mm = minDia % 60;
        const textoHora = "Hora: " + (h24 % 12 || 12) + ":" + (mm < 10 ? "0" : "") + mm + (h24 < 12 ? " AM" : " PM");
        if (textoHora !== e.textoHora) { e.textoHora = textoHora; rHora.textContent = textoHora; }

        const est = estado.estacion;
        const mod = est.modificadores;

        // Aviso al empezar y cada vez que cambia la estación
        if (estado.indice !== e.indiceAnterior) {
            const primera = e.indiceAnterior === -1;
            e.indiceAnterior = estado.indice;
            if (window.mostrarAviso) {
                window.mostrarAviso(
                    (primera ? "Estación: " : "Llegó ") + est.nombre +
                    "  ·  + " + est.beneficio + "  ·  − " + est.problema, 6000
                );
            }
        }

        // Rueda de estaciones (año, día y estación)
        const texto = est.id + "|" + estado.anio + "|" + estado.diaEnEstacion;
        if (texto !== e.textoHud) {
            e.textoHud = texto;
            pintarRueda(estado);
        }

        // Ambiente: más luz = mundo más claro; más lluvia = más niebla
        const brillo = 0.75 + 0.25 * mod.luz;
        const niebla = 35 / (0.7 + 0.3 * mod.lluvia);
        const k = e.reiniciarAmbiente ? 1 : Math.min(1, dt * 0.8); // cambia suave
        e.reiniciarAmbiente = false;
        const a = e.ambiente;
        for (let i = 0; i < 3; i++) {
            a.cielo[i] += (est.cielo[i] - a.cielo[i]) * k;
            a.tinte[i] += (est.tinte[i] * brillo - a.tinte[i]) * k;
        }
        a.niebla += (niebla - a.niebla) * k;
        gl.uniform3f(uTinte, a.tinte[0], a.tinte[1], a.tinte[2]);
        gl.uniform3f(uFondo, a.cielo[0], a.cielo[1], a.cielo[2]);
        gl.uniform1f(uNiebla, a.niebla);

        return mod.velocidad;
    }

    // ===== SUPERVIVENCIA =====
    // Salud, sed, hambre, sueño y cordura. 1 día del juego = 20 minutos reales (igual que las estaciones).
    // Todo lo que se puede ajustar está en SV_CONFIG.
    const SV_CONFIG = {
        sedDias: 4,            // la sed llega a 0 a los 4 días (el 5º día te empezás a morir)
        hambreDias: 32,        // el hambre dura ~4,5 semanas
        suenoDias: 7,          // sin dormir 7 días = morís
        danoSedPorDia: 60,     // vida que perdés por día con sed en 0
        danoHambrePorDia: 25,  // vida que perdés por día con hambre en 0
        aceleracionDormir: 30, // mientras dormís, sed/hambre/enfermedades corren x30
        recuperaSuenoPorSeg: 3.4,
        regeneracionSalud: 0.15   // puntos por segundo cuando estás bien
    };
    const DIA_JUEGO_MS = 20 * 60 * 1000;

    const ENFERMEDADES = {
        resfrio: { nombre: "Resfrío", sev: 15, dias: 3 },
        tos: { nombre: "Tos", sev: 8, dias: 2 }
    };

    const SANGRADO_POR_SEG = [0, 0.15, 0.3, 0.45];     // salud que perdés por segundo según cuánto sangrás (1 a 3)

    const sv = {
        activo: false, vivo: true,
        salud: 100, saludMax: 100,
        cordura: 100, corduraMax: 100,
        sed: 100, hambre: 100, sueno: 100,
        temp: 18,           // temperatura del cuerpo según el clima (se adapta de a poco)
        enf: [],            // enfermedades pasajeras: { id, nombre, sev, tasa }
        cron: [],           // enfermedades crónicas: { nombre, dano } (bajan la salud máxima para siempre)
        anabolico: false,
        sangrado: 0,        // 0 = no sangrás; 1 a 3 = cuánto (se frena con una venda)
        durmiendo: false, dormido: false, intento: 0,
        sombras: [], acumSombra: 0,
        velocidad: 1, fuerza: 1, audicion: 1,
        piernas: [{ n: 0, t: 0 }, { n: 0, t: 0 }],   // izquierda, derecha: n = 0 sana, 1 esguince, 2 fractura; t = días de juego que faltan
        msHud: 0, causa: ""
    };

    const clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
    const avisar = function (t, ms) { if (window.mostrarAviso) window.mostrarAviso(t, ms || 3500); };

    // ----- Temperatura -----
    // Clima base de cada estación (°C) y variación del día: más calor a las 15:00, más frío a las 3:00
    const TEMP_ESTACION = { otono: 10, invierno: -6, primavera: 16, verano: 30 };
    const ABRIGO = { torso: 4, piernas: 3, cabeza: 2, pies: 2 };
    function tempAmbiente() {
        const e = estacionesJuego;
        if (!e.activo || !e.reloj) return 18;
        const id = estadoEstacion().estacion.id;
        const hora = (e.minDia || 0) / 60;
        return (TEMP_ESTACION[id] != null ? TEMP_ESTACION[id] : 15) + 6 * Math.cos((hora - 15) / 24 * Math.PI * 2);
    }
    function tempSensacion() {
        const amb = tempAmbiente();
        let ab = 0;
        for (const k in ABRIGO) if (inv.equipo[k]) ab += ABRIGO[k];
        return amb + (amb < 15 ? ab : ab * 0.3);          // la ropa abriga con frío y casi no molesta con calor
    }
    // Estado térmico del cuerpo: -3 congelamiento, -2 mucho frío, -1 frío, 0 normal, 1 calor, 2 mucho calor, 3 golpe de calor
    function nivelTemp() {
        const t = sv.temp;
        if (t <= -6) return -3;
        if (t <= 2) return -2;
        if (t <= 10) return -1;
        if (t >= 38) return 3;
        if (t >= 32) return 2;
        if (t >= 27) return 1;
        return 0;
    }
    const NOMBRE_TEMP = { "-3": "Congelamiento", "-2": "Mucho frío", "-1": "Frío", "1": "Calor", "2": "Mucho calor", "3": "Golpe de calor" };

    function diasSinDormir() { return (100 - sv.sueno) / 100 * SV_CONFIG.suenoDias; }
    function diaSueno() { return Math.min(7, Math.floor(diasSinDormir()) + 1); }
    function diasSinComer() { return (100 - sv.hambre) / 100 * SV_CONFIG.hambreDias; }
    function diasSinBeber() { return (100 - sv.sed) / 100 * SV_CONFIG.sedDias; }

    function reiniciarSV(datos) {
        const d = datos || {};
        sv.vivo = true;
        sv.saludMax = clamp(d.saludMax != null ? d.saludMax : 100, 1, 100);
        sv.salud = clamp(d.salud != null ? d.salud : sv.saludMax, 1, sv.saludMax);
        sv.corduraMax = clamp(d.corduraMax != null ? d.corduraMax : 100, 1, 100);
        sv.cordura = clamp(d.cordura != null ? d.cordura : sv.corduraMax, 1, sv.corduraMax);
        sv.sed = clamp(d.sed != null ? d.sed : 100, 0, 100);
        sv.hambre = clamp(d.hambre != null ? d.hambre : 100, 0, 100);
        sv.sueno = clamp(d.sueno != null ? d.sueno : 100, 0, 100);
        sv.temp = 18;
        sv.enf = Array.isArray(d.enf) ? d.enf : [];
        sv.cron = Array.isArray(d.cron) ? d.cron : [];
        sv.anabolico = !!d.anabolico;
        sv.sangrado = clamp(Math.round(+d.sangrado || 0), 0, 3);
        sv.piernas = [0, 1].map(function (i) {
            const q = d.piernas && d.piernas[i];
            const n = q ? clamp(Math.round(+q.n || 0), 0, 2) : 0;
            return { n: n, t: n > 0 ? Math.max(0.001, +q.t || REC_DIAS[n]) : 0 };
        });
        postura = 0;
        alturaCam = altura;
        modoPelea = false;
        ruidoPulso = 0;
        sv.durmiendo = false;
        sv.dormido = false;
        sv.intento = 0;
        sv.sombras = [];
        sv.acumSombra = 0;
    }

    // Daño directo (caídas, etc.)
    function danar(n, causa) {
        if (!sv.activo || !sv.vivo || n <= 0) return;
        sv.salud = Math.max(0, sv.salud - n);
        if (sv.salud <= 0) morir(causa || "Tu cuerpo no resistió.");
        else avisar("Te lastimaste (−" + Math.round(n) + ")", 2000);
    }

    // ----- Piernas: esguinces y fracturas -----
    const REC_DIAS = { 1: 0.12, 2: 0.45 };   // días de juego para pasar de fractura a esguince y de esguince a sana
    const NOMBRE_PIERNA = ["izquierda", "derecha"];

    // Devuelve true si la pierna quedó peor de lo que estaba
    function herirPierna(i, nivel) {
        if (nivel <= 0) return false;
        const p = sv.piernas[i];
        if (nivel < p.n) return false;
        const peor = nivel > p.n;
        p.n = nivel;
        p.t = Math.max(p.t, REC_DIAS[nivel]);
        return peor;
    }

    // Según qué tan fuerte caíste: esguince, esguince en las dos, fractura, las dos fracturas.
    // El daño sale de las lesiones (así lo que perdés de vida coincide con lo que te pasó en las piernas):
    // esguince 8, fractura 22 por pierna, y si la caída es todavía más alta se suma un extra.
    const DANO_PIERNA = { 0: 0, 1: 8, 2: 22 };
    // Alturas en metros; un piso de la casa mide 3 m. v es la velocidad al tocar el suelo (gravedad 14).
    const GRAVEDAD = 14;
    const PISO_M = 3;
    const CAIDA_ESGUINCE = 2 * PISO_M;        // 2 pisos: esguince
    const CAIDA_FRACTURA = 2.5 * PISO_M;      // 2 pisos y medio: fractura
    const CAIDA_DOBLE = 3 * PISO_M;           // 3 pisos: fractura en las dos piernas (y daño extra de ahí en más)
    function alturaCaida(v) { return v * v / (2 * GRAVEDAD); }
    function tramoCaida(v) {
        const h = alturaCaida(v);
        if (h < CAIDA_ESGUINCE + 0.75) return [1, 0];
        if (h < CAIDA_FRACTURA) return [1, 1];
        if (h < CAIDA_DOBLE) return [2, Math.random() < 0.5 ? 1 : 0];
        return [2, 2];
    }
    function lesionPorCaida(tramo) {
        if (!sv.activo || !sv.vivo) return;
        const lado = Math.random() < 0.5 ? 0 : 1;
        const avisos = [];
        [[lado, tramo[0]], [1 - lado, tramo[1]]].forEach(function (x) {
            if (herirPierna(x[0], x[1])) {
                avisos.push((x[1] === 2 ? "Te quebraste" : "Te esguinzaste") + " la pierna " + NOMBRE_PIERNA[x[0]]);
            }
        });
        if (avisos.length) avisar(avisos.join(" · "), 4500);
    }

    function aterrizar(v) {
        if (v > 4) ruidoPulso = Math.max(ruidoPulso, 6 + v * 1.4);
        if (alturaCaida(v) < CAIDA_ESGUINCE || !sv.activo || !sv.vivo) return;   // menos de 2 pisos no lastima
        const tramo = tramoCaida(v);
        const vDoble = Math.sqrt(2 * GRAVEDAD * CAIDA_DOBLE);
        const dano = DANO_PIERNA[tramo[0]] + DANO_PIERNA[tramo[1]] + Math.max(0, v - vDoble) * 10;
        danar(dano, "Moriste por una caída.");
        lesionPorCaida(tramo);
    }

    // Qué tan rápido caminás con las piernas lastimadas (las muletas ayudan)
    function factorPiernas() {
        const total = sv.piernas[0].n + sv.piernas[1].n;
        if (total === 0) return 1;
        let f = [1, 0.8, 0.65, 0.5, 0.22][total];
        if (muletasEnMano()) f += (1 - f) * 0.35;
        return f;
    }

    function textoLesiones() {
        const t = [];
        const muletas = muletasEnMano();
        sv.piernas.forEach(function (p, i) {
            if (p.n <= 0) return;
            const dias = p.t + (p.n === 2 ? REC_DIAS[1] : 0);
            const min = Math.max(1, Math.ceil(dias * 60 / (muletas ? 2 : 1)));
            t.push("Pierna " + NOMBRE_PIERNA[i] + ": " + (p.n === 2 ? "fractura" : "esguince") + " (≈" + min + " min)");
        });
        if (t.length && !muletas) t.push("Con muletas en la mano te recuperás el doble de rápido.");
        return t.join("<br>");
    }

    // ----- Enfermedades -----
    function enfermar(id, opciones) {
        const base = Object.assign({ nombre: id, sev: 10, dias: 2 }, ENFERMEDADES[id] || {}, opciones || {});
        const ya = sv.enf.find(function (e) { return e.id === id; });
        if (ya) {
            ya.sev = Math.max(ya.sev, base.sev);
            ya.tasa = base.sev / base.dias;
        } else {
            sv.enf.push({ id: id, nombre: base.nombre, sev: base.sev, tasa: base.sev / base.dias });
        }
    }
    function enfermarCronica(nombre, dano) {
        sv.cron.push({ nombre: nombre, dano: dano });
        sv.saludMax = Math.max(1, sv.saludMax - dano);   // fija: nunca se recupera
        sv.salud = Math.min(sv.salud, sv.saludMax);
    }

    // ----- Interfaz -----
    const estiloSv = document.createElement("style");
    estiloSv.textContent = `
:root{--slot:clamp(34px,7.4vh,92px);--s2:calc(var(--slot)*.86);}
#hudBajo{position:fixed;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:800;display:none;
 align-items:flex-end;gap:calc(var(--slot)*.25);pointer-events:none;font-family:'Cinzel Decorative',serif;color:#fff;}
#hudBajo .hbCorazon{position:relative;width:calc(var(--slot)*1.55);height:calc(var(--slot)*1.4);
 filter:drop-shadow(0 0 calc(10px*var(--v)) rgba(255,40,40,calc(.85*var(--v))));}
#hudBajo .hbCorazon svg{width:100%;height:100%;display:block;}
#hudBajo .hbNum{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
 font-size:calc(var(--slot)*.42);letter-spacing:1px;text-shadow:0 0 6px #000,0 0 10px #f00;padding-top:calc(var(--slot)*.06);}
#hudBajo .hbMax{font-size:max(9px,calc(var(--slot)*.2));opacity:.8;margin-top:-2px;}
#hudBajo .hbCentro{display:flex;flex-direction:column;align-items:flex-start;gap:calc(var(--slot)*.12);}
#hudBajo .hbEstado{font-size:max(10px,calc(var(--slot)*.22));letter-spacing:1px;color:#e8c9c9;text-shadow:0 0 6px #000;min-height:1.1em;}
#hudBajo .hbPills{display:grid;grid-template-columns:1fr 1fr;gap:calc(var(--slot)*.1) calc(var(--slot)*.14);}
#hudBajo .hbPill{position:relative;overflow:hidden;box-sizing:border-box;height:max(17px,calc(var(--slot)*.42));min-width:calc(var(--slot)*2.2);
 padding:0 calc(var(--slot)*.18);display:flex;align-items:center;justify-content:space-between;gap:.5em;
 border:2px solid rgba(255,215,220,calc(.3 + .55*var(--v)));border-radius:calc(var(--slot)*.22);background:rgba(28,0,0,.82);
 font-size:max(10px,calc(var(--slot)*.24));letter-spacing:1px;text-shadow:0 0 2px #000;
 filter:brightness(calc(.35 + .65*var(--v)));}
#hudBajo .hbRelleno{position:absolute;left:0;top:0;bottom:0;width:calc(var(--v)*100%);background:linear-gradient(90deg,rgba(0,0,0,0),var(--c));opacity:.65;}
#hudBajo .hbTope{position:absolute;right:0;top:0;bottom:0;width:var(--tope,0%);background:repeating-linear-gradient(45deg,#000 0 3px,#2a2a2a 3px 6px);opacity:.9;}
#hudBajo .hbPill span{position:relative;}
#hudBajo .hbFila{display:flex;align-items:center;pointer-events:auto;}
#hudBajo .hbSlots{display:flex;border:2px solid rgba(255,215,220,.85);border-radius:calc(var(--slot)*.18);background:rgba(25,0,0,.72);box-shadow:0 0 14px rgba(255,0,0,.25);overflow:hidden;}
#hudBajo .hbSlot{position:relative;width:var(--slot);height:var(--slot);box-sizing:border-box;display:flex;align-items:center;justify-content:center;
 cursor:pointer;font-size:calc(var(--slot)*.55);border-left:2px solid rgba(255,215,220,.45);user-select:none;-webkit-user-select:none;}
#hudBajo .hbSlot:first-child{border-left:none;}
#hudBajo .hbSlot .hbN{position:absolute;left:3px;top:1px;font-size:max(8px,calc(var(--slot)*.2));opacity:.5;}
#hudBajo .hbSlot.sel,.iSlot.sel{background:rgba(120,0,0,.55);box-shadow:inset 0 0 12px rgba(255,60,60,.8),0 0 10px rgba(255,40,40,.7);}
#hudBajo .hbMas{margin-left:calc(var(--slot)*.18);width:var(--slot);height:var(--slot);box-sizing:border-box;border:2px solid rgba(255,215,220,.85);
 border-radius:calc(var(--slot)*.18);background:rgba(25,0,0,.72);display:flex;align-items:center;justify-content:center;
 font-size:calc(var(--slot)*.7);cursor:pointer;text-shadow:0 0 10px #f00;user-select:none;-webkit-user-select:none;}
#hudBajo .hbMano{position:relative;margin-left:calc(var(--slot)*.18);width:var(--slot);height:var(--slot);box-sizing:border-box;border:2px solid rgba(255,215,220,.85);
 border-radius:calc(var(--slot)*.18);background:rgba(25,0,0,.72);display:flex;align-items:center;justify-content:center;font-size:calc(var(--slot)*.55);
 cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;}
#hudBajo .hbMano .hbN{position:absolute;left:3px;top:1px;font-size:max(8px,calc(var(--slot)*.2));opacity:.6;}
#hudBajo .hbMano .hbVac{opacity:.3;}
#hudBajo .hbMano.mano{background:rgba(150,80,0,.55);box-shadow:inset 0 0 12px rgba(255,170,60,.9),0 0 10px rgba(255,150,40,.7);}
#hudBajo .hbMano.sel{background:rgba(120,0,0,.55);box-shadow:inset 0 0 12px rgba(255,60,60,.8),0 0 10px rgba(255,40,40,.7);}
#hudBajo .hbMas.on{background:rgba(120,0,0,.6);box-shadow:0 0 14px rgba(255,40,40,.7);}
#svVineta{position:fixed;inset:0;z-index:780;pointer-events:none;opacity:0;
 background:radial-gradient(ellipse at center,rgba(0,0,0,0) 35%,rgba(0,0,0,0.92) 100%);}
#svSueno{position:fixed;inset:0;z-index:790;pointer-events:none;opacity:0;background:#000;transition:opacity 1.2s;
 display:flex;align-items:center;justify-content:center;color:#d9b8b8;font-family:'Cinzel Decorative',serif;
 font-size:clamp(1rem,3vw,1.8rem);letter-spacing:3px;}
#svAcciones{position:fixed;left:50%;bottom:calc(var(--slot)*2.8 + 14px);transform:translateX(-50%);z-index:795;
 display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;}
#svAcciones .svBtn{display:none;pointer-events:auto;padding:0.4rem 1.2rem;border:2px solid rgba(255,215,220,0.85);border-radius:18px;
 background:rgba(20,0,0,0.88);color:#fff;font-family:'Cinzel Decorative',serif;font-size:clamp(12px,calc(var(--slot)*.3),22px);letter-spacing:2px;cursor:pointer;
 text-shadow:0 0 8px #f00;}
#svMuerte{position:fixed;inset:0;z-index:1600;display:none;flex-direction:column;align-items:center;
 justify-content:center;gap:1.2rem;background:rgba(10,0,0,.88);color:#fff;text-align:center;font-family:'Cinzel Decorative',serif;}
#svMuerte h1{margin:0;font-size:clamp(2rem,8vw,4.5rem);letter-spacing:8px;color:#b00000;text-shadow:0 0 20px #f00;}
#svMuerte p{margin:0;font-size:clamp(0.9rem,2.4vw,1.4rem);color:#d9b8b8;max-width:80vw;}
#svMuerte button{font-family:inherit;font-size:clamp(1rem,2.6vw,1.6rem);letter-spacing:3px;color:#fff;background:rgba(60,0,0,.7);
 border:2px solid rgba(255,215,220,.85);border-radius:22px;padding:.4rem 1.6rem;cursor:pointer;}
/* ===== INVENTARIO ===== */
#invFondo{position:fixed;inset:0;z-index:850;display:none;pointer-events:none;}
#invFondo.visible{display:block;}
#invCaja{--s2:calc(var(--slot)*.86*var(--ik,1));position:absolute;left:50%;transform:translateX(-50%);top:10px;max-height:calc(100% - var(--slot) - 32px);width:min(94vw,calc(var(--s2)*15.6));
 box-sizing:border-box;pointer-events:auto;overflow:auto;display:grid;grid-template-columns:auto auto auto 1fr;grid-template-rows:auto 1fr auto;
 gap:10px 18px;padding:12px 16px;border:2px solid rgba(255,215,220,.85);border-radius:22px;background:rgba(22,0,0,.95);
 box-shadow:0 0 30px rgba(255,0,0,.35);font-family:'Cinzel Decorative',serif;color:#fff;}
#invCaja .invVista{position:relative;align-self:stretch;width:calc(var(--s2)*2.3);min-height:calc(var(--s2)*5);box-sizing:border-box;
 border:2px solid rgba(255,215,220,.85);border-radius:14px;background:rgba(60,0,0,.35);overflow:hidden;}
#invCaja .invVista canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;
 user-select:none;-webkit-user-select:none;}
#invCaja .invVista canvas:active{cursor:grabbing;}
#invCaja .invCab{grid-column:1/-1;display:flex;align-items:center;gap:6px;margin:-4px 0 0;padding-bottom:6px;border-bottom:2px solid rgba(255,215,220,.4);
 cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;font-size:max(11px,calc(var(--s2)*.3));letter-spacing:2px;color:#e8c9c9;text-shadow:0 0 8px #f00;}
#invCaja .invCab.mueve{cursor:grabbing;}
#invCaja .invCab .invCabTit{flex:1;white-space:nowrap;}
#invCaja .invCab button{font-family:inherit;font-size:inherit;line-height:1;min-width:calc(var(--s2)*.62);height:calc(var(--s2)*.62);padding:0 .35em;color:#fff;background:rgba(60,0,0,.6);
 border:2px solid rgba(255,215,220,.7);border-radius:10px;cursor:pointer;text-shadow:0 0 8px #f00;touch-action:none;}
#invCaja .invCab button.grip{cursor:nwse-resize;}
#invCaja .invPie .invLes{flex-basis:100%;font-size:max(10px,calc(var(--s2)*.26));line-height:1.4;color:#ffb3b3;text-shadow:0 0 4px #000;}
#hudBajo .hbSlot.mano{background:rgba(150,80,0,.55);box-shadow:inset 0 0 12px rgba(255,170,60,.9),0 0 10px rgba(255,150,40,.7);}
#invCaja .invTit{font-size:max(11px,calc(var(--s2)*.3));letter-spacing:2px;color:#e8c9c9;text-shadow:0 0 8px #f00;margin-bottom:5px;}
#invCaja .invCol{display:flex;flex-direction:column;align-items:center;gap:5px;}
#invCaja .invGrid{display:grid;grid-template-columns:repeat(var(--cols),var(--s2));gap:4px;}
#invCaja .invConts{display:flex;flex-wrap:wrap;gap:12px 22px;align-content:flex-start;}
#invCaja .invVacio{color:#b9908f;font-size:max(11px,calc(var(--s2)*.3));letter-spacing:1px;line-height:1.5;max-width:260px;}
#invCaja .iSlot{position:relative;box-sizing:border-box;width:var(--s2);height:var(--s2);border:2px solid rgba(230,140,50,.8);border-radius:8px;
 background:rgba(60,20,0,.35);display:flex;align-items:center;justify-content:center;font-size:calc(var(--s2)*.58);cursor:pointer;
 user-select:none;-webkit-user-select:none;}
#invCaja .iSlot.eq{border-color:rgba(255,215,220,.85);background:rgba(60,0,0,.45);}
#invCaja .iSlot.alta{height:calc(var(--s2)*2.4);width:calc(var(--s2)*1.3);}
#invCaja .iSlot .iEt{position:absolute;font-size:max(8px,calc(var(--s2)*.2));opacity:.55;text-align:center;line-height:1.1;pointer-events:none;}
#invCaja .invAcc{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px 22px;align-items:flex-start;border-top:2px solid rgba(255,215,220,.4);padding-top:8px;}
#invCaja .invAcc .invAccBtn{font-family:inherit;font-size:max(11px,calc(var(--s2)*.3));letter-spacing:2px;color:#e8c9c9;background:none;border:0;padding:0;cursor:pointer;text-shadow:0 0 8px #f00;}
#invCaja .invAccGr{display:flex;flex-direction:column;gap:4px;}
#invCaja .invAccFila{display:flex;flex-wrap:wrap;gap:4px;max-width:calc(var(--s2)*6.4);}
#invCaja .iSlot.acc{width:calc(var(--s2)*.78);height:calc(var(--s2)*.78);font-size:calc(var(--s2)*.44);}
#invCaja .iSlot.acc.on{border-color:#ffd54a;background:rgba(120,70,0,.6);box-shadow:0 0 10px rgba(255,200,60,.8);}
#invCaja .iSlot.acc.nada{font-size:calc(var(--s2)*.34);opacity:.7;}
#invCaja .invPie{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;min-height:calc(var(--s2)*.8);border-top:2px solid rgba(255,215,220,.4);padding-top:8px;
 font-size:max(11px,calc(var(--s2)*.3));letter-spacing:1px;color:#d9b8b8;}
#invCaja .invPie b{color:#fff;font-weight:normal;text-shadow:0 0 8px #f00;}
#invCaja .invPie button{font-family:inherit;font-size:inherit;letter-spacing:2px;color:#fff;background:rgba(60,0,0,.6);
 border:2px solid rgba(255,215,220,.7);border-radius:14px;padding:.15rem .9rem;cursor:pointer;text-shadow:0 0 8px #f00;}
`;
    document.head.appendChild(estiloSv);

    const hudBajo = document.createElement("div");
    hudBajo.id = "hudBajo";
    hudBajo.innerHTML =
        '<div class="hbCorazon" id="hbCorazon" style="--v:1"><svg viewBox="0 0 32 29">' +
        '<defs><linearGradient id="hbGradC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e03a3a"/><stop offset="1" stop-color="#7a0000"/></linearGradient>' +
        '<clipPath id="hbClipC"><rect id="hbClipRect" x="0" y="2" width="32" height="26"/></clipPath></defs>' +
        '<path d="M16 28C16 28 2 18 2 9.5C2 5 5.500 2 9.500 2C12.500 2 15 3.600 16 6C17 3.600 19.500 2 22.500 2C26.500 2 30 5 30 9.500C30 18 16 28 16 28Z" fill="#1c0505"/>' +
        '<path d="M16 28C16 28 2 18 2 9.5C2 5 5.500 2 9.500 2C12.500 2 15 3.600 16 6C17 3.600 19.500 2 22.500 2C26.500 2 30 5 30 9.500C30 18 16 28 16 28Z" fill="url(#hbGradC)" clip-path="url(#hbClipC)"/>' +
        '<path d="M16 28C16 28 2 18 2 9.5C2 5 5.500 2 9.500 2C12.500 2 15 3.600 16 6C17 3.600 19.500 2 22.500 2C26.500 2 30 5 30 9.500C30 18 16 28 16 28Z" fill="none" stroke="rgba(255,215,220,.9)" stroke-width="1.2"/></svg>' +
        '<div class="hbNum"><span id="hbSalud">100</span><span class="hbMax" id="hbSaludMax"></span></div></div>' +
        '<div class="hbCentro">' +
        '<div class="hbPills">' +
        '<div class="hbPill" id="hbP_sueno" style="--c:#7a56c8;--v:1"><div class="hbRelleno"></div><span>Sueño</span><span class="hbV">100</span></div>' +
        '<div class="hbPill" id="hbP_cordura" style="--c:#6f9a68;--v:1"><div class="hbRelleno"></div><div class="hbTope"></div><span>Cordura</span><span class="hbV">100</span></div>' +
        '<div class="hbPill" id="hbP_sed" style="--c:#3c8fd0;--v:1"><div class="hbRelleno"></div><span>Sed</span><span class="hbV">100</span></div>' +
        '<div class="hbPill" id="hbP_hambre" style="--c:#d88a3a;--v:1"><div class="hbRelleno"></div><span>Hambre</span><span class="hbV">100</span></div>' +
        '</div><div class="hbFila"><div class="hbSlots" id="hbSlots"></div><div class="hbMas" id="hbMas">+</div></div></div>';
    document.body.appendChild(hudBajo);
    const hbPuno = document.createElement("div");
    hbPuno.className = "hbMas";
    hbPuno.id = "hbPuno";
    hbPuno.textContent = "✊";
    hbPuno.title = "Pegar (F)";
    hudBajo.querySelector(".hbFila").appendChild(hbPuno);
    hbPuno.addEventListener("pointerdown", function (e) { e.preventDefault(); atacar(); });

    const vineta = document.createElement("div");
    vineta.id = "svVineta";
    document.body.appendChild(vineta);

    const capaSueno = document.createElement("div");
    capaSueno.id = "svSueno";
    document.body.appendChild(capaSueno);

    const cajaAcciones = document.createElement("div");
    cajaAcciones.id = "svAcciones";
    const botonObjeto = document.createElement("div");
    botonObjeto.className = "svBtn";
    const cartelCama = document.createElement("div");
    cartelCama.className = "svBtn";
    const botonAbertura = document.createElement("div");
    botonAbertura.className = "svBtn";
    cajaAcciones.appendChild(botonAbertura);
    const botonAbertura2 = document.createElement("div");      // cartel de pasar por la ventana (solo en la compu; en el celu es el botón redondo)
    botonAbertura2.className = "svBtn";
    cajaAcciones.appendChild(botonAbertura2);
    cajaAcciones.appendChild(botonObjeto);
    cajaAcciones.appendChild(cartelCama);
    document.body.appendChild(cajaAcciones);

    const pantallaMuerte = document.createElement("div");
    pantallaMuerte.id = "svMuerte";
    pantallaMuerte.innerHTML = '<h1>Moriste</h1><p id="svCausa"></p>' +
        '<button id="svReaparecer">Reaparecer</button><button id="svSalir">Salir al menú</button>';
    document.body.appendChild(pantallaMuerte);

    const invFondo = document.createElement("div");
    invFondo.id = "invFondo";
    invFondo.innerHTML = '<div id="invCaja"></div>';
    document.body.appendChild(invFondo);

    // Una barrita: --v (0 a 1) controla el brillo; llena = un poco iluminada, vacía = oscura
    function ponerBarra(id, valor, tope) {
        const el = document.getElementById(id);
        el.style.setProperty("--v", (valor / 100).toFixed(3));
        if (tope != null) el.style.setProperty("--tope", tope + "%");
        el.querySelector(".hbV").textContent = Math.round(valor);
    }

    function pintarHud() {
        const vCor = clamp(sv.salud / 100, 0, 1);
        document.getElementById("hbCorazon").style.setProperty("--v", vCor.toFixed(3));
        const clipC = document.getElementById("hbClipRect");     // el corazón se va vaciando desde arriba
        clipC.setAttribute("y", (2 + 26 * (1 - vCor)).toFixed(2));
        clipC.setAttribute("height", (26 * vCor).toFixed(2));
        document.getElementById("hbSalud").textContent = Math.round(sv.salud);
        document.getElementById("hbSaludMax").textContent = sv.saludMax < 100 ? "/" + Math.round(sv.saludMax) : "";
        ponerBarra("hbP_sueno", sv.sueno);
        ponerBarra("hbP_cordura", sv.cordura, 100 - sv.corduraMax);
        ponerBarra("hbP_sed", sv.sed);
        ponerBarra("hbP_hambre", sv.hambre);
        const estados = [];
        sv.enf.forEach(function (e) { estados.push(e.nombre); });
        sv.cron.forEach(function (c) { estados.push(c.nombre + " (crónica)"); });
        if (sv.sangrado > 0) estados.push(["", "Sangrando", "Sangrando mucho", "Sangrando muchísimo"][sv.sangrado]);
        if (nivelTemp() !== 0) estados.push(NOMBRE_TEMP[String(nivelTemp())]);
        if (sv.sed <= 0) estados.push("Deshidratado");
        else if (sv.sed < 25) estados.push("Sed");
        if (sv.hambre <= 0) estados.push("Inanición");
        else if (diasSinComer() >= 7) estados.push("Debilidad");
        if (diaSueno() >= 2) estados.push("Sin dormir: día " + diaSueno());
        sv.piernas.forEach(function (p, i) {
            if (p.n === 2) estados.push("Pierna " + NOMBRE_PIERNA[i] + " rota");
            else if (p.n === 1) estados.push("Esguince (" + NOMBRE_PIERNA[i] + ")");
        });
        if (postura === 1) estados.push("Agachado · sigilo");
        else if (postura === 2) estados.push("Arrastrándote · sigilo total");
        document.getElementById("hbEstado").textContent = estados.join(" · ");
    }

    // ----- Muerte -----
    function morir(causa) {
        if (!sv.vivo) return;
        sv.vivo = false;
        sv.durmiendo = false;
        sv.dormido = false;
        sv.causa = causa;
        document.getElementById("svCausa").textContent = causa;
        pantallaMuerte.style.display = "flex";
        if (window.soltarControles) window.soltarControles();
        try { document.exitPointerLock(); } catch (e) {}
    }

    function cerrarPausaSiHay() {
        const p = document.getElementById("pausa");
        if (p && p.classList.contains("visible")) document.getElementById("pausaReanudar").click();
    }

    document.getElementById("svReaparecer").addEventListener("click", function () {
        reiniciarSV();
        irACasa();
        pantallaMuerte.style.display = "none";
        cerrarPausaSiHay();
    });
    document.getElementById("svSalir").addEventListener("click", function () {
        document.getElementById("pausaSalir").click();
    });

    // ----- Dormir -----
    function cercaDeCama() {
        return CAMAS.some(function (c) {
            const cx = clamp(px, c[0], c[2]);
            const cz = clamp(pz, c[1], c[3]);
            return Math.hypot(px - cx, pz - cz) <= 1.4;
        });
    }

    function empezarDormir() {
        if (!sv.activo || !sv.vivo || sv.durmiendo || !cercaDeCama()) return;
        if (diaSueno() <= 3 && sv.sueno > 90) { avisar("No tenés sueño"); return; }
        sv.durmiendo = true;
        sv.dormido = false;
        sv.intento = 0;
        if (window.soltarControles) window.soltarControles();
        avisar("Intentando dormir...", 2500);
    }

    function despertar() {
        sv.durmiendo = false;
        sv.dormido = false;
        sv.intento = 0;
    }

    function alternarDormir() {
        if (sv.durmiendo) despertar(); else empezarDormir();
    }

    window.addEventListener("keydown", function (e) {
        if (e.repeat || window.juegoPausado || !sv.activo || !sv.vivo) return;
        if (e.code === A.teclas.interactuar) { if (!inv.abierto && !recogerCercano() && !usarAbertura()) alternarDormir(); }
        if (e.code === "KeyR" && !inv.abierto) pasarPorVentana();
        if (e.code === A.teclas.tirar && !inv.abierto) {
            const r = inv.manoD ? { t: "h", k: "D" } : (inv.manoI ? { t: "h", k: "I" } : null);
            if (r) tirar(r); else avisar("No tenés nada en las manos", 1500);
        }
        if (e.code === A.teclas.inventario || e.code === "Tab") {
            e.preventDefault();
            if (inv.abierto) cerrarInventario(); else abrirInventario();
        }
        if (e.code === "KeyB" && !inv.abierto) alternarBaile();
        if (e.code === "KeyV" && !e.repeat) alternarMicrofono();
        if (/^Digit[1-7]$/.test(e.code)) tocarBarra(parseInt(e.code.slice(5), 10) - 1, true);
        if (DEBUG_SV) {
            if (e.code === "KeyJ") sv.sed = 100;
            if (e.code === "KeyK") sv.hambre = 100;
            if (e.code === "KeyL") enfermar("resfrio");
            if (e.code === "KeyN") { sv.anabolico = true; avisar("Anabólico inyectado"); }
            if (e.code === "KeyM") enfermarCronica("Enfermedad crónica", 10);
            if (e.code === "KeyT") saltarDias(1);
            if (e.code === "KeyY") saltarDias(7);
        }
    });
    cartelCama.addEventListener("touchstart", function (e) { e.preventDefault(); alternarDormir(); }, { passive: false });
    cartelCama.addEventListener("click", alternarDormir);
    botonObjeto.addEventListener("touchstart", function (e) { e.preventDefault(); recogerCercano(); }, { passive: false });
    botonObjeto.addEventListener("click", recogerCercano);
    botonAbertura.addEventListener("touchstart", function (e) { e.preventDefault(); usarAbertura(); }, { passive: false });
    botonAbertura.addEventListener("click", usarAbertura);
    botonAbertura2.addEventListener("click", pasarPorVentana);

    // ===== INVENTARIO =====
    // Sin ropa ni mochila puesta el inventario está vacío (solo tenés la barra rápida de abajo).
    // Cada prenda puesta suma espacio: mochila, camisa y pantalón tienen bolsillos.
    const ITEMS = {
        mochila:   { n: "Mochila", e: "🎒", slot: "espalda", cap: 10, cols: 5, d: "Guarda hasta 10 objetos. Puesta en la espalda o en una mano; no entra en el inventario." },
        camisa:    { n: "Camisa", e: "👕", slot: "torso", cap: 2, cols: 2, d: "Tiene 2 bolsillos." },
        pantalon:  { n: "Pantalón", e: "👖", slot: "piernas", cap: 4, cols: 2, d: "Tiene 4 bolsillos." },
        palo:      { n: "Palo", e: "🪵", mano: true, arma: { dano: 12, alcance: 2.0, espera: 0.6 }, d: "Se lleva en la mano. Pegás con él (daño medio)." },
        cuchillo:  { n: "Cuchillo", e: "🔪", mano: true, arma: { dano: 20, alcance: 1.6, espera: 0.45 }, d: "Se lleva en la mano. Rápido y filoso (daño alto, poco alcance)." },
        hacha:     { n: "Hacha", e: "🪓", mano: true, arma: { dano: 30, alcance: 1.9, espera: 1.0 }, d: "Se lleva en la mano. Lenta pero muy fuerte." },
        muletas:   { n: "Muletas", e: "🩼", mano: true, ayuda: true, d: "En la mano: caminás mejor con las piernas lastimadas y te recuperás el doble de rápido." },
        gorra:     { n: "Gorra", e: "🧢", slot: "cabeza", d: "Te cubre la cabeza." },
        botas:     { n: "Botas", e: "🥾", slot: "pies", d: "Calzado resistente." },
        agua:      { n: "Botella de agua", e: "💧", uso: "beber", d: "Calma la sed." },
        comida:    { n: "Lata de comida", e: "🥫", uso: "comer", d: "Calma el hambre." },
        jarabe:    { n: "Jarabe", e: "🧪", uso: "curar", d: "Cura resfríos y tos." },
        anabolico: { n: "Anabólico", e: "💉", uso: "anabolico", d: "Te deja dormir aunque no puedas." },
        venda:     { n: "Venda", e: "🩹", uso: "vendar", d: "Frena el sangrado de los cortes." }
    };
    const COLOR_ITEM = {
        mochila: [0.45, 0.30, 0.15], camisa: [0.30, 0.50, 0.80], pantalon: [0.25, 0.30, 0.60],
        gorra: [0.70, 0.20, 0.20], botas: [0.40, 0.25, 0.12], agua: [0.30, 0.70, 0.95],
        comida: [0.80, 0.60, 0.20], jarabe: [0.40, 0.85, 0.50], anabolico: [0.90, 0.90, 0.20],
        palo: [0.55, 0.38, 0.20], cuchillo: [0.78, 0.80, 0.85], hacha: [0.52, 0.52, 0.58], muletas: [0.82, 0.80, 0.72],
        venda: [0.93, 0.90, 0.80]
    };
    // ===== ACCESORIOS =====
    // Son gratis e ilimitados (no ocupan lugar ni hay que buscarlos en el mapa). Se eligen desde el inventario,
    // se ven en tu personaje y los demás jugadores te ven con ellos puestos. Hay uno por categoría.
    const ACC_SLOTS = ["adorno", "ojos", "cara"];
    const ACC_TIT = { adorno: "Cabeza", ojos: "Ojos", cara: "Cara" };
    const ACC = {
        flor_roja:     { n: "Flor roja", e: "🌹", slot: "adorno" },
        flor_rosa:     { n: "Flor rosa", e: "🌸", slot: "adorno" },
        flor_amarilla: { n: "Flor amarilla", e: "🌼", slot: "adorno" },
        flor_azul:     { n: "Flor azul", e: "🪻", slot: "adorno" },
        ramillete:     { n: "Ramillete de flores", e: "💐", slot: "adorno" },
        corona_flores: { n: "Corona de flores", e: "🌷", slot: "adorno" },
        mono:          { n: "Moño", e: "🎀", slot: "adorno" },
        orejas_gato:   { n: "Orejas de gato", e: "🐱", slot: "adorno" },
        corona:        { n: "Corona", e: "👑", slot: "adorno" },
        pestanas:      { n: "Pestañas", e: "👁️", slot: "ojos" },
        anteojos:      { n: "Anteojos", e: "👓", slot: "ojos" },
        anteojos_sol:  { n: "Anteojos de sol", e: "🕶️", slot: "ojos" },
        rubor:         { n: "Rubor", e: "😊", slot: "cara" },
        pecas:         { n: "Pecas", e: "✨", slot: "cara" },
        bigote:        { n: "Bigote", e: "🥸", slot: "cara" }
    };
    // Los accesorios son de la persona, no de la partida: se guardan aparte y se ven también en los servidores online
    const CLAVE_ACC = "rainster_accesorios";
    function guardarAcc() { try { localStorage.setItem(CLAVE_ACC, accATexto(inv.acc)); } catch (e) {} }
    function cargarAcc() {
        let q = "";
        try { q = localStorage.getItem(CLAVE_ACC) || ""; } catch (e) {}
        inv.acc = accDeTexto(q);
    }
    function accValido(id, slot) { return typeof id === "string" && ACC[id] && ACC[id].slot === slot ? id : null; }
    // lo que mandamos por la red: "adorno,ojos,cara"
    function accATexto(a) { return ACC_SLOTS.map(function (k) { return (a && a[k]) || ""; }).join(","); }
    function accDeTexto(q) {
        const r = {};
        if (typeof q !== "string") return r;
        const partes = q.split(",");
        ACC_SLOTS.forEach(function (k, i) { const id = accValido(partes[i], k); if (id) r[k] = id; });
        return r;
    }
    // ===== BAILES =====
    // Gratis. Se eligen en el inventario o con la tecla B. Se cortan solos si te movés, saltás, te agachás o peleás.
    // Cada baile devuelve la pose según el tiempo t (en segundos): ai/ad = brazo izq./der. (negativo = hacia adelante y arriba),
    // p = giro de cada pierna, oy = salto, giro = vuelta completa del cuerpo, tw = giro de arriba del cuerpo, cab = cabeceo.
    const BAILES = {
        movete: { n: "Movete", e: "🕺", f: function (t) {
            const s = Math.sin(t * 8);
            return { ai: -2.6 + 0.6 * s, ad: -2.6 - 0.6 * s, p: [0.35 * s, -0.35 * s], oy: 0.04 * Math.abs(s), tw: 0.25 * Math.sin(t * 4), cab: 0.15 * Math.sin(t * 8) };
        } },
        giro: { n: "Giro", e: "💃", f: function (t) {
            return { ai: -2.8, ad: -2.8, p: [0.3 * Math.sin(t * 10), -0.3 * Math.sin(t * 10)], oy: 0.03 * Math.abs(Math.sin(t * 5)), giro: t * 5 };
        } },
        robot: { n: "Robot", e: "🤖", f: function (t) {
            const q = Math.floor(t * 2.5) % 4;
            return { ai: [-1.57, 0, -1.57, -3][q], ad: [0, -1.57, -3, -1.57][q], p: [0, 0], tw: [0.6, 0, -0.6, 0][q], cab: [0.3, 0, -0.3, 0][q] };
        } },
        saltitos: { n: "Saltitos", e: "🦘", f: function (t) {
            const s = Math.sin(t * 6);
            return { ai: -3 + 0.3 * Math.sin(t * 12), ad: -3 - 0.3 * Math.sin(t * 12), p: [-0.35 * Math.abs(s), -0.35 * Math.abs(s)], oy: 0.3 * Math.abs(s) };
        } },
        twist: { n: "Twist", e: "🌀", f: function (t) {
            const s = Math.sin(t * 6);
            return { ai: -0.8 + 0.8 * s, ad: -0.8 - 0.8 * s, p: [0, 0], tw: 0.7 * s, oy: 0.02 * Math.abs(s) };
        } },
        pasitos: { n: "Pasitos", e: "🦵", f: function (t) {
            const s = Math.sin(t * 6);
            return { ai: -0.9 * s, ad: 0.9 * s, p: [-0.9 * Math.max(0, s), -0.9 * Math.max(0, -s)], oy: 0.03 * Math.abs(s), tw: 0.15 * s };
        } }
    };
    const BAILE_ORDEN = ["movete", "giro", "robot", "saltitos", "twist", "pasitos"];
    let baile = null;              // { id, t0 } mientras bailás
    let ultimoBaile = "movete";
    function empezarBaile(id) {
        if (!BAILES[id]) return;
        baile = { id: id, t0: performance.now() / 1000 };
        ultimoBaile = id;
    }
    function pararBaile() { baile = null; }
    function alternarBaile() { if (baile) pararBaile(); else empezarBaile(ultimoBaile); }
    function baileValido(id) { return typeof id === "string" && BAILES[id] ? id : ""; }
    const ETIQ_EQUIPO = { cabeza: "Cabeza", torso: "Torso", piernas: "Piernas", pies: "Pies", espalda: "Mochila" };
    const TIT_CONT = { espalda: "Mochila", torso: "Camisa (Bolsillo)", piernas: "Pantalón (Bolsillo)" };
    const ORDEN_CONT = ["espalda", "piernas", "torso"];
    const BARRA_N = 7;

    // Los objetos sueltos del mapa (MUNDO_INICIAL) los pone el generador de mapas según la semilla.

    const inv = {
        barra: new Array(BARRA_N).fill(null),
        equipo: {},      // cabeza, torso, piernas, pies, espalda -> id
        acc: {},         // accesorios gratis: adorno, ojos, cara -> id
        cont: {},        // espalda, torso, piernas -> lista de huecos
        mundo: [],
        sel: null,       // hueco seleccionado dentro del inventario
        barraSel: -1,    // hueco de la barra tocado una vez (el segundo toque lo usa)
        manoD: null,     // objeto en la mano derecha (se ve afuera del inventario, junto a la barra)
        manoI: null,     // objeto en la mano izquierda (se ve en el inventario)
        cargaMano: { D: null, I: null },   // lo que lleva adentro una mochila que tenés en la mano
        abierto: false
    };
    window.inventarioAbierto = false;
    let invAccAbierto = true;      // lista de accesorios desplegada

    // Objeto que tenés en la mano (o null)
    function itemMano() {
        const ids = [inv.manoD, inv.manoI];
        for (const id of ids) if (id && ITEMS[id] && ITEMS[id].mano) return id;
        return null;
    }
    function muletasEnMano() {
        const id = itemMano();
        return !!id && !!ITEMS[id].ayuda;
    }
    // Lleva un objeto a la mano (derecha si está libre, si no izquierda, si no cambia con la derecha)
    function enMano(r) {
        const id = getRef(r);
        if (!id) return;
        const d = { t: "h", k: !inv.manoD ? "D" : (!inv.manoI ? "I" : "D") };
        if (mover(r, d)) avisar("En la mano", 1000);
        inv.sel = null;
        inv.barraSel = -1;
        refrescarInventario();
    }

    // Mantener apretado (celular) o click derecho: tira el objeto
    function mantener(el, fn) {
        let t = null, hecho = false;
        el.addEventListener("pointerdown", function () {
            hecho = false;
            clearTimeout(t);
            t = setTimeout(function () { hecho = true; fn(); }, 600);
        });
        const fin = function () { clearTimeout(t); };
        el.addEventListener("pointerup", fin);
        el.addEventListener("pointerleave", fin);
        el.addEventListener("pointercancel", fin);
        el.addEventListener("click", function (e) {
            if (hecho) { hecho = false; e.stopImmediatePropagation(); e.preventDefault(); }
        }, true);
        el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    }

    function getRef(r) {
        if (r.t === "h") return inv["mano" + r.k] || null;
        if (r.t === "b") return inv.barra[r.i] || null;
        if (r.t === "e") return inv.equipo[r.k] || null;
        const c = inv.cont[r.k];
        return c ? (c[r.i] || null) : null;
    }
    function setRef(r, v) {
        if (r.t === "h") inv["mano" + r.k] = v || null;
        else if (r.t === "b") inv.barra[r.i] = v || null;
        else if (r.t === "e") { if (v) inv.equipo[r.k] = v; else delete inv.equipo[r.k]; }
        else if (inv.cont[r.k]) inv.cont[r.k][r.i] = v || null;
    }
    function mismoRef(a, b) { return !!a && !!b && a.t === b.t && a.k === b.k && a.i === b.i; }

    // Crea o quita los bolsillos según la ropa que tenés puesta
    function ajustarContenedores() {
        for (const k of ORDEN_CONT) {
            const id = inv.equipo[k];
            const cap = id && ITEMS[id].cap ? ITEMS[id].cap : 0;
            if (cap) {
                const viejo = inv.cont[k] || [];
                const nuevo = new Array(cap).fill(null);
                for (let i = 0; i < Math.min(cap, viejo.length); i++) nuevo[i] = viejo[i];
                inv.cont[k] = nuevo;
            } else {
                delete inv.cont[k];
            }
        }
    }
    function contenedorVacio(k) { return !inv.cont[k] || inv.cont[k].every(function (x) { return !x; }); }

    function puedeEn(ref, id) {
        if (ref.t === "e") return ITEMS[id].slot === ref.k;
        if (ref.t === "c" || ref.t === "b") return id !== "mochila";      // la mochila no se guarda: solo puesta o en una mano
        return true;
    }

    // Una mochila lleva sus cosas adentro estés donde estés: puesta, en una mano o tirada en el piso.
    // Estas dos funciones sacan y devuelven lo que tiene adentro cuando la mochila cambia de lugar.
    function sacarCarga(r) {
        let c = null;
        if (r.t === "e" && r.k === "espalda") c = inv.cont.espalda ? inv.cont.espalda.slice() : null;
        else if (r.t === "h") { c = inv.cargaMano[r.k]; inv.cargaMano[r.k] = null; }
        return c && c.some(function (x) { return !!x; }) ? c : null;
    }
    function ponerCarga(r, c) {
        if (!c) return;
        if (r.t === "e" && r.k === "espalda") {
            if (!inv.cont.espalda) return;
            for (let i = 0; i < inv.cont.espalda.length; i++) inv.cont.espalda[i] = c[i] || null;
        } else if (r.t === "h") {
            inv.cargaMano[r.k] = c;
        }
    }

    function mover(o, d) {
        if (mismoRef(o, d)) return false;
        const a = getRef(o), b = getRef(d);
        if (!a) return false;
        if (d.t === "c" && !inv.cont[d.k]) return false;
        if (!puedeEn(d, a)) { avisar("No va ahí", 1500); return false; }
        if (b && !puedeEn(o, b)) { avisar("No entra", 1500); return false; }
        if (o.t === "e" && o.k !== "espalda" && !contenedorVacio(o.k)) { avisar("Vaciá los bolsillos", 1500); return false; }
        if (d.t === "e" && d.k !== "espalda" && b && !contenedorVacio(d.k)) { avisar("Vaciá los bolsillos", 1500); return false; }
        if (o.t === "e" && d.t === "c" && d.k === o.k) return false;
        // la mochila se lleva lo que tiene adentro
        const cA = a === "mochila" ? sacarCarga(o) : null;
        const cB = b === "mochila" ? sacarCarga(d) : null;
        setRef(o, b);
        setRef(d, a);
        ajustarContenedores();
        if (a === "mochila") ponerCarga(d, cA);
        if (b === "mochila") ponerCarga(o, cB);
        return true;
    }

    function primerHueco(id, excluirCont) {
        if (id === "mochila") {
            if (!inv.manoD) return { t: "h", k: "D" };
            if (!inv.manoI) return { t: "h", k: "I" };
            return null;
        }
        for (let i = 0; i < BARRA_N; i++) if (!inv.barra[i]) return { t: "b", i: i };
        for (const k of ORDEN_CONT) {
            if (k === excluirCont || !inv.cont[k] || !puedeEn({ t: "c", k: k }, id)) continue;
            for (let i = 0; i < inv.cont[k].length; i++) if (!inv.cont[k][i]) return { t: "c", k: k, i: i };
        }
        return null;
    }
    function agregarItem(id, carga) {
        const h = primerHueco(id);
        if (!h) return false;
        setRef(h, id);
        if (id === "mochila") ponerCarga(h, carga || null);
        refrescarInventario();
        return true;
    }

    function usar(r) {
        const id = getRef(r);
        if (!id) return;
        const def = ITEMS[id];
        if (def.slot) {
            if (r.t === "e") {
                const h = primerHueco(id, r.k);
                if (!h) { avisar(id === "mochila" ? "Tenés las dos manos ocupadas: no podés sacarte la mochila" : "No tenés lugar para guardarlo", 2200); return; }
                mover(r, h);
            } else {
                mover(r, { t: "e", k: def.slot });
            }
        } else if (def.mano) {
            if (r.t === "h") {
                const h = primerHueco(id);
                if (!h) { avisar("Sin lugar", 1500); return; }
                mover(r, h);
                avisar("Guardado", 1000);
            } else {
                enMano(r);
                return;
            }
        } else if (def.llave) {
            avisar("Acercate a la puerta con candado " + def.color + " y tocá el botón de abrir", 3000);
        } else if (def.uso) {
            if (def.uso === "beber") { window.Supervivencia.beber(45); avisar("Tomaste agua"); }
            if (def.uso === "comer") { window.Supervivencia.comer(35); avisar("Comiste"); }
            if (def.uso === "curar") { sv.enf = []; window.Supervivencia.curar(10); avisar("Te sentís mejor"); }
            if (def.uso === "anabolico") { sv.anabolico = true; avisar("Te inyectaste el anabólico"); }
            if (def.uso === "vendar") {
                if (sv.sangrado <= 0) { avisar("No estás sangrando", 1500); return; }      // no se gasta
                sv.sangrado = 0;
                avisar("Te vendaste: dejaste de sangrar");
            }
            setRef(r, null);
        }
        inv.sel = null;
        inv.barraSel = -1;
        refrescarInventario();
    }

    function tirar(r) {
        const id = getRef(r);
        if (!id) return;
        if (r.t === "e" && r.k !== "espalda" && !contenedorVacio(r.k)) { avisar("Vaciá los bolsillos", 1500); return; }
        const carga = id === "mochila" ? sacarCarga(r) : null;     // la mochila se tira con todo lo que tiene adentro
        setRef(r, null);
        ajustarContenedores();
        avisar("Tirado", 1000);
        const x = px - Math.sin(yaw) * 0.9, z = pz - Math.cos(yaw) * 0.9;
        const suelto = { id: id, x: x, y: alturaSuelo(x, z, saltoY, 0.1), z: z };
        if (carga) suelto.c = carga;
        inv.mundo.push(suelto);
        if (conexion && miId !== null) {          // en un servidor, lo tirado lo ven todos
            suelto.k = "d" + miId + "_" + (++contSuelto);
            itemsRed.suel[suelto.k] = { id: id, x: x, y: suelto.y, z: z, c: carga || null };
            enviarRed({ tipo: "soltar", k: suelto.k, id: id, x: x, y: suelto.y, z: z, c: carga || null });
        }
        inv.sel = null;
        refrescarInventario();
    }

    // ----- Objetos compartidos en un servidor -----
    // Alguien tiró algo: aparece para todos
    function redItemPuesto(m) {
        if (!m || typeof m.k !== "string" || !ITEMS[m.id]) return;
        const c = Array.isArray(m.c) ? m.c.slice(0, 12).map(function (q) { return typeof q === "string" && ITEMS[q] ? q : null; }) : null;
        const it = { id: m.id, x: +m.x || 0, y: +m.y || 0, z: +m.z || 0, k: m.k };
        if (c) it.c = c;
        itemsRed.suel[m.k] = { id: it.id, x: it.x, y: it.y, z: it.z, c: c };
        if (!inv.mundo.some(function (o) { return o.k === m.k; })) inv.mundo.push(it);
    }
    // Alguien levantó algo: desaparece para todos
    function redItemSacado(k) {
        if (typeof k !== "string") return;
        if (k.charAt(0) === "i") itemsRed.ret[k] = 1; else delete itemsRed.suel[k];
        const i = inv.mundo.findIndex(function (o) { return o.k === k; });
        if (i >= 0) inv.mundo.splice(i, 1);
    }
    // Al entrar a un servidor: los objetos originales que quedan + los que tiraron
    function aplicarItemsServidor() {
        if (!conexion) return;
        inv.mundo = [];
        MUNDO_INICIAL.forEach(function (m, i) {
            if (!itemsRed.ret["i" + i]) inv.mundo.push(Object.assign({}, m, { k: "i" + i }));
        });
        for (const k in itemsRed.suel) {
            const sl = itemsRed.suel[k];
            if (!sl || !ITEMS[sl.id]) continue;
            const it = { id: sl.id, x: +sl.x || 0, y: +sl.y || 0, z: +sl.z || 0, k: k };
            if (Array.isArray(sl.c)) it.c = sl.c.map(function (q) { return typeof q === "string" && ITEMS[q] ? q : null; });
            inv.mundo.push(it);
        }
    }

    // Objeto del mapa que tenés al alcance (o null)
    function itemCercano() {
        let mejor = null, mejorD = 1.7;
        for (const it of inv.mundo) {
            const d = Math.hypot(it.x - px, it.z - pz);
            const dy = it.y - saltoY;
            if (d < mejorD && dy > -1.2 && dy < 1.7) { mejor = it; mejorD = d; }
        }
        for (const it of itemsLugar) {
            const d = Math.hypot(it.x - px, it.z - pz);
            const dy = it.y - saltoY;
            if (d < mejorD && dy > -1.2 && dy < 1.7) { mejor = it; mejorD = d; }
        }
        return mejor;
    }
    // Devuelve true si había un objeto cerca (aunque no hayas tenido lugar)
    function recogerCercano() {
        if (tiendaAbierta) return true;
        const it = itemCercano();
        if (!it) return false;
        const iL = itemsLugar.indexOf(it);
        if (iL >= 0) {                  // estante de un lugar seguro: se lleva sin avisarle a nadie
            if (agregarItem(it.id)) { itemsLugar.splice(iL, 1); avisar("Recogiste: " + ITEMS[it.id].n, 2000); }
            else avisar("No tenés lugar", 2000);
            return true;
        }
        if (agregarItem(it.id, it.c)) {
            if (conexion && it.k) { redItemSacado(it.k); enviarRed({ tipo: "recoger", k: it.k }); }
            else inv.mundo.splice(inv.mundo.indexOf(it), 1);
            avisar("Recogiste: " + ITEMS[it.id].n, 2000);
            alertarRobo();
        } else {
            avisar("No tenés lugar", 2000);
        }
        return true;
    }

    // ===== PUERTAS Y VENTANAS: abrir, cerrar, llaves, bloqueos, dibujo =====
    function tengoItem(id) {
        if (inv.manoD === id || inv.manoI === id || inv.barra.indexOf(id) >= 0) return true;
        for (const k of ORDEN_CONT) if (inv.cont[k] && inv.cont[k].indexOf(id) >= 0) return true;
        for (const k of ["D", "I"]) if (inv.cargaMano[k] && inv.cargaMano[k].indexOf(id) >= 0) return true;
        return false;
    }
    function mayuscula(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
    function estoyEnCasa(i) {
        const r = CASAS[i];
        return !!r && px > r[0] + 0.2 && px < r[2] - 0.2 && pz > r[1] + 0.2 && pz < r[3] - 0.2;
    }

    // La que tenés adelante y al alcance (o null)
    function aberturaCercana(filtro) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        let mejor = null, mejorD = 1e9;
        const lista = PUERTAS.concat(VENTANAS);
        for (const o of lista) {
            if (filtro && !filtro(o)) continue;
            const dx = o.centro[0] - px, dz = o.centro[1] - pz;
            const d = Math.hypot(dx, dz);
            if (d > (o.esPuerta ? 2.0 : 1.7) || d >= mejorD) continue;
            if (d > 0.6 && (dx * fx + dz * fz) / d < 0.35) continue;        // tiene que estar más o menos adelante
            if (!o.esPuerta && (saltoY > o.y2 || saltoY < o.y1 - 2.2)) continue;
            mejor = o; mejorD = d;
        }
        return mejor;
    }

    function textoAbertura(o, tactil) {
        let t;
        if (o.esPuerta && zona === "casa") {
            t = salidaAbierta() ? "salir de casa" : "puerta cerrada";
        } else if (o.esPuerta) {
            if (o.abierta) t = "cerrar puerta";
            else if (o.trabada) {
                const nom = COLORES_LLAVE[o.llave % COLORES_LLAVE.length].n;
                if (estoyEnCasa(o.casa)) t = "destrabar puerta";
                else if (tengoItem("llave" + o.llave)) t = "abrir con la llave " + nom;
                else t = "puerta con candado " + nom;
            } else t = "abrir puerta";
        } else {
            if (tareaVidrios && tareaVidrios.o === o) t = "sacando vidrios… " + Math.round(tareaVidrios.t / TIEMPO_VIDRIOS * 100) + "%";
            else if (o.rota) { if (o.abierta) return null; t = "sacar vidrios (3 s)"; }      // rota sin vidrios: no hay nada que hacer acá
            else if (o.bloqueada) t = "ventana bloqueada";
            else t = o.abierta ? "cerrar ventana" : "abrir ventana";
        }
        return tactil ? mayuscula(t) : "E: " + t;
    }

    // Ventanas por las que se puede pasar: abiertas o rotas
    function esPasable(o) { return !o.esPuerta && (o.rota || o.abierta); }

    // ¿Hay alguien parado donde cerraría la puerta / ventana? (vos u otro jugador)
    function ocupada(o) {
        const m = radio + 0.05;
        const r = o.rect;
        const dentro = function (x, z, y) {
            if (!(x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m)) return false;
            return o.esPuerta ? y < 2.2 : (y < o.y2 && y + 1.7 > o.y1);
        };
        if (dentro(px, pz, saltoY)) return true;
        for (const id in otros) {
            if (id === String(miId)) continue;
            if (mismaZona(otros[id]) && dentro(otros[id].x, otros[id].z, otros[id].y || 0)) return true;
        }
        return false;
    }
    // Si te cierran la puerta encima, te saca para el costado más cercano (para no quedar trabado adentro)
    function sacarmeDe(o) {
        const m = radio + 0.1, r = o.rect;
        if (!(px > r[0] - m && px < r[2] + m && pz > r[1] - m && pz < r[3] + m)) return;
        if ((r[2] - r[0]) < (r[3] - r[1])) px = (px - r[0] < r[2] - px) ? r[0] - m - 0.05 : r[2] + m + 0.05;
        else pz = (pz - r[1] < r[3] - pz) ? r[1] - m - 0.05 : r[3] + m + 0.05;
    }

    function enviarAbertura(o) {
        if (conexion && conexion.readyState === WebSocket.OPEN) {
            conexion.send(JSON.stringify({ tipo: "abertura", k: o.k, a: o.abierta ? 1 : 0, t: (o.esPuerta ? o.trabada : o.rota) ? 1 : 0 }));
        }
    }

    // Lo que pasa al apretar E / el botón. Devuelve true si había algo para abrir o cerrar.
    function usarAbertura() {
        if (inv.abierto || sv.durmiendo || !sv.vivo || window.juegoPausado) return false;
        if (pasoVentana) { cruzarVentana(pasoVentana.o); return true; }      // 2º toque mientras cruzás: más rápido
        if (tiendaAbierta) return true;
        const lugarAcc = accionLugar();
        if (lugarAcc) { lugarAcc.hacer(); return true; }
        const o = aberturaCercana();
        if (!o) return false;
        if (o.esPuerta && zona === "casa") { abrirDestinos(); return true; }       // la puerta de tu casa no se abre: es la salida
        if (o.esPuerta) {
            if (o.abierta) {
                if (ocupada(o)) { avisar("Hay alguien en la puerta", 1500); return true; }
                fijarAbertura(o, false, o.trabada);
                avisar("Cerraste la puerta", 1000);
            } else if (o.trabada) {
                const nom = COLORES_LLAVE[o.llave % COLORES_LLAVE.length].n;
                if (estoyEnCasa(o.casa)) {
                    fijarAbertura(o, true, false);
                    avisar("Destrabaste la puerta desde adentro", 1800);
                } else if (tengoItem("llave" + o.llave)) {
                    fijarAbertura(o, true, false);
                    avisar("Abriste la puerta con la llave " + nom, 2000);
                } else {
                    avisar("Está cerrada con llave. Buscá la llave " + nom, 2400);
                    return true;
                }
            } else {
                fijarAbertura(o, true, false);
                avisar("Abriste la puerta", 1000);
            }
        } else {
            if (o.rota) {                                        // rota: sacar los vidrios (o dejar de sacarlos)
                if (tareaVidrios) { tareaVidrios = null; avisar("Dejaste de sacar los vidrios", 1200); }
                else if (!o.abierta) tareaVidrios = { o: o, t: 0 };
                return true;
            }
            if (o.bloqueada) { avisar("La ventana está bloqueada: no se abre", 2000); return true; }
            if (o.abierta) {
                if (ocupada(o)) { avisar("No podés cerrarla con alguien en la ventana", 1800); return true; }
                fijarAbertura(o, false);
                avisar("Cerraste la ventana", 1000);
            } else {
                fijarAbertura(o, true);
                avisar("Abriste la ventana", 1000);
            }
        }
        ruidoPulso = Math.max(ruidoPulso, 6);
        enviarAbertura(o);
        return true;
    }

    // ===== VENTANAS: romper, sacar vidrios y pasar =====
    const TIEMPO_VIDRIOS = 3;        // segundos que lleva sacar los vidrios rotos
    let pasoVentana = null;          // cruce en curso: { o, t, dur, rapido, x0, z0, y0, w0, w1 }
    let tareaVidrios = null;         // sacando vidrios: { o, t }

    // Algo en la mano para romper el vidrio sin lastimarte (palo, cuchillo, hacha, muletas)
    function objetoParaRomper() {
        const val = function (id) { return id && ITEMS[id] && ITEMS[id].mano ? id : null; };
        return val(inv.manoD) || val(inv.manoI);
    }

    function romperVentana(o) {
        if (o.rota || o.abierta || o.bloqueada) return;
        const ob = objetoParaRomper();
        fijarAbertura(o, false, true);                 // rota, con los vidrios todavía en el marco
        ruidoPulso = Math.max(ruidoPulso, 30);         // se oye bastante lejos
        if (ob) {
            avisar("Rompiste la ventana con " + ITEMS[ob].n.toLowerCase() + ". Sacá los vidrios antes de pasar", 3500);
        } else {
            sv.sangrado = Math.max(sv.sangrado, 1);    // te cortás la mano
            avisar("Rompiste la ventana con la mano y te cortaste. Sacá los vidrios y vendate", 4500);
        }
        enviarAbertura(o);
    }

    // Botón redondo de pasar (R en la compu): cruza la ventana abierta o rota que tengas cerca
    function pasarPorVentana() {
        if (pasoVentana) { cruzarVentana(pasoVentana.o); return true; }      // 2º toque: más rápido
        if (inv.abierto || sv.durmiendo || !sv.vivo || window.juegoPausado) return false;
        const o = aberturaCercana(esPasable);
        if (!o) return false;
        cruzarVentana(o);
        return true;
    }

    // Golpear una ventana cerrada (la que tenés adelante): se rompe
    function ventanaApuntada(alcance) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        let mejor = null, mejorD = 1e9;
        for (const o of VENTANAS) {
            if (o.rota || o.abierta || o.bloqueada) continue;
            const dx = o.centro[0] - px, dz = o.centro[1] - pz;
            const d = Math.hypot(dx, dz);
            if (d > Math.max(1.7, alcance + 0.3) || d >= mejorD) continue;
            if (d > 0.6 && (dx * fx + dz * fz) / d < 0.7) continue;
            if (saltoY > o.y2 || saltoY < o.y1 - 2.2) continue;
            mejor = o; mejorD = d;
        }
        return mejor;
    }

    // Pasar al otro lado. Un segundo toque mientras cruzás lo hace más rápido, pero hace más ruido.
    function cruzarVentana(o) {
        if (pasoVentana) {
            if (!pasoVentana.rapido) {
                const p = pasoVentana.t / pasoVentana.dur;
                pasoVentana.rapido = true;
                pasoVentana.dur = 0.5;
                pasoVentana.t = p * 0.5;
                ruidoPulso = Math.max(ruidoPulso, 18);
            }
            return;
        }
        tareaVidrios = null;
        if (inv.abierto || sv.durmiendo || !sv.vivo) return;
        const rx = px - o.centro[0], rz = pz - o.centro[1];
        const lado = (rx * o.dentro[0] + rz * o.dentro[1]) >= 0 ? 1 : -1;       // 1 = estás del lado de adentro
        const lat = clamp(rx * o.u[0] + rz * o.u[1], -(o.ancho / 2 - 0.35), o.ancho / 2 - 0.35);
        const bx = o.centro[0] + o.u[0] * lat, bz = o.centro[1] + o.u[1] * lat;
        const w0 = [bx + o.dentro[0] * lado * 0.55, bz + o.dentro[1] * lado * 0.55];     // frente a la ventana
        const w1 = [bx - o.dentro[0] * lado * 0.75, bz - o.dentro[1] * lado * 0.75];     // del otro lado
        if (choca(w1[0], w1[1], saltoY)) { avisar("No hay lugar del otro lado", 1800); return; }
        pasoVentana = { o: o, t: 0, dur: 1.4, rapido: false, x0: px, z0: pz, y0: saltoY, w0: w0, w1: w1 };
        ruidoPulso = Math.max(ruidoPulso, 7);
        if (o.rota && !o.abierta) {                    // pasás por arriba de los vidrios
            sv.sangrado = Math.min(3, sv.sangrado + 1);
            avisar("Te cortaste con los vidrios rotos: sangrás más", 3000);
        }
    }

    // Se llama en cada cuadro: mientras cruzás, la ventana manda sobre tu posición
    function actualizarCruce(dt) {
        const c = pasoVentana;
        if (!c) return;
        if (!sv.vivo) { pasoVentana = null; return; }
        c.t += dt;
        const p = Math.min(1, c.t / c.dur), A = 0.3;
        let x, z, arco = 0;
        if (p < A) {
            const q = p / A;
            x = c.x0 + (c.w0[0] - c.x0) * q; z = c.z0 + (c.w0[1] - c.z0) * q;
        } else {
            const q = (p - A) / (1 - A);
            x = c.w0[0] + (c.w1[0] - c.w0[0]) * q; z = c.w0[1] + (c.w1[1] - c.w0[1]) * q;
            arco = Math.sin(Math.PI * q) * 0.25;
        }
        px = x; pz = z; saltoY = c.y0 + arco; velY = 0;
        if (p >= 1) { pasoVentana = null; saltoY = c.y0; }
    }

    // Sacar los vidrios: 3 segundos quieto. Si te movés o te alejás se cancela.
    function actualizarVidrios(dt, seMueve) {
        const T = tareaVidrios;
        if (!T) return;
        const o = T.o;
        const lejos = Math.hypot(o.centro[0] - px, o.centro[1] - pz) > 2.0;
        if (!sv.vivo || sv.durmiendo || inv.abierto || seMueve || lejos) {
            tareaVidrios = null;
            if (sv.vivo && (seMueve || lejos)) avisar("Dejaste de sacar los vidrios", 1200);
            return;
        }
        T.t += dt;
        ruidoPulso = Math.max(ruidoPulso, 4);
        if (T.t >= TIEMPO_VIDRIOS) {
            tareaVidrios = null;
            fijarAbertura(o, true, true);              // rota y sin vidrios: se pasa sin cortarse
            avisar("Sacaste los vidrios: ya podés pasar sin cortarte", 2500);
            enviarAbertura(o);
        }
    }

    // Estados: para guardar la partida, para el servidor y para reiniciar
    function estadoAberturas() {
        const e = {};
        todasAberturas().forEach(function (o) { e[o.k] = [o.abierta ? 1 : 0, (o.esPuerta ? o.trabada : o.rota) ? 1 : 0]; });
        return e;
    }
    function aplicarEstados(e, instantaneo, remoto) {
        if (!e || typeof e !== "object") return;
        todasAberturas().forEach(function (o) {
            const v = e[o.k];
            if (!Array.isArray(v)) return;
            if (!o.esPuerta && o.bloqueada) return;                 // una ventana bloqueada nunca se abre
            const abre = !!+v[0];
            if (!abre && remoto) sacarmeDe(o);
            fijarAbertura(o, abre, !!+v[1]);
            if (instantaneo) o.ang = abre ? 1 : 0;
        });
    }
    function reiniciarAberturas() {
        todasAberturas().forEach(function (o) {
            fijarAbertura(o, o.ini.a, o.ini.t);
            o.ang = o.ini.a ? 1 : 0;
        });
    }
    function actualizarAberturas(dt) {
        const paso = dt * 3.2;       // abrir o cerrar tarda un tercio de segundo
        PUERTAS.concat(VENTANAS).forEach(function (o) {
            const meta = o.abierta ? 1 : 0;
            if (o.ang < meta) o.ang = Math.min(meta, o.ang + paso);
            else if (o.ang > meta) o.ang = Math.max(meta, o.ang - paso);
        });
    }

    // Caja que sale de un punto (hx, hz) en la dirección (ux, uz): s0..s1 a lo largo, de grosor "grosor", entre y1 e y2
    function cajaOrientada(lista, hx, hz, ux, uz, s0, s1, grosor, y1, y2, col) {
        const vx = -uz, vz = ux, g = grosor / 2;
        const P = [];
        for (let i = 0; i < 8; i++) {
            const a = (i & 1) ? s1 : s0, y = ((i >> 1) & 1) ? y2 : y1, q = ((i >> 2) & 1) ? g : -g;
            P.push([hx + ux * a + vx * q, y, hz + uz * a + vz * q]);
        }
        cuboATriangulos(lista, P, col);
    }

    const COLOR_HOJA = [0.38, 0.25, 0.15], COLOR_METAL = [0.72, 0.68, 0.40];
    const COLOR_VIDRIO = [0.62, 0.80, 0.90];
    const COLOR_VIDRIO_ROTO = [0.85, 0.93, 0.97];
    const bufferAberturas = gl.createBuffer();
    const bufferVidrios = gl.createBuffer();
    let vidriosListos = [];

    function dibujarAberturas() {
        const lista = [], vidrios = [];
        for (const o of PUERTAS) {
            if (Math.hypot(o.bis[0] - px, o.bis[1] - pz) > 40) continue;
            const th = o.ang * Math.PI / 2 * 0.97;
            const ux = o.dirC[0] * Math.cos(th) + o.dirA[0] * Math.sin(th);
            const uz = o.dirC[1] * Math.cos(th) + o.dirA[1] * Math.sin(th);
            cajaOrientada(lista, o.bis[0], o.bis[1], ux, uz, 0.02, o.largo, 0.07, 0.02, 2.17, COLOR_HOJA);
            cajaOrientada(lista, o.bis[0], o.bis[1], ux, uz, 0.12, o.largo - 0.12, 0.085, 0.12, 0.2, [0.33, 0.21, 0.12]);   // zócalo
            cajaOrientada(lista, o.bis[0], o.bis[1], ux, uz, o.largo - 0.22, o.largo - 0.1, 0.13, 0.95, 1.05, COLOR_METAL);  // picaporte
            if (o.trabada && o.ang < 0.05) {
                // candado del color de su llave
                cajaOrientada(lista, o.bis[0], o.bis[1], ux, uz, o.largo - 0.4, o.largo - 0.24, 0.12, 1.15, 1.4, COLORES_LLAVE[o.llave % COLORES_LLAVE.length].c);
            }
        }
        for (const o of VENTANAS) {
            if (Math.hypot(o.centro[0] - px, o.centro[1] - pz) > 40) continue;
            const th = o.rota ? 0 : o.ang * 1.45;       // rota: las hojas quedan cerradas, sin vidrio
            const c = Math.cos(th), sn = Math.sin(th);
            const L = o.ancho / 2 - 0.01;
            const alto = o.y2 - o.y1;
            for (let h = 0; h < 2; h++) {
                const sg = h === 0 ? 1 : -1;                 // hoja izquierda va hacia +u, hoja derecha hacia -u
                const hp = h === 0 ? o.a0 : o.a1;
                const ux = sg * o.u[0] * c + o.dentro[0] * sn, uz = sg * o.u[1] * c + o.dentro[1] * sn;
                cajaOrientada(lista, hp[0], hp[1], ux, uz, 0.01, L, 0.05, o.y1 + 0.01, o.y1 + 0.07, MADERA);
                cajaOrientada(lista, hp[0], hp[1], ux, uz, 0.01, L, 0.05, o.y2 - 0.07, o.y2 - 0.01, MADERA);
                cajaOrientada(lista, hp[0], hp[1], ux, uz, 0.01, 0.07, 0.05, o.y1 + 0.01, o.y2 - 0.01, MADERA);
                cajaOrientada(lista, hp[0], hp[1], ux, uz, L - 0.06, L, 0.05, o.y1 + 0.01, o.y2 - 0.01, MADERA);
                cajaOrientada(lista, hp[0], hp[1], ux, uz, 0.01, L, 0.03, o.y1 + alto / 2 - 0.02, o.y1 + alto / 2 + 0.02, MADERA);
                if (!o.bloqueada) cajaOrientada(lista, hp[0], hp[1], ux, uz, L - 0.22, L - 0.08, 0.09, o.y1 + alto / 2 - 0.2, o.y1 + alto / 2 - 0.12, COLOR_METAL);   // manija
                if (!o.rota) cajaOrientada(vidrios, hp[0], hp[1], ux, uz, 0.01, L, 0.02, o.y1 + 0.07, o.y2 - 0.07, COLOR_VIDRIO);
            }
            if (o.rota && !o.abierta) {
                // vidrios rotos que quedan clavados en el marco (puntas hacia arriba abajo y hacia abajo arriba)
                for (let i = 0; i < 9; i++) {
                    const s0 = Math.max(0.02, (i + 0.5) / 9 * o.ancho - 0.05), s1 = Math.min(o.ancho - 0.02, s0 + 0.09);
                    const h1 = 0.06 + ((i * 37 + 11) % 7) / 7 * 0.16, h2 = 0.05 + ((i * 53 + 5) % 6) / 6 * 0.14;
                    cajaOrientada(lista, o.a0[0], o.a0[1], o.u[0], o.u[1], s0, s1, 0.02, o.y1 + 0.07, o.y1 + 0.07 + h1, COLOR_VIDRIO_ROTO);
                    cajaOrientada(lista, o.a0[0], o.a0[1], o.u[0], o.u[1], s0, s1, 0.02, o.y2 - 0.07 - h2, o.y2 - 0.07, COLOR_VIDRIO_ROTO);
                }
            }
            if (o.bloqueada) {
                // tablones clavados por adentro: se ve que no se puede abrir
                const bx = o.a0[0] - o.u[0] * 0.12 + o.dentro[0] * 0.19, bz = o.a0[1] - o.u[1] * 0.12 + o.dentro[1] * 0.19;
                [0.1, 0.5, 0.9].forEach(function (f, i) {
                    cajaOrientada(lista, bx, bz, o.u[0], o.u[1], 0, o.ancho + 0.24, 0.05, o.y1 + f * (alto - 0.2) , o.y1 + f * (alto - 0.2) + 0.18, i === 1 ? [0.40, 0.27, 0.16] : [0.34, 0.22, 0.13]);
                });
            }
        }
        vidriosListos = vidrios;
        if (lista.length === 0) return;
        configurarAtributos(bufferAberturas);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lista), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, lista.length / 6);
    }

    // Los vidrios van al final y translúcidos (se ve a través de ellos)
    function dibujarVidrios() {
        if (vidriosListos.length === 0) return;
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);   // no toca el alfa de la pantalla
        gl.depthMask(false);
        gl.uniform1f(uAlfa, 0.3);
        configurarAtributos(bufferVidrios);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vidriosListos), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, vidriosListos.length / 6);
        gl.uniform1f(uAlfa, 1);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }

    // ----- Pantalla -----
    const filaBarra = document.getElementById("hbSlots");
    for (let i = 0; i < BARRA_N; i++) {
        const s = document.createElement("div");
        s.className = "hbSlot";
        mantener(s, function () {
            if (!inv.barra[i]) return;
            tirar({ t: "b", i: i });
        });
        s.addEventListener("click", function () { tocarBarra(i); });
        filaBarra.appendChild(s);
    }
    const hbMano = document.createElement("div");
    hbMano.className = "hbMano";
    hbMano.title = "Mano derecha (mantené para tirar)";
    filaBarra.parentNode.insertBefore(hbMano, document.getElementById("hbMas"));
    mantener(hbMano, function () {
        if (inv.abierto || !inv.manoD) return;
        tirar({ t: "h", k: "D" });
    });
    hbMano.addEventListener("click", function () {
        const ref = { t: "h", k: "D" };
        if (inv.abierto) { clickHueco(ref); return; }
        if (!inv.manoD) { avisar("Mano derecha vacía", 1200); return; }
        usar(ref);
    });
    document.getElementById("hbMas").addEventListener("click", function () {
        if (inv.abierto) cerrarInventario(); else abrirInventario();
    });

    function pintarBarra() {
        const slots = filaBarra.children;
        for (let i = 0; i < BARRA_N; i++) {
            const id = inv.barra[i];
            slots[i].innerHTML = (id ? ITEMS[id].e : "") + '<span class="hbN">' + (i + 1) + "</span>";
            slots[i].classList.toggle("sel", inv.barraSel === i || (inv.sel && inv.sel.t === "b" && inv.sel.i === i));
        }
        document.getElementById("hbMas").classList.toggle("on", inv.abierto);
        hbMano.innerHTML = (inv.manoD ? ITEMS[inv.manoD].e : '<span class="hbVac">✋</span>') + '<span class="hbN">Der.</span>';
        hbMano.classList.toggle("mano", !!inv.manoD);
        hbMano.classList.toggle("sel", !!inv.sel && inv.sel.t === "h" && inv.sel.k === "D");
    }

    function tocarBarra(i, porTecla) {
        if (inv.abierto && !porTecla) { clickHueco({ t: "b", i: i }); return; }
        const id = inv.barra[i];
        if (!id) { inv.barraSel = -1; pintarBarra(); return; }
        if (ITEMS[id].mano) { enMano({ t: "b", i: i }); return; }
        if (inv.barraSel === i) { usar({ t: "b", i: i }); return; }
        inv.barraSel = i;
        avisar(ITEMS[id].n, 1200);
        pintarBarra();
    }

    function clickHueco(ref) {
        if (!inv.sel) {
            if (getRef(ref)) inv.sel = ref;
        } else if (mismoRef(inv.sel, ref)) {
            inv.sel = null;
        } else {
            mover(inv.sel, ref);
            inv.sel = null;
        }
        refrescarInventario();
    }

    function huecoDom(ref, clases) {
        const id = getRef(ref);
        const d = document.createElement("div");
        d.className = "iSlot " + (clases || "");
        if (id) d.textContent = ITEMS[id].e;
        else if (ref.t === "e" || ref.t === "h") {
            const et = document.createElement("span");
            et.className = "iEt";
            et.textContent = ref.t === "h" ? "Mano izq." : ETIQ_EQUIPO[ref.k];
            d.appendChild(et);
        }
        mantener(d, function () { if (getRef(ref)) tirar(ref); });
        if (inv.sel && mismoRef(inv.sel, ref)) d.classList.add("sel");
        d.addEventListener("click", function () { clickHueco(ref); });
        return d;
    }

    // ----- Vista previa del personaje (cubos en un canvas 2D; se gira arrastrando) -----
    const vista = { canvas: document.createElement("canvas"), giro: 0.5, inc: 0.2, cuerpo: 0, base: 0, postPrev: 0, arrastrando: false, ultimoX: 0, ultimoY: 0, ultimoToque: 0 };
    vista.canvas.addEventListener("pointerdown", function (e) {
        vista.arrastrando = true;
        vista.ultimoX = e.clientX;
        vista.ultimoY = e.clientY;
        vista.ultimoToque = performance.now();
        try { vista.canvas.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
    });
    vista.canvas.addEventListener("pointermove", function (e) {
        if (!vista.arrastrando) return;
        vista.giro += (e.clientX - vista.ultimoX) * 0.012;
        vista.inc = Math.max(-1.35, Math.min(1.35, vista.inc + (e.clientY - vista.ultimoY) * 0.01));   // arrastrar arriba/abajo: ver desde abajo/arriba
        vista.ultimoX = e.clientX;
        vista.ultimoY = e.clientY;
        vista.ultimoToque = performance.now();
    });
    function soltarVista() { vista.arrastrando = false; vista.ultimoToque = performance.now(); }
    vista.canvas.addEventListener("pointerup", soltarVista);
    vista.canvas.addEventListener("pointercancel", soltarVista);
    vista.canvas.addEventListener("lostpointercapture", soltarVista);

    function angDif(a, b) {
        let d = (a - b) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return d;
    }
    // El cuerpo de la vista previa sigue hacia dónde mirás: la cabeza gira hasta cierto límite y después arrastra al cuerpo
    function actualizarPoseVista(dt) {
        const LIM = 0.9;
        let d = angDif(yaw, vista.cuerpo);
        if (Math.abs(d) > LIM) { vista.cuerpo += d - Math.sign(d) * LIM; d = angDif(yaw, vista.cuerpo); }
        vista.cuerpo += d * Math.min(1, dt * (animMov > 0.1 ? 8 : 1.5));
        if (vista.postPrev !== postura) {                       // al acostarte se ve de costado; al pararte vuelve la vista normal
            vista.giro = postura === 2 ? 1.35 : 0.5;
            vista.postPrev = postura;
        }
    }

    // Mismo personaje que se ve en el juego: un rectángulo de color con una cajita blanca en la cara
    const COLORES_JUGADOR = [
        [1.0, 0.55, 0.0], [0.3, 0.6, 1.0], [0.4, 0.9, 0.4],
        [0.95, 0.4, 0.7], [0.95, 0.9, 0.3], [0.6, 0.4, 0.95]
    ];
    const VISTA_CARA = [0.9, 0.9, 1.0];
    function oscurecer(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

    function mezclar(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

    // Arma el mismo rectángulo del juego en franjas; cada prenda puesta pinta (y agranda un poco) su franja.
    // Con las piernas lastimadas se ven: esguince = vendaje, fractura = trizada y la pierna medio salida.
    // Estado de tu personaje (el de la vista previa). Los demás jugadores arman uno igual con lo que mandan.
    function estadoPropio() {
        const mio = (typeof otros !== "undefined" && miId !== null && otros[miId]) ? otros[miId] : null;
        return {
            base: hexARgb(A.colorPersonaje) || COLORES_JUGADOR[((mio && mio.c) || 0) % COLORES_JUGADOR.length],
            eq: inv.equipo,
            acc: inv.acc,
            baile: baile ? baile.id : "",
            baileT: baile ? performance.now() / 1000 - baile.t0 : 0,
            manoD: inv.manoD,
            manoI: inv.manoI,
            pl: [sv.piernas[0].n, sv.piernas[1].n],
            postura: postura,
            pelea: modoPelea,
            fase: animFase,
            mov: animMov,
            corre: animCorre,
            golpeT: golpeT,
            pitch: pitch,
            giroCuerpo: vista.cuerpo - vista.base,
            giroCab: angDif(yaw, vista.cuerpo)
        };
    }

    function cajasPersonaje(e) {
        e = e || estadoPropio();
        const base = e.base;
        const eq = e.eq;
        const camisa = eq.torso ? COLOR_ITEM[eq.torso] : null;
        const pantalon = eq.piernas ? COLOR_ITEM[eq.piernas] : null;
        const botas = eq.pies ? COLOR_ITEM[eq.pies] : null;
        const gorra = eq.cabeza ? COLOR_ITEM[eq.cabeza] : null;
        const mochila = eq.espalda ? COLOR_ITEM[eq.espalda] : null;
        const L = [];
        // add(centroX, yAbajo, yArriba, centroZ, anchoX, largoZ, color, grietas)
        const add = function (x, y1, y2, z, ancho, largo, c, grieta, sesgo) {
            const caja = { x: x, y1: y1, y2: y2, z: z, a: ancho / 2, l: largo / 2, c: c, g: grieta || 0, s: sesgo || 0 };
            L.push(caja);
            return caja;
        };
        const colPierna = pantalon || base;
        const colPie = botas || pantalon || base;
        const ap = pantalon ? 0.64 : 0.6, lp = pantalon ? 0.44 : 0.4;       // ancho y largo de las piernas
        const apie = botas ? 0.66 : ap, lpie = botas ? 0.46 : lp;
        const pl = e.pl;
        const rojo = [0.8, 0.15, 0.15];
        for (const i of [0, 1]) {
            const lado = i === 0 ? 1 : -1;                               // la pierna izquierda se ve a la derecha, de frente
            const x = lado * ap / 4;
            const n = pl[i];
            const cp = n === 2 ? mezclar(colPierna, rojo, 0.3) : colPierna;
            const cpie = n === 2 ? mezclar(colPie, rojo, 0.3) : colPie;
            const pierna = function (b) { b.pi = i; return b; };         // para balancearla al caminar
            if (n === 2) {
                // fractura: la parte de abajo se salió un poco hacia afuera y adelante (la pierna se ve doblada)
                pierna(add(x, 0.42, 0.7, 0, ap / 2, lp, cp));
                pierna(add(x + lado * 0.07, 0.18, 0.42, 0.07, ap / 2, lp, cp));
                pierna(add(x + lado * 0.07, 0, 0.18, 0.07, apie / 2, lpie, cpie));
            } else {
                pierna(add(x, 0, 0.18, 0, apie / 2, lpie, cpie));
                pierna(add(x, 0.18, 0.7, 0, ap / 2, lp, cp));
                if (n === 1) pierna(add(x, 0.08, 0.34, 0, ap / 2 + 0.04, lp + 0.04, [0.93, 0.9, 0.8], 0, 0.12));   // vendaje (se dibuja por encima de la pierna)
            }
        }
        const torso = add(0, 0.7, 1.35, 0, camisa ? 0.64 : 0.6, camisa ? 0.44 : 0.4, camisa || base);   // torso
        const cabeza = [];
        cabeza.push(add(0, 1.35, 1.6, 0, 0.6, 0.4, base));                                         // cabeza
        if (gorra) {
            cabeza.push(add(0, 1.6, 1.74, 0, 0.64, 0.44, gorra));
            cabeza.push(add(0, 1.6, 1.64, 0.34, 0.4, 0.24, oscurecer(gorra, 0.8)));                // visera
        } else {
            cabeza.push(add(0, 1.6, 1.7, 0, 0.6, 0.4, base));
        }
        cabeza.push(add(0, 1.35, 1.6, 0.3, 0.4, 0.3, VISTA_CARA));                                 // lo blanco (cara)
        // Accesorios gratis (se pegan a la cabeza: giran y se inclinan con ella)
        const acc = e.acc || {};
        const yTope = gorra ? 1.74 : 1.7;                                    // arriba de la cabeza (con gorra, arriba de la gorra)
        const ac = function (x, y1, y2, z, ancho, largo, c) { const b = add(x, y1, y2, z, ancho, largo, c); cabeza.push(b); return b; };
        const ZC = 0.455;                                                    // justo delante de la cara
        const flor = function (x, z, k, petalo, centro) {
            ac(x, yTope, yTope + 0.05 * k, z, 0.24 * k, 0.08 * k, petalo);
            ac(x, yTope, yTope + 0.05 * k, z, 0.08 * k, 0.24 * k, petalo);
            ac(x, yTope, yTope + 0.09 * k, z, 0.09 * k, 0.09 * k, centro);
        };
        const AMARILLO = [0.98, 0.85, 0.2], ROSA = [0.98, 0.5, 0.7];
        if (acc.adorno === "flor_roja") flor(0.18, 0.04, 1, [0.85, 0.1, 0.15], AMARILLO);
        else if (acc.adorno === "flor_rosa") flor(0.18, 0.04, 1, ROSA, AMARILLO);
        else if (acc.adorno === "flor_amarilla") flor(0.18, 0.04, 1, AMARILLO, [0.6, 0.35, 0.1]);
        else if (acc.adorno === "flor_azul") flor(0.18, 0.04, 1, [0.35, 0.5, 0.98], [0.98, 0.98, 0.9]);
        else if (acc.adorno === "ramillete") {
            flor(0.2, 0.06, 0.8, [0.85, 0.1, 0.15], AMARILLO);
            flor(-0.04, -0.08, 0.8, [0.98, 0.98, 0.95], AMARILLO);
            flor(-0.22, 0.05, 0.8, [0.6, 0.4, 0.95], AMARILLO);
        } else if (acc.adorno === "corona_flores") {
            const pts = [[-0.3, 0.2], [0, 0.22], [0.3, 0.2], [0.32, 0], [0.3, -0.2], [0, -0.22], [-0.3, -0.2], [-0.32, 0]];
            const cols = [ROSA, [0.98, 0.98, 0.95], AMARILLO, [0.6, 0.4, 0.95]];
            pts.forEach(function (p, i) { ac(p[0], yTope - 0.03, yTope + 0.07, p[1], 0.11, 0.11, cols[i % cols.length]); });
        } else if (acc.adorno === "mono") {
            const col = [0.95, 0.3, 0.5];
            ac(0.07, yTope, yTope + 0.1, 0.1, 0.14, 0.1, col);
            ac(0.29, yTope, yTope + 0.1, 0.1, 0.14, 0.1, col);
            ac(0.18, yTope, yTope + 0.12, 0.1, 0.08, 0.1, oscurecer(col, 0.7));
        } else if (acc.adorno === "orejas_gato") {
            for (const sg of [-1, 1]) {
                ac(sg * 0.2, yTope, yTope + 0.16, -0.02, 0.15, 0.12, oscurecer(base, 0.85));
                ac(sg * 0.2, yTope + 0.16, yTope + 0.22, -0.02, 0.08, 0.08, oscurecer(base, 0.85));
                ac(sg * 0.2, yTope, yTope + 0.12, 0.05, 0.07, 0.02, ROSA);
            }
        } else if (acc.adorno === "corona") {
            const oro = [0.95, 0.78, 0.2];
            ac(0, yTope, yTope + 0.06, 0, 0.66, 0.46, oro);
            for (const p of [[-0.27, 0.18], [0, 0.19], [0.27, 0.18], [-0.27, -0.18], [0, -0.19], [0.27, -0.18]]) ac(p[0], yTope + 0.06, yTope + 0.17, p[1], 0.09, 0.09, oro);
            ac(0, yTope + 0.01, yTope + 0.05, 0.235, 0.07, 0.02, [0.85, 0.1, 0.2]);
        }
        const gafas = function (lente, marco) {
            for (const sg of [-1, 1]) {
                ac(sg * 0.1, 1.42, 1.55, ZC, 0.15, 0.02, marco);
                ac(sg * 0.1, 1.44, 1.53, ZC + 0.012, 0.11, 0.02, lente);
                ac(sg * 0.215, 1.49, 1.52, 0.31, 0.03, 0.3, marco);
            }
            ac(0, 1.49, 1.51, ZC, 0.06, 0.02, marco);
        };
        if (acc.ojos === "pestanas") {
            for (const sg of [-1, 1]) {
                ac(sg * 0.1, 1.45, 1.51, ZC, 0.07, 0.02, [0.08, 0.08, 0.12]);                 // ojo
                ac(sg * 0.1, 1.51, 1.54, ZC, 0.11, 0.02, [0.05, 0.05, 0.08]);                 // línea de pestañas
                ac(sg * 0.17, 1.51, 1.58, ZC, 0.03, 0.02, [0.05, 0.05, 0.08]);                // pestaña que sale hacia afuera
                ac(sg * 0.125, 1.54, 1.575, ZC, 0.025, 0.02, [0.05, 0.05, 0.08]);             // pestaña de arriba
            }
        } else if (acc.ojos === "anteojos") gafas([0.75, 0.9, 1.0], [0.12, 0.12, 0.15]);
        else if (acc.ojos === "anteojos_sol") gafas([0.04, 0.04, 0.06], [0.04, 0.04, 0.06]);
        if (acc.cara === "rubor") {
            for (const sg of [-1, 1]) ac(sg * 0.13, 1.38, 1.43, ZC, 0.09, 0.02, [0.98, 0.5, 0.6]);
        } else if (acc.cara === "pecas") {
            for (const sg of [-1, 1]) for (const p of [[0.09, 1.4], [0.14, 1.42], [0.15, 1.38], [0.11, 1.37]]) ac(sg * p[0], p[1], p[1] + 0.025, ZC, 0.025, 0.02, [0.6, 0.38, 0.25]);
        } else if (acc.cara === "bigote") {
            const c = [0.2, 0.1, 0.05];
            ac(0, 1.395, 1.435, ZC, 0.24, 0.02, c);
            for (const sg of [-1, 1]) ac(sg * 0.11, 1.37, 1.395, ZC, 0.04, 0.02, c);
        }
        if (mochila) {
            add(0, 0.75, 1.4, -0.34, 0.44, 0.24, mochila);
            add(0, 0.85, 1.05, -0.47, 0.3, 0.04, oscurecer(mochila, 1.3));                         // bolsillo
        }
        // brazos: dos barras largas a los costados del torso (un poco más largas y anchas)
        const colBrazo = camisa || base;
        const bd = e.baile && BAILES[e.baile] && e.postura === 0 ? BAILES[e.baile].f(e.baileT || 0) : null;
        const brazos = { "-1": add(-0.4, 0.62, 1.33, 0, 0.16, 0.22, colBrazo), "1": add(0.4, 0.62, 1.33, 0, 0.16, 0.22, colBrazo) };
        // lo que tenés en las manos: la derecha se ve a la izquierda de frente, la izquierda a la derecha
        if (e.manoD === "muletas" || e.manoI === "muletas") {
            for (const sg of [-1, 1]) {
                add(sg * 0.47, 0.05, 1.15, 0.12, 0.06, 0.06, COLOR_ITEM.muletas).fijo = true;
                add(sg * 0.47, 1.08, 1.15, 0.12, 0.16, 0.1, [0.45, 0.35, 0.25]).fijo = true;
            }
        }
        // Animación en vivo: lo que hacés en el juego se ve acá (caminar, correr, arrastrarte, pegar, mirar)
        const balanceo = Math.sin(e.fase) * e.mov;
        const golpeando = e.golpeT < 0.3 ? Math.sin(e.golpeT / 0.3 * Math.PI) : 0;
        const esDeMano = function (id) { return !!id && !!ITEMS[id] && !!ITEMS[id].mano; };
        const conObjeto = esDeMano(e.manoD) || esDeMano(e.manoI);
        const manoGolpea = conObjeto ? (esDeMano(e.manoD) ? "D" : "I") : "D";
        [[e.manoD, -1], [e.manoI, 1]].forEach(function (par) {
            const id = par[0], sd = par[1], x = sd * 0.4;
            const k = sd === -1 ? "D" : "I";
            const grupo = [brazos[String(sd)]];
            let ang = 0;
            if (id && id !== "muletas") {
                grupo.push(add(x, 0.58, 0.7, 0.1, 0.12, 0.12, colBrazo));                          // la mano
                if (MODELOS_MANO[id]) {
                    for (const p of MODELOS_MANO[id]) grupo.push(add(x, 0.68 + p.a, 0.68 + p.a + p.b, 0.1, p.w, p.h, p.c));
                } else {
                    const t = id === "mochila" ? 0.26 : 0.14;
                    grupo.push(add(x, 0.64, 0.64 + t, 0.1, t, t, COLOR_ITEM[id] || [0.6, 0.6, 0.6]));
                }
                ang = -0.6;                                    // con algo en la mano el brazo se estira hacia adelante (gira desde el hombro)
            }
            if (e.pelea) ang = Math.min(ang, -0.9);          // puños arriba
            if (k === manoGolpea && golpeando > 0) ang -= 1.1 * golpeando;      // el golpe
            const libre = !(id && id !== "muletas") && !e.pelea;
            const amp = e.postura === 2 ? 0.7 : (libre ? (e.corre ? 0.9 : 0.55) : 0.1);
            if (e.postura === 2) ang = -2.2;                      // arrastrándote: los brazos van estirados hacia adelante, por el piso
            ang += (sd === 1 ? -1 : 1) * amp * balanceo;       // los brazos se balancean al revés que las piernas (arrastrándote: se estiran y se encogen)
            if (bd) ang = sd === 1 ? bd.ai : bd.ad;
            if (ang !== 0) grupo.forEach(function (b) { b.r = [[ang, 1.28, 0]]; });
        });
        // Piernas: se balancean al caminar (la lastimada, menos)
        const ampP = e.postura === 2 ? 0.5 : e.postura === 1 ? 0.35 : (e.corre ? 0.95 : 0.6);
        L.forEach(function (b) {
            if (b.pi === undefined) return;
            const flojo = pl[b.pi] > 0 ? 0.4 : 1;
            let a = (b.pi === 0 ? 1 : -1) * ampP * flojo * balanceo;
            if (bd) a = bd.p[b.pi] * flojo;
            if (a !== 0) b.r = [[a, 0.7, 0]];
        });
        // Cabeza: sube y baja con hacia dónde mirás, y gira a los costados (el cuerpo la sigue de a poco)
        const cabeceo = Math.max(-0.95, Math.min(0.95, -e.pitch * 0.65)) + (e.postura === 2 ? -1.35 : 0) + (bd && bd.cab ? bd.cab : 0);   // arrastrándote la cabeza se levanta para mirar al frente
        const giroCab = Math.max(-0.9, Math.min(0.9, e.giroCab));
        cabeza.forEach(function (b) { b.cab = true; b.r = [[cabeceo, 1.35, 0]]; });
        // posturas: agachado (inclinado hacia adelante) y arrastrándote (acostado boca abajo, cabeza a la derecha)
        if (e.postura === 1) {
            // agachado: de la cintura para arriba el cuerpo se inclina hacia adelante (como en Minecraft); las piernas quedan
            torso.y1 = 0.6;                                   // el torso baja un poco para que no quede hueco al inclinarse
            L.forEach(function (b) {
                if (!b.fijo && b.y1 >= 0.55) b.r = (b.r || []).concat([[0.45, 0.7, 0]]);
            });
        } else if (e.postura === 2) {
            L.forEach(function (b) {                          // todo el cuerpo se acuesta boca abajo
                b.r = (b.r || []).concat([[1.45, 0.87, 0]]);
                b.oy = -0.52;
            });
        }
        // giro del cuerpo (sigue hacia dónde mirás) y de la cabeza (un poco más)
        const giroCuerpo = e.giroCuerpo;
        const culebreo = e.postura === 2 ? 0.16 * balanceo : 0;      // arrastrándote el cuerpo serpentea de lado a lado
        L.forEach(function (b) { b.ya = giroCuerpo + culebreo + (b.cab ? giroCab : 0); });
        if (bd) {
            // baile: vuelta del cuerpo entero, giro de la parte de arriba (las piernas quedan) y saltitos
            L.forEach(function (b) {
                b.ya += (bd.giro || 0) + (b.pi === undefined && bd.tw ? bd.tw : 0);
                if (bd.oy) b.oy = (b.oy || 0) + bd.oy;
            });
        }
        return L;
    }

    const GRIETA = [[0.55, 1], [0.4, 0.8], [0.62, 0.6], [0.38, 0.4], [0.6, 0.2], [0.45, 0]];

    // La vista previa se dibuja con buffer de profundidad (z-buffer): ninguna parte del cuerpo queda tapada o invisible
    // desde ningún ángulo, y se puede girar en todas direcciones arrastrando.
    const vistaBuf = document.createElement("canvas");
    let vistaImg = null, vistaZ = null;
    function dibujarVista() {
        const cv = vista.canvas;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
            cv.width = Math.round(w * dpr);
            cv.height = Math.round(h * dpr);
        }
        const g = cv.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);

        const escala = Math.min(h / 2.0, w / 0.95) * (postura === 2 ? 0.5 : 1);
        const cx = w / 2, cy = h / 2 - (postura === 2 ? 0.55 : postura === 1 ? 0.06 : 0) * escala;
        const cg = Math.cos(vista.giro), sg = Math.sin(vista.giro);
        const inc = vista.inc, ci = Math.cos(inc), si = Math.sin(inc);   // inclinación de la cámara: + desde arriba, − desde abajo
        const luz = [-0.35, 0.55, 0.75];
        const ll = Math.hypot(luz[0], luz[1], luz[2]);

        // Punto del cuerpo -> pantalla (sx, sy) y profundidad (más grande = más cerca)
        function proyectar(x, y, z) {
            const x1 = x * cg + z * sg;
            const z1 = -x * sg + z * cg;
            return [cx + x1 * escala, cy - ((y - 0.87) * ci - z1 * si) * escala, z1 * ci + y * si];
        }

        // Sombra en el piso (solo si se mira desde arriba)
        if (si > 0.08) {
            const piso = proyectar(0, 0, 0);
            g.fillStyle = "rgba(0,0,0,0.45)";
            g.beginPath();
            g.ellipse(piso[0], piso[1], 0.5 * escala, 0.5 * escala * si, 0, 0, Math.PI * 2);
            g.fill();
        }

        // Buffer interno (más grande si la pantalla es de baja densidad, para suavizar los bordes)
        const esc = dpr >= 2 ? dpr : dpr * 2;
        const BW = Math.max(1, Math.round(w * esc)), BH = Math.max(1, Math.round(h * esc));
        if (vistaBuf.width !== BW || vistaBuf.height !== BH || !vistaImg) {
            vistaBuf.width = BW;
            vistaBuf.height = BH;
            vistaImg = vistaBuf.getContext("2d").createImageData(BW, BH);
            vistaZ = new Float32Array(BW * BH);
        }
        const dat = vistaImg.data, zb = vistaZ;
        dat.fill(0);
        zb.fill(-1e9);

        function tri(a, b, c, r, gg, bb) {
            const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(BW - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
            const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(BH - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
            const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            if (Math.abs(area) < 1e-6) return;
            const inv = 1 / area;
            for (let y = minY; y <= maxY; y++) {
                const py = y + 0.5;
                for (let x = minX; x <= maxX; x++) {
                    const px = x + 0.5;
                    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * inv;
                    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * inv;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
                    const k = y * BW + x;
                    if (z > zb[k]) {
                        zb[k] = z;
                        dat[k * 4] = r; dat[k * 4 + 1] = gg; dat[k * 4 + 2] = bb; dat[k * 4 + 3] = 255;
                    }
                }
            }
        }
        // cuadrilátero un poquito agrandado para que no queden rendijas entre caras vecinas
        function quad(P, r, gg, bb, sesgo) {
            let mx = 0, my = 0;
            for (const p of P) { mx += p[0]; my += p[1]; }
            mx /= 4; my /= 4;
            const Q = P.map(function (p) {
                const dx = p[0] - mx, dy = p[1] - my, d = Math.hypot(dx, dy) || 1;
                return [p[0] + dx / d * 0.7, p[1] + dy / d * 0.7, p[2] + sesgo];
            });
            tri(Q[0], Q[1], Q[2], r, gg, bb);
            tri(Q[0], Q[2], Q[3], r, gg, bb);
        }
        function trazo(p, q, r, gg, bb, grosor) {
            const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
            for (let s2 = 0; s2 <= n; s2++) {
                const t = s2 / n;
                const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t + 0.05 * escala * esc;
                for (let dy = -grosor; dy <= grosor; dy++) {
                    for (let dx = -grosor; dx <= grosor; dx++) {
                        const X = Math.round(x + dx), Y = Math.round(y + dy);
                        if (X < 0 || Y < 0 || X >= BW || Y >= BH) continue;
                        const k = Y * BW + X;
                        if (z > zb[k]) { zb[k] = z; dat[k * 4] = r; dat[k * 4 + 1] = gg; dat[k * 4 + 2] = bb; dat[k * 4 + 3] = 255; }
                    }
                }
            }
        }
        const aBuf = function (p) { return [p[0] * esc, p[1] * esc, p[2] * escala * esc]; };   // pantalla -> buffer (la profundidad en la misma escala)

        for (const b of cajasPersonaje()) {
            const xs = [b.x - b.a, b.x + b.a], ys = [b.y1, b.y2], zs = [b.z - b.l, b.z + b.l];
            const P = [];
            const rots = b.r || [];
            let angTot = 0;
            for (const r of rots) angTot += r[0];
            const cT = Math.cos(angTot), sT = Math.sin(angTot);
            const yaT = b.ya || 0, cY = Math.cos(yaT), sY = Math.sin(yaT);
            for (let i = 0; i < 8; i++) {
                let qx = xs[i & 1], qy = ys[(i >> 1) & 1], qz = zs[(i >> 2) & 1];
                for (const r of rots) {                       // giro alrededor del eje X (hacia adelante = +z)
                    const dy = qy - r[1], dz = qz - r[2], c = Math.cos(r[0]), sn = Math.sin(r[0]);
                    qy = r[1] + dy * c - dz * sn;
                    qz = r[2] + dz * c + dy * sn;
                }
                qy += b.oy || 0;
                if (yaT) { const nx = qx * cY + qz * sY; qz = -qx * sY + qz * cY; qx = nx; }   // giro del cuerpo / cabeza (eje vertical)
                P.push(aBuf(proyectar(qx, qy, qz)));
            }
            const idx = function (ix, iy, iz) { return ix + 2 * iy + 4 * iz; };
            const def = [
                { n: [0, 1, 0], v: [idx(0,1,0), idx(1,1,0), idx(1,1,1), idx(0,1,1)] },   // arriba
                { n: [0, 0, 1], v: [idx(0,0,1), idx(1,0,1), idx(1,1,1), idx(0,1,1)] },   // frente
                { n: [0, 0, -1], v: [idx(0,0,0), idx(1,0,0), idx(1,1,0), idx(0,1,0)] },  // espalda
                { n: [-1, 0, 0], v: [idx(0,0,0), idx(0,0,1), idx(0,1,1), idx(0,1,0)] },  // izquierda
                { n: [1, 0, 0], v: [idx(1,0,0), idx(1,0,1), idx(1,1,1), idx(1,1,0)] },   // derecha
                { n: [0, -1, 0], v: [idx(0,0,0), idx(1,0,0), idx(1,0,1), idx(0,0,1)] }   // abajo
            ];
            for (const f of def) {
                // normal -> espacio de cámara
                const fny = f.n[1] * cT - f.n[2] * sT, fnz = f.n[2] * cT + f.n[1] * sT;   // normal ya girada
                const fnx = f.n[0] * cY + fnz * sY, fnz2 = -f.n[0] * sY + fnz * cY;
                const n1x = fnx * cg + fnz2 * sg;
                const n1z = -fnx * sg + fnz2 * cg;
                const nUp = fny * ci - n1z * si;
                const nCerca = n1z * ci + fny * si;
                if (nCerca <= 0.001) continue;                        // cara que mira para otro lado
                const luzDot = Math.max(0, (n1x * luz[0] + nUp * luz[1] + nCerca * luz[2]) / ll);
                const k = 0.42 + 0.58 * luzDot;
                const rr = Math.min(255, Math.round(b.c[0] * k * 255));
                const gg = Math.min(255, Math.round(b.c[1] * k * 255));
                const bb = Math.min(255, Math.round(b.c[2] * k * 255));
                const pts = f.v.map(function (i) { return P[i]; });
                quad(pts, rr, gg, bb, b.s * 0.05 * escala * esc);
                if (b.g && (f.n[2] === 1 || f.n[0] !== 0)) {          // huesos trizados: grietas en el frente y los costados
                    const P0 = pts[0], P1 = pts[1], P3 = pts[3];
                    let ant = null;
                    GRIETA.forEach(function (q) {
                        const u = Math.max(0.1, Math.min(0.9, q[0] + (b.g - 2) * 0.12)), v = q[1];
                        const cur = [
                            P0[0] + (P1[0] - P0[0]) * u + (P3[0] - P0[0]) * v,
                            P0[1] + (P1[1] - P0[1]) * u + (P3[1] - P0[1]) * v,
                            P0[2] + (P1[2] - P0[2]) * u + (P3[2] - P0[2]) * v
                        ];
                        if (ant) trazo(ant, cur, 25, 0, 0, Math.max(1, Math.round(esc * 0.6)));
                        ant = cur;
                    });
                }
            }
        }
        vistaBuf.getContext("2d").putImageData(vistaImg, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.imageSmoothingEnabled = true;
        g.drawImage(vistaBuf, 0, 0, cv.width, cv.height);
    }

    let vistaRaf = 0, vistaT = 0;
    function bucleVista(t) {
        vistaRaf = 0;
        if (!inv.abierto) return;
        const dt = vistaT ? Math.min(0.1, (t - vistaT) / 1000) : 0;
        vistaT = t;
        actualizarPoseVista(dt);
        dibujarVista();
        vistaRaf = requestAnimationFrame(bucleVista);
    }
    function iniciarBucleVista() {
        if (vistaRaf) return;
        vistaT = 0;
        vistaRaf = requestAnimationFrame(bucleVista);
    }

    function pintarInventario() {
        const caja = document.getElementById("invCaja");
        caja.innerHTML = "";
        caja.appendChild(crearCabeceraInv());

        // Vista previa del personaje (se gira arrastrando)
        const colVista = document.createElement("div");
        colVista.className = "invVista";
        colVista.appendChild(vista.canvas);
        caja.appendChild(colVista);

        // Cuerpo: cabeza, torso, piernas y pies
        const colCuerpo = document.createElement("div");
        colCuerpo.className = "invCol";
        colCuerpo.innerHTML = '<div class="invTit">Ropa</div>';
        ["cabeza", "torso", "piernas", "pies"].forEach(function (k) {
            colCuerpo.appendChild(huecoDom({ t: "e", k: k }, "eq"));
        });
        caja.appendChild(colCuerpo);

        // Mochila (hueco alto, al lado de la ropa)
        const colMochila = document.createElement("div");
        colMochila.className = "invCol";
        colMochila.innerHTML = '<div class="invTit">Mochila</div>';
        colMochila.appendChild(huecoDom({ t: "e", k: "espalda" }, "eq alta"));
        const tm = document.createElement("div");
        tm.className = "invTit";
        tm.textContent = "Mano";
        colMochila.appendChild(tm);
        colMochila.appendChild(huecoDom({ t: "h", k: "I" }, "eq"));
        caja.appendChild(colMochila);

        // Bolsillos y mochila: solo existen si tenés la prenda puesta
        const conts = document.createElement("div");
        conts.className = "invConts";
        let hay = false;
        for (const k of ORDEN_CONT) {
            if (!inv.cont[k]) continue;
            hay = true;
            const bloque = document.createElement("div");
            bloque.innerHTML = '<div class="invTit">' + TIT_CONT[k] + "</div>";
            const grilla = document.createElement("div");
            grilla.className = "invGrid";
            grilla.style.setProperty("--cols", ITEMS[inv.equipo[k]].cols || 2);
            for (let i = 0; i < inv.cont[k].length; i++) grilla.appendChild(huecoDom({ t: "c", k: k, i: i }, ""));
            bloque.appendChild(grilla);
            conts.appendChild(bloque);
        }
        if (!hay) {
            const v = document.createElement("div");
            v.className = "invVacio";
            v.textContent = "Inventario vacío. Ponete ropa o una mochila para tener dónde guardar cosas.";
            conts.appendChild(v);
        }
        caja.appendChild(conts);

        // Accesorios gratis: flores, pestañas y más (los demás jugadores te ven con ellos)
        const bloqueAcc = document.createElement("div");
        bloqueAcc.className = "invAcc";
        const tAcc = document.createElement("button");
        tAcc.className = "invAccBtn";
        tAcc.textContent = (invAccAbierto ? "▾" : "▸") + " ACCESORIOS Y BAILES GRATIS";
        tAcc.addEventListener("click", function () { invAccAbierto = !invAccAbierto; pintarInventario(); });
        if (!invAccAbierto) {
            bloqueAcc.appendChild(tAcc);
        } else {
            const cab = document.createElement("div");
            cab.style.cssText = "flex-basis:100%;";
            cab.appendChild(tAcc);
            bloqueAcc.appendChild(cab);
            ACC_SLOTS.forEach(function (k) {
                const gr = document.createElement("div");
                gr.className = "invAccGr";
                gr.innerHTML = '<div class="invTit">' + ACC_TIT[k] + "</div>";
                const fila = document.createElement("div");
                fila.className = "invAccFila";
                const ninguno = document.createElement("div");
                ninguno.className = "iSlot eq acc nada" + (inv.acc[k] ? "" : " on");
                ninguno.textContent = "✕";
                ninguno.title = "Sin accesorio";
                ninguno.addEventListener("click", function () { delete inv.acc[k]; guardarAcc(); refrescarInventario(); });
                fila.appendChild(ninguno);
                Object.keys(ACC).filter(function (id) { return ACC[id].slot === k; }).forEach(function (id) {
                    const b = document.createElement("div");
                    b.className = "iSlot eq acc" + (inv.acc[k] === id ? " on" : "");
                    b.textContent = ACC[id].e;
                    b.title = ACC[id].n;
                    b.addEventListener("click", function () {
                        if (inv.acc[k] === id) delete inv.acc[k]; else inv.acc[k] = id;
                        guardarAcc();
                        refrescarInventario();
                    });
                    fila.appendChild(b);
                });
                gr.appendChild(fila);
                bloqueAcc.appendChild(gr);
            });
            const grB = document.createElement("div");
            grB.className = "invAccGr";
            grB.innerHTML = '<div class="invTit">Bailes (tecla B)</div>';
            const filaB = document.createElement("div");
            filaB.className = "invAccFila";
            const parar = document.createElement("div");
            parar.className = "iSlot eq acc nada" + (baile ? "" : " on");
            parar.textContent = "✕";
            parar.title = "Dejar de bailar";
            parar.addEventListener("click", function () { pararBaile(); refrescarInventario(); });
            filaB.appendChild(parar);
            BAILE_ORDEN.forEach(function (id) {
                const b = document.createElement("div");
                b.className = "iSlot eq acc" + (baile && baile.id === id ? " on" : "");
                b.textContent = BAILES[id].e;
                b.title = BAILES[id].n;
                b.addEventListener("click", function () {
                    if (baile && baile.id === id) pararBaile(); else empezarBaile(id);
                    refrescarInventario();
                });
                filaB.appendChild(b);
            });
            grB.appendChild(filaB);
            bloqueAcc.appendChild(grB);
        }
        caja.appendChild(bloqueAcc);

        // Pie: info del objeto elegido y acciones
        const pie = document.createElement("div");
        pie.className = "invPie";
        const id = inv.sel ? getRef(inv.sel) : null;
        if (id) {
            const def = ITEMS[id];
            const info = document.createElement("span");
            info.innerHTML = "<b>" + def.n + "</b>";
            pie.appendChild(info);
            const b1 = document.createElement("button");
            b1.textContent = def.slot ? (inv.sel.t === "e" ? "Quitar" : "Ponerme") : (def.mano ? (inv.sel.t === "h" ? "Guardar" : "En la mano") : "Usar");
            b1.addEventListener("click", function () { usar(inv.sel); });
            const b2 = document.createElement("button");
            b2.textContent = (inv.sel.t === "e" && id === "mochila") ? "Sacármela y tirar" : "Tirar";
            b2.addEventListener("click", function () { tirar(inv.sel); });
            pie.appendChild(b1);
            pie.appendChild(b2);
        }
        // Salud física (lesiones): abajo, junto al texto de ayuda
        const lesTxt = textoLesiones();
        if (lesTxt) {
            const t = document.createElement("div");
            t.className = "invLes";
            t.innerHTML = lesTxt;
            pie.appendChild(t);
        }
        caja.appendChild(pie);
        aplicarLayoutInv();
    }

    // ----- Inventario: se mueve y se achica o agranda a gusto (se guarda en el dispositivo) -----
    const INV_K_MIN = 0.5, INV_K_MAX = 1.8;
    function aplicarLayoutInv() {
        const caja = document.getElementById("invCaja");
        if (!caja || !inv.abierto) return;
        const L = A.inventario;
        const k = L && isFinite(L.k) ? Math.max(INV_K_MIN, Math.min(INV_K_MAX, L.k)) : 1;
        caja.style.setProperty("--ik", k.toFixed(3));
        if (L && isFinite(L.fx) && isFinite(L.fy)) {
            const W = window.innerWidth, H = window.innerHeight;
            const r = caja.getBoundingClientRect();
            caja.style.transform = "none";
            caja.style.left = Math.round(Math.max(0, Math.min(W - r.width, L.fx * W))) + "px";
            caja.style.top = Math.round(Math.max(0, Math.min(H - r.height, L.fy * H))) + "px";
        } else {
            caja.style.transform = "";
            caja.style.left = "";
            caja.style.top = "";
        }
    }
    // pasa de "centrado" a un lugar fijo (para poder moverlo o agrandarlo desde una esquina)
    function fijarLayoutInv() {
        if (A.inventario && isFinite(A.inventario.fx) && isFinite(A.inventario.fy)) return;
        const r = document.getElementById("invCaja").getBoundingClientRect();
        A.inventario = { fx: r.left / window.innerWidth, fy: r.top / window.innerHeight, k: (A.inventario && A.inventario.k) || 1 };
    }
    function cambiarTamInv(delta) {
        const k = (A.inventario && A.inventario.k) || 1;
        A.inventario = Object.assign({}, A.inventario || {}, { k: Math.max(INV_K_MIN, Math.min(INV_K_MAX, Math.round((k + delta) * 100) / 100)) });
        window.Ajustes.guardar();
        aplicarLayoutInv();
    }
    function crearCabeceraInv() {
        const cab = document.createElement("div");
        cab.className = "invCab";
        cab.title = "Arrastrá para mover el inventario";
        const tit = document.createElement("span");
        tit.className = "invCabTit";
        tit.textContent = "⠿ Inventario";
        cab.appendChild(tit);
        function boton(txt, titulo, fn, clase) {
            const b = document.createElement("button");
            b.textContent = txt;
            b.title = titulo;
            if (clase) b.className = clase;
            b.addEventListener("click", fn);
            cab.appendChild(b);
            return b;
        }
        boton("−", "Achicar", function () { cambiarTamInv(-0.1); });
        boton("+", "Agrandar", function () { cambiarTamInv(0.1); });
        const grip = boton("⤡", "Arrastrá para cambiar el tamaño", function () {}, "grip");
        boton("↺", "Volver al lugar y tamaño de siempre", function () {
            A.inventario = null;
            window.Ajustes.guardar();
            aplicarLayoutInv();
        });
        boton("✕", "Cerrar", function () { cerrarInventario(); });

        // mover: arrastrando la barra de arriba
        let mueve = null;
        cab.addEventListener("pointerdown", function (e) {
            if (e.target.closest("button")) return;
            fijarLayoutInv();
            mueve = { x: e.clientX, y: e.clientY, fx: A.inventario.fx, fy: A.inventario.fy };
            cab.classList.add("mueve");
            try { cab.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        cab.addEventListener("pointermove", function (e) {
            if (!mueve) return;
            A.inventario.fx = mueve.fx + (e.clientX - mueve.x) / window.innerWidth;
            A.inventario.fy = mueve.fy + (e.clientY - mueve.y) / window.innerHeight;
            aplicarLayoutInv();
        });
        function soltarMover() {
            if (!mueve) return;
            mueve = null;
            cab.classList.remove("mueve");
            const caja = document.getElementById("invCaja");
            const r = caja.getBoundingClientRect();     // se guarda ya con el tope de pantalla aplicado
            A.inventario.fx = r.left / window.innerWidth;
            A.inventario.fy = r.top / window.innerHeight;
            window.Ajustes.guardar();
        }
        cab.addEventListener("pointerup", soltarMover);
        cab.addEventListener("pointercancel", soltarMover);

        // achicar / agrandar: arrastrando la esquinita ⤡ (la esquina de arriba a la izquierda se queda quieta)
        let tam = null;
        grip.addEventListener("pointerdown", function (e) {
            fijarLayoutInv();
            const r = document.getElementById("invCaja").getBoundingClientRect();
            tam = { x: e.clientX, w: r.width, k: A.inventario.k || 1 };
            try { grip.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
            e.stopPropagation();
        });
        grip.addEventListener("pointermove", function (e) {
            if (!tam) return;
            A.inventario.k = Math.max(INV_K_MIN, Math.min(INV_K_MAX, tam.k * (tam.w + (e.clientX - tam.x)) / tam.w));
            aplicarLayoutInv();
        });
        function soltarTam() {
            if (!tam) return;
            tam = null;
            A.inventario.k = Math.round(A.inventario.k * 100) / 100;
            window.Ajustes.guardar();
        }
        grip.addEventListener("pointerup", soltarTam);
        grip.addEventListener("pointercancel", soltarTam);
        return cab;
    }
    window.addEventListener("resize", function () { aplicarLayoutInv(); });

    function refrescarInventario() {
        pintarBarra();
        if (inv.abierto) pintarInventario();
    }

    function abrirInventario() {
        if (!sv.activo || !sv.vivo || inv.abierto) return;
        inv.abierto = true;
        window.inventarioAbierto = true;      // para que el menú no abra la pausa al soltar el mouse
        if (sv.durmiendo) despertar();
        try { document.exitPointerLock(); } catch (e) {}      // sigue pudiendo moverte y correr con el inventario abierto
        invFondo.classList.add("visible");
        vista.cuerpo = yaw; vista.base = yaw; vista.postPrev = postura;
        vista.giro = postura === 2 ? 1.35 : 0.5;
        inv.barraSel = -1;
        refrescarInventario();
        iniciarBucleVista();
    }
    function cerrarInventario() {
        if (!inv.abierto) return;
        inv.abierto = false;
        window.inventarioAbierto = false;
        inv.sel = null;
        invFondo.classList.remove("visible");
        if (!("ontouchstart" in window)) { try { canvas.requestPointerLock(); } catch (e) {} }
        refrescarInventario();
    }
    window.cerrarInventario = cerrarInventario;

    function iniciarInventario(datos) {
        inv.barra = new Array(BARRA_N).fill(null);
        inv.equipo = {};
        cargarAcc();
        inv.cont = {};
        inv.sel = null;
        inv.barraSel = -1;
        inv.manoD = null;
        inv.manoI = null;
        inv.cargaMano = { D: null, I: null };
        inv.abierto = false;
        window.inventarioAbierto = false;
        invFondo.classList.remove("visible");
        const ok = function (id) { return typeof id === "string" && ITEMS[id] ? id : null; };
        dinero = datos && typeof datos === "object" ? Math.max(0, Math.min(999999, Math.floor(+datos.dinero) || 0)) : 0;
        if (datos && typeof datos === "object") {
            if (datos.aberturas) aplicarEstados(datos.aberturas, true);
            (datos.barra || []).slice(0, BARRA_N).forEach(function (id, i) { inv.barra[i] = ok(id); });
            for (const k in (datos.equipo || {})) {
                if (ok(datos.equipo[k]) && ITEMS[datos.equipo[k]].slot === k) inv.equipo[k] = datos.equipo[k];
            }
            inv.manoD = ok(datos.manoD);
            inv.manoI = ok(datos.manoI);
            const okCarga = function (c) { return Array.isArray(c) ? c.slice(0, 10).map(ok) : null; };
            ["D", "I"].forEach(function (k) {
                const c = datos.cargaMano ? okCarga(datos.cargaMano[k]) : null;
                if (c && inv["mano" + k] === "mochila") inv.cargaMano[k] = c;
            });
            // partidas viejas: la mochila no se guarda en la barra, pasa a una mano
            inv.barra.forEach(function (id, i) {
                if (id !== "mochila") return;
                if (!inv.manoD) { inv.manoD = id; inv.barra[i] = null; }
                else if (!inv.manoI) { inv.manoI = id; inv.barra[i] = null; }
            });
            ajustarContenedores();
            // volvés al mismo lugar donde dejaste la partida
            const ps = datos.pos;
            if (ps && isFinite(ps.x) && isFinite(ps.z) && Math.abs(ps.x) < 500 && Math.abs(ps.z) < 500) {
                const py = isFinite(ps.y) && ps.y > 0 && ps.y < 50 ? +ps.y : 0;      // por si estabas arriba de un objeto
                let libre = true;
                try { libre = !choca(+ps.x, +ps.z, py); } catch (e) {}
                if (libre) {
                    px = +ps.x; pz = +ps.z; saltoY = py;
                    if (isFinite(ps.yaw)) yaw = +ps.yaw;
                    if (isFinite(ps.pitch)) pitch = Math.max(-1.5, Math.min(1.5, +ps.pitch));
                }
            }
            for (const k of ORDEN_CONT) {
                if (!inv.cont[k] || !datos.cont || !Array.isArray(datos.cont[k])) continue;
                for (let i = 0; i < inv.cont[k].length; i++) inv.cont[k][i] = ok(datos.cont[k][i]);
            }
            inv.mundo = Array.isArray(datos.mundo)
                ? datos.mundo.filter(function (m) { return m && ok(m.id); }).map(function (m) {
                    const it = { id: m.id, x: +m.x || 0, y: +m.y || 0, z: +m.z || 0 };
                    if (m.id === "mochila" && okCarga(m.c)) it.c = okCarga(m.c);
                    return it;
                })
                : MUNDO_INICIAL.map(function (m) { return Object.assign({}, m); });
            // partidas guardadas antes de las llaves: aparecen las llaves una sola vez (si no, las puertas con llave quedarían imposibles)
            if (!(datos.v >= 3) && Array.isArray(datos.mundo)) {
                MUNDO_INICIAL.forEach(function (m) {
                    if (/^llave\d+$/.test(m.id)) inv.mundo.push(Object.assign({}, m));
                });
            }
            // partidas guardadas antes de las vendas: aparecen una sola vez
            if (!(datos.v >= 4) && Array.isArray(datos.mundo)) {
                MUNDO_INICIAL.forEach(function (m) {
                    if (m.id === "venda") inv.mundo.push(Object.assign({}, m));
                });
            }
            // partidas guardadas antes de los combates: aparecen los objetos nuevos una sola vez
            if (datos.v !== 2 && Array.isArray(datos.mundo)) {
                MUNDO_INICIAL.forEach(function (m) {
                    if (["palo", "cuchillo", "hacha", "muletas"].indexOf(m.id) >= 0) inv.mundo.push(Object.assign({}, m));
                });
            }
        } else {
            inv.mundo = MUNDO_INICIAL.map(function (m) { return Object.assign({}, m); });
        }
        aplicarItemsServidor();
        ajustarContenedores();
        hudBajo.style.display = "flex";
        pintarBarra();
    }

    function exportarInventario() {
        return {
            v: 4,
            dinero: dinero,
            aberturas: estadoAberturas(),
            barra: inv.barra.slice(),
            equipo: Object.assign({}, inv.equipo),
            manoD: inv.manoD,
            manoI: inv.manoI,
            cargaMano: JSON.parse(JSON.stringify(inv.cargaMano)),
            pos: { x: px, y: saltoY, z: pz, yaw: yaw, pitch: pitch },
            cont: JSON.parse(JSON.stringify(inv.cont)),
            mundo: inv.mundo.map(function (m) { var o = { id: m.id, x: m.x, y: m.y, z: m.z }; if (m.c) o.c = m.c; return o; })
        };
    }

    // Los objetos del mapa: tirados en el piso (o arriba de un mueble), quietos, cada uno con su giro y su forma
    const FORMA_ITEM = {   // [ancho, alto, largo] (los largos son los que van acostados)
        palo: [0.1, 0.1, 0.8], cuchillo: [0.07, 0.04, 0.4], hacha: [0.12, 0.08, 0.6], muletas: [0.12, 0.08, 0.9],
        mochila: [0.4, 0.3, 0.3], camisa: [0.4, 0.08, 0.36], pantalon: [0.34, 0.08, 0.5], gorra: [0.28, 0.14, 0.3],
        botas: [0.3, 0.16, 0.34], agua: [0.14, 0.3, 0.14], comida: [0.2, 0.14, 0.2], jarabe: [0.14, 0.22, 0.14], anabolico: [0.08, 0.06, 0.22], venda: [0.2, 0.08, 0.2]
    };
    // Las llaves: una por cada casa cerrada, cada una con el color de su candado
    for (let i = 0; i < 40; i++) {
        const cl = COLORES_LLAVE[i % COLORES_LLAVE.length];
        const nombre = cl.n + (i >= COLORES_LLAVE.length ? " " + (Math.floor(i / COLORES_LLAVE.length) + 1) : "");
        ITEMS["llave" + i] = { n: "Llave " + nombre, e: "🔑", llave: true, color: nombre, d: "Abre la puerta de entrada con el candado " + nombre + "." };
        COLOR_ITEM["llave" + i] = cl.c;
        FORMA_ITEM["llave" + i] = [0.07, 0.03, 0.24];
    }
    const bufferItems = gl.createBuffer();
    function dibujarItems(t) {
        if (!sv.activo || (inv.mundo.length === 0 && itemsLugar.length === 0)) return;
        const lista = [];
        for (const it of inv.mundo.concat(itemsLugar)) {
            if (Math.hypot(it.x - px, it.z - pz) > 40) continue;
            if (zona === "casa" && !enPatio(it.x, it.z)) continue;
            const f = FORMA_ITEM[it.id] || [0.3, 0.2, 0.3];
            const giro = (Math.sin(it.x * 12.9898 + it.z * 78.233) * 43758.5453 % 1 + 1) % 1 * Math.PI * 2;   // un ángulo fijo por objeto
            cajaGirada(lista, it.x, it.z, giro, f[0], it.y + 0.01, it.y + 0.01 + f[1], f[2], 0, COLOR_ITEM[it.id]);
        }
        if (lista.length === 0) return;
        configurarAtributos(bufferItems);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lista), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, lista.length / 6);
    }

    // ----- Sombras (npc negros que caminan; solo las ves vos) -----
    const bufferSombras = gl.createBuffer();
    const COLOR_SOMBRA = [0.015, 0.015, 0.02];

    // Cuántas sombras por segundo aparecen y cuántas puede haber a la vez
    function parametrosSombras() {
        let tasa = 0;
        let maximo = 0;
        let persistente = false;
        const dh = diasSinComer();
        if (dh >= 14) { tasa += dh >= 21 ? 1 / 100 : 1 / 150; maximo = 2; }          // semana 3 sin comer: muy de vez en cuando
        const ds = diaSueno();
        if (ds >= 3) { tasa += ds === 3 ? 1 / 45 : 1 / 30; maximo = Math.max(maximo, 2); } // día 3 sin dormir
        if (ds >= 5) { persistente = true; maximo = ds >= 6 ? 6 : 4; }                // día 5: no te dejan en paz
        if (sv.cordura < 30) { tasa += 1 / 60; maximo = Math.max(maximo, 2); }
        return { tasa: tasa, maximo: maximo, persistente: persistente };
    }

    function crearSombra(persistente) {
        const ang = yaw + (Math.random() - 0.5) * 2.2;        // delante tuyo, para que la veas
        const dist = persistente ? 8 + Math.random() * 10 : 10 + Math.random() * 8;
        const x = px - Math.sin(ang) * dist;
        const z = pz - Math.cos(ang) * dist;
        const dir = Math.random() * 6.283;
        sv.sombras.push({
            x: x, z: z, yaw: 0, t: 0,
            dura: persistente ? 90 : 7 + Math.random() * 8,
            vx: Math.cos(dir) * 0.9, vz: Math.sin(dir) * 0.9,
            persigue: persistente
        });
    }

    function actualizarSombras(dt) {
        const p = parametrosSombras();
        sv.acumSombra += dt * p.tasa;
        if (sv.acumSombra >= 1) {
            sv.acumSombra = 0;
            if (sv.sombras.length < p.maximo) crearSombra(false);
        }
        if (p.persistente) {
            while (sv.sombras.length < p.maximo) crearSombra(true);
        }
        let cerca = false;
        for (let i = sv.sombras.length - 1; i >= 0; i--) {
            const s = sv.sombras[i];
            s.t += dt;
            if (s.t >= s.dura) { sv.sombras.splice(i, 1); continue; }
            if (s.persigue && p.persistente) {
                const dx = px - s.x, dz = pz - s.z;
                const d = Math.hypot(dx, dz) || 1;
                if (d > 3.5) { s.vx = dx / d * 1.3; s.vz = dz / d * 1.3; }
                else { s.vx = 0; s.vz = 0; }
            }
            s.x += s.vx * dt;
            s.z += s.vz * dt;
            if (s.vx !== 0 || s.vz !== 0) s.yaw = Math.atan2(-s.vx, -s.vz);
            if (Math.hypot(px - s.x, pz - s.z) < 6) cerca = true;
        }
        return cerca;
    }

    function dibujarSombras() {
        if (sv.sombras.length === 0) return;
        const lista = [];
        for (const s of sv.sombras) {
            const k = Math.min(1, s.t / 1.2, (s.dura - s.t) / 1.2);   // aparece y se va de a poco
            cajaGirada(lista, s.x, s.z, s.yaw, 0.6, 0, 1.7 * k, 0.4, 0, COLOR_SOMBRA);
            cajaGirada(lista, s.x, s.z, s.yaw, 0.4, 1.35 * k, 1.6 * k, 0.3, -0.3, COLOR_SOMBRA);
        }
        configurarAtributos(bufferSombras);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lista), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, lista.length / 6);
    }

    // ----- NPCs de las casas (viven adentro: se paran, pasean despacito y te miran si te acercás) -----
    const bufferNpcs = gl.createBuffer();

    // En un servidor, el cliente que "manda" (el primero que entró; si se va, el siguiente) hace pensar a los NPCs
    // y le manda a los demás dónde están y qué hacen. Los otros solo los ven y los pueden golpear.
    const ES_NPC = ["para", "camina", "alerta", "ataca", "huye", "quieto"];
    function idPropio() { return miId === null ? "yo" : String(miId); }
    function dentroCasa(i, x, z) {
        const r = CASAS[i];
        return !!r && x > r[0] + 0.2 && x < r[2] - 0.2 && z > r[1] + 0.2 && z < r[3] - 0.2;
    }
    // Todos los jugadores que los NPCs pueden ver: vos y los demás del servidor
    function listaJugadores() {
        const l = [{ id: idPropio(), x: px, z: pz, y: saltoY, yo: true, vivo: sv.vivo }];
        for (const id in otros) {
            if (id === String(miId)) continue;
            const j = otros[id];
            if (j && mismaZona(j) && typeof j.x === "number" && typeof j.z === "number") l.push({ id: id, x: j.x, z: j.z, y: j.y || 0, yo: false, vivo: true });
        }
        return l;
    }

    let ultimoHablaNpc = 0;
    function mostrarHablaNpc(i, texto) {
        const n = NPCS[i];
        if (!n || !texto || Math.hypot(px - n.x, pz - n.z) > 12) return;
        avisar("💬 " + texto, Math.max(2600, Math.min(6000, texto.length * 60)));
    }
    function hablarNpc(n, texto, forzar) {
        const ahoraMs = performance.now();
        if (!forzar && (ahoraMs - n.habloMs < 4500 || ahoraMs - ultimoHablaNpc < 2200)) return false;
        n.habloMs = ahoraMs; ultimoHablaNpc = ahoraMs;
        mostrarHablaNpc(n.i, texto);
        enviarRed({ tipo: "npchabla", i: n.i, t: texto });
        return true;
    }
    function elegirTexto(l) { return l[Math.floor(Math.random() * l.length)]; }

    // Camina en coordenadas de la casa, deslizándose contra paredes y muebles. Devuelve true si se movió.
    function moverNpc(n, dx, dz, paso) {
        const intentos = [[dx, dz], [dx, 0], [0, dz]];
        for (const q of intentos) {
            const m = Math.hypot(q[0], q[1]);
            if (m < 0.01) continue;
            const nlx = n.lx + q[0] / m * paso, nlz = n.lz + q[1] / m * paso;
            if (!n.libreMov(nlx, nlz)) continue;
            const wp = n.T(nlx, nlz);
            n.vx = wp[0] - n.x; n.vz = wp[1] - n.z;
            n.lx = nlx; n.lz = nlz; n.x = wp[0]; n.z = wp[1];
            return true;
        }
        return false;
    }

    // Le pegaron a un NPC (porId = quién): se ofende con esa persona y reacciona según su carácter
    function golpearNpc(n, dano, porId) {
        if (n.caido) return;
        n.hp -= dano; n.ofendidoPor[porId] = true; n.golpeadoPor[porId] = true; if (n.confPor) delete n.confPor[porId];
        if (n.hp <= 0) {
            n.caido = true; n.estado = "quieto"; n.mov = 0; n.col[4] = -100;
            if (porId === idPropio()) avisar("Lo dejaste fuera de combate", 2200);
            return;
        }
        if (n.tipo === "cobarde") hablarNpc(n, elegirTexto(["¡Ay! ¡Por favor, parate!", "¡Basta, me voy a esconder!"]));
        else if (n.tipo === "pacifico") hablarNpc(n, elegirTexto(["¡Basta, por favor! No quiero pelear.", "¿Por qué hacés esto?"]));
        else hablarNpc(n, elegirTexto(["¡Me pegaste! ¡Ahora sí!", "¡Vas a pagar por eso!"]));
    }

    // Alguien (en (x, z)) se llevó algo de una casa: los que están ahí se enteran
    function robarNpcs(idJ, x, z) {
        if (typeof x !== "number" || typeof z !== "number") return;
        for (const n of NPCS) {
            if (n.caido || !dentroCasa(n.casa, x, z)) continue;
            n.ofendidoPor[idJ] = true;
            if (n.tipo === "defensor") hablarNpc(n, "¡Eso es mío! ¡Devolvelo!");
            else if (n.tipo === "pacifico") hablarNpc(n, "Llevalo nomás, seguro lo necesitás más que yo.");
            else if (n.tipo === "cobarde") hablarNpc(n, "¡Llevate lo que quieras, pero no me lastimes!");
        }
    }
    // Agarraste algo: si manejás a los NPCs reaccionan directo; si no, se le avisa al que los maneja
    function alertarRobo() {
        if (esAutoridad()) robarNpcs(idPropio(), px, pz);
        else enviarRed({ tipo: "robo", x: px, z: pz });
    }

    // ----- Fotos de los NPCs (lo que se manda por la red) -----
    function r2(v) { return Math.round(v * 100) / 100; }
    function fotoNpcs() {
        return NPCS.map(function (n) {
            return [r2(n.x), r2(n.z), r2(n.cuerpo), r2(n.giroCab), r2(n.mov), n.corre ? 1 : 0,
                Math.max(0, ES_NPC.indexOf(n.estado)), n.caido ? 1 : 0, Math.round(n.hp), n.golpeSeq];
        });
    }
    function aplicarFotoNpcs(arr, instantaneo) {
        for (let i = 0; i < NPCS.length && i < arr.length; i++) {
            const a = arr[i], n = NPCS[i];
            if (!Array.isArray(a) || a.length < 10) continue;
            n.sx = a[0]; n.sz = a[1]; n.scuerpo = a[2]; n.sgiro = a[3]; n.smov = a[4]; n.corre = !!a[5];
            n.estado = ES_NPC[a[6]] || "para";
            n.hp = a[8];
            if (a[9] !== n.golpeSeq) { n.golpeSeq = a[9]; n.golpeT = 0; }
            if (a[7] && !n.caido) { n.caido = true; n.estado = "quieto"; n.mov = 0; n.col[4] = -100; }
            if (instantaneo) {
                n.x = a[0]; n.z = a[1]; n.cuerpo = a[2]; n.giroCab = a[3]; n.mov = a[4];
                const lp = n.aLocal(n.x, n.z);
                n.lx = lp[0]; n.lz = lp[1]; n.tx = lp[0]; n.tz = lp[1];
            }
        }
    }
    // El que manejaba a los NPCs se fue: seguimos desde donde estaban
    function tomarMandoNpcs() {
        soyAutoridad = true;
        for (const n of NPCS) {
            const lp = n.aLocal(n.x, n.z);
            n.lx = lp[0]; n.lz = lp[1]; n.tx = lp[0]; n.tz = lp[1];
            if (!n.caido) { n.estado = "para"; n.espera = 1 + Math.random() * 3; }
            n.cd = 1; n.pendiente = 0;
        }
    }
    // Los que no manejan a los NPCs: los siguen suavemente
    function actualizarNpcsRemotos(dt) {
        if (snapNuevo && snapNpcs) { aplicarFotoNpcs(snapNpcs, false); snapNuevo = false; }
        const k = Math.min(1, dt * 12);
        for (const n of NPCS) {
            if (n.sx === undefined) continue;
            n.golpeT += dt;
            n.x += (n.sx - n.x) * k; n.z += (n.sz - n.z) * k;
            n.cuerpo += angDif(n.scuerpo, n.cuerpo) * k;
            n.giroCab += (n.sgiro - n.giroCab) * Math.min(1, dt * 10);
            n.mov += (n.smov - n.mov) * Math.min(1, dt * 10);
            if (n.mov > 0.1) n.fase += dt * (n.corre ? 9 : 5.4);
            if (!n.caido) { n.col[0] = n.x - 0.3; n.col[1] = n.z - 0.3; n.col[2] = n.x + 0.3; n.col[3] = n.z + 0.3; }
        }
    }

    function actualizarNpcs(dt) {
        if (snapHola && NPCS.length) { aplicarFotoNpcs(snapHola, true); snapHola = null; }
        if (!esAutoridad()) { actualizarNpcsRemotos(dt); return; }
        const jugs = listaJugadores();
        const ahoraMs = performance.now();
        for (const n of NPCS) {
            if (n.caido) { n.mov = 0; continue; }
            let minD = 1e9, jcerca = null;
            for (const j of jugs) {
                if (!j.vivo) continue;
                const d = Math.hypot(j.x - n.x, j.z - n.z);
                if (d < minD) { minD = d; jcerca = j; }
            }
            const activo = n.estado === "ataca" || n.estado === "alerta" || n.estado === "huye";
            if (minD > 45 && !activo) { n.mov = 0; continue; }       // lejos de todos: se quedan quietos
            n.golpeT += dt; n.cd -= dt;
            n.vx = 0; n.vz = 0;
            let camina = false, corre = false;

            // ¿qué hace al ver a cada jugador? depende de su carácter (y de si esa persona le robó o le pegó)
            let objAt = null, dAt = 1e9, objHu = null, dHu = 1e9;
            for (const j of jugs) {
                if (!j.vivo) continue;
                const d = Math.hypot(j.x - n.x, j.z - n.z);
                const enProp = dentroCasa(n.casa, j.x, j.z) && j.y < 2.5;
                const gol = !!n.golpeadoPor[j.id], ofe = !!n.ofendidoPor[j.id];
                const calma = (n.calmaPor[j.id] || 0) > ahoraMs;          // lo calmaste hablando
                const asus = (n.asustadoPor[j.id] || 0) > ahoraMs;        // lo asustaste hablando
                if (!enProp && n.vistoPor) delete n.vistoPor[j.id];      // si salís de la casa, la próxima vez te vuelve a recibir
                if (!(enProp || (gol && d < 8) || asus)) continue;
                // lo que dice al verte entrar lo dice UNA sola vez por visita (no se repite mientras estés adentro)
                if (!n.vistoPor) n.vistoPor = {};
                const recibir = function (t) {
                    if (n.vistoPor[j.id]) return;
                    if (hablarNpc(n, t)) n.vistoPor[j.id] = true;
                };
                let r = null;
                if (n.tipo === "agresivo") {
                    if (!calma) r = "ataca";
                    else if (d < 3) recibir("Mmm... yo te estoy mirando.");
                } else if (n.tipo === "defensor") {
                    if (ofe && !calma) r = "ataca";
                    else if (!ofe && d < 4) recibir("Ey... mirá, no toques nada.");
                } else if (n.tipo === "cobarde") {
                    if (asus || (!calma && (ofe || d < 7))) r = "huye";
                } else {                                            // pacífico
                    if (gol || asus) r = "huye";
                    else if (d < 4) recibir(elegirTexto(["Ah, hola. Pasá, pasá, no hay problema.", "Hola... si tenés hambre o sed, fijate por ahí."]));
                }
                if (r === "ataca" && d < dAt) { objAt = j; dAt = d; }
                else if (r === "huye" && d < dHu) { objHu = j; dHu = d; }
            }
            const reaccion = objAt ? "ataca" : objHu ? "huye" : null;
            const obj = objAt || objHu;

            if (reaccion === "ataca") {
                if (n.estado !== "ataca" && n.estado !== "alerta") {
                    n.estado = "alerta"; n.alerta = n.tipo === "agresivo" ? 0.9 : 0.6;
                    hablarNpc(n, n.tipo === "agresivo"
                        ? elegirTexto(["¡¿Qué hacés en mi casa?!", "¡Ladrón! ¡Fuera de acá!", "¡Te voy a romper la cara!"])
                        : "¡Te dije que no tocaras nada!");
                }
            } else if (reaccion === "huye") {
                if (n.estado !== "huye") {
                    n.estado = "huye"; n.tx = n.lx; n.tz = n.lz; n.espera = 0;
                    hablarNpc(n, elegirTexto(["¡P-por favor, no me hagas daño!", "¡Auxilio!"]));
                }
            } else if (activo) {
                n.estado = "para"; n.espera = 3 + Math.random() * 3;       // se calma
            }

            if (n.estado === "alerta") {
                n.alerta -= dt;
                if (n.alerta <= 0) n.estado = "ataca";
            } else if (n.estado === "ataca" && obj) {
                const lp = n.aLocal(obj.x, obj.z);
                const dx = lp[0] - n.lx, dz = lp[1] - n.lz, d = Math.hypot(dx, dz);
                if (d > 1.0) { camina = moverNpc(n, dx, dz, 2.3 * dt); corre = camina; }
                else if (n.cd <= 0 && Math.abs(obj.y) < 1.2) { n.cd = 1.3; n.golpeT = 0; n.golpeSeq = (n.golpeSeq + 1) % 100000; n.pendiente = 0.25; n.blanco = obj.id; }
            } else if (n.estado === "huye" && obj) {
                n.espera -= dt;
                if (n.espera <= 0) {                                // elige la esquina más lejos de quien lo asusta
                    n.espera = 1;
                    const lp = n.aLocal(obj.x, obj.z);
                    let mejor = null, mejorD = -1;
                    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                        const cx = sx * (n.w - n.t - 0.7), cz = sz * (n.d - n.t - 0.7);
                        if (!n.libreMov(cx, cz)) continue;
                        const dd = Math.hypot(cx - lp[0], cz - lp[1]);
                        if (dd > mejorD) { mejorD = dd; mejor = [cx, cz]; }
                    }
                    if (mejor) { n.tx = mejor[0]; n.tz = mejor[1]; }
                }
                const dx = n.tx - n.lx, dz = n.tz - n.lz;
                if (Math.hypot(dx, dz) > 0.3) { camina = moverNpc(n, dx, dz, 2.4 * dt); corre = camina; }
            } else if (n.estado === "camina") {
                const dx = n.tx - n.lx, dz = n.tz - n.lz;
                const d = Math.hypot(dx, dz);
                if (d < 0.1 || minD < 1.3) {
                    n.estado = "para"; n.espera = 2 + Math.random() * 5;
                } else {
                    const paso = Math.min(d, 0.9 * dt);
                    const nlx = n.lx + dx / d * paso, nlz = n.lz + dz / d * paso;
                    if (!n.libre(nlx, nlz)) {
                        n.estado = "para"; n.espera = 1 + Math.random() * 2;
                    } else {
                        const wp = n.T(nlx, nlz);
                        n.vx = wp[0] - n.x; n.vz = wp[1] - n.z;
                        n.lx = nlx; n.lz = nlz; n.x = wp[0]; n.z = wp[1];
                        camina = true;
                    }
                }
            } else if (n.estado !== "alerta") {
                if (n.estado !== "para") n.estado = "para";
                n.espera -= dt;
                if (n.espera <= 0) {
                    n.espera = 2 + Math.random() * 5;
                    for (let k = 0; k < 8; k++) {
                        const tx = -n.w + n.t + 0.6 + Math.random() * (2 * n.w - 2 * n.t - 1.2);
                        const tz = -n.d + n.t + 0.6 + Math.random() * (2 * n.d - 2 * n.t - 1.2);
                        if (Math.hypot(tx - n.lx, tz - n.lz) < 1) continue;
                        if (!n.libre(tx, tz) || !n.camino(n.lx, n.lz, tx, tz)) continue;
                        n.tx = tx; n.tz = tz; n.estado = "camina";
                        break;
                    }
                }
            }

            // el golpe llega un instante después de levantar el brazo (si el blanco todavía está cerca)
            if (n.pendiente > 0) {
                n.pendiente -= dt;
                if (n.pendiente <= 0) {
                    const bj = jugs.find(function (j) { return j.id === n.blanco; });
                    if (bj && bj.vivo && Math.hypot(bj.x - n.x, bj.z - n.z) < 1.5 && Math.abs(bj.y) < 1.2) {
                        const dano = (n.tipo === "agresivo" ? 7 : 5) + Math.random() * (n.tipo === "agresivo" ? 7 : 6);
                        if (bj.yo) recibirGolpe(dano, "el dueño de la casa");
                        else enviarRed({ tipo: "npcdano", a: Number(bj.id), d: dano });
                    }
                }
            }

            // la caja de colisión sigue al NPC
            n.col[0] = n.x - 0.3; n.col[1] = n.z - 0.3; n.col[2] = n.x + 0.3; n.col[3] = n.z + 0.3;

            // hacia dónde mira
            const mira = obj || jcerca;
            const haciaVos = mira ? Math.atan2(-(mira.x - n.x), -(mira.z - n.z)) : n.cuerpo;
            let objetivo = n.cuerpo;
            if (camina && n.estado === "ataca") objetivo = haciaVos;
            else if (camina) objetivo = Math.atan2(-n.vx, -n.vz);
            else if (n.estado === "alerta" || n.estado === "ataca" || minD < 6) objetivo = haciaVos;
            n.cuerpo += angDif(objetivo, n.cuerpo) * Math.min(1, dt * (camina ? 8 : 4));
            const cab = (minD < 6 || n.estado === "ataca" || n.estado === "alerta") ? angDif(haciaVos, n.cuerpo) : 0;
            n.giroCab += (Math.max(-0.9, Math.min(0.9, cab)) - n.giroCab) * Math.min(1, dt * 6);

            n.corre = corre;
            n.mov += ((camina ? 1 : 0) - n.mov) * Math.min(1, dt * 10);
            if (n.mov > 0.1) n.fase += dt * (corre ? 9 : 5.4);
        }

        // en un servidor, les manda a los demás dónde están los NPCs (10 veces por segundo)
        if (conexion) {
            acumFotoNpc += dt;
            if (acumFotoNpc >= 0.1) { acumFotoNpc = 0; enviarRed({ tipo: "npcs", n: fotoNpcs() }); }
        }
    }

    function dibujarNpcs() {
        if (NPCS.length === 0) return;
        const lista = [];
        for (const n of NPCS) {
            if (Math.hypot(px - n.x, pz - n.z) > 40) continue;
            const est = {
                base: n.base, eq: n.eq, acc: {}, baile: "", baileT: 0,
                manoD: null, manoI: null, pl: [0, 0], postura: n.caido ? 2 : 0, pelea: n.estado === "ataca" || n.estado === "alerta",
                fase: n.fase, mov: n.mov, corre: !!n.corre, golpeT: n.golpeT, pitch: 0,
                giroCuerpo: n.cuerpo, giroCab: n.giroCab
            };
            personajeATriangulos(lista, cajasPersonaje(est), n.x, 0.02, n.z);
        }
        if (lista.length === 0) return;
        configurarAtributos(bufferNpcs);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lista), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, lista.length / 6);
    }

    // ----- Micrófono: los NPCs detectan tu voz por zona (por ahora solo detectan: no reaccionan) -----
    // Mientras está prendido se mide qué tan fuerte hablás y de ahí sale un alcance en metros.
    // Cada NPC dentro de ese alcance queda con n.oyeVoz = true (y n.distVoz = distancia).
    // Las paredes tapan: si vos y el NPC no están en el mismo lugar (adentro de la misma casa o los dos afuera), el alcance se achica a la mitad.
    const voz = { activo: false, pidiendo: false, ctx: null, analizador: null, buf: null, stream: null,
        sueloDb: -60, calib: 0, nivel: 0, radio: 0, oyen: 0, acumHud: 0, pico: 0, picoT: 0, rec: null,
        env: -90, habla: null, vozT: 0, altoT: 0, medidor: false, estado: "" };
    const cajaVoz = document.createElement("div");
    cajaVoz.style.cssText = "position:fixed;top:20px;right:150px;z-index:790;display:none;font:600 .85rem sans-serif;color:#fff;text-align:right;";
    const estiloBtnVoz = "padding:.35rem .8rem;font:600 .85rem sans-serif;color:#fff;background:rgba(0,0,0,.55);" +
        "border:1px solid rgba(255,255,255,.35);border-radius:8px;cursor:pointer;margin-left:6px;";
    const botonVoz = document.createElement("button");
    botonVoz.style.cssText = estiloBtnVoz;
    botonVoz.textContent = "🎤 Voz: off";
    botonVoz.title = "Prender / apagar el micrófono (en la compu: tecla V)";
    const botonTexto = document.createElement("button");
    botonTexto.style.cssText = estiloBtnVoz;
    botonTexto.textContent = "💬";
    botonTexto.title = "Escribirles a los NPCs (en la compu: tecla Enter)";
    const lineaVoz = document.createElement("div");
    lineaVoz.style.cssText = "margin-top:6px;max-width:320px;margin-left:auto;text-shadow:0 1px 3px #000;opacity:0;transition:opacity .5s;";
    cajaVoz.appendChild(botonVoz); cajaVoz.appendChild(botonTexto); cajaVoz.appendChild(lineaVoz);
    document.body.appendChild(cajaVoz);
    function casaDe(x, z) {
        for (let i = 0; i < CASAS.length; i++) {
            const r = CASAS[i];
            if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return i;
        }
        return -1;
    }
    // En el celular el navegador no deja que dos cosas usen el micrófono a la vez: si se abre el medidor de volumen, el reconocimiento de voz
    // se queda sordo (error "audio-capture"). Por eso en el celular solo se usa el reconocimiento de voz (sin medir volumen: se habla "normal").
    const ES_CELU = ("ontouchstart" in window) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    async function activarMicrofono() {
        if (voz.activo || voz.pidiendo) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const puedeMedir = !ES_CELU && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        if (!SR && !puedeMedir) {
            avisar(navigator.mediaDevices ? "Este navegador no reconoce voz: usá el botón 💬 para escribirles" : "Este navegador no deja usar el micrófono (hace falta https): usá el botón 💬", 4500);
            return;
        }
        voz.pidiendo = true;
        voz.medidor = false;
        voz.sueloDb = -60; voz.calib = 0; voz.nivel = 0; voz.radio = 0;
        voz.env = -90; voz.habla = null; voz.vozT = 0; voz.altoT = 0; voz.pico = 0; voz.estado = "";
        if (puedeMedir) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
                });
                const AC = window.AudioContext || window.webkitAudioContext;
                const ctx = new AC();
                if (ctx.state === "suspended") { try { await ctx.resume(); } catch (e) {} }
                const fuente = ctx.createMediaStreamSource(stream);
                const analizador = ctx.createAnalyser();
                analizador.fftSize = 1024;
                fuente.connect(analizador);                    // no se conecta a los parlantes: no te escuchás
                voz.stream = stream; voz.ctx = ctx; voz.analizador = analizador;
                voz.buf = new Float32Array(analizador.fftSize);
                voz.calib = 1.5;
                voz.medidor = true;
            } catch (e) {
                if (!SR) { avisar("No pude usar el micrófono (permiso denegado)", 3000); voz.pidiendo = false; return; }
            }
        }
        voz.activo = true;
        avisar(voz.medidor ? "Micrófono prendido: quedate callado un segundito para calibrar" : "Micrófono prendido: hablá y los NPCs cercanos te escuchan", 3000);
        iniciarReconocimiento();
        voz.pidiendo = false;
    }
    function desactivarMicrofono() {
        if (!voz.activo) return;
        voz.activo = false;
        detenerReconocimiento();
        try { voz.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { voz.ctx.close(); } catch (e) {}
        voz.stream = null; voz.ctx = null; voz.analizador = null; voz.estado = "";
        voz.nivel = 0; voz.radio = 0; voz.oyen = 0;
        for (const n of NPCS) { n.oyeVoz = false; n.distVoz = 0; }
        avisar("Micrófono apagado", 1500);
    }
    function alternarMicrofono() { if (voz.activo) desactivarMicrofono(); else activarMicrofono(); }
    botonVoz.addEventListener("click", function () { alternarMicrofono(); botonVoz.blur(); });

    // ----- Hablarles a los NPCs: lo que decís cambia cómo reaccionan -----
    // IA: el reconocimiento de voz del navegador pasa lo que dijiste a texto, se detecta la intención por palabras clave
    // (amenaza, insulto, calma, pedido de ayuda, saludo...) y cada NPC reacciona según su carácter.
    // Lo que no entiende lo busca en internet (Wiktionario / Wikipedia) y lo aprende; las preguntas las contesta con Wikipedia.
    const NOMBRE_INTENCION = { amenaza: "amenaza", insulto: "insulto", calma: "calma", ayuda: "pedido de ayuda", saludo: "saludo",
        gracias: "gracias grax thanks mil muchas agradecida agradezco copado copada groso grosa joya barbaro bacan chevere padre buenazo buenaza nice crack capo genio genia", despedida: "despedida", pregunta: "pregunta", desconocido: "no se entiende" };
    const INTENCIONES_OK = Object.keys(NOMBRE_INTENCION);
    function sinAcentos(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim(); }
    // "A veces te sueño" / "soñé con vos" habla de SOÑAR (dormido), no de tener sueño ni de pedir ayuda.
    // Se mira el texto con la ñ (sinAcentos la pierde: "sueño" y "sueno" quedarían iguales).
    function esSonarConAlguien(texto) {
        const t = String(texto || "").toLowerCase().normalize("NFC").replace(/[¿?¡!.,;:"“”]/g, " ").replace(/\s+/g, " ");
        const fin = "(?![a-zñáéíóú])", ini = "(?<![a-zñáéíóú])";
        return new RegExp(ini + "(te|lo|la|los|las|nos) (sueño|sueno|sueñas|sueñan|soñé|sone|soñaba|soñaste|soñamos)" + fin).test(t) ||
               new RegExp(ini + "(soñé|sone|soñaba|soñar|soñando|soñamos|soñaste) con" + fin).test(t) ||
               new RegExp(ini + "sueño (con (vos|ti|usted|ustedes)|contigo)" + fin).test(t) ||
               new RegExp(ini + "(a veces|siempre|anoche|ayer|todas las noches|cada noche) (sueño|sueno) (con|contigo)" + fin).test(t);
    }
    // ¿De quién habla la frase? Evita confundir "tengo frío" (me pasa a mí) con "hace frío" (el clima), o "esa gallina" con un insulto.
    function hablaDeMi(texto) {
        return /\b(tengo|tenemos|necesito|necesitamos|preciso|estoy|estamos|me|mi|mis|nos|nuestro|nuestra|ayudame|ayudenme|dame|damelo|auxilio|socorro|por favor|porfa|quiero|queremos|siento|duele|muero)\b/.test(sinAcentos(texto));
    }
    function hablaConTigo(texto) {
        return /\b(vos|tu|tus|te|ti|usted|ustedes|sos|eres|son|les|dame|dale|entrega\w*)\b/.test(sinAcentos(texto));
    }
    // "no necesito nada", "no tengo hambre", "ya comí": avisa que NO le falta algo (no es un pedido). Si además agradece, se toma como gracias.
    function esNegarNecesidad(texto) {
        const t = sinAcentos(texto);
        if (/\b(gracias|grax|thanks)\b/.test(t)) return false;
        return /\bno (me )?(hace falta|hacen falta)\b|\bno (necesito|necesitamos|preciso|tengo (hambre|sed|frio|sueno))\b|\bya (comi|bebi|tome|desayune|almorce|cene)\b/.test(t);
    }
    function clasificarReglas(texto) {
        const t = sinAcentos(texto);
        if (!t) return "desconocido";
        // "no necesito nada, gracias": rechaza amable, es un gracias (no un pedido)
        if (/\b(gracias|grax|thanks)\b/.test(t) && /\bno (me )?(hace falta|hacen falta|necesito|necesitamos|preciso|tengo (hambre|sed|frio|sueno))\b|\bya (comi|bebi|tome)\b/.test(t)) return "gracias";
        if (/\bno te (voy a |quiero |pienso )?(matar|mato|lastim\w*|hacer dano|hago dano|pegar|golpear|robar|asaltar)/.test(t)) return "calma";
        if (/\b(te voy a (matar|golpear|pegar|lastimar|romper|reventar)|te mato|te reviento|te lastimo|asalto|esto es un robo|voy a robar|dame (todo|la plata|lo que tengas|tus cosas|tu plata)|entregame|entrega todo|manos arriba|arriba las manos|o te (mato|lastimo|pego)|(voy a )?matarte|(voy a )?matar a (vos|usted|ustedes|ti)|mato a (vos|usted|ustedes|ti))\b/.test(t)) return "amenaza";
        if (/\b(idiota|estupid\w*|imbecil|inutil|basura|asquer\w*|cagon|tarado|pelotudo|hijo de puta|mierda|cobarde|maldito|inservible|desgraciado)\b/.test(t)) return "insulto";
        // charla de todos los días (jerga y frases hechas)
        if (/\b(que onda|que hubo|quiubo|que cuentas|que pasa|todo bien|todo tranquilo|como te va|como andan|como van|que se cuenta|wena|wenas|buenaas|buenas buenas|buen dia|saludos|bienvenido)\b/.test(t) && !/\b(matar|mato|golpe\w*|robar|robo)\b/.test(t)) return "saludo";
        // ofrecer ayuda ("¿necesitás algo?", "te ayudo") no es pedirla: es buena onda
        if (/\b(te ayudo|te ayudamos|te puedo ayudar|puedo ayudarte|podemos ayudarte|queres que te ayude|en que te puedo ayudar|necesitas|te traigo|te doy una mano|te echo una mano|te presto)\b/.test(t)) return "calma";
        if (/\b(estoy perdido|estoy perdida|me perdi|me ayudas|me ayudan|me das (algo|un poco|agua|comida)|tenes (algo|agua|comida|venda\w*)|tienes (algo|agua|comida|venda\w*)|una mano|me prestas|me convidas|regalame|convidame|tengo (hambre|sed|frio|miedo|sueno)|me siento mal|estoy mal|estoy herido|estoy herida)\b/.test(t)) return "ayuda";
        if (/\b(linda casa|bonita casa|lindo lugar|bonito lugar|que linda casa|que lindo lugar|me gusta (tu|su) casa|sin problema|no hay problema|no hay drama|de nada|esta bien|todo en orden|buena gente|buena persona|sos buena|eres buena|sos bueno|eres bueno|te quiero ayudar|vengo en paz|soy amigo|soy amiga|no soy peligroso|no soy peligrosa)\b/.test(t)) return "calma";
        if (/\b(mil gracias|muchas gracias|grax|thanks|thank you|te debo una|sos un crack|sos una crack|sos un capo|sos groso|sos grosa|que groso|que grosa|que copado|que copada|genial|joya|barbaro|de diez|un genio|una genia|que bueno)\b/.test(t)) return "gracias";
        if (/\b(nos vemos|hasta manana|hasta pronto|hasta la proxima|bye|ciao|chao|me tengo que ir|tengo que irme|ya me voy|me fui|que andes bien|que te vaya bien|cuidate|cuidense|nos pillamos)\b/.test(t)) return "despedida";
        if (/\b(de donde sos|de donde eres|cuantos anos tenes|cuantos anos tienes|vivis solo|vives solo|vivis sola|vives sola|estas solo|estas sola|tenes familia|tienes familia|hace mucho que vivis|hace mucho que vives|que haces aca|que haces aqui|que es esto|que paso aca|que paso aqui|como llegaste|como sobreviviste|sabes algo|sabes que paso)\b/.test(t)) return "pregunta";
        // regalos: "¿qué me diste?" es una pregunta, "me regalaste algo" es agradecer (no una amenaza)
        if (/\b(que|cual|cuales)\b.*\b(me|nos) (diste|regalaste|dejaste|trajiste|entregaste)\b/.test(t)) return "pregunta";
        if (/\b(me|nos) (diste|regalaste|dejaste|trajiste|entregaste)\b/.test(t)) return "gracias";
        if (/\b(tranquil\w*|calma\w*|paz|perdon\w*|disculp\w*|amigo|tranqui|no pasa nada|no tengas miedo|no quiero (pelear|problemas|hacerte)|no te (hago|voy a hacer|molesto|voy a molestar))\b/.test(t)) return "calma";
        if (/\b(ayuda\w*|auxilio|necesito|hambre|sed|agua|comida|comer|herid\w*|sangr\w*|medicina|venda\w*|por favor|porfa|me muero)\b/.test(t) && (t.split(" ").length <= 2 || hablaDeMi(texto))) return "ayuda";
        if (/\b(hola|holi|buenas|buen dia|buenos dias|buenas tardes|buenas noches|que tal|como (estas|andas|va)|ey|hey)\b/.test(t)) return "saludo";
        if (/\b(gracias|te agradezco|muy amable)\b/.test(t)) return "gracias";
        if (/\b(chau|adios|hasta luego|nos vemos|me voy|me retiro)\b/.test(t)) return "despedida";
        if (/\b(quien (sos|eres)|como te llamas|que haces|donde estoy|que es este lugar|vivis aca|vives aca)\b/.test(t)) return "pregunta";
        return "desconocido";
    }


    // ----- Vocabulario: muchas palabras por intención + tolera errores del reconocimiento + aprende solo -----
    const LEXICO_TXT = {
        amenaza: "matar mato matare mataria muerte morir morite muerete asesinar asesino degollar apunalar acuchillar disparar disparo balazo tiro pistola arma armado cuchillo navaja machete hacha golpear golpe pegar paliza reventar romper destrozar aplastar lastimar herir torturar quemar secuestrar asalto asaltar robar robo atraco plata billetera dinero entregar entrega pagar peligro cuidado acabar eliminar exterminar venganza vengarme destruir ahorcar estrangular sufrir sufriras mataste matalo matarlo matarte sangre degollado cadaver cadaveres ojo ojito atras cuidadito patada patadas trompada trompadas cachetada cachetadas piña punetazo punetazos sopapo sopapos garrote palo rompo rompote desgraciar linchar fusilar",
        insulto: "idiota estupido estupida imbecil inutil basura asqueroso asquerosa asco cagon tarado tarada pelotudo pelotuda mierda carajo puta maldito maldita inservible desgraciado desgraciada miserable cobarde gallina payaso tonto tonta bobo boba zonzo nabo burro animal bestia gordo gorda feo fea horrible patetico ridiculo estupidez cretino subnormal escoria rata cerdo puerco hediondo apestoso sucio forro mediocre fracasado perdedor boludo boluda pelotudos pavo pava nabos nabo salame zapallo chanta mugre mugroso lacra lacras basuras idiotas estupidos cabeza hueco inutiles inservibles cobardes miedoso gil gila trolo cornudo maricon maricona mamerto menso mensa menso tarugo zoquete baboso babosa asco asquerosos escupo vago vaga vagos garca sorete cabron cabrona pendejo pendeja culiao conchudo imbeciles",
        calma: "tranquilo tranquila tranqui calma calmate calmo paz pacifico amigo amiga amistad amigable perdon perdona perdoname disculpa disculpame disculpe respeto respetuoso confianza confiar confia tranquilizate relajate relajado sereno amable cordial hermano hermana companero vecino vecina senor senora buena onda lamento tranqui tranquis relax relajate paz pacifica pacificos relajados cool bien bueno buena buenos buenas onda gente genio capo maestro crack compa compadre colega parcero parce hermano hermanito hermanita viejo viejito amigos amigas cordial gentil paciencia sin drama lindo linda bonito bonita",
        ayuda: "ayuda ayudame ayudar ayudarme auxilio socorro necesito necesitar hambre hambriento hambrienta sed sediento sedienta agua comida comer beber alimento alimentar herido herida sangre sangrando sangro medicina medicamento remedio venda vendar curar doctor medico enfermo enferma fiebre dolor duele mareado cansado frio refugio abrigo favor porfa porfavor suplico ruego piedad ayudenme ayudarme auxiliame socorrame socorro perdido perdida perdi frio frios helado calor cansancio cansado cansada sueno dormir descansar bañarme banarme banio bano agua aguita comidita galletas galleta pan lata latas conserva conservas fruta manzana bebida gaseosa jugo leche cura curita curitas gasas alcohol botiquin pastilla pastillas pila pilas linterna mochila abrigo campera remera pantalon zapatillas zapatos ropa mantita manta",
        saludo: "hola holi holis ola alo buenas buenos buen dia tarde noche ey hey epa saludos bienvenido buenas buenaas wena wenas epa epale quiubo quihubo que onda onda saludo saludos bienvenidos bienvenida holaa holaaa holis hello hi",
        gracias: "gracias agradezco agradecido agradecida genial excelente buenisimo",
        despedida: "chau chao adios luego vemos retiro cuidate cuidense suerte pasala chau chauu chao ciao bye adios luego pronto manana vemos retiro cuidate cuidense suerte pasala buen viaje",
        pregunta: "quien quienes eres llamas nombre vivis vives vive donde lugar haces hacen quien quienes eres sos llamas nombre vivis vives vive donde lugar haces hacen pasa paso porque como cuando cuanto cuantos cual cuales familia solo sola edad anos mucho tiempo llegaste sobreviviste"
    };
    // Adjetivos sueltos que parecen calma pero en una frase larga suelen describir otra cosa ("el agua está linda")
    const CALMA_FLOJA = new Set(sinAcentos("lindo linda lindos lindas bonito bonita bien bueno buena buenos buenas onda gente genio capo maestro crack cool relax viejo viejito sereno cordial gentil").split(" "));
    const PRIORIDAD = ["amenaza", "insulto", "calma", "ayuda", "saludo", "gracias", "despedida", "pregunta"];
    const STOP = new Set(sinAcentos("que como para pero porque cuando esto eso esta este esa ese aquel con sin sobre entre desde hasta hay ser estar tener hacer voy vas vamos soy sos eres era fue muy mas menos tambien solo todo toda todos nada algo alguien yo vos tu te me se lo la las los le les un una unos unas del al por mis tus sus nos si no ya ahi aca alla ahora luego cual quien donde cuando tengo tenes tiene quiero queres quiere puedo podes puede").split(" "));
    function raiz(w) {
        if (w.length <= 3) return w;
        w = w.replace(/(ar|er|ir)(me|te|lo|la|se|nos|le|les)$/, "$1");      // matarte, ayudarme, degollarlo...
        for (let i = 0; i < 2; i++) {
            const r = w.replace(/(ando|iendo|aron|aste|amos|ado|ido|ar|er|ir|an|en|as|es|os|s|a|o|e)$/, "");
            if (r.length >= 3) w = r;
        }
        return w;
    }
    const LEX = {};
    PRIORIDAD.forEach(function (it) {
        LEXICO_TXT[it].split(" ").forEach(function (w) { const r = raiz(w); if (!LEX[r]) LEX[r] = it; });
    });
    const LEX_CLAVES = Object.keys(LEX);
    function distancia(a, b, max) {         // Levenshtein (corta si pasa del máximo)
        if (Math.abs(a.length - b.length) > max) return max + 1;
        let prev = [];
        for (let j = 0; j <= b.length; j++) prev.push(j);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            let min = i;
            for (let j = 1; j <= b.length; j++) {
                cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
                if (cur[j] < min) min = cur[j];
            }
            if (min > max) return max + 1;
            prev = cur;
        }
        return prev[b.length];
    }
    // Lo que aprendió de vos (se guarda en este dispositivo): { raíz: { intención: veces } }
    let APRENDIDO = {};
    try { APRENDIDO = JSON.parse(localStorage.getItem("rainster_lexico") || "{}") || {}; } catch (e) { APRENDIDO = {}; }
    function guardarAprendido() { try { localStorage.setItem("rainster_lexico", JSON.stringify(APRENDIDO)); } catch (e) {} }
    function intencionAprendida(r) {
        const a = APRENDIDO[r];
        if (!a) return null;
        let mejor = null, n = 0, total = 0;
        for (const it in a) { total += a[it]; if (a[it] > n) { n = a[it]; mejor = it; } }
        return n >= 3 && n / total >= 0.7 ? mejor : null;
    }
    // Intención de una palabra: del vocabulario, parecida a una conocida (errores de reconocimiento) o aprendida
    function intencionPalabra(w) {
        const r = raiz(w);
        if (LEX[r]) return LEX[r];
        if (w.length >= 6) {        // solo palabras largas y con la misma letra inicial: así "diste" ya no se confunde con "disparo"
            const max = w.length >= 10 ? 2 : 1;
            for (const c of LEX_CLAVES) if (c.length >= 5 && c[0] === r[0] && distancia(r, c, max) <= max) return LEX[c];
        }
        return intencionAprendida(r);
    }
    function clasificarFrase(texto) {
        const reglas = clasificarReglas(texto);
        if (reglas !== "desconocido") return reglas;
        const puntos = {};
        const pals = sinAcentos(texto).split(" ").filter(Boolean);
        const corta = pals.length <= 2, mi = hablaDeMi(texto), contigo = hablaConTigo(texto);
        pals.forEach(function (w) {
            if (w.length < 3 || STOP.has(w)) return;
            const it = intencionPalabra(w);
            if (!it) return;
            // en una frase larga: "frío", "agua" o "cansado" solo piden ayuda si hablás de vos; "plata" o "gallina" solo amenazan/insultan si es a él
            if (it === "ayuda" && !corta && !mi) return;
            if ((it === "amenaza" || it === "insulto") && !corta && !contigo) return;
            if (it === "calma" && CALMA_FLOJA.has(w) && !corta && !contigo) return;
            if (it === "saludo" && (w === "dia" || w === "tarde" || w === "noche") && !corta) return;     // "qué lindo día" no es un saludo
            puntos[it] = (puntos[it] || 0) + 1;
        });
        let mejor = "desconocido", n = 0;
        PRIORIDAD.forEach(function (it) { if ((puntos[it] || 0) > n) { n = puntos[it]; mejor = it; } });
        return mejor;
    }
    // Las palabras que no conoce y vinieron en una frase que sí entendió se van asociando a esa intención
    function aprenderDe(texto, intent) {
        const nuevas = [];
        if (intent === "desconocido") return nuevas;
        sinAcentos(texto).split(" ").forEach(function (w) {
            if (w.length < 4 || STOP.has(w) || intencionPalabra(w)) return;
            const r = raiz(w);
            const a = APRENDIDO[r] || (APRENDIDO[r] = {});
            a[intent] = (a[intent] || 0) + 1;
            if (a[intent] === 3 && intencionAprendida(r) === intent) nuevas.push(w);
        });
        if (Object.keys(APRENDIDO).length > 3000) APRENDIDO = {};       // por si crece de más
        guardarAprendido();
        return nuevas;
    }
    // Enseñar a propósito: "desgraciado significa insulto"
    function ensenar(texto) {
        const m = /^(.+?) (significa|quiere decir|quiero decir|es una?) (amenaza|insulto|calma|ayuda|saludo|gracias|despedida|pregunta)$/.exec(sinAcentos(texto));
        if (!m) return null;
        const palabras = m[1].split(" ").filter(function (w) { return w.length >= 3 && !STOP.has(w); });
        palabras.forEach(function (w) { const r = raiz(w); APRENDIDO[r] = {}; APRENDIDO[r][m[3]] = 3; });
        guardarAprendido();
        return { palabras: palabras, intent: m[3] };
    }

    // ----- Internet: Wiktionario (para entender palabras nuevas) y Wikipedia (para saber cosas) -----
    // - Una palabra que no conoce se busca en el diccionario de internet, se deduce qué intención tiene según su definición
    //   y se guarda en este dispositivo: la próxima vez ya la sabe, incluso sin conexión.
    // - Una pregunta ("¿qué es un volcán?", "¿quién fue San Martín?", "contame sobre Japón") se contesta con lo que dice Wikipedia,
    //   y después podés decir "contame más" para que siga.
    // Todo se pide directo desde el navegador (esas APIs permiten CORS), no hace falta tocar el servidor.
    const WEB_CLAVE = "rainster_web2";
    let WEB = { pal: {}, tema: {} };
    try { const g = JSON.parse(localStorage.getItem(WEB_CLAVE) || "null"); if (g && g.pal && g.tema) WEB = g; } catch (e) { WEB = { pal: {}, tema: {} }; }
    function recortarCache(obj, max, dejar) {
        const k = Object.keys(obj);
        if (k.length <= max) return;
        k.sort(function (a, b) { return (obj[a].t || 0) - (obj[b].t || 0); }).slice(0, k.length - dejar).forEach(function (c) { delete obj[c]; });
    }
    function guardarWeb() {
        recortarCache(WEB.pal, 1500, 1200);
        recortarCache(WEB.tema, 40, 30);
        try { localStorage.setItem(WEB_CLAVE, JSON.stringify(WEB)); } catch (e) {}
    }

    // Para no abusar de Wikipedia: como mucho 12 pedidos cada 15 segundos, y cada uno espera 7 s como máximo
    const webPedidos = [];
    function webPermitido() {
        const ahora = Date.now();
        while (webPedidos.length && ahora - webPedidos[0] > 15000) webPedidos.shift();
        if (webPedidos.length >= 12) return false;
        webPedidos.push(ahora);
        return true;
    }
    function pedirJSON(url) {            // devuelve el JSON, o null si no hay conexión / tardó / se pidieron demasiados
        return new Promise(function (resolver) {
            if (typeof fetch !== "function" || navigator.onLine === false || !webPermitido()) { resolver(null); return; }
            let listo = false, reloj = null;
            const ctl = typeof AbortController === "function" ? new AbortController() : null;
            const fin = function (v) { if (listo) return; listo = true; clearTimeout(reloj); resolver(v); };
            reloj = setTimeout(function () { if (ctl) { try { ctl.abort(); } catch (e) {} } fin(null); }, 7000);
            try {
                fetch(url, ctl ? { signal: ctl.signal } : {})
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(fin, function () { fin(null); });
            } catch (e) { fin(null); }
        });
    }

    // --- Wiktionario: definiciones de una palabra ---
    function limpiarWiki(t) {
        t = String(t || "").replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^>]*\/>|<!--[\s\S]*?-->/g, "");
        t = t.replace(/\{\{\s*(?:plm|ucf)\s*\|\s*([^{}|]*)[^{}]*\}\}/gi, "$1");
        for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
        t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/'{2,}/g, "").replace(/<[^>]+>/g, "");
        return t.replace(/\s+/g, " ").trim();
    }
    function definiciones(wikitext) {
        let txt = String(wikitext || "");
        const ini = txt.search(/\{\{\s*lengua\s*\|\s*es\s*\}\}/i);
        if (ini >= 0) {
            txt = txt.slice(ini + 1);
            const fin = txt.search(/\n==\s*\{\{\s*lengua\s*\|/i);
            if (fin >= 0) txt = txt.slice(0, fin);
        }
        const lista = [];
        txt.split("\n").forEach(function (l) {
            const m = /^;\s*\d+[^:]*:\s*(.+)$/.exec(l);
            if (!m) return;
            const d = limpiarWiki(m[1]);
            if (d.length >= 3) lista.push(d);
        });
        return lista.slice(0, 5);
    }
    // Sinónimos de la palabra (sección "Sinónimos" del Wiktionario): si alguno ya lo conoce, hereda su significado
    function sinonimos(wikitext) {
        let txt = String(wikitext || "");
        const ini = txt.search(/\{\{\s*lengua\s*\|\s*es\s*\}\}/i);
        if (ini >= 0) {
            txt = txt.slice(ini + 1);
            const fin = txt.search(/\n==\s*\{\{\s*lengua\s*\|/i);
            if (fin >= 0) txt = txt.slice(0, fin);
        }
        const lista = [];
        let dentro = false;
        txt.split("\n").forEach(function (l) {
            if (/^={3,}/.test(l)) { dentro = /^={3,}\s*Sin[oó]nimos?\s*={3,}/i.test(l); return; }
            if (!dentro) return;
            const re = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g;
            let m;
            while ((m = re.exec(l))) { const w = sinAcentos(m[1]); if (w && w.indexOf(" ") < 0 && lista.indexOf(w) < 0) lista.push(w); }
        });
        return lista.slice(0, 15);
    }
    // Palabras que delatan la intención en una definición: [fuertes, débiles]
    const MARCAS_DEF = {
        amenaza: [/\b(matar|asesin\w*|homicid\w*|amenaz\w*|intimid\w*|torturar|quitar la vida|disparar|atracar|asaltar)\b/g,
                  /\b(violen\w*|agred\w*|agresi\w*|golpe\w*|herir|lastimar|robar|hurtar|destruir|atacar|delito|crimen|mortal|letal|arma\w*)\b/g],
        insulto: [/\b(insult\w*|ofensiv\w*|despectiv\w*|peyorativ\w*|injuri\w*|denigr\w*|menospreci\w*|improperio|vulgarismo)\b/g,
                  /\b(ofend\w*|despreci\w*|grosero|vulgar|tonto|necio|torpe|mezquino|ruin|canalla|vil|estupid\w*|idiota|imbecil)\b/g],
        calma: [/\b(calma\w*|tranquil\w*|sosiego|serenidad|pacific\w*|perdon\w*|disculp\w*|reconcili\w*)\b/g,
                /\b(sereno|paz|apacible|amistad|amig\w*|cordial\w*|armonia|relaj\w*|clemencia|compasion|confianza)\b/g],
        ayuda: [/\b(ayud\w*|auxilio|socorro|asistencia|suplic\w*|implor\w*)\b/g,
                /\b(necesidad|necesitar|hambre|sed|enferm\w*|dolor|medicina|medicamento|remedio|alimento|herid\w*)\b/g],
        saludo: [/\b(saludo|saludar|bienvenid\w*|salutacion)\b/g, /\b(cortesia)\b/g],
        gracias: [/\b(agradec\w*|gratitud)\b/g, /(?!x)x/g],
        despedida: [/\b(despedid\w*|despedir\w*|adios)\b/g, /\b(hasta luego|hasta pronto|marcharse|separarse)\b/g],
        pregunta: [/(?!x)x/g, /(?!x)x/g]                       // las preguntas se detectan por la frase, no por definiciones
    };
    function intencionDeDefs(defs, sins) {
        const puntos = {};
        (sins || []).forEach(function (w) {                     // un sinónimo que ya conoce pesa fuerte
            const it = w.length >= 3 && !STOP.has(w) ? intencionPalabra(w) : null;
            if (it) puntos[it] = (puntos[it] || 0) + 3;
        });
        defs.forEach(function (d) {                             // "Sinónimo de X" / "Dicho de X"
            const m = /^(?:sinonimo|equivalente|variante|forma)\b.*?\bde ([a-zñ]{3,})\s*\.?$/.exec(sinAcentos(d));
            const it = m ? intencionPalabra(m[1]) : null;
            if (it) puntos[it] = (puntos[it] || 0) + 3;
        });
        defs.forEach(function (d, i) {
            const t = sinAcentos(d), peso = i === 0 ? 1.5 : 1;
            PRIORIDAD.forEach(function (it) {
                const m = MARCAS_DEF[it];
                puntos[it] = (puntos[it] || 0) + peso * (2 * (t.match(m[0]) || []).length + (t.match(m[1]) || []).length);
            });
            t.split(" ").forEach(function (w) {                 // palabras que ya conoce del vocabulario suman un poquito
                if (w.length < 4 || STOP.has(w)) return;
                const it = LEX[raiz(w)];
                if (it) puntos[it] = (puntos[it] || 0) + 0.5 * peso;
            });
        });
        let mejor = null, n = 0, segundo = 0;
        PRIORIDAD.forEach(function (it) {
            const p = puntos[it] || 0;
            if (p > n) { segundo = n; n = p; mejor = it; } else if (p > segundo) segundo = p;
        });
        return mejor && n >= 2.5 && n - segundo >= 1 ? mejor : null;
    }
    // Sentidos secundarios de una palabra (la 1ª definición manda): "perro" es un animal, pero otra acepción es "persona despreciable".
    // Solo cuenta si se lo decís A ÉL ("sos un perro"); "tengo un perro" no ofende a nadie.
    function intencionAlterna(defs) {
        const pts = { insulto: 0, amenaza: 0 };
        defs.forEach(function (d, i) {
            if (i === 0) return;
            const t = sinAcentos(d);
            ["insulto", "amenaza"].forEach(function (it) {
                pts[it] += 2 * (t.match(MARCAS_DEF[it][0]) || []).length + (t.match(MARCAS_DEF[it][1]) || []).length;
            });
            const fig = /\b(persona|dicho de una persona|hombre|mujer|individuo)\b.*\b(despreciable|ruin|vil|mala|malvada|cruel|canalla|sinverguenza|desleal|traidora?|inutil|torpe|tonta?|necia?)\b/.test(t);
            if (fig) pts.insulto += 3;
        });
        return pts.insulto >= 2 && pts.insulto >= pts.amenaza ? "insulto" : pts.amenaza >= 2 ? "amenaza" : null;
    }
    // Formas a probar en el diccionario: la palabra tal cual, sin pronombre/plural y un infinitivo posible
    function candidatosPalabra(w) {
        const c = [w];
        const a = w.replace(/(ar|er|ir)(me|te|lo|la|se|nos|le|les)$/, "$1");
        if (a !== w) c.push(a);
        else if (w.length > 4 && /s$/.test(w)) c.push(w.slice(0, -1));
        if (a !== w) { /* ya se le sacó el pronombre */ }
        else if (/(aron|aste|amos|ando|ado|ais|an|as|a|o)$/.test(w)) c.push(w.replace(/(aron|aste|amos|ando|ado|ais|an|as|a|o)$/, "") + "ar");
        else if (/(ieron|iste|iendo|ido|emos|en|es|e)$/.test(w)) c.push(w.replace(/(ieron|iste|iendo|ido|emos|en|es|e)$/, "") + "er");
        return c.filter(function (x, i) { return x.length >= 3 && c.indexOf(x) === i; }).slice(0, 3);
    }
    // Promesa -> { titulo, defs, intent } | { nada: true } (no existe) | null (no se pudo consultar)
    function consultarDiccionario(tok) {
        const cands = candidatosPalabra(tok);
        const probar = function (k) {
            if (k >= cands.length) return Promise.resolve({ nada: true });
            const url = "https://es.wiktionary.org/w/api.php?action=parse&prop=wikitext&redirects=1&format=json&formatversion=2&origin=*&page=" + encodeURIComponent(cands[k]);
            return pedirJSON(url).then(function (j) {
                if (!j) return null;
                const wt = j.parse && j.parse.wikitext;
                const crudo = typeof wt === "string" ? wt : (wt && wt["*"]) || "";
                const defs = definiciones(crudo);
                if (!defs.length) return probar(k + 1);
                return { titulo: cands[k], defs: defs, intent: intencionDeDefs(defs, sinonimos(crudo)), alt: intencionAlterna(defs) };
            });
        };
        return probar(0);
    }
    function recordarPalabraWeb(clave, intent, alt) {
        WEB.pal[clave] = { i: intent || null, a: alt || null, t: Date.now() };
        if (intent) {                                               // lo suma a lo aprendido para que lo use el clasificador de siempre
            const a = APRENDIDO[raiz(clave)] = {};
            a[intent] = 3;
            guardarAprendido();
        }
        guardarWeb();
    }
    // Promesa -> { i: significado principal, a: significado ofensivo secundario } de una palabra que no conocía
    function buscarPalabraWeb(tok) {
        const clave = sinAcentos(tok);
        const g = WEB.pal[clave];
        if (g && (g.i || g.a || Date.now() - g.t < 3 * 86400000)) return Promise.resolve({ i: g.i || null, a: g.a || null });
        return consultarDiccionario(tok).then(function (r) {
            if (!r) return { i: null, a: null };                    // sin conexión: no se anota para volver a probar
            recordarPalabraWeb(clave, r.intent, r.alt);
            return { i: r.intent || null, a: r.alt || null };
        });
    }
    // Palabras de la frase que no conoce (hasta 3, las más largas), con acentos tal como las dijiste
    function palabrasDesconocidas(texto) {
        const vistas = {}, lista = [];
        String(texto).toLowerCase().replace(/[^a-záéíóúüñ0-9\s]/g, " ").split(/\s+/).forEach(function (tok) {
            const w = sinAcentos(tok);
            if (w.length < 4 || /\d/.test(w) || STOP.has(w) || vistas[w] || intencionPalabra(w)) return;
            vistas[w] = 1;
            lista.push(tok);
        });
        return lista.sort(function (a, b) { return b.length - a.length; }).slice(0, 3);
    }
    // Promesa -> { intent, palabras } si internet le explicó alguna palabra, o null
    function entenderConInternet(lista, texto) {
        // ¿Se lo decís a él? Una palabra suelta o con "vos/sos/te/tu..." sí; "tengo un perro" no
        const aEl = String(texto || "").trim().split(/\s+/).length <= 2 || hablaConTigo(texto);
        return Promise.all(lista.map(function (tok) {
            return buscarPalabraWeb(tok).then(function (it) { return { p: tok, i: it.i || (aEl ? it.a : null) }; });
        })).then(function (res) {
            const puntos = {};
            res.forEach(function (r) { if (r.i) puntos[r.i] = (puntos[r.i] || 0) + 1; });
            let mejor = null, n = 0;
            PRIORIDAD.forEach(function (it) { if ((puntos[it] || 0) > n) { n = puntos[it]; mejor = it; } });
            return mejor ? { intent: mejor, palabras: res.filter(function (r) { return r.i; }).map(function (r) { return r.p; }) } : null;
        });
    }

    // --- Wikipedia: resumen de un tema, partido en frases ---
    function frasesDe(t) {
        t = String(t || "").replace(/\s*\([^()]*\)/g, "").replace(/\s*\([^()]*\)/g, "").replace(/\s+/g, " ").replace(/ ([,.;:])/g, "$1").trim();
        const partes = t.match(/[^.!?]+(?:[.!?]+["»”)]*|$)/g) || [];
        const frases = [];
        partes.forEach(function (p) {
            p = p.trim();
            if (!p) return;
            const ult = frases[frases.length - 1];
            if (ult && (/^[a-záéíóúñ]/.test(p) || /(?:\b[A-ZÁÉÍÓÚÑ]|\b(?:Sr|Sra|Dr|Dra|Ud|Uds|etc|aprox|núm|pág|vol|Lic|Ing|Av|Gral|Cap|Sta|Sto|EE)|\d [ad])\.$/.test(ult))) frases[frases.length - 1] = ult + " " + p;
            else frases.push(p);
        });
        return frases.filter(function (f) { return f.length >= 12; }).slice(0, 6);
    }
    function cortarHabla(t, max) {
        t = String(t || "").trim();
        if (t.length <= max) return t;
        const c = t.slice(0, max - 1), i = c.lastIndexOf(" ");
        return (i > max * 0.5 ? c.slice(0, i) : c).replace(/[,;:\s]+$/, "") + "…";
    }
    // Promesa -> { titulo, frases } | { nada: true } | null (sin conexión). "estricto": el título tiene que parecerse a lo buscado
    function resumenWiki(tema, estricto) {
        const clave = sinAcentos(tema);
        const g = WEB.tema[clave];
        if (g && g.f && g.f.length) { g.t = Date.now(); return Promise.resolve({ titulo: g.ti, frases: g.f }); }
        const url = "https://es.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&generator=search&gsrlimit=4" +
            "&prop=extracts&exintro=1&explaintext=1&exlimit=4&exsentences=6&gsrsearch=" + encodeURIComponent(tema);
        return pedirJSON(url).then(function (j) {
            if (!j) return null;
            let paginas = (j.query && j.query.pages) || [];
            if (!Array.isArray(paginas)) paginas = Object.keys(paginas).map(function (k) { return paginas[k]; });
            paginas.sort(function (a, b) { return (a.index || 99) - (b.index || 99); });
            const palabras = clave.split(" ").filter(function (w) { return w.length >= 4 && !STOP.has(w); });
            for (let i = 0; i < paginas.length; i++) {
                const p = paginas[i], ext = String(p.extract || "").trim();
                if (!ext || /(puede|pueden) (referirse|significar)|hace referencia a|desambiguaci/i.test(ext.slice(0, 220))) continue;
                const frases = frasesDe(ext);
                if (!frases.length) continue;
                if (estricto) {
                    const base = sinAcentos(p.title + " " + frases[0]);
                    if (!palabras.some(function (w) { return base.indexOf(raiz(w)) >= 0; })) continue;
                }
                WEB.tema[clave] = { ti: p.title, f: frases, t: Date.now() };
                guardarWeb();
                return { titulo: p.title, frases: frases };
            }
            return { nada: true };
        });
    }

    // --- Detectar qué quiere saber ---
    const NO_TEMA = /^(?:este|esta|esto|eso|esa|ese|aquel|aquello|aqui|aca|alla|ahi|tu|tus|vos|tuyo|usted|yo|mi|mis|que|quien|como|donde|cuando)\b/;
    function temaOriginal(texto, tema) {                  // el tema con los acentos que dijiste (Wikipedia busca mejor así)
        const o = String(texto).toLowerCase().replace(/[^a-záéíóúüñ0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ");
        const n = tema.split(" ").length;
        for (let i = o.length - n; i >= 0; i--) {
            const cand = o.slice(i, i + n).join(" ");
            if (sinAcentos(cand) === tema) return cand;
        }
        return tema;
    }
    function limpiarTema(s) {
        s = String(s || "").replace(/\b(?:por favor|porfa|por fa|nomas|che|gracias|me podes decir|me decis)\b/g, " ")
            .replace(/^(?:el|la|los|las|un|una|unos|unas|lo)\s+/, "").replace(/^(?:palabra|termino)\s+/, "").replace(/\s+/g, " ").trim();
        return s.length >= 2 && s.length <= 60 && s.split(" ").length <= 7 && !NO_TEMA.test(s) ? s : null;
    }
    const SABER_RE = [
        /^(?:y )?(?:que|quien|quienes) (?:es|son|fue|fueron|era|eran|seria|serian) (.+)$/,
        /^(?:y )?(?:que|quien|quienes) (?:sabes|conoces) (?:de|sobre|acerca de|del) (.+)$/,
        /^(?:sabes|conoces) (?:algo )?(?:de|sobre|acerca de|del|quien es|que es) (.+)$/,
        /^(?:contame|cuentame|conta|decime|dime|hablame|habla|explicame|explica|informame|ensename) (?:algo )?(?:de|sobre|acerca de|del|que es|quien es) (.+)$/,
        /^(?:donde|en donde) (?:queda|esta|estan|se encuentra|se encuentran) (.+)$/,
        /^(?:cuando|donde) (?:nacio|murio|se fundo|se creo|se invento|ocurrio|empezo|termino) (.+)$/
    ];
    // -> { tipo: "saber" | "significado" | "mas", tema } o null si no es una consulta
    function detectarConsulta(texto) {
        const t = sinAcentos(texto);
        if (!t || clasificarReglas(texto) === "pregunta") return null;
        if (memoriaWeb && /^(?:y )?(?:que )?(?:mas|algo mas|segui|sigue|continua|continuar|contame mas|cuentame mas|decime mas|dime mas|conta mas|y despues)$/.test(t)) return { tipo: "mas", tema: memoriaWeb.titulo };
        let m = /^(?:que )?(?:significa|quiere decir)(?: la palabra| el termino)? (.+)$/.exec(t) ||
                /^(?:cual es el )?(?:significado|definicion) de(?: la palabra| el termino)? (.+)$/.exec(t) ||
                /^(?:defini|define|definime|definir)(?: la palabra)? (.+)$/.exec(t);
        if (m) { const x = limpiarTema(m[1]); return x ? { tipo: "significado", tema: temaOriginal(texto, x) } : null; }
        m = /^cual es (?:la |el )?(capital|moneda|idioma|bandera|poblacion|superficie|himno|presidente|religion) (?:de|del) (.+)$/.exec(t);
        if (m) { const x = limpiarTema(m[2]); return x ? { tipo: "saber", tema: m[1] + " de " + temaOriginal(texto, x) } : null; }
        for (let i = 0; i < SABER_RE.length; i++) {
            m = SABER_RE[i].exec(t);
            if (m) { const x = limpiarTema(m[1]); return x ? { tipo: "saber", tema: temaOriginal(texto, x) } : null; }
        }
        return null;
    }

    // --- Contestar como una persona: el NPC habla (en globitos cortos, uno tras otro), sin avisos técnicos ---
    let memoriaWeb = null;                                // lo último que explicó, para "contame más": { titulo, frases, pos }
    function decirHud(texto, ms) {
        lineaVoz.textContent = texto;
        lineaVoz.style.opacity = "1";
        clearTimeout(lineaVoz.t);
        lineaVoz.t = setTimeout(function () { lineaVoz.style.opacity = "0"; }, ms || 5000);
    }
    function npcsOyentes(x, z, radio) {
        const casaH = casaDe(x, z), l = [];
        for (const n of NPCS) {
            if (n.caido) continue;
            const d = Math.hypot(n.x - x, n.z - z);
            if (d <= radio * (casaDe(n.x, n.z) === casaH ? 1 : 0.5)) l.push({ n: n, d: d });
        }
        return l.sort(function (a, b) { return a.d - b.d; });
    }
    // Quién contesta: el NPC más cercano que no esté de mal humor con vos (si todos lo están, el más cercano se niega)
    function elegirRespondedor() {
        const oy = npcsOyentes(px, pz, 12), yo = idPropio();
        if (!oy.length) return null;
        for (let i = 0; i < oy.length; i++) {
            const n = oy[i].n;
            if (n.tipo !== "agresivo" && !(n.ofendidoPor && n.ofendidoPor[yo])) return { n: n, hostil: false };
        }
        return { n: oy[0].n, hostil: true };
    }
    // Parte un texto en globitos de a lo sumo "max" letras, cortando en espacios
    function partirHabla(t, max) {
        const partes = [];
        let resto = String(t || "").replace(/\s+/g, " ").trim();
        while (resto.length > max) {
            let i = resto.lastIndexOf(" ", max - 1);
            if (i < max * 0.4) i = max;
            partes.push(resto.slice(0, i).trim());
            resto = resto.slice(i).trim();
        }
        if (resto) partes.push(resto);
        return partes;
    }
    function decirUnaVez(n, texto) {
        if (esAutoridad()) hablarNpc(n, texto, true);
        else { mostrarHablaNpc(n.i, texto); enviarRed({ tipo: "npcdice", i: n.i, t: texto }); }     // el servidor se lo muestra a los demás
    }
    // El NPC dice varias cosas seguidas (cada globito dura ~2,6 s; el servidor deja uno cada 2 s)
    function hablarSeguido(n, textos) {
        let partes = [];
        textos.forEach(function (t) { partes = partes.concat(partirHabla(t, 100)); });
        partes.slice(0, 5).forEach(function (p, i) { setTimeout(function () { decirUnaVez(n, p); }, i * 2900); });
    }
    function elegirPorTipo(n, o) { return elegirTexto(o[n.tipo] || o.pacifico); }
    const MULETILLA = {
        pacifico: ["Ah, mirá...", "Que yo sepa...", "Mmm, creo que..."],
        cobarde: ["E-eh... creo que...", "N-no sé mucho, pero..."],
        defensor: ["A ver...", "Mirá..."]
    };
    const PENSANDO = { pacifico: "Mmm... dejame pensar...", cobarde: "E-eh... a ver...", defensor: "Eh... esperá un poco..." };
    const NO_SE = {
        pacifico: ["Mmm, de eso no tengo ni idea.", "Uh, eso no lo sé, perdoname."],
        cobarde: ["N-no sé nada de eso..."], defensor: ["No sé, che. De eso no entiendo."]
    };
    const NO_ME_ACUERDO = {
        pacifico: ["Uf, ahora no me acuerdo de nada..."], cobarde: ["P-perdón, me quedé en blanco..."], defensor: ["Se me fue, no me sale ahora."]
    };
    // r: lo que encontró ({ titulo, frases } / { nada } / null si no pudo averiguar); el NPC lo cuenta con sus palabras
    function contarComoPersona(n, r, conMuletilla) {
        if (r === null) { hablarSeguido(n, [elegirPorTipo(n, NO_ME_ACUERDO)]); return; }
        if (r.nada || !r.frases || !r.frases.length) { hablarSeguido(n, [elegirPorTipo(n, NO_SE)]); return; }
        memoriaWeb = { titulo: r.titulo, frases: r.frases, pos: 0 };
        hablarSeguido(n, conMuletilla ? [elegirPorTipo(n, MULETILLA), r.frases[0]] : [r.frases[0]]);
    }
    function responderConsulta(c) {
        const quien = elegirRespondedor();
        if (!quien) { decirHud("No hay nadie cerca que te escuche", 3000); return; }
        const n = quien.n;
        if (quien.hostil) { hablarSeguido(n, ["No tengo ganas de charlar."]); return; }
        if (c.tipo === "mas") {
            const m = memoriaWeb;
            m.pos++;
            if (m.pos >= m.frases.length) { m.pos = m.frases.length; hablarSeguido(n, ["Eso es todo lo que sé de eso."]); }
            else hablarSeguido(n, [m.frases[m.pos]]);
            return;
        }
        let contesto = false;
        const reloj = setTimeout(function () { if (!contesto) { contesto = true; decirUnaVez(n, PENSANDO[n.tipo] || PENSANDO.pacifico); } }, 1500);
        const listo = function (r) { clearTimeout(reloj); setTimeout(function () { contarComoPersona(n, r, true); }, contesto ? 2900 : 0); };
        if (c.tipo === "significado") {
            consultarDiccionario(c.tema).then(function (r) {
                if (r && r.defs) {
                    recordarPalabraWeb(sinAcentos(c.tema), r.intent);        // de paso aprende la palabra
                    listo({ titulo: r.titulo, frases: r.defs });
                } else listo(r);
            });
        } else resumenWiki(c.tema, false).then(listo);
    }

    // Un NPC te regala algo: queda en el piso a su lado (y en un servidor lo ven todos)
    function darItemNpc(n, itemId, haciaX, haciaZ) {
        const d = Math.hypot(haciaX - n.x, haciaZ - n.z) || 1;
        const x = n.x + (haciaX - n.x) / d * 0.8, z = n.z + (haciaZ - n.z) / d * 0.8;
        const it = { id: itemId, x: x, y: 0.02, z: z };
        if (conexion && miId !== null) {
            it.k = "d" + miId + "_" + (++contSuelto);
            itemsRed.suel[it.k] = { id: itemId, x: x, y: it.y, z: z, c: null };
            enviarRed({ tipo: "soltar", k: it.k, id: itemId, x: x, y: it.y, z: z, c: null });
        }
        inv.mundo.push(it);
    }

    // ----- Cuando no entiende: dice QUÉ no entendió, pregunta a qué te referís y a veces te discute (según cómo es) -----
    function recortarTxt(t, max) { t = String(t || "").trim(); return t.length > max ? t.slice(0, max - 1).trim() + "…" : t; }
    function respuestaNoEntendi(n, texto) {
        const crudo = String(texto || "").replace(/[¿?¡!"“”<>]/g, " ").replace(/\s+/g, " ").trim();
        if (!crudo) return "¿Eh? No te entendí.";
        const t = sinAcentos(texto);
        const tipo = n.tipo, duro = tipo === "agresivo" || tipo === "defensor";
        const pick = elegirTexto;
        // te dijo que te sueña: le llama la atención, no es un pedido
        if (esSonarConAlguien(texto)) {
            if (tipo === "pacifico") return pick(["¿Me soñás? Qué cosa más rara... ¿y cómo son esos sueños?", "Ay, ¿en serio soñás conmigo? No sé qué decirte."]);
            if (tipo === "cobarde") return pick(["¿M-me soñás? Eso... da un poco de miedo.", "¿S-soñás conmigo? No sé si me gusta..."]);
            if (tipo === "defensor") return pick(["¿Soñás conmigo? Raro. Ni nos conocemos.", "Eso es medio raro, ¿no? No te conozco."]);
            return pick(["¿Qué? No me sueñes, ¿entendiste?", "Qué raro sos. No me soñés."]);
        }
        // te dijo que no le falta nada ("no tengo hambre", "ya comí")
        if (esNegarNecesidad(texto)) {
            if (tipo === "pacifico") return pick(["Ah, qué bueno. Igual si algo te falta, decime.", "Me alegro, entonces. Cualquier cosa avisame."]);
            if (tipo === "cobarde") return pick(["A-ah, bueno... mejor.", "Ah, ok... qué bien."]);
            if (tipo === "defensor") return pick(["Bien. Entonces no hay más que hablar.", "Perfecto. Eso te ahorra el pedido."]);
            return pick(["Mejor para vos.", "Bien. No te iba a dar nada igual."]);
        }
        // la palabra más rara/larga que dijiste (sin las palabras comunes)
        // risas: pregunta de qué te reís
        if (/\b(?:(?:j[aeiou]){2,}j?|ha(?:ha)+|he(?:he)+|lol|xd+|kkk+)\b/.test(t) && t.split(" ").length <= 3)
            return tipo === "pacifico" ? pick(["Jaja... ¿de qué te reís?", "¿Qué es tan gracioso?"]) : tipo === "cobarde" ? pick(["¿D-de qué te reís?", "¿Me... me estás cargando?"]) : pick(["¿De qué te reís?", "¿Te parece gracioso?"]);
        const IGNORAR = new Set(["significa", "signific", "sabes", "decime", "dime", "contame", "cuentame", "quiere", "decir", "palabra", "llama", "llamas", "siempre", "nunca", "todos", "nadie", "obvio", "obviamente", "seguro", "claramente", "jamas", "pero", "entonces", "bueno", "porque"]);
        const toks = crudo.split(" ").filter(function (w) { const x = sinAcentos(w); return x.length >= 4 && !STOP.has(x) && !IGNORAR.has(x) && !intencionPalabra(x); });
        toks.sort(function (a, b) { return b.length - a.length; });
        const raro = toks[0] ? recortarTxt(toks[0], 18) : "";
        let r;
        // 1) afirmaste algo ("el cielo es verde"): algunos te discuten
        const af = /^(?:que |pero )?((?:el|la|los|las|un|una|mi|tu|su) .{2,28}?|[a-z]{3,16}) (es|son|era|eran|fue|seria) (.{2,34})$/.exec(t);
        if (af && !/\?/.test(texto) && !/^(que|como|cual|quien|donde|cuando|por que)\b/.test(t) && Math.random() < (duro ? 0.7 : 0.5)) {
            const suj = af[1], verbo = af[2], pred = af[3];
            if (tipo === "pacifico") r = pick(["¿En serio " + suj + " " + verbo + " " + pred + "? A mí no me cierra...", "Mmm, no sé... ¿" + suj + " " + verbo + " " + pred + "? Yo lo vi distinto."]);
            else if (tipo === "cobarde") r = pick(["¿S-seguro que " + suj + " " + verbo + " " + pred + "? Yo no creo...", "Eh... no, no me parece que " + suj + " " + verbo + " " + pred + "."]);
            else if (tipo === "defensor") r = pick(["Ahí te equivocás: " + suj + " no " + verbo + " " + pred + ".", "¿" + suj + " " + verbo + " " + pred + "? Dejate de decir cosas."]);
            else r = pick(["¿" + suj + " " + verbo + " " + pred + "? Qué estupideces decís.", "Estás equivocado, " + suj + " no " + verbo + " " + pred + "."]);
            return recortarTxt(r, 100);
        }
        // 2) opinaste con algo tajante ("siempre", "nunca", "todos", "obvio"...): te lo discuten
        const tajante = /\b(siempre|nunca|todos|nadie|obvio|obviamente|seguro|claramente|jamas)\b/.exec(t);
        if (tajante && Math.random() < 0.6) {
            const k = tajante[1];
            if (tipo === "pacifico") r = pick(["¿\"" + k + "\"? Yo no diría tanto, siempre hay excepciones.", "No sé, decir \"" + k + "\" es medio exagerado, ¿no?"]);
            else if (tipo === "cobarde") r = pick(["¿\"" + k + "\"? Eh... no sé si es tan así.", "D-decir \"" + k + "\" es mucho... digo, creo."]);
            else r = pick(["¿\"" + k + "\"? Eso no es verdad y lo sabés.", "No me vengas con \"" + k + "\", no es así."]);
            return recortarTxt(r, 100);
        }
        // 3) preguntaste algo que no sabe
        if (/\?/.test(texto) || /^(que|como|cual|cuales|quien|quienes|donde|cuando|cuanto|por que|para que)\b/.test(t)) {
            if (raro) r = tipo === "pacifico" ? pick(["Uf, de \"" + raro + "\" no sé nada. ¿Por qué lo preguntás?", "Eso de \"" + raro + "\"... ni idea. ¿Para qué lo querés saber?"])
                : tipo === "cobarde" ? pick(["N-no sé qué es \"" + raro + "\"... perdón.", "¿\"" + raro + "\"? No sé nada de eso, de verdad."])
                : pick(["¿Y yo cómo voy a saber de \"" + raro + "\"?", "No sé de \"" + raro + "\" ni me importa."]);
            else r = tipo === "pacifico" ? "Mmm, esa no te la sé contestar. ¿A qué te referís?" : tipo === "cobarde" ? "N-no sé qué responderte..." : "Qué pregunta rara. No sé.";
            return recortarTxt(r, 100);
        }
        // 4) no entendió una palabra: lo dice y pide que se lo expliques
        if (raro) {
            if (tipo === "pacifico") r = pick(["¿Lo de \"" + raro + "\"? No sé a qué te referís, ¿me lo explicás?", "Perdón, no te seguí con \"" + raro + "\". ¿Qué querés decir?", "Se me escapó lo de \"" + raro + "\", ¿me lo decís de otra forma?"]);
            else if (tipo === "cobarde") r = pick(["¿L-lo de \"" + raro + "\"? No te sigo...", "E-eso de \"" + raro + "\"... no entiendo qué querés decir."]);
            else if (tipo === "defensor") r = pick(["¿Lo de \"" + raro + "\"? Hablá claro, que no te sigo.", "No entiendo qué tiene que ver \"" + raro + "\". Explicate."]);
            else r = pick(["¿\"" + raro + "\"? ¿Qué querés decir con eso?", "Hablá bien. ¿Qué pasa con \"" + raro + "\"?"]);
            return recortarTxt(r, 100);
        }
        // 4b) comentario sobre el lugar o el clima ("el agua está linda", "qué día horrible"): no es para él, pero se contesta como charla
        if (/\b(linda|lindo|bonita|bonito|hermosa|hermoso|fea|feo|horrible|fria|frio|calor|lindo dia|dia)\b/.test(t) && /\b(el|la|los|las|que|esta|esta|hace|hoy|se ve|este|esta)\b/.test(t) && !/\b(vos|tu|tus|usted|ustedes)\b/.test(t)) {
            if (tipo === "pacifico") r = pick(["Y sí... por lo menos algo lindo queda, ¿no?", "Mmm, puede ser. Cuesta ver lo bueno, pero algo hay."]);
            else if (tipo === "cobarde") r = pick(["S-sí, supongo... si no pasa nada raro.", "Eh... sí, puede ser."]);
            else if (tipo === "defensor") r = pick(["Puede ser. Pero no te quedes mirando mi casa.", "Sí, sí. ¿Y vos qué querés?"]);
            else r = pick(["¿Y a mí qué me importa?", "No vine a charlar del clima."]);
            return recortarTxt(r, 100);
        }
        // 5) frase corta o sin palabras raras
        const corta = recortarTxt(crudo, 30);
        if (crudo.split(" ").length <= 2) r = pick(["¿\"" + corta + "\"? ¿Y eso qué quiere decir?", "¿Solo \"" + corta + "\"? Contame un poco más."]);
        else r = pick(["Se me perdió el hilo con \"" + corta + "\"... ¿me lo repetís?", "No te seguí con lo de \"" + corta + "\". ¿Qué querías decir?"]);
        if (duro) r = pick(["No te entendí nada. Hablá claro.", "¿Qué decís? Repetilo bien."]);
        return recortarTxt(r, 100);
    }

    // ----- Memoria de los NPCs: se guarda con la partida (offline) para que te recuerden al volver -----
    // Los tiempos se guardan como "hace cuánto" (performance.now() arranca de cero en cada sesión).
    function exportarMemoriaNpcs() {
        const ahoraMs = performance.now(), lista = [];
        NPCS.forEach(function (n) {
            const e = { i: n.i };
            let hay = false;
            if (n.dio) { e.dio = 1; e.dioItem = n.dioItem || null; e.dioHace = n.dioT ? Math.max(0, Math.round(ahoraMs - n.dioT)) : 0; hay = true; }
            const gol = Object.keys(n.golpeadoPor || {}).filter(function (k) { return n.golpeadoPor[k]; });
            const ofe = Object.keys(n.ofendidoPor || {}).filter(function (k) { return n.ofendidoPor[k]; });
            if (gol.length) { e.gol = gol; hay = true; }
            if (ofe.length) { e.ofe = ofe; hay = true; }
            const conf = {};
            for (const k in (n.confPor || {})) { const c = n.confPor[k]; if (c && c.v > 0) conf[k] = { v: c.v, hace: Math.max(0, Math.round(ahoraMs - c.t)) }; }
            if (Object.keys(conf).length) { e.conf = conf; hay = true; }
            const memo = {};
            for (const k in (n.memo || {})) { const m = n.memo[k]; if (m && m.ult) memo[k] = { ult: m.ult, hace: Math.max(0, Math.round(ahoraMs - m.t)), den: m.den || 0 }; }
            if (Object.keys(memo).length) { e.memo = memo; hay = true; }
            if (hay) lista.push(e);
        });
        return lista;
    }
    function importarMemoriaNpcs(datos) {
        const ahoraMs = performance.now();
        NPCS.forEach(function (n) {                       // arranca de cero: no arrastra lo de otra partida con el mismo mapa
            n.dio = false; n.dioItem = null; n.dioT = 0;
            n.golpeadoPor = {}; n.ofendidoPor = {}; n.confPor = {}; n.memo = {};
            n.calmaPor = {}; n.asustadoPor = {};
        });
        if (!Array.isArray(datos)) return;
        const num = function (v, max) { v = +v; return isFinite(v) ? Math.max(0, Math.min(max, v)) : 0; };
        datos.slice(0, 500).forEach(function (e) {
            const n = e && NPCS[e.i];
            if (!n) return;
            if (e.dio) { n.dio = true; n.dioItem = e.dioItem === "agua" || e.dioItem === "comida" ? e.dioItem : null; n.dioT = ahoraMs - num(e.dioHace, 1e12); }
            (Array.isArray(e.gol) ? e.gol : []).slice(0, 20).forEach(function (k) { n.golpeadoPor[String(k)] = true; });
            (Array.isArray(e.ofe) ? e.ofe : []).slice(0, 20).forEach(function (k) { n.ofendidoPor[String(k)] = true; });
            for (const k in (e.conf || {})) { const c = e.conf[k]; if (c) n.confPor[k] = { v: Math.min(6, num(c.v, 6)), t: ahoraMs - num(c.hace, 1e12) }; }
            for (const k in (e.memo || {})) {
                const m = e.memo[k];
                if (m && INTENCIONES_OK.indexOf(m.ult) >= 0) n.memo[k] = { ult: m.ult, t: ahoraMs - num(m.hace, 1e12), den: num(m.den, 10), denT: 0 };
            }
        });
    }
    window.MemoriaNpcs = { exportar: exportarMemoriaNpcs, importar: importarMemoriaNpcs };

    // Qué hace un NPC que te oyó, según lo que dijiste y cómo es él (solo lo corre quien maneja a los NPCs)
    function reaccionNpc(n, idJ, intent, grito, primero, x, z, texto) {
        const ahoraMs = performance.now();
        const hab = function (t) { if (primero) hablarNpc(n, t, true); };
        const tipo = n.tipo;
        const duro = tipo === "agresivo" || tipo === "defensor";
        // Memoria: de qué hablaron la última vez y hace cuánto (por NPC y por jugador), para no contestar siempre como la primera vez
        if (!n.memo) n.memo = {};
        const mem = n.memo[idJ] || (n.memo[idJ] = { ult: null, t: 0, den: 0, denT: 0 });
        const ult = mem.ult, hace = ahoraMs - mem.t;
        const peleaReciente = (ult === "amenaza" || ult === "insulto") && hace < 90000;
        mem.t = ahoraMs;
        if (intent !== "desconocido") mem.ult = intent;
        // Confianza: no se gana con una sola frase. Sube de a 1 (como mucho cada 8 s) si le hablás bien, se enfría con el tiempo
        // (-1 por minuto) y se pierde del todo si lo amenazás, insultás o golpeás.
        if (!n.confPor) n.confPor = {};
        const confianza = function () {
            const c = n.confPor[idJ];
            return c ? Math.max(0, c.v - Math.floor((ahoraMs - c.t) / 60000)) : 0;
        };
        const ganarConfianza = function () {
            const c = n.confPor[idJ];
            if (c && ahoraMs - c.t < 8000) return;           // repetir lo mismo rápido no suma
            n.confPor[idJ] = { v: Math.min(6, confianza() + 1), t: ahoraMs };
        };
        const dar = function () {
            if (n.dio) { hab("Ya te di lo que tenía."); return; }
            n.dio = true; n.dioT = ahoraMs;
            n.dioItem = elegirTexto(["agua", "comida"]);
            darItemNpc(n, n.dioItem, x, z);
            hab("Tomá, llevate esto.");
        };
        // gritar enoja o asusta, y no calma a nadie
        if (grito && intent !== "amenaza" && intent !== "insulto" && intent !== "ayuda") {      // gritar "¡ayuda!" es normal: ahí sí contesta
            if (duro) hab("¡Y a mí no me grités!");
            else { n.asustadoPor[idJ] = ahoraMs + 6000; hab("¡No grites, por favor!"); }
            return;
        }
        switch (intent) {
            case "amenaza":
                delete n.calmaPor[idJ]; delete n.confPor[idJ];
                if (duro) { n.ofendidoPor[idJ] = true; hab(elegirTexto(["¿Me estás amenazando en mi casa?", "¡Ahora sí te la busqué!"])); }
                else { n.asustadoPor[idJ] = ahoraMs + 10000; hab(tipo === "cobarde" ? "¡No, por favor, no!" : "Tranquilo... no quiero problemas."); }
                break;
            case "insulto":
                delete n.confPor[idJ];
                if (duro) { n.ofendidoPor[idJ] = true; delete n.calmaPor[idJ]; hab("¿Qué dijiste?"); }
                else if (tipo === "cobarde") hab("Eso... eso no se dice.");
                else hab("No hace falta insultar.");
                break;
            case "calma": {
                delete n.asustadoPor[idJ];
                if (peleaReciente) {            // recién lo amenazaste o insultaste: no se la cree todavía
                    hab(tipo === "pacifico" ? "Recién me dijiste cosas feas... dame un rato." : tipo === "cobarde" ? "H-hace nada me asustaste..." : "Hace un segundo me amenazabas. No te creo.");
                    break;
                }
                ganarConfianza();
                const c = confianza();
                if (tipo === "agresivo") {
                    if (c >= 4) { n.calmaPor[idJ] = ahoraMs + 12000; hab("Mmm... más te vale."); }
                    else hab(elegirTexto(["No te creo nada.", "Hablás lindo, pero no te conozco."]));
                } else if (tipo === "defensor") {
                    if (c >= 3) { n.calmaPor[idJ] = ahoraMs + 20000; hab("Bueno... pero no toques nada."); }
                    else hab(elegirTexto(["Mmm. Eso dicen todos.", "Veremos. Mirá sin tocar."]));
                } else if (tipo === "cobarde") {
                    if (c >= 2) { n.calmaPor[idJ] = ahoraMs + 15000; delete n.golpeadoPor[idJ]; hab("¿D-de verdad? ...bueno."); }
                    else hab(elegirTexto(["N-no sé... no te conozco.", "¿Seguro? Es que me da miedo..."]));
                } else {
                    if (c >= 2) { delete n.golpeadoPor[idJ]; hab("Gracias, se agradece."); }
                    else hab(elegirTexto(["Mmm, está bien... gracias.", "Ojalá, eh. Todavía no te conozco."]));
                }
                break;
            }
            case "ayuda": {
                // se ayuda a quien ya se ganó la confianza (saludar, hablar bien, agradecer); a quien lastimó u ofendió, no
                if (n.dio) { hab("Ya te di lo que tenía."); break; }
                if (n.golpeadoPor[idJ] || n.ofendidoPor[idJ]) { hab("Después de lo que hiciste, no te pienso ayudar."); break; }
                const c = confianza();
                if (tipo === "agresivo") hab("¡No te voy a dar nada!");
                else if (c >= (tipo === "pacifico" ? 2 : tipo === "cobarde" ? 3 : 4)) dar();
                else {
                    // pedir una y otra vez no sirve: a la tercera lo toma a mal y pierde confianza
                    mem.den = ahoraMs - mem.denT < 60000 ? mem.den + 1 : 1;
                    mem.denT = ahoraMs;
                    if (mem.den >= 3) {
                        n.confPor[idJ] = { v: Math.max(0, c - 1), t: ahoraMs };
                        hab(tipo === "pacifico" ? "Ya te dije... no insistas, que me incomodás." : tipo === "cobarde" ? "P-por favor, no insistas..." : "Ya te dije que no. No insistas.");
                    } else if (mem.den === 2) {
                        hab(tipo === "pacifico" ? "Ya te dije: primero charlemos un poco." : tipo === "cobarde" ? "Y-ya te dije que no te conozco..." : "Ya te contesté.");
                    } else if (tipo === "pacifico") hab(elegirTexto(["Mmm... recién te conozco. Charlemos un poco primero.", "¿Y vos quién sos? Contame algo antes de pedirme."]));
                    else if (tipo === "cobarde") hab(elegirTexto(["N-no sé... no te conozco. No me pidas cosas.", "P-perdón, no tengo mucho para dar..."]));
                    else hab(elegirTexto(["¿Y vos quién sos para pedirme cosas?", "Mmm... no tengo para andar regalando."]));
                }
                break;
            }
            case "saludo":
                if (peleaReciente) {
                    hab(tipo === "pacifico" ? "¿Ahora me saludás? Después de lo que dijiste..." : tipo === "cobarde" ? "H-hola... pero me asustaste." : tipo === "defensor" ? "No me vengas con saludos después de eso." : "¿Ahora saludás? Andate.");
                } else if (ult === "saludo" && hace < 120000) {          // ya se saludaron hace un rato: no suma confianza repetirlo
                    hab(tipo === "pacifico" ? "Ya nos saludamos, jaja. ¿Necesitás algo?" : tipo === "cobarde" ? "Y-ya me saludaste..." : "Ya te escuché. ¿Qué querés?");
                } else {
                    ganarConfianza();
                    if (ult && hace > 180000 && tipo === "pacifico") hab("¡Volviste! ¿Cómo andás?");
                    else hab(tipo === "pacifico" ? "¡Hola! ¿Todo bien?" : tipo === "cobarde" ? "H-hola..." : tipo === "defensor" ? "Buenas. Mirá sin tocar." : "¿Qué querés?");
                }
                break;
            case "gracias":
                if (!(ult === "gracias" && hace < 120000)) ganarConfianza();
                if (n.dio && n.dioT && ahoraMs - n.dioT < 60000) hab(tipo === "pacifico" ? "De nada. Cuidalo, que no sobra." : "Sí, sí. No lo desperdicies.");
                else hab(tipo === "pacifico" ? "De nada, por favor." : "Sí, sí.");
                break;
            case "despedida":
                hab(tipo === "pacifico" ? "Chau, cuidate mucho." : tipo === "agresivo" ? "Y no vuelvas." : "Chau.");
                break;
            case "pregunta":
                if (n.dio) { hab("Te di " + (n.dioItem || "lo que tenía") + ". Cuidalo, no sobra."); break; }
                hab(tipo === "pacifico" ? "Vivo acá, ¿y vos?" : tipo === "cobarde" ? "Y-yo solo vivo acá..." : "Eso no te importa.");
                break;
            default:
                hab(respuestaNoEntendi(n, texto));
        }
    }

    // Alguien (en x, z) dijo algo con tal volumen: lo oyen los NPCs dentro del alcance (las paredes lo achican a la mitad)
    function reaccionarVoz(idJ, x, z, intent, radio, grito, texto) {
        if (INTENCIONES_OK.indexOf(intent) < 0 || !(radio > 0) || typeof x !== "number" || typeof z !== "number") return;
        const casaH = casaDe(x, z);
        const oyentes = [];
        for (const n of NPCS) {
            if (n.caido) continue;
            const d = Math.hypot(n.x - x, n.z - z);
            if (d <= radio * (casaDe(n.x, n.z) === casaH ? 1 : 0.5)) oyentes.push({ n: n, d: d });
        }
        oyentes.sort(function (a, b) { return a.d - b.d; });
        oyentes.forEach(function (o, i) { reaccionNpc(o.n, idJ, intent, !!grito, i === 0, x, z, texto); });
    }

    // Lo que dijiste (por voz o escrito): se interpreta y se manda a quien maneja a los NPCs
    // Lo último que se entendió (para que un "sí" o un "te lo juro" retome ese tema)
    let ultimaIntencion = { intent: null, t: 0 };
    function esConfirmacion(texto) {
        return /^(?:(?:si|sii+|sip|claro|obvio|obviamente|seguro|por supuesto|de verdad|en serio|de una|dale|ya te dije|te lo juro|lo juro|te lo prometo|lo prometo|palabra|jurado|confia|confia en mi|creeme|cree en mi)(?: que si| de verdad| en serio| te lo juro| te lo prometo)?\s*)+$/.test(sinAcentos(texto));
    }
    function procesarFrase(texto, escrito) {
        texto = String(texto || "").trim().slice(0, 140);
        if (!texto || !sv.activo || !sv.vivo) return;
        const leccion = ensenar(texto);
        if (leccion) {
            decirHud("🧠 Aprendí: " + leccion.palabras.join(", ") + " = " + NOMBRE_INTENCION[leccion.intent], 5000);
            return;
        }
        const radio = escrito ? 8 : Math.max(6, voz.pico);          // hablando se usa el volumen reciente de tu micrófono
        const grito = !escrito && radio >= 17 && voz.vozT >= 3;
        // ¿Quiere saber algo? ("¿qué es un volcán?", "contame sobre Japón", "contame más"): se contesta con lo que dice internet
        const consulta = detectarConsulta(texto);
        if (consulta) { responderConsulta(consulta); return; }
        // "te sueño" / "soñé con vos": no es un pedido de ayuda. Se manda como frase sin clasificar y cada NPC contesta según cómo es
        if (esSonarConAlguien(texto)) { terminarFrase(texto, "desconocido", radio, grito, ""); return; }
        if (esNegarNecesidad(texto)) { terminarFrase(texto, "desconocido", radio, grito, ""); return; }
        // "¿De verdad?" -> "Sí": si hace poco dijiste algo claro, la confirmación vale por ese mismo tema
        if (esConfirmacion(texto) && ultimaIntencion.intent && performance.now() - ultimaIntencion.t < 30000 &&
            ["calma", "ayuda", "amenaza"].indexOf(ultimaIntencion.intent) >= 0) {
            terminarFrase(texto, ultimaIntencion.intent, radio, grito, " (confirmando)"); return;
        }
        const intent = clasificarFrase(texto);
        if (intent !== "desconocido") { terminarFrase(texto, intent, radio, grito, ""); return; }
        // No la entiende: busca en internet (sin avisar) las palabras que no conoce y, si es algo corto, si es un tema conocido
        const lista = palabrasDesconocidas(texto);
        // Internet solo sirve para interpretar: si no preguntaste nada ("¿qué es...?", "contame sobre..."), nunca suelta datos
        if (!lista.length) { terminarFrase(texto, "desconocido", radio, grito, ""); return; }
        entenderConInternet(lista, texto).then(function (r) {
            terminarFrase(texto, r ? r.intent : "desconocido", radio, grito, "");
        });
    }
    // Ya sabe qué quisiste decir: lo anota, lo muestra y los NPCs reaccionan
    function terminarFrase(texto, intent, radio, grito, extra) {
        if (intent !== "desconocido") ultimaIntencion = { intent: intent, t: performance.now() };
        const nuevas = aprenderDe(texto, intent);
        decirHud("Dijiste: “" + texto + "” → " + NOMBRE_INTENCION[intent] + (grito ? " (gritando)" : "") + (extra || "") +
            (nuevas.length ? " · 🧠 aprendí: " + nuevas.join(", ") : ""), 5000);
        if (esAutoridad()) reaccionarVoz(idPropio(), px, pz, intent, radio, grito, texto);
        else enviarRed({ tipo: "vozdice", intent: intent, r: radio, g: grito ? 1 : 0, t: intent === "desconocido" ? texto : "" });
    }

    function iniciarReconocimiento() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { avisar("Este navegador no reconoce voz: usá el botón 💬 para escribirles", 4000); return; }
        const idiomas = ["es-AR", "es-419", "es-ES", "es"];      // si el celular no tiene uno, prueba con el siguiente
        let iIdioma = 0, fallos = 0, ultimoTexto = "", ultimoT = 0;
        const lanzar = function () {
            if (!voz.activo) return;
            let rec;
            try { rec = new SR(); } catch (e) { voz.rec = null; return; }
            rec.lang = idiomas[iIdioma];
            rec.continuous = true;
            rec.interimResults = true;                             // muestra lo que va entendiendo mientras hablás
            rec.maxAlternatives = 1;
            const hechos = {};                                     // algunos celulares repiten los resultados ya terminados
            rec.onstart = function () { voz.estado = "escuchando…"; };
            rec.onresult = function (e) {
                let parcial = "";
                fallos = 0;
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    const r = e.results[i], txt = String(r[0].transcript || "").trim();
                    if (!txt) continue;
                    if (!r.isFinal) { parcial += txt + " "; continue; }
                    const clave = i + "|" + txt;
                    if (hechos[clave]) continue;
                    hechos[clave] = true;
                    const ahora = performance.now();
                    if (txt === ultimoTexto && ahora - ultimoT < 2500) continue;
                    ultimoTexto = txt; ultimoT = ahora;
                    procesarFrase(txt, false);
                }
                if (parcial.trim()) decirHud("🎤 " + parcial.trim(), 2500);
            };
            rec.onerror = function (e) {
                const c = e && e.error;
                if (c === "not-allowed" || c === "service-not-allowed") {
                    avisar("No hay permiso para el micrófono: activalo en los ajustes del navegador, o usá el botón 💬", 5000);
                    voz.estado = "sin permiso";
                    voz.rec = null; fallos = 99;
                } else if (c === "language-not-supported") {
                    if (iIdioma < idiomas.length - 1) iIdioma++;
                } else if (c === "network") {
                    avisar("El reconocimiento de voz necesita internet", 3500);
                    voz.estado = "sin internet"; fallos++;
                } else if (c === "audio-capture") {
                    avisar("No pude captar el micrófono (¿otra app lo está usando?)", 4000);
                    voz.estado = "sin micrófono"; fallos++;
                }                                                  // "no-speech" y "aborted" son normales: se reinicia solo
            };
            rec.onend = function () {
                if (!voz.activo || voz.rec !== rec) return;
                if (fallos >= 6) { avisar("Se cortó el micrófono. Probá de nuevo o usá el botón 💬", 4000); desactivarMicrofono(); return; }
                setTimeout(lanzar, 300);                           // el celular corta cada tanto: se vuelve a abrir
            };
            voz.rec = rec;
            try { rec.start(); } catch (e) { fallos++; setTimeout(lanzar, 600); }
        };
        lanzar();
    }
    function detenerReconocimiento() {
        const rec = voz.rec;
        voz.rec = null;
        if (rec) { rec.onend = null; try { rec.stop(); } catch (e) {} }
    }
    // ----- Escribirles a los NPCs con el teclado: Enter abre el cuadro, Enter envía y Esc cancela -----
    // No se suelta el mouse (si no, el juego se pausa): el cuadro toma el teclado y el personaje se queda quieto mientras escribís.
    const cajaChat = document.createElement("div");
    cajaChat.style.cssText = "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:795;display:none;width:min(520px,90vw);" +
        "background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.4);border-radius:10px;padding:8px 10px;box-sizing:border-box;";
    const campoChat = document.createElement("input");
    campoChat.type = "text";
    campoChat.maxLength = 140;
    campoChat.autocomplete = "off";
    campoChat.spellcheck = false;
    campoChat.placeholder = "Escribile a los NPCs que tengas cerca…  (Enter: enviar · Esc: cancelar)";
    campoChat.style.cssText = "width:100%;box-sizing:border-box;background:#111;color:#fff;border:1px solid #666;border-radius:6px;padding:.5rem .65rem;font:16px sans-serif;outline:none;";
    cajaChat.appendChild(campoChat);
    document.body.appendChild(cajaChat);
    window.chatAbierto = false;
    function abrirChat() {
        if (window.chatAbierto || window.juegoPausado || !sv.activo || !sv.vivo) return;
        window.chatAbierto = true;
        if (window.soltarControles) window.soltarControles();        // por si venías caminando
        cajaChat.style.display = "block";
        campoChat.value = "";
        setTimeout(function () { campoChat.focus(); }, 0);
    }
    function cerrarChat() {
        if (!window.chatAbierto) return;
        window.chatAbierto = false;
        cajaChat.style.display = "none";
        campoChat.blur();
    }
    campoChat.addEventListener("keydown", function (e) {
        e.stopPropagation();                                          // lo que escribís no mueve al personaje ni dispara otras teclas
        if (e.key === "Enter") {
            e.preventDefault();
            const t = campoChat.value.trim();
            cerrarChat();
            if (t) procesarFrase(t, true);
        } else if (e.key === "Escape") { e.preventDefault(); cerrarChat(); }
    });
    campoChat.addEventListener("keyup", function (e) { e.stopPropagation(); });
    window.addEventListener("keydown", function (e) {
        if ((e.code !== "Enter" && e.code !== "NumpadEnter") || e.repeat) return;
        if (window.chatAbierto || window.juegoPausado || !sv.activo || !sv.vivo || inv.abierto) return;
        const a = document.activeElement;
        if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
        e.preventDefault();
        abrirChat();
    });
    document.addEventListener("pointerlockchange", function () { if (!document.pointerLockElement) cerrarChat(); });    // Esc / pausa
    botonTexto.addEventListener("click", function () { botonTexto.blur(); abrirChat(); });

    function actualizarVoz(dt) {
        const visible = !!sv.activo;
        if (cajaVoz.style.display !== (visible ? "block" : "none")) cajaVoz.style.display = visible ? "block" : "none";
        if (!voz.activo) { if (botonVoz.textContent !== "🎤 Voz: off") botonVoz.textContent = "🎤 Voz: off"; return; }
        if (!sv.activo) { desactivarMicrofono(); return; }

        if (!voz.medidor) {                        // celular: no se mide el volumen, siempre se habla "normal" (8 m, nunca gritando)
            voz.radio = 8; voz.pico = 8; voz.nivel = 0.33; voz.vozT = 0;
        } else {
        // volumen del cuadro (RMS en decibeles)
        voz.analizador.getFloatTimeDomainData(voz.buf);
        let suma = 0;
        for (let i = 0; i < voz.buf.length; i++) suma += voz.buf[i] * voz.buf[i];
        const db = 20 * Math.log10(Math.max(Math.sqrt(suma / voz.buf.length), 1e-5));

        // ruido de fondo: al principio se calibra rápido; después baja rápido y sube muy de a poco
        if (voz.calib > 0) { voz.calib -= dt; voz.sueloDb += (db - voz.sueloDb) * Math.min(1, dt * 4); }
        else voz.sueloDb += (db - voz.sueloDb) * Math.min(1, dt * (db < voz.sueloDb ? 2 : 0.05));

        // El volumen se mide contra TU voz normal (cada micrófono y cada persona es distinta; antes hablar normal ya contaba como grito):
        // hablar como siempre ≈ 8 m, susurrar ≈ 2 m y gritar (unos 9 dB más fuerte que de costumbre) ≈ 17 a 20 m
        const piso = Math.max(voz.sueloDb + 8, -55);
        voz.env = Math.max(db, voz.env - 8 * dt);                     // envolvente: sube enseguida, baja de a poco (entre sílabas no se hunde)
        if (voz.calib <= 0 && voz.habla === null) voz.habla = Math.max(voz.sueloDb + 38, -40);     // al principio supone una voz fuerte: mejor no detectar un grito que inventarlo
        const hayVoz = voz.calib <= 0 && voz.env > piso + 4;           // hay voz, no solo ruido de fondo
        if (hayVoz) {
            voz.vozT += dt;
            // lo primero que decís (2 s de voz) define tu volumen "de siempre"; después se ajusta de a poco
            // (rápido si hablás más bajo, despacio si hablás más fuerte: así un grito no se vuelve lo normal)
            if (voz.vozT < 2) voz.habla += (voz.env - voz.habla) * Math.min(1, dt * 3);
            else voz.habla += (Math.min(voz.env, voz.habla + 5) - voz.habla) * Math.min(1, dt * (voz.env < voz.habla ? 0.6 : 0.2));
        }
        const radioAhora = hayVoz ? Math.max(2, Math.min(20, 8 + (voz.env - voz.habla))) : 0;
        const objetivo = radioAhora ? (radioAhora - 2) / 18 : 0;
        voz.nivel += (objetivo - voz.nivel) * Math.min(1, dt * (objetivo > voz.nivel ? 20 : 3));
        voz.radio = voz.nivel > 0.05 ? 2 + voz.nivel * 18 : 0;       // susurro ~2 m, hablar ~8 m, grito ~20 m
        // un grito de verdad dura un rato: un golpe, un carraspeo o un portazo (decenas de ms) no cuentan, ni tampoco antes de conocer tu voz
        voz.altoT = db > voz.habla + 7 ? voz.altoT + dt : Math.max(0, voz.altoT - dt * 0.5);
        const radioVale = voz.radio >= 17 && (voz.altoT < 0.3 || voz.vozT < 3) ? 16.9 : voz.radio;
        // el reconocimiento de voz contesta un rato después de hablar: se acuerda del volumen más alto de los últimos 5 s
        const tAhora = performance.now();
        if (radioVale >= voz.pico || tAhora - voz.picoT > 5000) { voz.pico = radioVale; voz.picoT = tAhora; }
        }

        // qué NPCs te oyen
        const miCasa = casaDe(px, pz);
        let oyen = 0;
        for (const n of NPCS) {
            if (n.caido) { n.oyeVoz = false; continue; }
            const d = Math.hypot(n.x - px, n.z - pz);
            const alcance = voz.radio * (casaDe(n.x, n.z) === miCasa ? 1 : 0.5);
            n.distVoz = d;
            n.oyeVoz = alcance > 0 && d <= alcance;
            if (n.oyeVoz) oyen++;
        }
        voz.oyen = oyen;

        voz.acumHud += dt;
        if (voz.acumHud >= 0.1) {
            voz.acumHud = 0;
            const barras = Math.round(voz.nivel * 8);
            if (!voz.medidor) botonVoz.textContent = "🎤 " + (voz.estado || "escuchando…") + " · te oyen: " + oyen;
            else botonVoz.textContent = voz.calib > 0 ? "🎤 calibrando…" :
                "🎤 " + "▮".repeat(barras) + "▯".repeat(8 - barras) + " " + voz.radio.toFixed(0) + " m · te oyen: " + oyen;
        }
    }

    // ----- Paso del tiempo -----
    // msReales = milisegundos reales del cuadro. Devuelve el multiplicador de velocidad.
    function actualizarSupervivencia(dt, msReales) {
        if (!sv.activo) return 1;
        if (!sv.vivo) return 0;

        const dtSeg = Math.min(msReales, 1000) / 1000;
        const accel = sv.dormido ? SV_CONFIG.aceleracionDormir : 1;
        const dtDias = Math.min(msReales, 1000) / DIA_JUEGO_MS * accel;

        // Estación: el verano da más sed, el invierno menos
        let modSed = 1;
        if (estacionesJuego.activo && estacionesJuego.reloj) {
            modSed = estadoEstacion().estacion.modificadores.sed;
        }

        // Temperatura: el cuerpo se va acercando a la sensación térmica; el calor da más sed
        sv.temp += (tempSensacion() - sv.temp) * Math.min(1, 24 * dtDias);
        const nT = nivelTemp();
        if (nT > 0) modSed *= [1, 1.25, 1.6, 2][nT];

        sv.sed = clamp(sv.sed - 100 / SV_CONFIG.sedDias * dtDias * modSed, 0, 100);
        sv.hambre = clamp(sv.hambre - 100 / SV_CONFIG.hambreDias * dtDias, 0, 100);

        // Con mucho frío te resfriás
        if (nT <= -2 && !sv.enf.some(function (x) { return x.id === "resfrio"; }) && Math.random() < 0.6 * dtDias) {
            enfermar("resfrio");
            avisar("Te resfriaste", 2500);
        }

        // Sueño
        if (sv.dormido) {
            sv.sueno = clamp(sv.sueno + SV_CONFIG.recuperaSuenoPorSeg * dtSeg, 0, 100);
            if (sv.sueno >= 100) { despertar(); avisar("Despertaste descansado"); }
        } else {
            sv.sueno = clamp(sv.sueno - 100 / SV_CONFIG.suenoDias * dtDias, 0, 100);
        }
        if (sv.durmiendo && !sv.dormido) {
            sv.intento += dtSeg;
            if (sv.intento >= 4) {
                sv.intento = 0;
                const d = diaSueno();
                let logrado;
                if (d <= 3) logrado = true;                       // días 1 a 3: dormís normal
                else if (d <= 5) logrado = Math.random() < 0.02;  // días 4 y 5: solo un 2%
                else logrado = sv.anabolico;                      // día 6: solo con anabólico
                if (logrado) {
                    sv.dormido = true;
                    if (d >= 6) {                                 // colapso de cordura
                        sv.anabolico = false;
                        sv.corduraMax = Math.min(sv.corduraMax, 80);
                        sv.cordura = clamp(sv.cordura - 25, 1, sv.corduraMax);
                        avisar("Dormiste, pero tu mente colapsó. Ya no vas a recuperar toda tu cordura.", 6000);
                    }
                } else {
                    sv.cordura = clamp(sv.cordura - 1, 1, sv.corduraMax);
                    avisar("No lográs conciliar el sueño...", 2500);
                }
            }
        }

        // Enfermedades pasajeras: se curan solas si estás bien alimentado (y más rápido durmiendo)
        const bien = sv.sed > 10 && sv.hambre > 5 && sv.sueno > 10;
        for (let i = sv.enf.length - 1; i >= 0; i--) {
            const e = sv.enf[i];
            e.sev -= e.tasa * dtDias * (bien ? 1 : 0.25);
            if (e.sev <= 0) { avisar("Se te pasó el " + e.nombre.toLowerCase()); sv.enf.splice(i, 1); }
        }

        // Piernas: se curan con el tiempo (más rápido durmiendo y con muletas en la mano)
        const ayudaMuletas = muletasEnMano() ? 2 : 1;
        for (let i = 0; i < 2; i++) {
            const p = sv.piernas[i];
            if (p.n <= 0) continue;
            p.t -= dtDias * ayudaMuletas * (bien ? 1 : 0.4);
            if (p.t <= 0) {
                p.n--;
                p.t = p.n > 0 ? REC_DIAS[p.n] : 0;
                if (p.n === 1) avisar("Tu pierna " + NOMBRE_PIERNA[i] + " ya no está rota, solo esguince", 3500);
                else avisar("Tu pierna " + NOMBRE_PIERNA[i] + " se recuperó", 3000);
            }
        }

        // Salud: el techo baja con las enfermedades; las crónicas bajan el máximo para siempre
        let carga = 0;
        for (const e of sv.enf) carga += e.sev;
        const techo = Math.max(1, sv.saludMax - carga);
        let dano = 0;
        if (sv.sed <= 0) dano += SV_CONFIG.danoSedPorDia;
        if (sv.hambre <= 0) dano += SV_CONFIG.danoHambrePorDia;
        if (nT === -3 || nT === 3) dano += 30;                // congelamiento o golpe de calor
        if (dano > 0) sv.salud -= dano * dtDias;
        if (sv.sangrado > 0) sv.salud -= SANGRADO_POR_SEG[sv.sangrado] * dtSeg;       // heridas abiertas
        if (sv.salud > techo) sv.salud = Math.max(techo, sv.salud - 3 * dtSeg);
        else if (bien && dano === 0 && sv.sangrado === 0 && sv.salud < techo) sv.salud = Math.min(techo, sv.salud + SV_CONFIG.regeneracionSalud * dtSeg);

        // Sombras y cordura
        const sombraCerca = actualizarSombras(dtSeg);
        let dc = 0;
        if (diaSueno() >= 4) dc -= 0.04;
        if (sv.hambre < 10) dc -= 0.04;
        if (sombraCerca) dc -= 0.4;
        if (dc === 0 && bien) dc = sv.dormido ? 0.2 : 0.01;
        sv.cordura = clamp(sv.cordura + dc * dtSeg, 1, sv.corduraMax);

        // Efectos
        const dh = diasSinComer();
        const debil = dh >= 7 ? Math.min(0.3, (dh - 7) * 0.012) : 0;     // semana 1 sin comer en adelante
        const lentoSueno = [1, 0.95, 0.93, 0.9, 0.88, 0.85, 0.8][diaSueno() - 1];
        sv.velocidad = (1 - debil) * lentoSueno * (sv.sed < 25 ? 0.95 : 1) * (sv.salud < 30 ? 0.9 : 1) * (nT === -3 ? 0.85 : nT === -2 ? 0.95 : 1);
        sv.fuerza = 1 - debil * 1.5;                                      // para cuando haya combate
        sv.audicion = dh >= 26 ? Math.max(0.15, 1 - (dh - 26) / 6 * 0.85) : 1;

        // Muerte
        if (sv.salud <= 0) {
            morir(sv.sed <= 0 ? "Moriste de sed." : sv.hambre <= 0 ? "Moriste de hambre." : nT === -3 ? "Moriste congelado." : nT === 3 ? "Moriste por un golpe de calor." : sv.sangrado > 0 ? "Te desangraste." : "Tu cuerpo no resistió.");
        } else if (sv.sueno <= 0) {
            morir("Pasaste 7 días sin dormir.");
        }

        // Pantalla
        sv.msHud += msReales;
        if (sv.msHud > 100) { sv.msHud = 0; pintarHud(); }
        const oscuridad = Math.pow(1 - sv.cordura / 100, 1.4) * 0.85 + (sv.salud < 25 ? (25 - sv.salud) / 25 * 0.3 : 0);
        vineta.style.opacity = Math.min(0.95, oscuridad).toFixed(2);
        capaSueno.style.opacity = sv.durmiendo ? (sv.dormido ? "0.92" : "0.6") : "0";
        capaSueno.textContent = sv.durmiendo ? (sv.dormido ? "Durmiendo..." : "Intentando dormir...") : "";
        const tactil = "ontouchstart" in window;
        const objeto = (!sv.durmiendo && !inv.abierto) ? itemCercano() : null;
        botonObjeto.style.display = objeto ? "block" : "none";
        if (objeto) botonObjeto.textContent = (tactil ? "Recoger: " : "E: recoger ") + ITEMS[objeto.id].n;
        const cerca = !sv.durmiendo && !inv.abierto && cercaDeCama();
        cartelCama.style.display = cerca ? "block" : "none";
        if (cerca) cartelCama.textContent = tactil ? "Dormir" : "E: dormir";
        const ab = (!sv.durmiendo && !inv.abierto && sv.vivo) ? aberturaCercana() : null;
        const lugarAcc = (!sv.durmiendo && !inv.abierto && sv.vivo && !ab) ? accionLugar() : null;
        const txtAb = ab ? textoAbertura(ab, tactil) : (lugarAcc ? lugarAcc.texto : null);
        botonAbertura.style.display = txtAb ? "block" : "none";
        if (txtAb) botonAbertura.textContent = txtAb;
        // pasar por una ventana abierta o rota: botón redondo en el celu, cartel en la compu
        const vp = (!sv.durmiendo && !inv.abierto && sv.vivo) ? aberturaCercana(esPasable) : null;
        const verPasar = !!(vp || pasoVentana);
        if (botonPasarVentana) botonPasarVentana.style.visibility = verPasar ? "visible" : "hidden";
        botonAbertura2.style.display = (verPasar && !tactil) ? "block" : "none";
        if (verPasar && !tactil) botonAbertura2.textContent = "R: pasar por la ventana";
        return sv.velocidad;
    }

    function iniciarSupervivencia(datos) {
        reiniciarSV(datos);
        sv.activo = true;
        pintarHud();
    }

    function saltarDias(n) {
        sv.sed = clamp(sv.sed - 100 / SV_CONFIG.sedDias * n, 0, 100);
        sv.hambre = clamp(sv.hambre - 100 / SV_CONFIG.hambreDias * n, 0, 100);
        sv.sueno = clamp(sv.sueno - 100 / SV_CONFIG.suenoDias * n, 0, 100);
    }

    const DEBUG_SV = /[?&]debug=1/.test(location.search);

    // Para guardar la partida (offline). Si estás muerto se guarda una vida nueva.
    function exportarSupervivencia() {
        if (!sv.activo) return null;
        if (!sv.vivo) return null;
        return {
            salud: sv.salud, saludMax: sv.saludMax, cordura: sv.cordura, corduraMax: sv.corduraMax,
            sed: sv.sed, hambre: sv.hambre, sueno: sv.sueno,
            enf: sv.enf, cron: sv.cron, anabolico: sv.anabolico, sangrado: sv.sangrado,
            piernas: sv.piernas.map(function (p) { return { n: p.n, t: p.t }; })
        };
    }

    // Lo que el resto del juego puede usar (comida, bebida, medicinas, combate, sonido...)
    window.Inventario = { exportar: exportarInventario, agregar: agregarItem };

    window.Supervivencia = {
        estado: sv,
        exportar: exportarSupervivencia,
        beber: function (n) { sv.sed = clamp(sv.sed + n, 0, 100); },
        comer: function (n) { sv.hambre = clamp(sv.hambre + n, 0, 100); },
        curar: function (n) { sv.salud = clamp(sv.salud + n, 0, sv.saludMax); },
        enfermar: enfermar,
        enfermarCronica: enfermarCronica,
        bajarCordura: function (n) { sv.cordura = clamp(sv.cordura - n, 1, sv.corduraMax); },
        inyectarAnabolico: function () { sv.anabolico = true; },
        saltarDias: saltarDias,
        danar: danar,
        posicion: function () { return { x: px, y: saltoY, z: pz }; },
        get fuerza() { return sv.fuerza; },
        get audicion() { return sv.audicion; }
    };

    // La audición baja con el hambre extrema: afecta al volumen final de los sonidos
    (function () {
        const original = window.Ajustes.volumenFinal;
        window.Ajustes.volumenFinal = function () { return original.call(window.Ajustes) * sv.audicion; };
    })();

    // ===== POSTURA, COMBATE Y OBJETO EN LA MANO =====
    const PUNO = { dano: 5, alcance: 1.4, espera: 0.4 };

    function puedeActuar(libreInv) {
        return sv.activo && sv.vivo && !sv.durmiendo && (libreInv || !inv.abierto) && !window.juegoPausado;
    }
    function ambasPiernasRotas() { return sv.piernas[0].n === 2 && sv.piernas[1].n === 2; }
    function apagarCorrerCelu() {
        if (!correrCelu) return;
        correrCelu = false;
        if (botonCorrerRef) botonCorrerRef.style.background = "rgba(255,255,255,0.25)";
    }

    function alternarAgachar() {
        if (!puedeActuar(true)) return;
        if (ambasPiernasRotas() && !muletasEnMano()) { avisar("Tenés las dos piernas rotas: solo podés arrastrarte", 2200); return; }
        postura = postura === 1 ? 0 : 1;
        apagarCorrerCelu();
        avisar(postura === 1 ? "Agachado" : "De pie", 1000);
        pintarHud();
    }
    function alternarArrastrar() {
        if (!puedeActuar(true)) return;
        if (postura === 2) {
            if (ambasPiernasRotas() && !muletasEnMano()) { avisar("Con las dos piernas rotas no podés pararte (necesitás muletas)", 2600); return; }
            postura = 0;
            avisar("De pie", 1300);
        } else {
            postura = 2;
            avisar("Arrastrándote", 1000);
        }
        apagarCorrerCelu();
        pintarHud();
    }
    function alternarPelea() {
        if (!puedeActuar()) return;
        modoPelea = !modoPelea;
        avisar(modoPelea ? "Puños arriba: ya podés pegar" : "Bajaste los puños", 1500);
        pintarHud();
    }

    // Pegar: solo con los puños arriba; con un objeto en la mano pega con él, si no, con los puños
    function atacar() {
        if (!puedeActuar(true)) return;
        const ahoraMs = performance.now();
        if (postura === 2) return;
        const id = itemMano();
        const conArma = !!id && !!ITEMS[id].arma;
        const arma = conArma ? ITEMS[id].arma : PUNO;
        if (ahoraMs - ultimoGolpe < arma.espera * 1000) return;
        ultimoGolpe = ahoraMs;
        modoPelea = true;                 // se ven los puños arriba un ratito después de pegar
        peleaHasta = ahoraMs + 1500;
        golpeT = 0;
        golpesN++;
        ruidoPulso = Math.max(ruidoPulso, 12);

        // a quién le pegás: el más cercano que tengas adelante
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        let mejor = null, mejorD = 1e9;
        for (const oid in otros) {
            if (oid === String(miId)) continue;
            const j = otros[oid];
            if (!mismaZona(j)) continue;
            const dx = j.x - px, dz = j.z - pz;
            const d = Math.hypot(dx, dz);
            if (d > arma.alcance + 0.3) continue;
            if (d > 0.5 && (dx * fx + dz * fz) / d < 0.7) continue;     // tiene que estar más o menos adelante
            if (Math.abs((j.y || 0) - saltoY) > 1.2) continue;
            if (d < mejorD) { mejorD = d; mejor = oid; }
        }
        // ¿hay un NPC más cerca que cualquier jugador? A ese le pegás
        let npcGolpeado = null, dNpc = 1e9;
        for (const n of NPCS) {
            if (n.caido) continue;
            const dx = n.x - px, dz = n.z - pz;
            const d = Math.hypot(dx, dz);
            if (d > arma.alcance + 0.3) continue;
            if (d > 0.5 && (dx * fx + dz * fz) / d < 0.7) continue;
            if (Math.abs(saltoY) > 1.2) continue;
            if (d < dNpc) { dNpc = d; npcGolpeado = n; }
        }
        if (npcGolpeado && dNpc < mejorD) {
            const fz2 = Math.max(0.3, Math.min(1, sv.fuerza));
            if (esAutoridad()) golpearNpc(npcGolpeado, arma.dano * fz2, idPropio());
            else enviarRed({ tipo: "npcgolpe", i: npcGolpeado.i, arma: conArma ? id : "puno", f: fz2 });
            mejor = null;
        } else if (mejor === null) {                      // si no le pegás a nadie, y apuntás a una ventana cerrada, la rompés
            const v = ventanaApuntada(arma.alcance);
            if (v) romperVentana(v);
        }
        if (mejor !== null && conexion && conexion.readyState === WebSocket.OPEN) {
            conexion.send(JSON.stringify({ tipo: "golpe", a: Number(mejor), arma: conArma ? id : "puno", f: Math.max(0.3, Math.min(1, sv.fuerza)) }));
        }
    }

    // Te pegaron
    const flashGolpe = document.createElement("div");
    flashGolpe.style.cssText = "position:fixed;inset:0;z-index:781;pointer-events:none;background:rgba(190,0,0,.5);opacity:0;transition:opacity .4s;";
    document.body.appendChild(flashGolpe);
    function recibirGolpe(dano, nombre) {
        if (!sv.activo || !sv.vivo || !(dano > 0)) return;
        if (sv.durmiendo) despertar();
        sv.salud = Math.max(0, sv.salud - dano);
        flashGolpe.style.transition = "none";
        flashGolpe.style.opacity = "1";
        setTimeout(function () { flashGolpe.style.transition = "opacity .4s"; flashGolpe.style.opacity = "0"; }, 60);
        ruidoPulso = Math.max(ruidoPulso, 10);
        if (sv.salud <= 0) morir("Te mataron a golpes" + (nombre ? " (" + nombre + ")" : "") + ".");
        else avisar((nombre || "Alguien") + " te golpeó (−" + Math.round(dano) + ")", 1800);
    }

    window.addEventListener("keydown", function (e) {
        if (e.repeat || window.juegoPausado || !sv.activo || !sv.vivo) return;
        const T = A.teclas;
        if (e.code === T.agachar) alternarAgachar();
        else if (e.code === T.arrastrar) alternarArrastrar();
        else if (e.code === T.pelea) atacar();
        else if (e.code === T.correr && postura === 1) { postura = 0; pintarHud(); }   // correr te para
    });
    document.addEventListener("mousedown", function (e) {
        if (e.button === 0 && document.pointerLockElement === canvas) atacar();
    });

    // Botones del celular
    let botonesTactiles = null;
    let botonPasarVentana = null;       // botón redondo para pasar por una ventana (solo aparece cerca de una abierta o rota)
    const ICONO_PASAR = '<svg viewBox="0 0 64 64" width="62%" height="62%"><g stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
        '<circle cx="44" cy="22" r="6" fill="#fff"/><path d="M38 30 L24 38 L8 34 M24 38 L30 54 M32 34 L52 42"/></g></svg>';
    if ("ontouchstart" in window) {
        const mini = "";
        const hacer = function (texto, estilo, accion) {
            const b = crearBoton(texto, mini + estilo);
            b.addEventListener("touchstart", function (e) { e.preventDefault(); accion(); }, { passive: false });
            return b;
        };
        const nuevo = function (id, texto, der, mx, my, accion) {
            const b = hacer(texto, "", accion);
            registrarBoton(id, texto, b, 1.4, der, mx, my);
            return b;
        };
        botonesTactiles = {
            agachar: nuevo("agachar", "Agachar", true, 1.9, 2.75, alternarAgachar),
            arrastrar: nuevo("arrastrar", "Arrastrar", true, 0.3, 2.75, alternarArrastrar)
        };
        botonPasarVentana = hacer(ICONO_PASAR, "visibility:hidden;", pasarPorVentana);
        registrarBoton("pasar", "Pasar", botonPasarVentana, 1.4, true, 2.3, 0.6);       // a la izquierda de Saltar
    }
    function actualizarBotonesTactiles() {
        if (!botonesTactiles) return;
        const on = "rgba(255,140,0,0.7)", off = "rgba(255,255,255,0.25)";
        botonesTactiles.agachar.style.background = postura === 1 ? on : off;
        botonesTactiles.arrastrar.style.background = postura === 2 ? on : off;
    }

    // Lo que tenés en la mano, visto desde tus ojos (se dibuja encima de todo)
    const bufferMano = gl.createBuffer();
    const MODELOS_MANO = {
        palo:     [{ a: 0, b: 0.85, w: 0.06, h: 0.06, c: [0.55, 0.38, 0.20] }],
        cuchillo: [{ a: 0, b: 0.13, w: 0.04, h: 0.05, c: [0.25, 0.15, 0.08] }, { a: 0.13, b: 0.24, w: 0.025, h: 0.07, c: [0.80, 0.82, 0.86] }],
        hacha:    [{ a: 0, b: 0.75, w: 0.05, h: 0.05, c: [0.50, 0.35, 0.20] }, { a: 0.58, b: 0.15, w: 0.04, h: 0.24, c: [0.55, 0.56, 0.60] }]
    };
    function rotX(v, c, sn) { return [v[0], v[1] * c - v[2] * sn, v[1] * sn + v[2] * c]; }
    function normal3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

    // Color de tu personaje (camisa si tenés puesta, si no el color base)
    function colorBrazoMio() {
        const mio = (typeof otros !== "undefined" && miId !== null && otros[miId]) ? otros[miId] : null;
        const base = hexARgb(A.colorPersonaje) || COLORES_JUGADOR[((mio && mio.c) || 0) % COLORES_JUGADOR.length];
        return inv.equipo.torso ? COLOR_ITEM[inv.equipo.torso] : base;
    }
    // Brazo en primera persona: una barra desde el hombro (fuera de pantalla) hasta la mano
    function brazoMano(lista, S, H, col) {
        const d = [H[0] - S[0], H[1] - S[1], H[2] - S[2]];
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        const L = [d[0] / len, d[1] / len, d[2] / len];
        const R = Math.hypot(L[2], L[0]) < 1e-3 ? [1, 0, 0] : normal3([L[2], 0, -L[0]]);
        const U = [L[1] * R[2] - L[2] * R[1], L[2] * R[0] - L[0] * R[2], L[0] * R[1] - L[1] * R[0]];
        cajaOri(lista, [(S[0] + H[0]) / 2, (S[1] + H[1]) / 2, (S[2] + H[2]) / 2], R, U, L, 0.055, 0.055, len / 2 + 0.03, col);
    }

    function dibujarMano(proy, tS) {
        if (!sv.activo || !sv.vivo || sv.durmiendo) return;
        const itD = inv.manoD, itI = inv.manoI;
        const mulet = itD === "muletas" || itI === "muletas";
        if (!itD && !itI && !modoPelea) return;
        const lista = [];
        const sw = golpeT < 0.3 ? Math.sin(golpeT / 0.3 * Math.PI) : 0;   // 0 → 1 → 0 durante el golpe
        const resp = Math.sin(tS * 2) * 0.008;
        const cb = colorBrazoMio();
        const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
        const act = itemMano() ? ((itD && ITEMS[itD].mano) ? "D" : "I") : null;     // con qué mano pegás
        if (mulet) {
            for (const sg of [-1, 1]) {
                cajaOri(lista, [sg * 0.55, -0.42 + resp, -0.8 - sw * 0.15], X, Y, Z, 0.022, 0.5, 0.022, COLOR_ITEM.muletas);
                cajaOri(lista, [sg * 0.55, -0.02 + resp, -0.8 - sw * 0.15], X, Y, Z, 0.07, 0.025, 0.04, [0.45, 0.35, 0.25]);
            }
        }
        [["D", itD, 1], ["I", itI, -1]].forEach(function (par) {
            const k = par[0], id = par[1], side = par[2];
            const swH = act === k ? sw : 0;
            if (mulet) return;
            if (id && MODELOS_MANO[id]) {
                const lev = modoPelea ? 1 : 0;
                const H = [side * (0.42 - 0.04 * lev), -0.55 + 0.12 * lev + resp, -0.7];
                const L0 = normal3(lev ? [-0.25 * side, 0.85, -0.45] : [-0.15 * side, 0.55, -0.8]);
                // eje lateral perpendicular al largo del objeto
                let R0 = [1 - L0[0] * L0[0], -L0[0] * L0[1], -L0[0] * L0[2]];
                R0 = normal3(R0);
                const U0 = [L0[1] * R0[2] - L0[2] * R0[1], L0[2] * R0[0] - L0[0] * R0[2], L0[0] * R0[1] - L0[1] * R0[0]];
                const ang = -swH * 1.35;                      // el golpe lo tira hacia adelante y abajo
                const c = Math.cos(ang), sn = Math.sin(ang);
                const L = rotX(L0, c, sn), R = rotX(R0, c, sn), U = rotX(U0, c, sn);
                const Hs = [H[0], H[1] - swH * 0.05, H[2] - swH * 0.1];
                for (const p of MODELOS_MANO[id]) {
                    const kk = p.a + p.b / 2;
                    cajaOri(lista, [Hs[0] + L[0] * kk, Hs[1] + L[1] * kk, Hs[2] + L[2] * kk], R, U, L, p.w / 2, p.h / 2, p.b / 2, p.c);
                }
                brazoMano(lista, [side * 0.6, -1.0, -0.3], Hs, cb);
            } else if (id) {
                // cualquier otro objeto (mochila, agua...): un bulto en la mano
                const t = id === "mochila" ? 0.13 : 0.06;
                brazoMano(lista, [side * 0.6, -1.0, -0.3], [side * 0.36, -0.36 + resp, -0.65], cb);
                cajaOri(lista, [side * 0.36, -0.36 + resp, -0.65], X, Y, Z, t, t, t, COLOR_ITEM[id] || [0.6, 0.6, 0.6]);
            } else if (modoPelea) {
                const pu = [side * 0.28, -0.3 + resp * side, -0.55 - (k === "D" && !act ? sw * 0.4 : 0)];
                brazoMano(lista, [side * 0.6, -1.0, -0.3], pu, cb);
                cajaOri(lista, pu, X, Y, Z, 0.065, 0.065, 0.085, cb);
            }
        });
        if (lista.length === 0) return;
        configurarAtributos(bufferMano);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lista), gl.DYNAMIC_DRAW);
        gl.clear(gl.DEPTH_BUFFER_BIT);                    // así nunca se mete dentro de una pared
        gl.uniformMatrix4fv(uCamara, false, proy);        // cámara pegada a tus ojos
        gl.drawArrays(gl.TRIANGLES, 0, lista.length / 6);
    }

    // ===== SALIR DE CASA =====
    // Empezás adentro de tu casa (zona cerrada). La puerta siempre está habilitada: ahí elegís
    // en el mapa a dónde ir. Los lugares de la lista todavía no hacen nada (solo están los botones).
    const DESTINOS = [
        { id: "barrio", e: "⚔️", n: "Zona de guerra", d: "Las casas del barrio: acá todo es peligroso", listo: true },
        { id: "peligro", e: "⚠️", n: "Zona peligrosa" },
        { id: "tranquilo", e: "🌳", n: "Barrios tranquilos" },
        { id: "super", e: "🛒", n: "Supermercado", d: "Saqueá todo lo que quieras, sin problemas", listo: true },
        { id: "comercio", e: "💱", n: "Compra y venta", d: "Vendé lo que juntaste y comprá lo que te falta", listo: true },
        { id: "mas", e: "➕", n: "Más lugares" }
    ];
    let destinosAbierto = false;
    let salidaPrev = null;

    // Te lleva adentro de tu casa (al empezar y al reaparecer)
    function irACasa() {
        entrarZona("casa");
        const c = casaPropia ? casaPropia.spawnDentro : SPAWN;
        px = c.x; pz = c.z; yaw = c.yaw; pitch = 0; saltoY = 0; velY = 0;
        pasoVentana = null; tareaVidrios = null;
        salidaPrev = null;
        destinosAbierto = false;
        if (panelDestinos) panelDestinos.classList.remove("visible");
    }

    // La puerta de tu casa no tiene horario: podés salir cuando quieras, de día o de noche
    function salidaAbierta() { return true; }

    const estiloDestinos = document.createElement("style");
    estiloDestinos.textContent =
        "#btnSalirCasa{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:810;display:none;padding:.45em 1.1em;" +
        "font-family:'Cinzel Decorative',serif;font-size:max(13px,1rem);letter-spacing:2px;color:#fff;background:rgba(60,0,0,.8);" +
        "border:2px solid rgba(255,215,220,.8);border-radius:14px;cursor:pointer;text-shadow:0 0 8px #f00;box-shadow:0 0 14px rgba(255,0,0,.4);}" +
        "#panelDestinos{position:fixed;inset:0;z-index:900;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.75);}" +
        "#panelDestinos.visible{display:flex;}" +
        "#panelDestinos .dCaja{width:min(94vw,540px);max-height:94vh;overflow:auto;box-sizing:border-box;padding:14px 16px;border-radius:18px;" +
        "background:rgba(28,0,0,.95);border:2px solid rgba(255,215,220,.7);box-shadow:0 0 30px rgba(255,0,0,.4);color:#f1dede;text-align:center;" +
        "font-family:'Cinzel Decorative',serif;}" +
        "#panelDestinos h2{margin:0 0 4px;font-size:1.2rem;letter-spacing:3px;font-weight:normal;text-shadow:0 0 10px #f00;}" +
        "#panelDestinos p{margin:0 0 10px;font-size:.8rem;opacity:.8;letter-spacing:1px;}" +
        "#panelDestinos canvas{display:block;margin:0 auto;width:min(46vw,190px);height:min(46vw,190px);box-sizing:border-box;border:3px solid #7c7c7c;border-radius:8px;background:#3a3a3a;}" +
        "#panelDestinos .dLey{margin:4px 0 10px;font-size:.75rem;letter-spacing:1px;color:#e8c9c9;}" +
        "#panelDestinos .dGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}" +
        "#panelDestinos .dBtn{font-family:inherit;color:#fff;background:rgba(60,0,0,.65);border:2px solid rgba(255,215,220,.55);border-radius:12px;" +
        "padding:.55em .4em;cursor:pointer;font-size:.9rem;line-height:1.2;}" +
        "#panelDestinos .dBtn small{display:block;margin-top:2px;font-size:.62rem;opacity:.75;letter-spacing:1px;}" +
        "#panelDestinos .dBtn.listo{border-color:#ffb347;box-shadow:0 0 12px rgba(255,160,60,.45);}" +
        "#panelDestinos .dBtn.vacio{opacity:.6;cursor:default;}" +
        "#panelDestinos .dQuedar{margin-top:10px;font-family:inherit;font-size:.85rem;letter-spacing:2px;color:#fff;background:transparent;" +
        "border:2px solid rgba(255,215,220,.55);border-radius:12px;padding:.45em 1.2em;cursor:pointer;}";
    document.head.appendChild(estiloDestinos);

    const btnSalirCasa = document.createElement("button");
    btnSalirCasa.id = "btnSalirCasa";
    btnSalirCasa.type = "button";
    btnSalirCasa.textContent = "🚪 Salir de casa";
    document.body.appendChild(btnSalirCasa);

    const panelDestinos = document.createElement("div");
    panelDestinos.id = "panelDestinos";
    panelDestinos.innerHTML =
        '<div class="dCaja"><h2>🗺️ ¿A dónde vas?</h2>' +
        '<p>Elegí un lugar del mapa.</p>' +
        '<canvas width="240" height="240"></canvas><div class="dLey">● Tu casa</div>' +
        '<div class="dGrid"></div>' +
        '<button type="button" class="dQuedar">Quedarme en casa</button></div>';
    document.body.appendChild(panelDestinos);

    const gridDestinos = panelDestinos.querySelector(".dGrid");
    DESTINOS.forEach(function (d) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dBtn" + (d.listo ? " listo" : " vacio");
        b.innerHTML = d.e + " " + d.n + "<small>" + (d.listo ? d.d : "Próximamente") + "</small>";
        if (d.listo) b.addEventListener("click", function () { irADestino(d.id); });
        gridDestinos.appendChild(b);         // los que no están listos quedan sin acción (por ahora)
    });
    panelDestinos.querySelector(".dQuedar").addEventListener("click", function () { cerrarDestinos(); });
    panelDestinos.addEventListener("click", function (e) { if (e.target === panelDestinos) cerrarDestinos(); });
    btnSalirCasa.addEventListener("click", function () { abrirDestinos(); });

    // El mapa del menú: el barrio con tus casas en gris claro, calles grises y terrenos más oscuros; tu casa en rojo
    function dibujarMapaDestinos() {
        const cv = panelDestinos.querySelector("canvas"), g = cv.getContext("2d"), S = cv.width;
        const k = S / (2 * MUNDO_MITAD);
        const X = function (v) { return (v + MUNDO_MITAD) * k; };
        const rect = function (r, col) { g.fillStyle = col; g.fillRect(X(r[0]), X(r[1]), (r[2] - r[0]) * k, (r[3] - r[1]) * k); };
        g.fillStyle = "#3a3a3a"; g.fillRect(0, 0, S, S);
        CALLES.forEach(function (r) { rect(r, "#777777"); });
        CASAS.forEach(function (r) { rect(r, "#c4c4c4"); });
        if (casaPropia) {
            const r = casaPropia.rect;
            g.beginPath();
            g.arc(X((r[0] + r[2]) / 2), X((r[1] + r[3]) / 2), 6, 0, Math.PI * 2);
            g.fillStyle = "#e02b2b"; g.fill();
            g.lineWidth = 2; g.strokeStyle = "rgba(0,0,0,.6)"; g.stroke();
        }
    }

    function abrirDestinos() {
        if (destinosAbierto || zona !== "casa" || !sv.activo || !sv.vivo || window.juegoPausado) return;
        if (!salidaAbierta()) {
            avisar("La puerta está cerrada", 3200);
            return;
        }
        if (inv.abierto) cerrarInventario();
        destinosAbierto = true;
        window.inventarioAbierto = true;          // para que el menú no abra la pausa al soltar el mouse
        if (sv.durmiendo) despertar();
        if (window.soltarControles) window.soltarControles();
        try { document.exitPointerLock(); } catch (e) {}
        dibujarMapaDestinos();
        panelDestinos.classList.add("visible");
    }
    function cerrarDestinos() {
        if (!destinosAbierto) return;
        destinosAbierto = false;
        window.inventarioAbierto = !!inv.abierto;
        panelDestinos.classList.remove("visible");
        if (!("ontouchstart" in window) && !inv.abierto) { try { canvas.requestPointerLock(); } catch (e) {} }
    }
    function irADestino(id) {
        if (id === "super" || id === "comercio") {
            cerrarDestinos();
            entrarZona(id);
            salidaPrev = null;
            btnSalirCasa.style.display = "none";
            avisar(id === "super" ? "🛒 Supermercado: llevate lo que quieras, nadie te va a decir nada" : "💱 Compra y venta: hablale al vendedor", 3500);
            return;
        }
        if (id !== "barrio") return;              // los demás lugares todavía no existen
        cerrarDestinos();
        entrarZona("barrio");
        const f = casaPropia.spawnFuera;
        px = f.x; pz = f.z; yaw = f.yaw; pitch = 0; saltoY = 0; velY = 0;
        pasoVentana = null; tareaVidrios = null;
        salidaPrev = null;
        btnSalirCasa.style.display = "none";
        avisar("Entraste a la zona de guerra", 2500);
    }

    // Esc / botón "atrás": primero cierra el menú de destinos
    (function () {
        const cerrarInv = window.cerrarInventario;
        window.cerrarInventario = function () {
            if (destinosAbierto) { cerrarDestinos(); return; }
            cerrarInv();
        };
    })();

    // ===== LUGARES SEGUROS: SUPERMERCADO Y COMPRA Y VENTA =====
    // Dos zonas cerradas como tu casa (cargan solo su propio edificio). Se llega desde el mapa de la puerta y se vuelve a tu casa.
    // - Supermercado: estantes con comida, agua, remedios y ropa. Podés llevarte todo sin que nadie reaccione (no hay NPCs ni alarma de robo).
    //   Se vuelve a surtir cada 10 minutos (por jugador: el stock no se comparte en un servidor).
    // - Compra y venta: un vendedor te compra tus cosas (te da plata) y te vende otras.
    // Cada edificio está lejos del barrio (en otras coordenadas) para no mezclarse con sus objetos.
    const LUGAR_BASE = { super: [200, 0], comercio: [260, 0] };
    const SURTIDO_MS = 10 * 60 * 1000;
    const LUGARES = {};
    // [lo que cuesta comprarlo, lo que te pagan si lo vendés (0 = no lo compran)]
    const PRECIOS = {
        agua: [4, 2], comida: [6, 3], jarabe: [12, 6], venda: [8, 4], anabolico: [25, 12],
        palo: [5, 2], cuchillo: [20, 10], hacha: [35, 17], muletas: [30, 15],
        gorra: [8, 4], botas: [18, 9], camisa: [15, 7], pantalon: [15, 7], mochila: [40, 0]
    };
    const ORDEN_TIENDA = ["agua", "comida", "jarabe", "venda", "anabolico", "palo", "cuchillo", "hacha", "muletas", "gorra", "camisa", "pantalon", "botas", "mochila"];

    function codigoZona() { return zona === "casa" ? 1 : zona === "super" ? 2 : zona === "comercio" ? 3 : 0; }
    function enLugar() { return zona === "super" || zona === "comercio"; }

    function prepararLugar(id) {
        if (LUGARES[id]) return LUGARES[id];
        const cx = LUGAR_BASE[id][0], cz = LUGAR_BASE[id][1];
        const W = id === "super" ? 24 : 16, D = id === "super" ? 16 : 12;
        const x1 = cx - W / 2, x2 = cx + W / 2, z1 = cz - D / 2, z2 = cz + D / 2;
        const L = { id: id, datos: [], cols: [], rect: [x1, z1, x2, z2], surtidoT: 0, cx: cx, cz: cz,
            spawn: { x: cx, z: z2 - 2.4, yaw: 0 }, salida: [cx, z2], mostrador: null };
        // caja dibujada en este lugar; si es sólida también frena (la colisión va aparte para no mezclarse con el barrio)
        const B = function (a, b, c, d, e, f, col, sol) {
            caja(a, b, c, d, e, f, col, false, L.datos);
            if (sol) L.cols.push([Math.min(a, d), Math.min(c, f), Math.max(a, d), Math.max(c, f), e, b]);
        };
        const t = 0.3, alto = 4.0;
        const PISO = id === "super" ? [0.62, 0.62, 0.58] : [0.45, 0.36, 0.26];
        const PARED_L = id === "super" ? [0.78, 0.78, 0.72] : [0.58, 0.46, 0.34];
        B(x1 - 0.5, -0.1, z1 - 0.5, x2 + 0.5, 0, z2 + 0.5, PISO, false);                 // piso
        B(x1 - 0.5, 0.02, z1 - 0.5, x2 + 0.5, 0.03, z2 + 0.5, PISO, false);
        B(x1 - t, 0, z1 - t, x2 + t, alto, z1, PARED_L, true);                           // paredes
        B(x1 - t, 0, z2, x2 + t, alto, z2 + t, PARED_L, true);
        B(x1 - t, 0, z1, x1, alto, z2, PARED_L, true);
        B(x2, 0, z1, x2 + t, alto, z2, PARED_L, true);
        B(x1 - t, alto, z1 - t, x2 + t, alto + 0.25, z2 + t, TECHO_COLOR, false);          // techo
        // puerta de salida (al frente): marco y hoja pintados en la pared
        B(cx - 1.0, 0, z2 - 0.05, cx + 1.0, 2.3, z2 + 0.02, MADERA, false);
        B(cx - 0.85, 0, z2 - 0.08, cx + 0.85, 2.15, z2 - 0.02, [0.20, 0.55, 0.30], false);
        B(cx - 0.25, 1.0, z2 - 0.12, cx - 0.15, 1.1, z2 - 0.08, [0.9, 0.85, 0.2], false);  // manija
        // franja de color en la pared de atrás
        B(x1, 2.3, z1 + 0.01, x2, 3.2, z1 + 0.05, id === "super" ? [0.80, 0.18, 0.18] : [0.85, 0.65, 0.15], false);

        if (id === "super") {
            // 3 estantes largos (la parte de arriba está a la altura de la mano) + una caja registradora
            L.estantes = [];
            [-5.5, -2.0, 1.5].forEach(function (dz, i) {
                const ez = cz + dz;
                B(cx - 9.5, 0, ez - 0.5, cx + 5.5, 1.0, ez + 0.5, i === 2 ? [0.30, 0.34, 0.50] : [0.55, 0.36, 0.20], true);
                B(cx - 9.5, 1.0, ez - 0.5, cx + 5.5, 1.04, ez + 0.5, [0.75, 0.75, 0.72], false);
                L.estantes.push({ z: ez, tipo: i });
            });
            B(cx + 7.0, 0, cz + 3.5, cx + 10.0, 1.0, cz + 5.0, [0.25, 0.25, 0.28], true);   // caja
            B(cx + 8.0, 1.0, cz + 3.9, cx + 8.7, 1.4, cz + 4.5, [0.15, 0.15, 0.17], false);
        } else {
            // mostrador al fondo con el vendedor atrás; cajones y estantes de adorno a los costados
            B(cx - 3.0, 0, cz - 2.6, cx + 3.0, 1.05, cz - 1.8, [0.45, 0.30, 0.18], true);
            B(cx - 3.0, 1.05, cz - 2.7, cx + 3.0, 1.12, cz - 1.7, [0.70, 0.55, 0.30], false);
            const vz = cz - 3.6;
            B(cx - 0.3, 0.0, vz - 0.2, cx + 0.3, 1.0, vz + 0.2, [0.15, 0.30, 0.45], false);      // cuerpo
            B(cx - 0.45, 0.8, vz - 0.12, cx - 0.3, 1.0, vz + 0.12, [0.88, 0.68, 0.52], false);   // manos
            B(cx + 0.3, 0.8, vz - 0.12, cx + 0.45, 1.0, vz + 0.12, [0.88, 0.68, 0.52], false);
            B(cx - 0.22, 1.0, vz - 0.2, cx + 0.22, 1.45, vz + 0.2, [0.88, 0.68, 0.52], false);   // cabeza
            B(cx - 0.28, 1.43, vz - 0.26, cx + 0.28, 1.58, vz + 0.26, [0.75, 0.20, 0.18], false);  // gorro
            B(cx - 6.5, 0, cz - 5.2, cx - 3.5, 1.2, cz - 4.0, CAJA, true);
            B(cx + 3.5, 0, cz - 5.2, cx + 6.5, 1.2, cz - 4.0, CAJA, true);
            B(cx - 7.5, 0, cz + 1.0, cx - 6.5, 1.0, cz + 3.5, MADERA, true);
            B(cx + 6.5, 0, cz + 1.0, cx + 7.5, 1.0, cz + 3.5, MADERA, true);
            L.mostrador = [cx, cz - 1.0];
        }
        LUGARES[id] = L;
        return L;
    }

    // Llena los estantes del supermercado
    function surtirSuper(L) {
        const lista = [];
        const tipos = [["agua", "comida"], ["comida", "jarabe", "venda", "agua"], ["camisa", "pantalon", "gorra", "botas", "agua"]];
        L.estantes.forEach(function (e) {
            const pool = tipos[e.tipo];
            for (let k = 0; k < 11; k++) {
                const x = L.cx - 8.8 + k * 1.35;
                lista.push({ id: pool[(k + e.tipo) % pool.length], x: x, y: 1.04, z: e.z + (k % 2 ? 0.15 : -0.15) });
            }
        });
        lista.push({ id: "mochila", x: L.cx + 4.6, y: 1.04, z: L.estantes[2].z });
        lista.push({ id: "venda", x: L.cx + 8.5, y: 1.0, z: L.cz + 4.6 });
        L.items = lista;
        L.surtidoT = Date.now();
    }

    // Te lleva a un lugar seguro (se llama desde entrarZona)
    function entrarLugar(id) {
        const L = prepararLugar(id);
        zona = id;
        colisiones.length = 0;
        L.cols.forEach(function (c) { colisiones.push(c); });
        PUERTAS = []; VENTANAS = []; NPCS = [];
        cargarBuffer(L.datos);
        if (id === "super") {
            if (!L.surtidoT || Date.now() - L.surtidoT > SURTIDO_MS) surtirSuper(L);
            itemsLugar = L.items;
        } else {
            itemsLugar = [];
        }
        px = L.spawn.x; pz = L.spawn.z; yaw = L.spawn.yaw; pitch = 0; saltoY = 0; velY = 0;
        pasoVentana = null; tareaVidrios = null;
    }

    // Lo que podés hacer donde estás (salir, comerciar) o null
    function accionLugar() {
        if (!enLugar() || tiendaAbierta || destinosAbierto) return null;
        const L = LUGARES[zona];
        if (!L) return null;
        const tactil = "ontouchstart" in window;
        if (L.mostrador && Math.hypot(px - L.mostrador[0], pz - L.mostrador[1]) < 3.4)
            return { texto: tactil ? "Comerciar" : "E: comerciar", hacer: abrirTienda };
        if (Math.hypot(px - L.salida[0], pz - L.salida[1]) < 2.6)
            return { texto: tactil ? "Salir" : "E: salir", hacer: function () { irACasa(); avisar("Volviste a tu casa", 2000); } };
        return null;
    }

    // ----- Compra y venta -----
    const estiloTienda = document.createElement("style");
    estiloTienda.textContent =
        "#panelTienda{position:fixed;inset:0;z-index:900;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.75);}" +
        "#panelTienda.visible{display:flex;}" +
        "#panelTienda .tCaja{width:min(94vw,560px);max-height:94vh;overflow:auto;box-sizing:border-box;padding:14px 16px;border-radius:18px;" +
        "background:rgba(28,0,0,.95);border:2px solid rgba(255,215,220,.7);box-shadow:0 0 30px rgba(255,0,0,.4);color:#f1dede;text-align:center;" +
        "font-family:'Cinzel Decorative',serif;}" +
        "#panelTienda h2{margin:0 0 2px;font-size:1.2rem;letter-spacing:3px;font-weight:normal;text-shadow:0 0 10px #f00;}" +
        "#panelTienda .tPlata{margin:0 0 8px;font-size:1rem;letter-spacing:2px;color:#ffd76a;}" +
        "#panelTienda h3{margin:10px 0 6px;font-size:.85rem;letter-spacing:2px;font-weight:normal;opacity:.85;}" +
        "#panelTienda .tGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}" +
        "#panelTienda .tBtn{font-family:inherit;color:#fff;background:rgba(60,0,0,.65);border:2px solid rgba(255,215,220,.55);border-radius:12px;" +
        "padding:.45em .3em;cursor:pointer;font-size:.8rem;line-height:1.2;}" +
        "#panelTienda .tBtn small{display:block;font-size:.65rem;opacity:.85;letter-spacing:1px;}" +
        "#panelTienda .tBtn.no{opacity:.4;cursor:default;}" +
        "#panelTienda .tVacio{font-size:.75rem;opacity:.7;padding:6px;}" +
        "#panelTienda .tCerrar{margin-top:12px;font-family:inherit;font-size:.85rem;letter-spacing:2px;color:#fff;background:transparent;" +
        "border:2px solid rgba(255,215,220,.55);border-radius:12px;padding:.45em 1.2em;cursor:pointer;}";
    document.head.appendChild(estiloTienda);

    const panelTienda = document.createElement("div");
    panelTienda.id = "panelTienda";
    panelTienda.innerHTML =
        '<div class="tCaja"><h2>💱 Compra y venta</h2><div class="tPlata"></div>' +
        '<h3>VENDER (lo que llevás)</h3><div class="tGrid tVender"></div>' +
        '<h3>COMPRAR</h3><div class="tGrid tComprar"></div>' +
        '<button type="button" class="tCerrar">Listo</button></div>';
    document.body.appendChild(panelTienda);

    // Todo lo que llevás que se puede vender (barra, bolsillos y manos; la ropa puesta y las mochilas no)
    function refsVendibles() {
        const l = [];
        const ok = function (id) { return id && PRECIOS[id] && PRECIOS[id][1] > 0; };
        inv.barra.forEach(function (id, i) { if (ok(id)) l.push({ t: "b", i: i }); });
        ORDEN_CONT.forEach(function (k) { (inv.cont[k] || []).forEach(function (id, i) { if (ok(id)) l.push({ t: "c", k: k, i: i }); }); });
        ["D", "I"].forEach(function (k) { if (ok(inv["mano" + k])) l.push({ t: "h", k: k }); });
        return l;
    }
    function pintarTienda() {
        panelTienda.querySelector(".tPlata").textContent = "💰 $" + dinero;
        const vender = panelTienda.querySelector(".tVender"), comprar = panelTienda.querySelector(".tComprar");
        vender.innerHTML = ""; comprar.innerHTML = "";
        const cuenta = {};
        refsVendibles().forEach(function (r) { const id = getRef(r); (cuenta[id] = cuenta[id] || []).push(r); });
        const ids = Object.keys(cuenta);
        if (!ids.length) vender.innerHTML = '<div class="tVacio" style="grid-column:1/3">No llevás nada que te compren.</div>';
        ids.forEach(function (id) {
            const b = document.createElement("button");
            b.type = "button"; b.className = "tBtn";
            b.innerHTML = ITEMS[id].e + " " + ITEMS[id].n + (cuenta[id].length > 1 ? " ×" + cuenta[id].length : "") + "<small>Vender: $" + PRECIOS[id][1] + "</small>";
            b.addEventListener("click", function () {
                const r = cuenta[id][0];
                if (getRef(r) !== id) { pintarTienda(); return; }
                setRef(r, null);
                dinero += PRECIOS[id][1];
                refrescarInventario(); pintarBarra();
                avisar("Vendiste: " + ITEMS[id].n + " (+$" + PRECIOS[id][1] + ")", 1500);
                pintarTienda();
            });
            vender.appendChild(b);
        });
        ORDEN_TIENDA.forEach(function (id) {
            const b = document.createElement("button");
            const alcanza = dinero >= PRECIOS[id][0];
            b.type = "button"; b.className = "tBtn" + (alcanza ? "" : " no");
            b.innerHTML = ITEMS[id].e + " " + ITEMS[id].n + "<small>Comprar: $" + PRECIOS[id][0] + "</small>";
            b.addEventListener("click", function () {
                if (dinero < PRECIOS[id][0]) { avisar("No te alcanza la plata", 1500); return; }
                if (!agregarItem(id)) { avisar("No tenés lugar", 1800); return; }
                dinero -= PRECIOS[id][0];
                pintarBarra();
                avisar("Compraste: " + ITEMS[id].n + " (-$" + PRECIOS[id][0] + ")", 1500);
                pintarTienda();
            });
            comprar.appendChild(b);
        });
    }
    function abrirTienda() {
        if (tiendaAbierta || !sv.activo || !sv.vivo || window.juegoPausado) return;
        if (inv.abierto) cerrarInventario();
        tiendaAbierta = true;
        window.inventarioAbierto = true;
        if (sv.durmiendo) despertar();
        if (window.soltarControles) window.soltarControles();
        try { document.exitPointerLock(); } catch (e) {}
        pintarTienda();
        panelTienda.classList.add("visible");
    }
    function cerrarTienda() {
        if (!tiendaAbierta) return;
        tiendaAbierta = false;
        window.inventarioAbierto = !!inv.abierto;
        panelTienda.classList.remove("visible");
        if (!("ontouchstart" in window) && !inv.abierto) { try { canvas.requestPointerLock(); } catch (e) {} }
    }
    panelTienda.querySelector(".tCerrar").addEventListener("click", cerrarTienda);
    panelTienda.addEventListener("click", function (e) { if (e.target === panelTienda) cerrarTienda(); });
    (function () {
        const cerrarPrev = window.cerrarInventario;
        window.cerrarInventario = function () {
            if (tiendaAbierta) { cerrarTienda(); return; }
            cerrarPrev();
        };
    })();

    // Se llama en cada cuadro desde el reloj
    function actualizarSalidaCasa() {
        const abierta = zona === "casa" && salidaAbierta();
        if (destinosAbierto && !abierta) cerrarDestinos();       // amaneció con el menú abierto
        const ver = abierta && !destinosAbierto && !inv.abierto && sv.vivo && !window.juegoPausado;
        const disp = ver ? "block" : "none";
        if (btnSalirCasa.style.display !== disp) btnSalirCasa.style.display = disp;
        if (zona === "casa") {
            if (salidaPrev === null) {
                avisar("Estás en tu casa: podés salir por la puerta cuando quieras", 5000);
            } else if (abierta !== salidaPrev) {
                avisar(abierta ? "Ya podés salir por la puerta" : "La puerta está cerrada", 4000);
            }
            salidaPrev = abierta;
        } else {
            salidaPrev = null;
        }
    }

    // ===== BUCLE DEL JUEGO =====
    let anterior = performance.now();

    let tCongelado = null, ultimoDibujoPausa = 0;

    // Dibuja la escena entera con la cámara donde está (también se usa en pausa)
    function dibujarEscena(ahora, limpBob) {
        if (!estacionesJuego.ambiente) return;
        const proyeccion = perspectiva(
            Math.PI / 3, canvas.width / canvas.height, 0.1, 100
        );
        const vista = multiplicar(
            rotarX(-pitch),
            multiplicar(rotarY(-yaw), trasladar(-px, -(alturaCam + limpBob + saltoY), -pz))
        );
        gl.uniformMatrix4fv(uCamara, false, multiplicar(proyeccion, vista));

        const cielo = estacionesJuego.ambiente.cielo;
        gl.clearColor(cielo[0], cielo[1], cielo[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        configurarAtributos(buffer);
        gl.drawArrays(gl.TRIANGLES, 0, cantidad);
        dibujarAberturas();
        dibujarOtros();
        dibujarNpcs();
        dibujarItems(ahora / 1000);
        dibujarSombras();
        dibujarVidrios();
        dibujarMano(proyeccion, ahora / 1000);
        dibujarMapa();
    }

    function animar(ahora) {
        const msReales = ahora - anterior;
        const dt = Math.min(msReales / 1000, 0.05);
        anterior = ahora;
       
        // En pausa el juego queda quieto, pero se vuelve a dibujar la escena si cambió la pantalla
        // (girar el celular, bajar la barra de arriba, volver de otra app) para que no quede en blanco
        if (window.juegoPausado) {
            if (tCongelado === null) tCongelado = ahora;
            if (pantallaCambio || ahora - ultimoDibujoPausa > 400) {
                pantallaCambio = false;
                ultimoDibujoPausa = ahora;
                try { dibujarEscena(tCongelado, 0); } catch (e) {}
            }
            requestAnimationFrame(animar);
            return;
        }
        tCongelado = null;

        actualizarAberturas(dt);
        actualizarNpcs(dt);
        actualizarVoz(dt);
        const multEstacion = actualizarEstaciones(dt, msReales);
        const multSupervivencia = actualizarSupervivencia(dt, msReales);

        // Mirar con las flechas
        if (teclas["ArrowLeft"]) yaw += 1.8 * dt;
        if (teclas["ArrowRight"]) yaw -= 1.8 * dt;
        if (teclas["ArrowUp"]) pitch += 1.5 * dt;
        if (teclas["ArrowDown"]) pitch -= 1.5 * dt;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));

       // Moverse
        const K = A.teclas;
        let adelante = 0;
        let lado = 0;
        if (teclas[K.adelante]) adelante += 1;
        if (teclas[K.atras]) adelante -= 1;
        if (teclas[K.derecha]) lado += 1;
        if (teclas[K.izquierda]) lado -= 1;
        // Joystick (celu): la dirección sale de la perilla y la velocidad de qué tan lejos la llevás
        const joyM = Math.min(1, Math.hypot(joyAdelante, joyLado));
        const usaJoy = adelante === 0 && lado === 0 && joyM > 0;
        if (usaJoy) {
            adelante = joyAdelante / joyM;
            lado = joyLado / joyM;
        }

        // Dormir: si te movés te despertás; dormido o muerto no te movés
        if (sv.durmiendo && (adelante !== 0 || lado !== 0)) despertar();
        if (sv.durmiendo || !sv.vivo || destinosAbierto) { adelante = 0; lado = 0; }

        // Piernas, postura y velocidad
        const lesion = sv.piernas[0].n + sv.piernas[1].n;                     // 0 a 4
        const hayFractura = sv.piernas[0].n === 2 || sv.piernas[1].n === 2;
        const sinPiernas = ambasPiernasRotas() && !muletasEnMano();
        if (sinPiernas && postura !== 2 && sv.vivo) {
            postura = 2;
            avisar("Tenés las dos piernas rotas: te tenés que arrastrar", 3000);
        }
        golpeT += dt;
        if (modoPelea && performance.now() > peleaHasta) modoPelea = false;
        const quiereCorrer = (teclas[K.correr] || correrCelu) && !sv.durmiendo;
        let corre = quiereCorrer && postura === 0 && lesion <= 1;
        let joyF = 1;
        if (usaJoy) {
            if (postura === 0) {
                const puedeCorrer = lesion <= 1;
                const vJoy = joyM < 0.6 ? 3 * joyM / 0.6 : 3 + (puedeCorrer ? 3 * (joyM - 0.6) / 0.4 : 0);   // 0–3 caminando, 3–6 corriendo
                corre = puedeCorrer && joyM > 0.8;
                joyF = vJoy / (corre ? 6 : 3);
            } else {
                joyF = Math.min(1, joyM / 0.6);
            }
        }
        let velBase;
        if (postura === 2) velBase = 0.75 * (sinPiernas ? 0.8 : 1);           // arrastrándote
        else if (postura === 1) velBase = 1.65 * factorPiernas();             // agachado
        else velBase = (corre ? 6 : 3) * factorPiernas();
        const velocidad = velBase * joyF * multEstacion * multSupervivencia;

        // Ruido que hacés: de pie corriendo se oye lejos, agachado poco, arrastrándote casi nada
        const seMueve = adelante !== 0 || lado !== 0;
        animCorre = !!corre;
        if (baile && (seMueve || postura !== 0 || saltoY > 0 || modoPelea || sv.durmiendo || !sv.vivo)) pararBaile();
        animMov += ((seMueve && sv.vivo && !sv.durmiendo ? 1 : 0) - animMov) * Math.min(1, dt * 8);
        if (seMueve) animFase += dt * (postura === 2 ? 3.5 : Math.max(2.5, Math.min(16, velocidad * 2.4)));
        const ruidoBase = !seMueve ? 0 : postura === 2 ? 1.5 : postura === 1 ? 4.5 : (corre ? 22 : 11);
        ruidoPulso = Math.max(0, ruidoPulso - dt * 12);
        ruidoRadio = Math.max(ruidoBase, ruidoPulso);
        const seno = Math.sin(yaw);
        const coseno = Math.cos(yaw);

        const dx = (-seno * adelante + coseno * lado) * velocidad * dt;
        const dz = (-coseno * adelante - seno * lado) * velocidad * dt;

        if (!choca(px + dx, pz, saltoY)) px += dx;
        if (!choca(px, pz + dz, saltoY)) pz += dz;
        // Saltar y caer (se puede subir arriba de los objetos)
        const sueloAhora = alturaSuelo(px, pz, saltoY);
        if ((teclas[K.saltar] || pidioSaltar) && saltoY <= sueloAhora + 0.02 && !sv.durmiendo && sv.vivo) {
            if (postura !== 0) {
                if (!sinPiernas) postura = 0;                    // saltar primero te para
            } else if (hayFractura) {
                if (ahora - avisoSaltoT > 2500) { avisoSaltoT = ahora; avisar("Con la pierna rota no podés saltar", 1800); }
            } else {
                velY = lesion > 0 ? 4.8 : 6;
                ruidoPulso = Math.max(ruidoPulso, 14);
            }
        }
        pidioSaltar = false;
        const yAntes = saltoY;
        velY -= GRAVEDAD * dt;
        saltoY += velY * dt;
        if (velY > 0) {
            // el techo (y los cabezales) te frenan la cabeza: no se atraviesan saltando
            const tope = limiteCabeza(px, pz, yAntes, saltoY);
            if (tope !== null) { saltoY = Math.max(yAntes, tope); velY = 0; }
        }
        const piso = alturaSuelo(px, pz, yAntes);
        if (saltoY <= piso) {
            aterrizar(-velY);     // daño, esguinces y fracturas según la caída
            saltoY = piso;
            velY = 0;
        }

        actualizarCruce(dt);                       // cruzando una ventana
        actualizarVidrios(dt, seMueve);            // sacando vidrios

        // Cámara: más baja agachado o arrastrándote, y con un vaivén si rengueás
        const alturaObj = postura === 2 ? 0.45 : postura === 1 ? 1.05 : altura;
        alturaCam += (alturaObj - alturaCam) * Math.min(1, dt * 10);
        const limpBob = (lesion > 0 && seMueve && postura !== 2) ? -Math.abs(Math.sin(ahora / 1000 * (4 + (corre ? 2 : 0)))) * 0.035 * Math.min(lesion, 3) : 0;
        actualizarBotonesTactiles();

        // Cámara y dibujo
        dibujarEscena(ahora, limpBob);

        requestAnimationFrame(animar);
    }

    requestAnimationFrame(animar);
}