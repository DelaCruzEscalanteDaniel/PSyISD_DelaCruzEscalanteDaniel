(function () {
  'use strict';
  const S = window.Subneteo;
  const $ = (id) => document.getElementById(id);

  function escapar(texto) {
    return String(texto).replace(/[&<>"']/g, (caracter) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[caracter]);
  }

  const formatoMiles = (numero) => numero.toLocaleString('es-MX');

  function mostrarError(destino, error) {
    destino.innerHTML = `<div class="error">⚠ ${escapar(error.message)}</div>`;
  }

  function binarioColoreado(ip, prefijo) {
    const bits = S.ipABinario(ip).replace(/\./g, '');
    let html = '';
    for (let indice = 0; indice < 32; indice++) {
      if (indice > 0 && indice % 8 === 0) html += '.';
      html += `<span class="${indice < prefijo ? 'bits-red' : 'bits-host'}">${bits[indice]}</span>`;
    }
    return html;
  }

  function tarjetaRedBase(ip, prefijo) {
    const clase = S.claseDeRed(ip);
    return `
      <div class="tarjeta">
        <h3>Red base ${escapar(ip)}/${prefijo}</h3>
        <dl class="datos">
          <div><dt>Clase (histórica)</dt><dd>${clase.clase}${clase.prefijoPorDefecto ? ` · /${clase.prefijoPorDefecto} por defecto` : ''}</dd></div>
          <div><dt>Tipo</dt><dd>${S.esPrivada(ip) ? 'Privada (RFC 1918)' : 'Pública'}</dd></div>
          <div><dt>Máscara</dt><dd>${S.prefijoAMascara(prefijo)}</dd></div>
          <div><dt>Direcciones en total</dt><dd>${formatoMiles(2 ** (32 - prefijo))}</dd></div>
        </dl>
        <p class="binario">IP&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${binarioColoreado(ip, prefijo)}</p>
        <p class="binario">Máscara ${binarioColoreado(S.prefijoAMascara(prefijo), prefijo)}</p>
        <p class="leyenda"><span class="bits-red">Azul</span> = bits de red · <span class="bits-host">naranja</span> = bits de host</p>
      </div>`;
  }

  function tablaSubredes(subredes, conSolicitados) {
    const filas = subredes.map((subred, indice) => `
      <tr>
        <td>${indice + 1}</td>
        <td>${escapar(subred.nombre)}</td>
        ${conSolicitados ? `<td>${formatoMiles(subred.hostsSolicitados)}</td>` : ''}
        <td class="ip">${subred.red}/${subred.prefijo}</td>
        <td class="ip">${subred.mascara}</td>
        <td class="ip">${subred.primerHost}</td>
        <td class="ip">${subred.ultimoHost}</td>
        <td class="ip">${subred.broadcast}</td>
        <td>${formatoMiles(subred.hosts)}</td>
      </tr>`).join('');
    return `
      <div class="tabla-envoltura">
        <table class="resultado">
          <thead><tr>
            <th>#</th><th>Subred</th>${conSolicitados ? '<th>Hosts pedidos</th>' : ''}
            <th>Red</th><th>Máscara</th><th>Primer host</th><th>Último host</th><th>Broadcast</th><th>Hosts útiles</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  }

  function activarPanel(id) {
    document.querySelectorAll('.pestana').forEach((boton) => {
      const activa = boton.dataset.panel === id;
      boton.classList.toggle('activa', activa);
      boton.setAttribute('aria-selected', String(activa));
    });
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('activo', panel.id === id));
  }

  document.querySelectorAll('.pestana').forEach((boton) => {
    boton.addEventListener('click', () => activarPanel(boton.dataset.panel));
  });

  $('form-binario').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const destino = $('bin-resultado');
    try {
      const entrada = $('bin-ip').value.trim();
      const octetos = entrada.includes('.')
        ? S.enteroAIp(S.ipAEntero(entrada)).split('.').map(Number)
        : [Number(entrada)];
      if (octetos.some((octeto) => !Number.isInteger(octeto) || octeto < 0 || octeto > 255)) {
        throw new Error('Escribe un número entre 0 y 255 o una dirección IPv4 válida');
      }
      destino.innerHTML = octetos.map((octeto) => {
        const pasos = S.pasosDecimalABinario(octeto);
        return `
          <div class="tarjeta">
            <h3>${octeto} → <span class="binario">${S.octetoABinario(octeto)}</span></h3>
            <table class="pasos">
              <tr><th>Peso</th>${pasos.map((paso) => `<th>${paso.peso}</th>`).join('')}</tr>
              <tr><td>Bit</td>${pasos.map((paso) => `<td>${paso.bit}</td>`).join('')}</tr>
              <tr><td>Resto</td>${pasos.map((paso) => `<td>${paso.resto}</td>`).join('')}</tr>
            </table>
            <p class="leyenda">Si el número o el resto alcanza para el peso, se pone 1 y se resta; si no, se pone 0.</p>
          </div>`;
      }).join('');
    } catch (error) {
      mostrarError(destino, error);
    }
  });

  $('form-flsm').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const destino = $('flsm-resultado');
    try {
      const ip = $('flsm-red').value.trim();
      const prefijo = S.leerPrefijo($('flsm-prefijo').value);
      const cantidad = Number($('flsm-cantidad').value);
      const opciones = { [$('flsm-modo').value]: cantidad };
      const resultado = S.subnetearFLSM(ip, prefijo, opciones);
      destino.innerHTML = tarjetaRedBase(ip, prefijo) + `
        <div class="tarjeta">
          <h3>Resultado</h3>
          <dl class="datos">
            <div><dt>Bits prestados</dt><dd>${resultado.bitsPrestados} (2^${resultado.bitsPrestados} = ${resultado.totalSubredes} subredes)</dd></div>
            <div><dt>Nuevo prefijo</dt><dd>/${resultado.nuevoPrefijo} · ${S.prefijoAMascara(resultado.nuevoPrefijo)}</dd></div>
            <div><dt>Hosts útiles por subred</dt><dd>2^${32 - resultado.nuevoPrefijo} − 2 = ${formatoMiles(resultado.hostsPorSubred)}</dd></div>
            <div><dt>Salto entre subredes</dt><dd>${formatoMiles(resultado.subredes[0].tamanoBloque)} direcciones</dd></div>
          </dl>
        </div>
        <div class="tarjeta">${tablaSubredes(resultado.subredes, false)}</div>`;
    } catch (error) {
      mostrarError(destino, error);
    }
  });

  function agregarFila(nombre = '', hosts = 1) {
    const fila = document.createElement('div');
    fila.className = 'req-fila';
    fila.innerHTML = `
      <input class="req-nombre" type="text" aria-label="Nombre del área" placeholder="Área o subred" value="${escapar(nombre)}">
      <input class="req-hosts" type="number" min="1" step="1" aria-label="Cantidad de hosts" value="${hosts}">
      <button type="button" class="quitar" aria-label="Quitar subred">×</button>`;
    fila.querySelector('.quitar').addEventListener('click', () => fila.remove());
    $('vlsm-filas').appendChild(fila);
  }

  function cargarFilas(lista) {
    $('vlsm-filas').innerHTML = '';
    lista.forEach(([nombre, hosts]) => agregarFila(nombre, hosts));
  }

  $('vlsm-agregar').addEventListener('click', () => agregarFila());

  $('form-vlsm').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const destino = $('vlsm-resultado');
    try {
      const ip = $('vlsm-red').value.trim();
      const prefijo = S.leerPrefijo($('vlsm-prefijo').value);
      const requerimientos = Array.from($('vlsm-filas').querySelectorAll('.req-fila')).map((fila, indice) => ({
        nombre: fila.querySelector('.req-nombre').value.trim() || `Subred ${indice + 1}`,
        hosts: Number(fila.querySelector('.req-hosts').value)
      }));
      const resultado = S.subnetearVLSM(ip, prefijo, requerimientos);
      destino.innerHTML = tarjetaRedBase(ip, prefijo) + `
        <div class="tarjeta">
          <h3>Resultado VLSM</h3>
          <dl class="datos">
            <div><dt>Direcciones de la red base</dt><dd>${formatoMiles(resultado.direccionesTotales)}</dd></div>
            <div><dt>Direcciones asignadas</dt><dd>${formatoMiles(resultado.direccionesUsadas)}</dd></div>
            <div><dt>Primera dirección libre</dt><dd>${resultado.primerLibre || 'No quedan direcciones disponibles'}</dd></div>
          </dl>
        </div>
        <div class="tarjeta">${tablaSubredes(resultado.subredes, true)}</div>`;
    } catch (error) {
      mostrarError(destino, error);
    }
  });

  $('form-ip').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const destino = $('ip-resultado');
    try {
      const ip = $('ip-dir').value.trim();
      const prefijo = S.leerPrefijo($('ip-prefijo').value);
      const subred = S.analizarIp(ip, prefijo);
      destino.innerHTML = `
        <div class="tarjeta">
          <h3>${escapar(ip)}/${prefijo}</h3>
          <p class="binario">IP&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${binarioColoreado(ip, prefijo)}</p>
          <p class="binario">Máscara ${binarioColoreado(subred.mascara, prefijo)}</p>
          <p class="binario">Red&nbsp;&nbsp;&nbsp;&nbsp;${binarioColoreado(subred.red, prefijo)} &nbsp;(IP AND máscara)</p>
          <dl class="datos">
            <div><dt>Red</dt><dd>${subred.red}/${prefijo}</dd></div>
            <div><dt>Primer host</dt><dd>${subred.primerHost}</dd></div>
            <div><dt>Último host</dt><dd>${subred.ultimoHost}</dd></div>
            <div><dt>Broadcast</dt><dd>${subred.broadcast}</dd></div>
            <div><dt>Hosts útiles</dt><dd>${formatoMiles(subred.hosts)}</dd></div>
          </dl>
        </div>`;
    } catch (error) {
      mostrarError(destino, error);
    }
  });

  const ejercicios = {
    1: () => {
      $('vlsm-red').value = '192.168.50.0';
      $('vlsm-prefijo').value = '/24';
      cargarFilas([['Laboratorio de Cómputo', 60], ['Sala de Maestros', 25], ['Control Escolar', 12],
        ['Biblioteca', 5], ['Enlace R1-R2', 2], ['Enlace R2-R3', 2]]);
      activarPanel('panel-vlsm');
      $('form-vlsm').requestSubmit();
    },
    2: () => {
      $('vlsm-red').value = '172.20.0.0';
      $('vlsm-prefijo').value = '/16';
      cargarFilas([['Campus Norte', 2000], ['Campus Sur', 1000], ['Administración', 500],
        ['WiFi Visitantes', 200], ['Enlace Norte-Sur', 2]]);
      activarPanel('panel-vlsm');
      $('form-vlsm').requestSubmit();
    },
    3: () => {
      $('flsm-red').value = '10.0.0.0';
      $('flsm-prefijo').value = '/8';
      $('flsm-modo').value = 'subredes';
      $('flsm-cantidad').value = 16;
      activarPanel('panel-flsm');
      $('form-flsm').requestSubmit();
    }
  };

  document.querySelectorAll('[data-ejemplo]').forEach((boton) => {
    boton.addEventListener('click', () => ejercicios[boton.dataset.ejemplo]());
  });

  cargarFilas([['Laboratorio de Cómputo', 60], ['Sala de Maestros', 25], ['Control Escolar', 12],
    ['Biblioteca', 5], ['Enlace R1-R2', 2], ['Enlace R2-R3', 2]]);
  $('form-binario').requestSubmit();

  const enlace = location.hash.match(/ejercicio=(\d)/);
  if (enlace && ejercicios[enlace[1]]) ejercicios[enlace[1]]();
})();
