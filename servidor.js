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
                    reloj: Estaciones.crearReloj({ estacionInicial: estacionInicial })
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
    sala.sockets.add(socket);
    sala.vacioDesde = null;
    sala.jugadores[id] = { x: 0, z: 9, yaw: 0, y: 0, c: id % 6, n: limpiar(params.get("nombre"), 20) || "Jugador" };
    socket.send(JSON.stringify({ tipo: "hola", id: id, reloj: sala.reloj, ahora: Date.now() }));

    socket.on("message", function (mensaje) {
        try {
            const datos = JSON.parse(mensaje);
            if (sala.jugadores[id] &&
                typeof datos.x === "number" &&
                typeof datos.z === "number" &&
                typeof datos.yaw === "number") {
                sala.jugadores[id] = {
                    x: datos.x,
                    z: datos.z,
                    yaw: datos.yaw,
                    y: typeof datos.y === "number" ? datos.y : 0,
                    c: sala.jugadores[id].c,
                    n: sala.jugadores[id].n
                };
            }
        } catch (e) {}
    });

    socket.on("close", function () {
        sala.sockets.delete(socket);
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