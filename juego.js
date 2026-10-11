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
            colisiones.push([x1, z1, x2, z2]);
        }
    }

    const PARED = [0.55, 0.50, 0.45];
    const MADERA = [0.45, 0.30, 0.18];
    const CAJA = [0.55, 0.42, 0.22];
    const ESCOMBRO = [0.40, 0.38, 0.36];

    // Suelo
    caja(-25, -0.1, -25, 25, 0, 25, [0.25, 0.26, 0.28], false);

    // Calles y casas (el mapa usa estos mismos datos): [x1, z1, x2, z2]
    const MUNDO_MITAD = 25;
    const CALLES = [[-25, 11, 25, 15], [14, -25, 18, 11], [14, 15, 18, 25]];
    const CASAS = [[-5, -5, 5, 5]];
    const CALLE_COLOR = [0.38, 0.38, 0.40];
    for (const c of CALLES) {
        caja(c[0], -0.1, c[1], c[2], 0.02, c[3], CALLE_COLOR, false);
    }

    // Casa (de x -5 a 5, z -5 a 5)
    // Pared de adelante, con puerta en el medio
    caja(-5, 0, 4.7, -1, 3, 5, PARED, true);
    caja(1, 0, 4.7, 5, 3, 5, PARED, true);
    caja(-1, 2.2, 4.7, 1, 3, 5, PARED, false);
    // Pared de atrás, con ventana
    caja(-5, 0, -5, 2, 3, -4.7, PARED, true);
    caja(3.5, 0, -5, 5, 3, -4.7, PARED, true);
    caja(2, 0, -5, 3.5, 0.9, -4.7, PARED, true);
    caja(2, 2.1, -5, 3.5, 3, -4.7, PARED, false);
    // Pared izquierda y derecha
    caja(-5, 0, -4.7, -4.7, 3, 4.7, PARED, true);
    caja(4.7, 0, -4.7, 5, 3, 4.7, PARED, true);

    // Muebles adentro
    caja(-3.5, 0, -3.5, -1.5, 0.8, -2.5, MADERA, true);       // mesa
    caja(-4.5, 0, 0, -2.5, 0.5, 2.5, [0.6, 0.3, 0.3], true);  // cama
    caja(3.5, 0, -4.5, 4.6, 2, -3.5, MADERA, true);           // estante
    caja(2.5, 0, 1, 3.5, 1, 2, CAJA, true);                   // caja
    caja(3.5, 0, 1.5, 4.5, 0.6, 2.5, CAJA, true);             // caja chica

    // Afuera
    caja(-9, 0, 6, -7.5, 1.2, 7.5, CAJA, true);
    caja(-7.8, 0, 7.5, -6.8, 0.7, 8.5, CAJA, true);
    caja(8, 0, -2, 9, 2.5, -1, ESCOMBRO, true);
    caja(7, 0, 5, 10, 1, 5.5, ESCOMBRO, true);
    caja(-12, 0, -8, -11, 4, -7, ESCOMBRO, true);
    caja(-14, 0, -2, -12.5, 2, -0.5, ESCOMBRO, true);
    caja(10, 0, -9, 11, 5, -8, ESCOMBRO, true);

    const cantidad = datos.length / 6;
    const vertices = new Float32Array(datos);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

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
        varying vec3 vColor;
        varying float vDist;

        void main() {
            float niebla = clamp(vDist / nieblaDist, 0.0, 1.0);
            
            gl_FragColor = vec4(mix(vColor, fondo, niebla), 1.0);
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

    // ===== JUGADOR =====
    let px = 0;
    let pz = 9;
    const altura = 1.6;
    const radio = 0.3;
    let yaw = 0;
    let pitch = 0;

    function choca(x, z) {
        for (const b of colisiones) {
            if (x + radio > b[0] && x - radio < b[2] &&
                z + radio > b[1] && z - radio < b[3]) {
                return true;
            }
        }
        return false;
    }

    // ===== AJUSTES (se guardan en el dispositivo) =====
    const AJUSTES_BASE = {
        sensMouse: 1,
        sensDedo: 1,
        volumen: 1,
        silencio: false,
        invertirY: false,
        teclas: {
            adelante: "KeyW",
            atras: "KeyS",
            izquierda: "KeyA",
            derecha: "KeyD",
            saltar: "Space",
            correr: "ShiftLeft"
        }
    };

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
                this.guardar();
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

    canvas.addEventListener("touchstart", function (e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.clientX < window.innerWidth / 2 && dedoMover === null) {
                dedoMover = t.identifier;
                inicioX = t.clientX;
                inicioY = t.clientY;
            } else if (t.clientX >= window.innerWidth / 2 && dedoMirar === null) {
                dedoMirar = t.identifier;
                miraX = t.clientX;
                miraY = t.clientY;
            }
        }
    }, { passive: false });

    canvas.addEventListener("touchmove", function (e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier === dedoMover) {
                joyLado = Math.max(-1, Math.min(1, (t.clientX - inicioX) / 60));
                joyAdelante = Math.max(-1, Math.min(1, (inicioY - t.clientY) / 60));
            }
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
            if (t.identifier === dedoMover) {
                dedoMover = null;
                joyAdelante = 0;
                joyLado = 0;
            }
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
    };

    // Cartel de ayuda
    const ayuda = document.createElement("div");
    ayuda.style.cssText =
        "position:fixed;top:190px;left:16px;color:white;" +
        "font-family:sans-serif;font-size:16px;" +
        "background:rgba(0,0,0,0.6);padding:12px;border-radius:8px;";
    ayuda.innerHTML =
        "Haz clic para jugar<br>" +
        "W A S D: moverte<br>" +
        "Mouse: mirar<br>" +
        "Flechas: mirar con el teclado<br>" +
        "Shift: correr<br>" +
        "Esc: pausa"
    document.body.appendChild(ayuda); 
    if ("ontouchstart" in window) {
        ayuda.innerHTML = "Izquierda: mover<br>Derecha: mirar";
        ayuda.style.top = "130px";
        setTimeout(function () {
            ayuda.style.display = "none";
        }, 5000);
    }

    document.addEventListener("pointerlockchange", function () {
        ayuda.style.display =
            document.pointerLockElement === canvas ? "none" : "block";
    });

    function ajustarPantalla() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    window.addEventListener("resize", ajustarPantalla);
    ajustarPantalla();

    // ===== MULTIJUGADOR =====
    let miId = null;
    let otros = {};
    const bufferOtros = gl.createBuffer();

    // Dibuja una caja girada hacia donde mira el jugador
    function cajaGirada(lista, cx, cz, giro, ancho, y1, y2, largo, desvio, col) {
        const c = Math.cos(giro);
        const s = Math.sin(giro);

        function punto(lx, y, lz) {
            lz += desvio;
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

    function configurarAtributos(b) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.vertexAttribPointer(posicion, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
    }

    function dibujarOtros() {
        const lista = [];
        for (const id in otros) {
            if (id === String(miId)) continue;
            const j = otros[id];
         const colores = [
                [1.0, 0.55, 0.0], [0.3, 0.6, 1.0], [0.4, 0.9, 0.4],
                [0.95, 0.4, 0.7], [0.95, 0.9, 0.3], [0.6, 0.4, 0.95]
            ];
            const col = colores[(j.c || 0) % colores.length];
            const y = j.y || 0;
            cajaGirada(lista, j.x, j.z, j.yaw, 0.6, y, y + 1.7, 0.4, 0, col);
            cajaGirada(lista, j.x, j.z, j.yaw, 0.4, y + 1.35, y + 1.6, 0.3, -0.3, [0.9, 0.9, 1.0]);
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
                            desfaseMs: (mensaje.ahora || Date.now()) - Date.now()
                        });
                    }
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
            conexion.send(JSON.stringify({ x: px, z: pz, yaw: yaw, y: saltoY }));
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

    function crearBoton(texto, estilo) {
        const b = document.createElement("div");
        b.innerHTML = texto;
        b.style.cssText =
            "position:fixed;bottom:30px;width:90px;height:90px;" +
            "border-radius:50%;background:rgba(255,255,255,0.25);" +
            "color:white;font-family:sans-serif;font-size:16px;" +
            "display:flex;align-items:center;justify-content:center;" +
            "user-select:none;touch-action:none;" + estilo;
        document.body.appendChild(b);
        return b;
    }

    if ("ontouchstart" in window) {
        const botonSaltar = crearBoton("Saltar", "right:30px;");
        const botonCorrer = crearBoton("Correr", "left:30px;");

        botonSaltar.addEventListener("touchstart", function (e) {
            e.preventDefault();
            pidioSaltar = true;
        }, { passive: false });

        botonCorrer.addEventListener("touchstart", function (e) {
            e.preventDefault();
            correrCelu = !correrCelu;
            botonCorrer.style.background = correrCelu
                ? "rgba(255,140,0,0.7)"
                : "rgba(255,255,255,0.25)";
        }, { passive: false });
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
        '<svg class="rueda" viewBox="0 0 200 200">' +
        '<defs><radialGradient id="rBrillo" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#fff" stop-opacity="0.10"/>' +
        '<stop offset="70%" stop-color="#fff" stop-opacity="0"/>' +
        '<stop offset="100%" stop-color="#000" stop-opacity="0.30"/>' +
        '</radialGradient>' +
        '<filter id="rResplandor" x="-30%" y="-30%" width="160%" height="160%">' +
        '<feGaussianBlur stdDeviation="3.5" result="b"/>' +
        '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        '</filter></defs>' + svg + '</svg>' +
        '<div><div class="mapaTitulo">Mapa</div><canvas class="mapaCaja"></canvas></div>';
    document.body.appendChild(hudEstacion);

    const rAnio = hudEstacion.querySelector("#rAnio");
    const rDia = hudEstacion.querySelector("#rDia");
    const rNombre = hudEstacion.querySelector("#rNombre");
    const rFlecha = hudEstacion.querySelector("#rFlecha");
    const rBrilloC = hudEstacion.querySelector("#rBrilloC");

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
            puntoMapa(j.x, j.z, "#ffffff", 6);                              // los demás
        }
        puntoMapa(px, pz, "#e02b2b", 7);             // vos
    }

    window.iniciarEstaciones = function (config) {
        const e = estacionesJuego;
        e.activo = true;
        e.modo = config.modo;
        e.reloj = config.reloj;
        e.desfaseMs = config.desfaseMs || 0;
        e.tiempoJugadoMs = config.tiempoJugadoMs || 0;
        e.indiceAnterior = -1;
        e.textoHud = "";
        e.reiniciarAmbiente = true;
        window.reiniciarFlechaEstacion();
        hudEstacion.style.display = "flex";
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

    // ===== BUCLE DEL JUEGO =====
    let anterior = performance.now();

    function animar(ahora) {
        const msReales = ahora - anterior;
        const dt = Math.min(msReales / 1000, 0.05);
        anterior = ahora;
       
        // En pausa el juego queda quieto
        if (window.juegoPausado) {
            requestAnimationFrame(animar);
            return;
        }

        const multEstacion = actualizarEstaciones(dt, msReales);

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
        adelante += joyAdelante;
        lado += joyLado;

        const velocidad = ((teclas[K.correr] || correrCelu) ? 6 : 3) * multEstacion;
        const seno = Math.sin(yaw);
        const coseno = Math.cos(yaw);

        const dx = (-seno * adelante + coseno * lado) * velocidad * dt;
        const dz = (-coseno * adelante - seno * lado) * velocidad * dt;

        if (!choca(px + dx, pz)) px += dx;
        if (!choca(px, pz + dz)) pz += dz;
        // Saltar
        if ((teclas[K.saltar] || pidioSaltar) && saltoY === 0) {
            velY = 5;
        }
        pidioSaltar = false;
        velY -= 14 * dt;
        saltoY += velY * dt;
        if (saltoY < 0) {
            saltoY = 0;
            velY = 0;
        }

        // Cámara
        const proyeccion = perspectiva(
            Math.PI / 3, canvas.width / canvas.height, 0.1, 100
        );
        const vista = multiplicar(
            rotarX(-pitch),
            multiplicar(rotarY(-yaw), trasladar(-px, -(altura + saltoY), -pz))
        );
        gl.uniformMatrix4fv(uCamara, false, multiplicar(proyeccion, vista));

        const cielo = estacionesJuego.ambiente.cielo;
        gl.clearColor(cielo[0], cielo[1], cielo[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        configurarAtributos(buffer);
        gl.drawArrays(gl.TRIANGLES, 0, cantidad);
        dibujarOtros();
        dibujarMapa();

        requestAnimationFrame(animar);
    }

    requestAnimationFrame(animar);
}