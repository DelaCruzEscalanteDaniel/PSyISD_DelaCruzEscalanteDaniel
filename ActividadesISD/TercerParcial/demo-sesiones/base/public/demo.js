const $ = (id) => document.getElementById(id);

async function llamar(metodo, url, cuerpo, token) {
  const opciones = { method: metodo, headers: {} };
  if (token) opciones.headers.Authorization = `Bearer ${token}`;

  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  const respuesta = await fetch(url, opciones);

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    datos = null;
  }
  return { status: respuesta.status, datos };
}

function claseDelCodigo(status) {
  if (status >= 200 && status < 300) return 'codigo ok';
  if (status === 401) return 'codigo e401';
  if (status === 403) return 'codigo e403';
  return 'codigo error';
}

function anotar(metodo, url, status, datos, idLista = 'bitacora') {
  const li = document.createElement('li');

  const codigo = document.createElement('span');
  codigo.className = claseDelCodigo(status);
  codigo.textContent = status;

  const peticion = document.createElement('code');
  peticion.textContent = ` ${metodo} ${url}`;

  const json = document.createElement('pre');
  json.textContent = JSON.stringify(datos, null, 2);

  li.append(codigo, peticion, json);
  $(idLista).prepend(li);
}

async function refrescarEstado() {
  const { status, datos } = await llamar('GET', '/api/sesion');
  const estado = $('estado');

  if (status === 200 && datos) {
    const { usuario, sesion, expiraEnSegundos } = datos;
    estado.textContent = `${usuario.nombre} · rol ${usuario.rol} · sesión ${sesion} · vence en ${expiraEnSegundos} s`;
    estado.className = 'estado con-sesion';
  } else {
    estado.textContent = `Sin sesión (el servidor responde ${status})`;
    estado.className = 'estado sin-sesion';
  }

  $('cookie-js').textContent = document.cookie || '(vacío)';
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto; 
  return td;
}

async function refrescarSesiones() {
  const { status, datos } = await llamar('GET', '/api/diagnostico/sesiones');
  const cuerpo = $('tabla-sesiones');
  cuerpo.replaceChildren(); // vacía el <tbody> sin usar innerHTML

  if (status !== 200 || !datos) {
    $('donde').textContent = `No se pudo leer el diagnóstico (código ${status})`;
    cuerpo.append(filaVacia('(sin sesiones)'));
    return;
  }

  $('donde').textContent =
    datos.almacen === 'memoria'
      ? 'En la MEMORIA del servidor (MemoryStore): se pierde al reiniciarlo.'
      : 'En MySQL, tabla sessions. En Workbench: SELECT * FROM demo_sesiones.sessions;';

  if (!datos.sesiones || datos.sesiones.length === 0) {
    cuerpo.append(filaVacia('(sin sesiones)'));
    return;
  }

  for (const s of datos.sesiones) {
    const fila = document.createElement('tr');
    if (s.esLaTuya) fila.className = 'tuya';
    const vence = s.expira ? new Date(s.expira).toLocaleTimeString() : '—';
    fila.append(
      celda(s.esLaTuya ? `${s.sesion} (la tuya)` : s.sesion),
      celda(s.usuario),
      celda(s.visitas),
      celda(vence)
    );
    cuerpo.append(fila);
  }
}

function filaVacia(texto) {
  const fila = document.createElement('tr');
  const td = celda(texto);
  td.colSpan = 4;
  fila.append(td);
  return fila;
}

async function refrescarTodo() {
  await refrescarEstado();
  await refrescarSesiones();
}

$('usuario').addEventListener('change', () => {
  $('contrasena').value = `${$('usuario').value}12345`;
});

$('form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const cuerpo = { usuario: $('usuario').value, contrasena: $('contrasena').value };
  const { status, datos } = await llamar('POST', '/api/login', cuerpo);
  anotar('POST', '/api/login', status, datos);
  await refrescarTodo();
});

for (const boton of document.querySelectorAll('button[data-url]')) {
  boton.addEventListener('click', async () => {
    const { metodo, url } = boton.dataset;
    const { status, datos } = await llamar(metodo, url);
    anotar(metodo, url, status, datos);
    await refrescarTodo();
  });
}

$('btn-refrescar').addEventListener('click', refrescarTodo);
$('btn-sesiones').addEventListener('click', refrescarSesiones);

let tokenJWT = sessionStorage.getItem('tokenJWT');

function guardarToken(token) {
  tokenJWT = token;
  if (token) sessionStorage.setItem('tokenJWT', token);
  else sessionStorage.removeItem('tokenJWT');
}

function leerPayload(token) {
  try {
    const parte = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(parte), (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function refrescarEstadoJWT() {
  const estado = $('estado-jwt');
  if (!tokenJWT) {
    estado.textContent = 'Sin token';
    estado.className = 'estado sin-sesion';
    $('jwt-token').textContent = '(sin token)';
    $('jwt-payload').textContent = '(sin token)';
    return;
  }
  $('jwt-token').textContent = tokenJWT;
  $('jwt-payload').textContent = JSON.stringify(leerPayload(tokenJWT), null, 2);

  const { status, datos } = await llamar('GET', '/api/jwt/sesion', undefined, tokenJWT);
  if (status === 200 && datos && datos.usuario) {
    const u = datos.usuario;
    estado.textContent = `Con token: ${u.nombre} (${u.rol}) · token ${datos.jti.slice(0, 8)}… · vence en ${datos.expiraEnSegundos} s`;
    estado.className = 'estado con-sesion';
  } else {
    estado.textContent = `Token NO válido: ${datos ? datos.error : status}`;
    estado.className = 'estado sin-sesion';
  }
}

async function refrescarTokens() {
  const { status, datos } = await llamar('GET', '/api/diagnostico/tokens');
  const cuerpo = $('tabla-tokens');
  cuerpo.replaceChildren();
  if (status !== 200 || !datos) {
    $('jwt-revocar').textContent = `No se pudo leer la lista negra (código ${status})`;
    cuerpo.append(filaVacia('(no se pudo leer)'));
    return;
  }
  $('jwt-revocar').textContent = datos.revocar
    ? 'jwtRevocar = true: al hacer logout el token se anota en MySQL (tabla tokens_revocados)'
    : 'jwtRevocar = false: el servidor no guarda nada, el token sirve hasta que venza';

  if (datos.tokens.length === 0) {
    cuerpo.append(filaVacia('(sin tokens revocados)'));
    return;
  }
  const mio = tokenJWT ? (leerPayload(tokenJWT) || {}).jti : null;
  for (const tk of datos.tokens) {
    const fila = document.createElement('tr');
    if (mio === tk.jti) fila.className = 'tuya';
    fila.append(
      celda(`${tk.jti.slice(0, 8)}…`),
      celda(tk.usuario),
      celda(new Date(tk.expira).toLocaleTimeString()),
      celda(new Date(tk.revocado_en).toLocaleTimeString())
    );
    cuerpo.append(fila);
  }
}

async function refrescarJWT() {
  await refrescarEstadoJWT();
  await refrescarTokens();
}

for (const boton of document.querySelectorAll('button[data-jwt]')) {
  boton.addEventListener('click', async () => {
    const accion = boton.dataset.jwt;

    if (accion === 'borrar') {
      guardarToken(null);
      anotar('--', 'sessionStorage', '--', { mensaje: 'Token borrado del navegador (el servidor no se entera)' }, 'bitacora-jwt');
      await refrescarJWT();
      return;
    }

    if (accion === 'login') {
      const cuerpo = { usuario: $('usuario').value, contrasena: $('contrasena').value };
      const { status, datos } = await llamar('POST', '/api/jwt/login', cuerpo);
      anotar('POST', '/api/jwt/login', status, datos, 'bitacora-jwt');
      if (status === 200) guardarToken(datos.token);
    } else {
      const [metodo, url] = accion.split(' ');
      const { status, datos } = await llamar(metodo, url, undefined, tokenJWT);
      anotar(metodo, url, status, datos, 'bitacora-jwt');
      if (url === '/api/jwt/refresh' && status === 200) guardarToken(datos.token);
    }
    await refrescarJWT();
  });
}

$('btn-tokens').addEventListener('click', refrescarTokens);

async function iniciar() {
  const { datos } = await llamar('GET', '/api/config');
  $('config').textContent = JSON.stringify(datos, null, 2);
  await refrescarTodo();
  await refrescarJWT();
}

iniciar();
