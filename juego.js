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
    function caja(x1, y1, z1, x2, y2, z2, color, solida) {
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
                datos.push(cara[i][0], cara[i][1], cara[i][2], c[0], c[1], c[2]);
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
    let CAMAS = [];                         // [x1, z1, x2, z2]
    let MUNDO_INICIAL = [];                 // objetos sueltos { id, x, y, z }
    let SPAWN = { x: 0, z: 9, yaw: 0 };
    let semillaMundo = null;

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
        PUERTAS = []; VENTANAS = [];

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
                const W = rnd(8, 13), D = rnd(8, 12);
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
            construirCasa(9, 9, (g.r[0] + g.r[2]) / 2, (g.r[1] + g.r[3]) / 2, g.calle.zM ? 0 : g.calle.zm ? 1 : g.calle.xM ? 2 : 3);
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
    }
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
        if (document.pointerLockElement !== canvas || window.juegoPausado) return;
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

    window.desconectarServidor = function () {
        if (conexion) {
            conexion.onclose = null;
            conexion.onerror = null;
            try { conexion.close(); } catch (e) {}
            conexion = null;
        }
        miId = null;
        otros = {};
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
        rectMapa([-MUNDO_MITAD, -MUNDO_MITAD, MUNDO_MITAD, MUNDO_MITAD], "#3a3a3a"); // terrenos
        for (const calle of CALLES) rectMapa(calle, "#777777");             // calles
        for (const casa of CASAS) rectMapa(casa, "#c4c4c4");                // casas
        for (const id in otros) {
            if (id === String(miId)) continue;
            const j = otros[id];
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
        px = SPAWN.x; pz = SPAWN.z; yaw = SPAWN.yaw; pitch = 0; saltoY = 0; velY = 0;
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

        // Hora del día: 1 día = 1 hora real, y el día arranca a las 7:00 a.m.
        const msJuego = e.modo === "online" ? Date.now() + e.desfaseMs : e.tiempoJugadoMs;
        const frac = (Math.max(0, msJuego - e.reloj.inicioMs) % Estaciones.MS_POR_DIA) / Estaciones.MS_POR_DIA;
        const minDia = Math.floor(frac * 1440 + 7 * 60) % 1440;
        e.minDia = minDia;
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
    // Salud, sed, hambre, sueño y cordura. 1 día del juego = 1 hora real (igual que las estaciones).
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
    const DIA_JUEGO_MS = 60 * 60 * 1000;

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
        px = SPAWN.x; pz = SPAWN.z; yaw = SPAWN.yaw; pitch = 0;
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
        inv.sel = null;
        refrescarInventario();
    }

    // Objeto del mapa que tenés al alcance (o null)
    function itemCercano() {
        let mejor = null, mejorD = 1.7;
        for (const it of inv.mundo) {
            const d = Math.hypot(it.x - px, it.z - pz);
            const dy = it.y - saltoY;
            if (d < mejorD && dy > -1.2 && dy < 1.7) { mejor = it; mejorD = d; }
        }
        return mejor;
    }
    // Devuelve true si había un objeto cerca (aunque no hayas tenido lugar)
    function recogerCercano() {
        const it = itemCercano();
        if (!it) return false;
        if (agregarItem(it.id, it.c)) {
            inv.mundo.splice(inv.mundo.indexOf(it), 1);
            avisar("Recogiste: " + ITEMS[it.id].n, 2000);
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
        if (o.esPuerta) {
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
            if (dentro(otros[id].x, otros[id].z, otros[id].y || 0)) return true;
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
        const o = aberturaCercana();
        if (!o) return false;
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
        PUERTAS.concat(VENTANAS).forEach(function (o) { e[o.k] = [o.abierta ? 1 : 0, (o.esPuerta ? o.trabada : o.rota) ? 1 : 0]; });
        return e;
    }
    function aplicarEstados(e, instantaneo, remoto) {
        if (!e || typeof e !== "object") return;
        PUERTAS.concat(VENTANAS).forEach(function (o) {
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
        PUERTAS.concat(VENTANAS).forEach(function (o) {
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
        ajustarContenedores();
        hudBajo.style.display = "flex";
        pintarBarra();
    }

    function exportarInventario() {
        return {
            v: 4,
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
        if (!sv.activo || inv.mundo.length === 0) return;
        const lista = [];
        for (const it of inv.mundo) {
            if (Math.hypot(it.x - px, it.z - pz) > 40) continue;
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
        const txtAb = ab ? textoAbertura(ab, tactil) : null;
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
            const dx = j.x - px, dz = j.z - pz;
            const d = Math.hypot(dx, dz);
            if (d > arma.alcance + 0.3) continue;
            if (d > 0.5 && (dx * fx + dz * fz) / d < 0.7) continue;     // tiene que estar más o menos adelante
            if (Math.abs((j.y || 0) - saltoY) > 1.2) continue;
            if (d < mejorD) { mejorD = d; mejor = oid; }
        }
        if (mejor === null) {                      // si no le pegás a nadie, y apuntás a una ventana cerrada, la rompés
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
        if (sv.durmiendo || !sv.vivo) { adelante = 0; lado = 0; }

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