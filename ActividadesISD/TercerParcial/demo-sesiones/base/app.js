// La aplicación de la demo. server.js la arranca; las pruebas la arrancan con otras configuraciones.
// Lo que dice "(en clase)" lo programamos juntos, paso por paso. Mientras no esté, esa ruta responde 501.
const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { crearModeloUsuarios } = require('./modelos/usuarios.modelo');

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
  app.use(express.json());
  const usuarios = crearModeloUsuarios(pool);

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
      const { usuario, contrasena } = req.body || {};
      const encontrado = await usuarios.verificar(usuario, contrasena);
      // Mismo mensaje si el usuario no existe o si la contraseña está mal.
      if (!encontrado) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

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

  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: 'Error del servidor' });
  });

  return app;
}

module.exports = { crearApp, NOMBRE_COOKIE };
