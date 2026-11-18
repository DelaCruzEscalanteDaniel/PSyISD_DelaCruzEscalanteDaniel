const $ = (id) => document.getElementById(id);

async function llamar(metodo, url, cuerpo) {
  const opciones = { method: metodo, headers: {} };

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

function anotar(metodo, url, status, datos) {
  const li = document.createElement('li');

  const codigo = document.createElement('span');
  codigo.className = claseDelCodigo(status);
  codigo.textContent = status;

  const peticion = document.createElement('code');
  peticion.textContent = ` ${metodo} ${url}`;

  const json = document.createElement('pre');
  json.textContent = JSON.stringify(datos, null, 2);

  li.append(codigo, peticion, json);
  $('bitacora').prepend(li);
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

async function iniciar() {
  const { datos } = await llamar('GET', '/api/config');
  $('config').textContent = JSON.stringify(datos, null, 2);
  await refrescarTodo();
}

iniciar();
