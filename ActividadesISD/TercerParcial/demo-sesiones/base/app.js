// La aplicación de la demo. server.js la arranca; las pruebas la arrancan con otras configuraciones.
// Lo que dice "(en clase)" lo programamos juntos, paso por paso. Mientras no esté, esa ruta responde 501.
const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { crearModeloUsuarios } = require('./modelos/usuarios.modelo');
const { crearModeloTokens } = require('./modelos/tokens.modelo');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const NOMBRE_COOKIE = 'connect.sid';

// Regresa todas las sesiones del almacén (MemoryStore usa callback; MySQLStore regresa una promesa).
function todasLasSesiones(almacen) {
  return new Promise((resolve, reject) => {
    const promesa = almacen.all((error, sesiones) => (error ? reject(error) : resolve(sesiones)));
    if (promesa && typeof promesa.then === 'function') promesa.then(resolve, reject);
  });
}

// Respuesta para lo que todavía no programamos.
const pendiente = (paso) => (req, res) =>
  res.status(501).json({ error: `501 · Falta programarlo en clase (paso ${paso})` });

// pool: la conexión a MySQL (db.js). Los usuarios SIEMPRE se leen de MySQL.
function crearApp(config, pool) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  const usuarios = crearModeloUsuarios(pool);
  const tokens = crearModeloTokens(pool);

  // Aquí vive lo que el servidor recuerda de cada sesión:
  //  - 'mysql':   en la tabla sessions. Sobrevive a un reinicio y la puedes ver en Workbench.
  //  - 'memoria': en la memoria del proceso. Si el servidor se reinicia, se pierde todo.
  const almacen =
    config.almacen === 'memoria'
      ? new session.MemoryStore()
      : new MySQLStore({ createDatabaseTable: false, clearExpired: false }, pool);
  app.locals.almacen = almacen;

  // Paso 1: express-session ANTES de las rutas, para que todas tengan req.session.
  app.use(
    session({
      name: NOMBRE_COOKIE,
      secret: process.env.SESSION_SECRET || 'cambia-este-secreto', // firma la cookie: no se puede inventar un id
      store: almacen,
      resave: false, // no reescribe la sesión si no cambió
      saveUninitialized: false, // no crea cookie hasta que haya algo que guardar
      rolling: config.rolling,
      cookie: {
        maxAge: config.maxAgeMs,
        httpOnly: config.httpOnly,
        sameSite: config.sameSite,
        secure: false, // http://localhost; en producción (HTTPS) va en true
      },
    })
  );

  // El id de sesión que traía la cookie de la petición (antes de cualquier regenerate), o null.
  function idDeLaCookie(req) {
    const par = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${NOMBRE_COOKIE}=`));
    if (!par) return null;
    const valor = decodeURIComponent(par.slice(NOMBRE_COOKIE.length + 1));
    if (!valor.startsWith('s:')) return null;
    return valor.slice(2, valor.lastIndexOf('.'));
  }

  // Los primeros 8 caracteres del id de sesión, para poder compararlos en pantalla.
  const idCorto = (id) => (id ? `${id.slice(0, 8)}…` : null);

  // ---------- Middlewares de protección ----------

  // Paso 5: el SERVIDOR decide si la sesión venció (no solo el navegador con su Expires).
  // rolling: false → cuenta desde que se creó; rolling: true → desde la última vez que se usó.
  function vencida(sesion) {
    const desde = config.rolling ? sesion.ultimoUso : sesion.creada;
    return !desde || Date.now() - desde > config.maxAgeMs;
  }

  // 401: "no sé quién eres" (no hay sesión o ya venció).
  function requiereSesion(req, res, next) {
    if (!req.session || !req.session.usuario) {
      return res.status(401).json({ error: '401 · No has iniciado sesión (o tu sesión ya venció)' });
    }
    if (vencida(req.session)) {
      return req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie(NOMBRE_COOKIE);
        res.status(401).json({ error: '401 · Tu sesión venció: vuelve a iniciar sesión' });
      });
    }
    if (config.rolling) req.session.ultimoUso = Date.now(); // se usó: el reloj vuelve a empezar
    return next();
  }

  // 403: "sé quién eres, pero no tienes permiso".
  function requiereRol(rol) {
    return (req, res, next) => {
      if (req.session.usuario.rol === rol) return next();
      return res.status(403).json({ error: `403 · Eres ${req.session.usuario.usuario}, pero esta ruta es solo para ${rol}` });
    };
  }

  const intentosFallidos = {};
  const MAX_INTENTOS = 5;
  const BLOQUEO_MS = 60 * 1000;

  function estaBloqueado(ip) {
    const registro = intentosFallidos[ip];
    if (!registro) return false;
    if (registro.bloqueadoHasta && Date.now() < registro.bloqueadoHasta) return true;
    if (registro.bloqueadoHasta && Date.now() >= registro.bloqueadoHasta) delete intentosFallidos[ip];
    return false;
  }

  function sumarFallo(ip) {
    const registro = intentosFallidos[ip] || { fallos: 0, bloqueadoHasta: null };
    registro.fallos += 1;
    if (registro.fallos >= MAX_INTENTOS) registro.bloqueadoHasta = Date.now() + BLOQUEO_MS;
    intentosFallidos[ip] = registro;
  }

  function validarLogin(cuerpo) {
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return 'Manda un JSON con usuario y contrasena';
    const { usuario, contrasena } = cuerpo;
    if (usuario === undefined || contrasena === undefined) return 'Faltan datos: se necesita usuario y contrasena';
    if (typeof usuario !== 'string' || typeof contrasena !== 'string') return 'usuario y contrasena deben ser texto';
    if (usuario.trim() === '' || contrasena === '') return 'usuario y contrasena no pueden ir vacíos';
    if (usuario.length > 30) return 'El usuario no puede tener más de 30 caracteres';
    if (contrasena.length > 100) return 'La contraseña no puede tener más de 100 caracteres';
    if (!/^[a-zA-Z0-9._-]+$/.test(usuario.trim())) return 'El usuario solo puede tener letras, números, punto, guion o guion bajo';
    return null;
  }

  // ---------- Rutas ----------

  app.get('/api/config', (req, res) => res.json(config));

  // Guarda un contador en la sesión. Sirve para ver que la sesión existe antes de entrar
  // (y para la demostración de fijación de sesión).
  app.post('/api/visita', (req, res) => {
    if (!req.session) return pendiente(1)(req, res);
    req.session.visitas = (req.session.visitas || 0) + 1;
    res.json({ visitas: req.session.visitas, sesion: idCorto(req.sessionID) });
  });

  // Paso 2 (en clase): iniciar sesión. Paso 7 (en clase): regenerar el id al entrar.
  app.post('/api/login', async (req, res, next) => {
    try {
      if (estaBloqueado(req.ip)) {
        return res.status(429).json({ error: '429 · Demasiados intentos fallidos, espera un minuto' });
      }
      const problema = validarLogin(req.body);
      if (problema) return res.status(400).json({ error: `400 · ${problema}` });

      const encontrado = await usuarios.verificar(req.body.usuario.trim(), req.body.contrasena);
      // Mismo mensaje si el usuario no existe o si la contraseña está mal.
      if (!encontrado) {
        sumarFallo(req.ip);
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }
      delete intentosFallidos[req.ip];

      const sesionAntes = idDeLaCookie(req) === req.sessionID ? idCorto(req.sessionID) : null;
      const guardar = () => {
        const ahora = Date.now();
        req.session.usuario = encontrado; // id, usuario, nombre, rol (sin el hash)
        req.session.creada = ahora;
        req.session.ultimoUso = ahora;
        req.session.save((error) => {
          if (error) return next(error);
          res.json({ usuario: encontrado, sesionAntes, sesionDespues: idCorto(req.sessionID) });
        });
      };
      // Paso 7: id NUEVO al entrar, así una cookie "plantada" por un atacante no queda con sesión.
      if (config.regenerarAlEntrar) {
        req.session.regenerate((error) => (error ? next(error) : guardar()));
      } else {
        guardar();
      }
    } catch (error) {
      next(error);
    }
  });

  // Paso 2 (en clase): cerrar sesión.
  app.post('/api/logout', (req, res, next) => {
    // destroy borra la sesión del almacén (la fila de MySQL): una cookie copiada ya no sirve.
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie(NOMBRE_COOKIE);
      res.json({ mensaje: 'Sesión cerrada: el servidor la borró' });
    });
  });

  app.get('/api/sesion', requiereSesion, (req, res) => {
    const desde = config.rolling ? req.session.ultimoUso : req.session.creada;
    res.json({
      usuario: req.session.usuario,
      sesion: idCorto(req.sessionID),
      expiraEnSegundos: Math.max(0, Math.round((desde + config.maxAgeMs - Date.now()) / 1000)),
    });
  });

  app.get('/api/perfil', requiereSesion, (req, res) => {
    req.session.visitas = (req.session.visitas || 0) + 1;
    res.json({ mensaje: `Hola, ${req.session.usuario.nombre}`, rol: req.session.usuario.rol, visitas: req.session.visitas });
  });

  app.get('/api/admin/reporte', requiereSesion, requiereRol('admin'), (req, res) => {
    res.json({ reporte: 'Talleres: 3 · Inscritos: 57 · Cupo libre: 18' });
  });

  // SOLO PARA LA CLASE: muestra lo que el servidor guarda de cada sesión.
  // Un servidor real NUNCA expone esto.
  app.get('/api/diagnostico/sesiones', async (req, res, next) => {
    try {
      const sesiones = await todasLasSesiones(almacen);
      const lista = Object.entries(sesiones || {}).map(([id, s]) => ({
        sesion: idCorto(id),
        esLaTuya: id === req.sessionID,
        usuario: s.usuario ? s.usuario.usuario : '(sin iniciar sesión)',
        visitas: s.visitas || 0,
        expira: s.cookie && s.cookie.expires,
      }));
      res.json({ almacen: config.almacen, sesiones: lista });
    } catch (error) {
      next(error);
    }
  });

  const SECRETO_JWT = process.env.JWT_SECRET || 'secreto-jwt-solo-para-la-demo';

  function firmarToken(usuario) {
    return jwt.sign(
      { sub: String(usuario.id), usuario: usuario.usuario, nombre: usuario.nombre, rol: usuario.rol },
      SECRETO_JWT,
      { algorithm: 'HS256', expiresIn: config.jwtExpiraSeg, jwtid: crypto.randomUUID() }
    );
  }

  async function requiereJWT(req, res, next) {
    const encabezado = req.headers.authorization || '';
    if (!encabezado.startsWith('Bearer ')) {
      return res.status(401).json({ error: '401 · Falta el token (Authorization: Bearer ...)' });
    }
    const token = encabezado.slice('Bearer '.length).trim();

    let datos;
    try {
      datos = jwt.verify(token, SECRETO_JWT, { algorithms: ['HS256'] });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: '401 · Token expirado, renuévalo o vuelve a iniciar sesión' });
      }
      return res.status(401).json({ error: '401 · Token inválido' });
    }

    try {
      if (config.jwtRevocar && (await tokens.estaRevocado(datos.jti))) {
        return res.status(401).json({ error: '401 · Token revocado, ya se cerró la sesión' });
      }
    } catch (error) {
      return next(error);
    }

    req.jwt = datos;
    return next();
  }

  function requiereRolJWT(rol) {
    return (req, res, next) => {
      if (req.jwt.rol === rol) return next();
      return res.status(403).json({ error: `403 · Eres ${req.jwt.usuario}, pero esta ruta es solo para ${rol}` });
    };
  }

  app.post('/api/jwt/login', async (req, res, next) => {
    try {
      if (estaBloqueado(req.ip)) {
        return res.status(429).json({ error: '429 · Demasiados intentos fallidos, espera un minuto' });
      }
      const problema = validarLogin(req.body);
      if (problema) return res.status(400).json({ error: `400 · ${problema}` });

      const datos = await usuarios.verificar(req.body.usuario.trim(), req.body.contrasena);
      if (!datos) {
        sumarFallo(req.ip);
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }
      delete intentosFallidos[req.ip];

      res.json({ token: firmarToken(datos), usuario: datos, expiraEnSegundos: config.jwtExpiraSeg });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/jwt/sesion', requiereJWT, (req, res) => {
    res.json({
      usuario: { id: req.jwt.sub, usuario: req.jwt.usuario, nombre: req.jwt.nombre, rol: req.jwt.rol },
      jti: req.jwt.jti,
      emitido: new Date(req.jwt.iat * 1000),
      expira: new Date(req.jwt.exp * 1000),
      expiraEnSegundos: Math.max(0, req.jwt.exp - Math.floor(Date.now() / 1000)),
    });
  });

  app.get('/api/jwt/perfil', requiereJWT, (req, res) => {
    res.json({
      mensaje: `Hola, ${req.jwt.nombre}`,
      rol: req.jwt.rol,
      expiraEnSegundos: Math.max(0, req.jwt.exp - Math.floor(Date.now() / 1000)),
    });
  });

  app.post('/api/jwt/refresh', requiereJWT, (req, res) => {
    const { sub, usuario, nombre, rol } = req.jwt;
    res.json({ token: firmarToken({ id: sub, usuario, nombre, rol }), expiraEnSegundos: config.jwtExpiraSeg });
  });

  app.get('/api/jwt/reporte', requiereJWT, requiereRolJWT('admin'), (req, res) => {
    res.json({ reporte: 'Talleres: 3 · Inscritos: 57 · Cupo libre: 18' });
  });

  app.post('/api/jwt/logout', requiereJWT, async (req, res, next) => {
    try {
      if (config.jwtRevocar) {
        await tokens.revocar(req.jwt.jti, req.jwt.usuario, req.jwt.exp);
        return res.json({ mensaje: 'Token revocado: el servidor lo anotó en la lista negra', revocado: true });
      }
      res.json({ mensaje: 'El servidor no guarda nada, solo se borra el token del navegador (sigue sirviendo hasta que venza)', revocado: false });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/diagnostico/tokens', async (req, res, next) => {
    try {
      res.json({ revocar: config.jwtRevocar, tokens: await tokens.listar() });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: '400 · El JSON está mal escrito' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: '413 · Lo que mandaste es demasiado grande' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error del servidor' });
  });

  return app;
}

module.exports = { crearApp, NOMBRE_COOKIE };
