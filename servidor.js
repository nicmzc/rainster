const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const crypto = require("crypto");
const Estaciones = require("./estaciones.js");

const PUERTO = process.env.PORT || 3000;
const permitidos = [
    "rainster.html", "juego.js", "manifest.webmanifest",
    "sw.js", "estaciones.js", "icono.rainster.png", "icono.rainster2.png",
    "assetlinks.json"
];
const tipos = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".jpeg": "image/jpeg",
    ".json": "application/json"
};

// Daño y alcance de cada golpe (el servidor decide; el alcance es el del juego + un margen por la demora de la red)
const ARMAS = {
    puno: { dano: 5, alcance: 2.4, espera: 300 },
    palo: { dano: 12, alcance: 3.0, espera: 450 },
    cuchillo: { dano: 20, alcance: 2.6, espera: 320 },
    hacha: { dano: 30, alcance: 2.9, espera: 800 }
};

// ===== SERVIDORES (SALAS) =====
const salas = {};
let siguienteSala = 1;
let siguienteId = 1;
const MAX_SALAS = 100;
const MAX_SALAS_POR_IP = 3;
const ESPERA_VACIA = 30000; // una sala vacía se borra a los 30 segundos

// IP de quien pide (detrás de un proxy como Render viene en x-forwarded-for)
function ipDe(req) {
    const reenviada = req.headers["x-forwarded-for"];
    const ip = reenviada ? String(reenviada).split(",")[0].trim() : req.socket.remoteAddress;
    return String(ip || "").replace(/^::ffff:/, "");
}

function esPrivada(ip) {
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(ip) ||
        ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}

// Dos dispositivos están en la misma red si tienen la misma IP pública o los dos son locales
function mismaRed(a, b) {
    return a === b || (esPrivada(a) && esPrivada(b));
}

// Los servidores online los ve todo el mundo; los LAN solo quien está en la misma red
function visible(sala, ip) {
    return sala.tipo === "online" || mismaRed(sala.ip, ip);
}

function limpiar(texto, maximo) {
    return String(texto || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, maximo);
}

function responder(res, codigo, datos) {
    res.writeHead(codigo, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(datos));
}

// ===== PAUSA DEL ANFITRIÓN =====
// Le manda un mensaje a todos los que están en la sala
function enviarASala(sala, mensaje) {
    const texto = JSON.stringify(mensaje);
    for (const cliente of sala.sockets) {
        if (cliente.readyState === WebSocket.OPEN) {
            try { cliente.send(texto); } catch (e) {}
        }
    }
}

// Reanuda la partida para todos. El reloj de las estaciones no avanza mientras está en pausa.
function reanudarSala(sala) {
    if (!sala.pausada) return;
    sala.pausada = false;
    sala.reloj.inicioMs += Date.now() - sala.pausadaDesde;
    sala.pausadaDesde = null;
    sala.pausadoPor = null;
    enviarASala(sala, { tipo: "pausa", pausado: false, reloj: sala.reloj, ahora: Date.now() });
}

// Solo el dueño del servidor (el que tiene el token) puede pausar o reanudar
function cambiarPausa(sala, socket, datos) {
    if (!datos.token || datos.token !== sala.token) return;
    if (datos.pausado === true) {
        sala.pausadoPor = socket;
        if (sala.pausada) return;
        sala.pausada = true;
        sala.pausadaDesde = Date.now();
        enviarASala(sala, { tipo: "pausa", pausado: true, host: sala.host });
    } else {
        reanudarSala(sala);
    }
}

// Muestra la página del juego y la lista de servidores
const servidor = http.createServer(function (req, res) {
    let pedido = req.url.split("?")[0];

    if (pedido === "/api/servidores/cerrar") {
        if (req.method !== "POST") { responder(res, 405, { error: "Método no permitido" }); return; }
        let cuerpo = "";
        req.on("data", function (trozo) {
            cuerpo += trozo;
            if (cuerpo.length > 2000) req.destroy();
        });
        req.on("end", function () {
            let datos;
            try { datos = JSON.parse(cuerpo); } catch (e) {
                responder(res, 400, { error: "Datos inválidos" });
                return;
            }
            const sala = salas[datos.id];
            if (!sala) { responder(res, 404, { error: "Ese servidor ya no existe" }); return; }
            if (!datos.token || datos.token !== sala.token) {
                responder(res, 403, { error: "No sos el dueño de este servidor" });
                return;
            }
            for (const cliente of sala.sockets) {
                try { cliente.send(JSON.stringify({ tipo: "cerrado" })); } catch (e) {}
                try { cliente.close(); } catch (e) {}
            }
            delete salas[datos.id];
            responder(res, 200, { ok: true });
        });
        return;
    }

    if (pedido === "/api/servidores") {
        const ip = ipDe(req);

        if (req.method === "GET") {
            const lista = Object.values(salas)
                .filter(function (s) { return visible(s, ip); })
                .sort(function (a, b) { return b.creada - a.creada; })
                .map(function (s) {
                    return {
                        id: s.id, nombre: s.nombre, host: s.host, tipo: s.tipo,
                        max: s.max, jugadores: s.sockets.size,
                        estacion: Estaciones.obtenerEstado(s.reloj).estacion.nombre
                    };
                });
            responder(res, 200, lista);
            return;
        }

        if (req.method === "POST") {
            let cuerpo = "";
            req.on("data", function (trozo) {
                cuerpo += trozo;
                if (cuerpo.length > 2000) req.destroy();
            });
            req.on("end", function () {
                let datos;
                try { datos = JSON.parse(cuerpo); } catch (e) {
                    responder(res, 400, { error: "Datos inválidos" });
                    return;
                }
                const nombre = limpiar(datos.nombre, 30);
                const host = limpiar(datos.host, 20) || "Jugador";
                const tipo = datos.tipo === "lan" ? "lan" : "online";
                const max = Math.max(2, Math.min(10, parseInt(datos.max, 10) || 10));
                const estacionInicial = Estaciones.OPCIONES_ESTACION_INICIAL.includes(datos.estacionInicial)
                    ? datos.estacionInicial : "otono";
                if (!nombre) {
                    responder(res, 400, { error: "Ponele un nombre al servidor" });
                    return;
                }
                const propias = Object.values(salas).filter(function (s) { return s.ip === ip; }).length;
                if (propias >= MAX_SALAS_POR_IP) {
                    responder(res, 429, { error: "Ya tenés " + MAX_SALAS_POR_IP + " servidores creados" });
                    return;
                }
                if (Object.keys(salas).length >= MAX_SALAS) {
                    responder(res, 503, { error: "Hay demasiados servidores, probá más tarde" });
                    return;
                }
                const id = "s" + (siguienteSala++);
                salas[id] = {
                    id: id, token: crypto.randomBytes(16).toString("hex"),
                    nombre: nombre, host: host, tipo: tipo, max: max, ip: ip,
                    jugadores: {}, sockets: new Set(), creada: Date.now(), vacioDesde: Date.now(),
                    reloj: Estaciones.crearReloj({ estacionInicial: estacionInicial }),
                    semilla: crypto.randomInt(1, 2147483647),   // de acá sale el mapa: todos los jugadores ven el mismo
                    pausada: false, pausadaDesde: null, pausadoPor: null,
                    aberturas: {},     // estado de puertas y ventanas: { "p3": [abierta, trabada] }
                    itemsRet: {},      // objetos del mapa original que ya se llevaron: { "i5": 1 }
                    itemsSuel: {},     // objetos que alguien tiró: { "d3_1": { id, x, y, z, c } }
                    autoridad: null,   // el jugador cuyo cliente maneja a los NPCs (si se va, pasa al siguiente)
                    npcsSnap: null     // última foto de los NPCs (para el que entra después o toma el mando)
                };
                responder(res, 200, { id: id, token: salas[id].token });
            });
            return;
        }

        responder(res, 405, { error: "Método no permitido" });
        return;
    }

    if (pedido === "/") pedido = "/rainster.html";

    const nombre = path.basename(pedido);
    if (!permitidos.includes(nombre)) {
        res.writeHead(404);
        res.end("No encontrado");
        return;
    }

    fs.readFile(path.join(__dirname, nombre), function (error, contenido) {
        if (error) {
            res.writeHead(404);
            res.end("No encontrado");
            return;
        }
        res.writeHead(200, { "Content-Type": tipos[path.extname(nombre)] });
        res.end(contenido);
    });
});

// Conecta a los jugadores a la sala que eligieron
const wss = new WebSocket.Server({ server: servidor });

wss.on("connection", function (socket, req) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const sala = salas[params.get("sala")];
    const ip = ipDe(req);

    function rechazar(motivo) {
        try { socket.send(JSON.stringify({ tipo: "error", motivo: motivo })); } catch (e) {}
        socket.close();
    }

    socket.on("error", function () {});

    if (!sala) return rechazar("Ese servidor ya no existe");
    if (!visible(sala, ip)) return rechazar("Ese servidor es solo para su red local (LAN)");
    if (sala.sockets.size >= sala.max) return rechazar("El servidor está lleno");

    const id = siguienteId++;
    socket.jugadorId = id;
    let ultimoGolpe = 0;
    let ultimoDice = 0;      // última vez que este jugador hizo hablar a un NPC (respuestas de internet)
    sala.sockets.add(socket);
    sala.vacioDesde = null;
    sala.jugadores[id] = { x: 0, z: 9, yaw: 0, y: 0, c: id % 6, n: limpiar(params.get("nombre"), 20) || "Jugador" };
    if (!sala.autoridad || !sala.sockets.has(sala.autoridad)) sala.autoridad = socket;
    socket.send(JSON.stringify({
        tipo: "hola", id: id, reloj: sala.reloj, semilla: sala.semilla, ahora: Date.now(),
        pausada: sala.pausada, host: sala.host, aberturas: sala.aberturas,
        items: { ret: Object.keys(sala.itemsRet), suel: sala.itemsSuel },
        npcs: sala.npcsSnap, autoridad: sala.autoridad === socket
    }));

    socket.on("message", function (mensaje) {
        try {
            const datos = JSON.parse(mensaje);
            if (datos.tipo === "pausa") {
                cambiarPausa(sala, socket, datos);
                return;
            }
            if (datos.tipo === "abertura") {
                // alguien abrió o cerró una puerta/ventana: se guarda (para los que entren después) y se avisa a los demás
                if (typeof datos.k !== "string" || !/^[pv]\d{1,3}(_\d{1,2})?$/.test(datos.k)) return;
                const a = datos.a ? 1 : 0, t = datos.t ? 1 : 0;
                if (Object.keys(sala.aberturas).length > 600 && !sala.aberturas[datos.k]) return;
                sala.aberturas[datos.k] = [a, t];
                const aviso = JSON.stringify({ tipo: "abertura", k: datos.k, a: a, t: t });
                for (const otro of sala.sockets) {
                    if (otro !== socket && otro.readyState === WebSocket.OPEN) otro.send(aviso);
                }
                return;
            }
            if (datos.tipo === "soltar") {
                // alguien tiró un objeto: queda guardado en la sala y lo ven todos
                if (typeof datos.k !== "string" || !/^d\d{1,7}_\d{1,7}$/.test(datos.k)) return;
                if (typeof datos.id !== "string" || !/^[a-z]{1,12}\d{0,2}$/.test(datos.id)) return;
                if (![datos.x, datos.y, datos.z].every(function (v) { return typeof v === "number" && isFinite(v); })) return;
                if (Math.abs(datos.x) > 100 || Math.abs(datos.z) > 100 || datos.y < -1 || datos.y > 30) return;
                if (sala.itemsSuel[datos.k] || Object.keys(sala.itemsSuel).length >= 500) return;
                const it = { id: datos.id, x: datos.x, y: datos.y, z: datos.z };
                if (Array.isArray(datos.c) && datos.c.length <= 12 &&
                    datos.c.every(function (q) { return q === null || (typeof q === "string" && /^[a-z]{1,12}\d{0,2}$/.test(q)); })) it.c = datos.c;
                sala.itemsSuel[datos.k] = it;
                const aviso = JSON.stringify({ tipo: "soltar", k: datos.k, id: it.id, x: it.x, y: it.y, z: it.z, c: it.c || null });
                for (const otro of sala.sockets) {
                    if (otro !== socket && otro.readyState === WebSocket.OPEN) otro.send(aviso);
                }
                return;
            }
            if (datos.tipo === "recoger") {
                // alguien levantó un objeto: desaparece para todos (el primero que llega se lo queda)
                if (typeof datos.k !== "string" || !/^[id]\d{1,7}(_\d{1,7})?$/.test(datos.k)) return;
                if (datos.k[0] === "d") {
                    if (!sala.itemsSuel[datos.k]) return;
                    delete sala.itemsSuel[datos.k];
                } else {
                    if (sala.itemsRet[datos.k] || Object.keys(sala.itemsRet).length >= 600) return;
                    sala.itemsRet[datos.k] = 1;
                }
                const aviso = JSON.stringify({ tipo: "recoger", k: datos.k });
                for (const otro of sala.sockets) {
                    if (otro !== socket && otro.readyState === WebSocket.OPEN) otro.send(aviso);
                }
                return;
            }
            if (datos.tipo === "npcs") {
                // solo el que manda sobre los NPCs puede decir dónde están: se guarda y se reenvía a los demás
                if (sala.autoridad !== socket || !Array.isArray(datos.n) || datos.n.length > 200) return;
                if (!datos.n.every(function (a) { return Array.isArray(a) && a.length <= 12 && a.every(function (v) { return typeof v === "number" && isFinite(v); }); })) return;
                sala.npcsSnap = datos.n;
                const aviso = JSON.stringify({ tipo: "npcs", n: datos.n });
                for (const otro of sala.sockets) {
                    if (otro !== socket && otro.readyState === WebSocket.OPEN) otro.send(aviso);
                }
                return;
            }
            if (datos.tipo === "npchabla") {
                if (sala.autoridad !== socket || !Number.isInteger(datos.i)) return;
                const aviso = JSON.stringify({ tipo: "npchabla", i: datos.i, t: limpiar(datos.t, 100) });
                for (const otro of sala.sockets) {
                    if (otro !== socket && otro.readyState === WebSocket.OPEN) otro.send(aviso);
                }
                return;
            }
            if (datos.tipo === "npcdice") {
                // un jugador (que no maneja a los NPCs) le preguntó algo a un NPC y la respuesta vino de internet: todos ven al NPC contestar
                const yo = sala.jugadores[id];
                const ahora = Date.now();
                if (!yo || sala.pausada || sala.autoridad === socket || !Number.isInteger(datos.i) || !sala.npcsSnap) return;
                const npc = sala.npcsSnap[datos.i];
                if (!npc || ahora - ultimoDice < 2000) return;
                if (Math.hypot(yo.x - npc[0], yo.z - npc[1]) > 14) return;     // tiene que estar cerca del NPC (la posición la pone el servidor)
                const texto = limpiar(datos.t, 100);
                if (!texto) return;
                ultimoDice = ahora;
                const aviso = JSON.stringify({ tipo: "npchabla", i: datos.i, t: texto });
                for (const otro of sala.sockets) {
                    if (otro !== socket && otro.readyState === WebSocket.OPEN) otro.send(aviso);
                }
                return;
            }
            if (datos.tipo === "npcdano") {
                // un NPC le pegó a un jugador (lo decide el que manda sobre los NPCs)
                if (sala.autoridad !== socket || sala.pausada) return;
                const dano = Math.max(0, Math.min(15, Number(datos.d) || 0));
                if (dano <= 0) return;
                for (const otro of sala.sockets) {
                    if (otro.jugadorId === Number(datos.a) && otro.readyState === WebSocket.OPEN) {
                        otro.send(JSON.stringify({ tipo: "golpe", de: 0, nombre: "el dueño de la casa", dano: dano }));
                    }
                }
                return;
            }
            if (datos.tipo === "npcgolpe") {
                // un jugador le pegó a un NPC: el servidor calcula el daño y se lo pasa al que maneja a los NPCs
                const yo = sala.jugadores[id];
                const arma = ARMAS[datos.arma];
                const ahora = Date.now();
                if (sala.pausada || !yo || !arma || !sala.autoridad || sala.autoridad === socket) return;
                if (!Number.isInteger(datos.i) || datos.i < 0) return;
                if (ahora - ultimoGolpe < arma.espera * 0.8) return;
                const npc = sala.npcsSnap && sala.npcsSnap[datos.i];
                if (npc && Math.hypot(yo.x - npc[0], yo.z - npc[1]) > arma.alcance + 0.5) return;
                ultimoGolpe = ahora;
                const fuerza = Math.max(0.3, Math.min(1, Number(datos.f) || 1));
                if (sala.autoridad.readyState === WebSocket.OPEN) {
                    sala.autoridad.send(JSON.stringify({ tipo: "npcgolpe", i: datos.i, dano: arma.dano * fuerza, de: id }));
                }
                return;
            }
            if (datos.tipo === "vozdice") {
                // un jugador le habló a los NPCs: se le pasa la intención y el volumen al que los maneja (la posición la pone el servidor)
                const yo = sala.jugadores[id];
                const intenciones = ["amenaza", "insulto", "calma", "ayuda", "saludo", "gracias", "despedida", "pregunta", "desconocido"];
                if (!yo || !sala.autoridad || sala.autoridad === socket || sala.pausada) return;
                if (intenciones.indexOf(datos.intent) < 0 || typeof datos.r !== "number" || !isFinite(datos.r)) return;
                if (sala.autoridad.readyState === WebSocket.OPEN) {
                    sala.autoridad.send(JSON.stringify({
                        tipo: "vozdice", de: id, intent: datos.intent, r: Math.max(0, Math.min(22, datos.r)),
                        g: datos.g ? 1 : 0, t: limpiar(datos.t, 140), x: yo.x, z: yo.z
                    }));
                }
                return;
            }
            if (datos.tipo === "robo") {
                // alguien se llevó algo de una casa: se le avisa al que maneja a los NPCs para que reaccionen
                if (!sala.autoridad || sala.autoridad === socket) return;
                if (typeof datos.x !== "number" || typeof datos.z !== "number") return;
                if (sala.autoridad.readyState === WebSocket.OPEN) {
                    sala.autoridad.send(JSON.stringify({ tipo: "robo", de: id, x: datos.x, z: datos.z }));
                }
                return;
            }
            if (datos.tipo === "golpe") {
                const yo = sala.jugadores[id];
                const blancoId = Number(datos.a);
                const blanco = sala.jugadores[blancoId];
                const arma = ARMAS[datos.arma];
                const ahora = Date.now();
                if (sala.pausada || !yo || !blanco || !arma || blancoId === id) return;
                if (ahora - ultimoGolpe < arma.espera * 0.8) return;
                if (Math.hypot(yo.x - blanco.x, yo.z - blanco.z) > arma.alcance) return;
                ultimoGolpe = ahora;
                const fuerza = Math.max(0.3, Math.min(1, Number(datos.f) || 1));
                for (const otro of sala.sockets) {
                    if (otro.jugadorId === blancoId && otro.readyState === WebSocket.OPEN) {
                        otro.send(JSON.stringify({ tipo: "golpe", de: id, nombre: yo.n, dano: arma.dano * fuerza }));
                    }
                }
                return;
            }
            if (sala.jugadores[id] &&
                typeof datos.x === "number" &&
                typeof datos.z === "number" &&
                typeof datos.yaw === "number") {
                sala.jugadores[id] = {
                    x: datos.x,
                    z: datos.z,
                    yaw: datos.yaw,
                    y: typeof datos.y === "number" ? datos.y : 0,
                    p: datos.p === 1 || datos.p === 2 ? datos.p : 0,
                    m: typeof datos.m === "string" && /^[a-z]{1,12}$/.test(datos.m) ? datos.m : "",
                    pe: datos.pe ? 1 : 0,
                    r: typeof datos.r === "number" ? Math.max(0, Math.min(60, datos.r)) : 0,
                    g: typeof datos.g === "number" ? Math.floor(datos.g) % 100000 : 0,
                    c: sala.jugadores[id].c,
                    col: typeof datos.col === "string" && /^#[0-9a-fA-F]{6}$/.test(datos.col) ? datos.col : "",
                    // cómo se ve el jugador para los demás (cabeza, manos, ropa, piernas y movimiento)
                    pi: typeof datos.pi === "number" ? Math.max(-1.6, Math.min(1.6, datos.pi)) : 0,
                    md: typeof datos.md === "string" && /^[a-z]{0,12}$/.test(datos.md) ? datos.md : "",
                    mi: typeof datos.mi === "string" && /^[a-z]{0,12}$/.test(datos.mi) ? datos.mi : "",
                    q: typeof datos.q === "string" && /^([a-z]{0,12},){4}[a-z]{0,12}$/.test(datos.q) ? datos.q : ",,,,",
                    ad: typeof datos.ad === "string" && /^([a-z_]{0,16},){2}[a-z_]{0,16}$/.test(datos.ad) ? datos.ad : ",,",
                    ba: typeof datos.ba === "string" && /^[a-z_]{0,12}$/.test(datos.ba) ? datos.ba : "",
                    pl: Number.isInteger(datos.pl) && datos.pl >= 0 && datos.pl <= 8 ? datos.pl : 0,
                    am: typeof datos.am === "number" ? Math.max(0, Math.min(1, datos.am)) : 0,
                    ac: datos.ac ? 1 : 0,
                    zn: Number.isInteger(datos.zn) && datos.zn >= 0 && datos.zn <= 3 ? datos.zn : 0,      // 0 = zona de guerra (el barrio), 1 = su casa, 2 = supermercado, 3 = compra y venta
                    n: sala.jugadores[id].n
                };
            }
        } catch (e) {}
    });

    socket.on("close", function () {
        sala.sockets.delete(socket);
        if (sala.autoridad === socket) {
            sala.autoridad = null;
            for (const otro of sala.sockets) {
                if (otro.readyState === WebSocket.OPEN) {
                    sala.autoridad = otro;
                    try { otro.send(JSON.stringify({ tipo: "autoridad", si: true })); } catch (e) {}
                    break;
                }
            }
        }
        if (sala.pausada && sala.pausadoPor === socket) reanudarSala(sala);
        delete sala.jugadores[id];
        if (sala.sockets.size === 0) sala.vacioDesde = Date.now();
    });
});

// Cada 50 milisegundos le avisa a cada sala dónde está cada jugador
setInterval(function () {
    for (const id in salas) {
        const sala = salas[id];
        if (sala.sockets.size === 0) continue;
        const mensaje = JSON.stringify({ tipo: "jugadores", jugadores: sala.jugadores });
        for (const cliente of sala.sockets) {
            if (cliente.readyState === WebSocket.OPEN) {
                cliente.send(mensaje);
            }
        }
    }
}, 50);

// Borra los servidores que quedaron vacíos
setInterval(function () {
    const ahora = Date.now();
    for (const id in salas) {
        const s = salas[id];
        if (s.sockets.size === 0 && s.vacioDesde && ahora - s.vacioDesde > ESPERA_VACIA) {
            delete salas[id];
        }
    }
}, 5000);

servidor.listen(PUERTO, function () {
    console.log("Servidor listo en http://localhost:" + PUERTO);
});