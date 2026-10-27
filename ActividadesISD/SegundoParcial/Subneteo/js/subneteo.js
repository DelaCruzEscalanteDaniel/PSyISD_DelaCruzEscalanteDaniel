(function (global) {
  'use strict';

  function octetoABinario(octeto) {
    if (!Number.isInteger(octeto) || octeto < 0 || octeto > 255) {
      throw new Error('El octeto debe ser un número entero entre 0 y 255');
    }
    return octeto.toString(2).padStart(8, '0');
  }

  function pasosDecimalABinario(octeto) {
    const pesos = [128, 64, 32, 16, 8, 4, 2, 1];
    let resto = octeto;

    return pesos.map((peso) => {
      const bit = resto >= peso ? 1 : 0;
      if (bit) resto -= peso;
      return { peso, bit, resto };
    });
  }

  function ipAEntero(ip) {
    const partes = String(ip).trim().split('.');
    if (partes.length !== 4) throw new Error(`"${ip}" no es una dirección IPv4 válida`);
    return partes.reduce((acumulado, parte) => {
      if (!/^\d{1,3}$/.test(parte)) throw new Error(`"${parte}" no es un octeto válido`);
      const octeto = Number(parte);
      if (octeto > 255) throw new Error(`"${octeto}" es mayor que 255`);
      return acumulado * 256 + octeto;
    }, 0);
  }

  function enteroAIp(numero) {
    if (!Number.isInteger(numero) || numero < 0 || numero > 4294967295) {
      throw new Error('El valor debe estar entre 0 y 4294967295');
    }
    return [24, 16, 8, 0].map((desplazamiento) => Math.floor(numero / 2 ** desplazamiento) % 256).join('.');
  }

  function ipABinario(ip) {
    return enteroAIp(ipAEntero(ip)).split('.').map(Number).map(octetoABinario).join('.');
  }

  function validarPrefijo(prefijo) {
    if (!Number.isInteger(prefijo) || prefijo < 0 || prefijo > 32) {
      throw new Error('El prefijo debe ser un entero entre 0 y 32');
    }
  }

  function prefijoAMascara(prefijo) {
    validarPrefijo(prefijo);
    return enteroAIp(prefijo === 0 ? 0 : 2 ** 32 - 2 ** (32 - prefijo));
  }

  function mascaraAPrefijo(mascara) {
    const binario = ipABinario(mascara).replace(/\./g, '');
    if (!/^1*0*$/.test(binario)) throw new Error(`"${mascara}" no es una máscara válida`);
    return binario.indexOf('0') === -1 ? 32 : binario.indexOf('0');
  }

  function leerPrefijo(texto) {
    const valor = String(texto).trim().replace(/^\//, '');
    if (valor.includes('.')) return mascaraAPrefijo(valor);
    const prefijo = Number(valor);
    validarPrefijo(prefijo);
    return prefijo;
  }

  function claseDeRed(ip) {
    const primerOcteto = Math.floor(ipAEntero(ip) / 2 ** 24);
    if (primerOcteto >= 1 && primerOcteto <= 126) return { clase: 'A', prefijo: 8, prefijoPorDefecto: 8 };
    if (primerOcteto === 127) return { clase: 'Local', prefijo: 8, prefijoPorDefecto: 8 };
    if (primerOcteto >= 128 && primerOcteto <= 191) return { clase: 'B', prefijo: 16, prefijoPorDefecto: 16 };
    if (primerOcteto >= 192 && primerOcteto <= 223) return { clase: 'C', prefijo: 24, prefijoPorDefecto: 24 };
    if (primerOcteto >= 224 && primerOcteto <= 239) return { clase: 'D', prefijo: null, prefijoPorDefecto: null };
    return { clase: 'E', prefijo: null, prefijoPorDefecto: null };
  }

  function esPrivada(ip) {
    const numero = ipAEntero(ip);
    const pertenece = (red, prefijo) => Math.floor(numero / 2 ** (32 - prefijo))
      === Math.floor(ipAEntero(red) / 2 ** (32 - prefijo));
    return pertenece('10.0.0.0', 8)
      || pertenece('172.16.0.0', 12)
      || pertenece('192.168.0.0', 16);
  }

  function hostsUtilizable(prefijo) {
    validarPrefijo(prefijo);
    if (prefijo === 32) return 1;
    if (prefijo === 31) return 2;
    return 2 ** (32 - prefijo) - 2;
  }

  function describirSubred(redEntera, prefijo, nombre) {
    validarPrefijo(prefijo);
    const tamanoBloque = 2 ** (32 - prefijo);
    const broadcastEntero = redEntera + tamanoBloque - 1;
    const conHosts = prefijo < 31;

    return {
      nombre: nombre || '',
      red: enteroAIp(redEntera),
      prefijo,
      mascara: prefijoAMascara(prefijo),
      primerHost: enteroAIp(conHosts ? redEntera + 1 : redEntera),
      ultimoHost: enteroAIp(conHosts ? broadcastEntero - 1 : broadcastEntero),
      broadcast: enteroAIp(broadcastEntero),
      hosts: hostsUtilizable(prefijo),
      tamanoBloque
    };
  }

  function analizarIp(ip, prefijo) {
    validarPrefijo(prefijo);
    const numero = ipAEntero(ip);
    const tamano = 2 ** (32 - prefijo);
    const red = Math.floor(numero / tamano) * tamano;
    return describirSubred(red, prefijo);
  }

  function validarRedBase(ip, prefijo) {
    validarPrefijo(prefijo);
    const numero = ipAEntero(ip);
    const tamano = 2 ** (32 - prefijo);
    if (numero % tamano !== 0) {
      const redCorrecta = enteroAIp(Math.floor(numero / tamano) * tamano);
      throw new Error(`${ip} no es la dirección de red para /${prefijo}; la red correspondiente es ${redCorrecta}/${prefijo}`);
    }
    return numero;
  }

  function bitsParaHosts(hosts) {
    if (!Number.isInteger(hosts) || hosts < 1) throw new Error(`${hosts} no es una cantidad válida de hosts`);
    let bits = 2;
    while (2 ** bits - 2 < hosts) bits++;
    return bits;
  }

  function subnetearFLSM(ip, prefijo, opciones) {
    const base = validarRedBase(ip, prefijo);
    const cantidadSubredes = opciones.subredes;
    const hostsSolicitados = opciones.hostsPorSubred || opciones.hostPorSubred;
    let bitsPrestados;

    if (cantidadSubredes !== undefined) {
      if (!Number.isInteger(cantidadSubredes) || cantidadSubredes < 1) {
        throw new Error('La cantidad de subredes debe ser un entero mayor que cero');
      }
      bitsPrestados = Math.ceil(Math.log2(cantidadSubredes));
    } else if (hostsSolicitados !== undefined) {
      bitsPrestados = 32 - prefijo - bitsParaHosts(Number(hostsSolicitados));
    } else {
      throw new Error('Indica el número de subredes o los hosts por subred');
    }

    const nuevoPrefijo = prefijo + bitsPrestados;
    if (bitsPrestados < 0 || nuevoPrefijo > 30) {
      throw new Error(`No caben las subredes solicitadas dentro de la red /${prefijo}`);
    }

    const total = 2 ** bitsPrestados;
    const tamano = 2 ** (32 - nuevoPrefijo);
    const subredes = Array.from({ length: total }, (_, indice) =>
      describirSubred(base + indice * tamano, nuevoPrefijo, `Subred ${indice + 1}`));

    return {
      bitsPrestados,
      nuevoPrefijo,
      totalSubredes: total,
      hostsPorSubred: hostsUtilizable(nuevoPrefijo),
      subredes
    };
  }

  function subnetearVLSM(ip, prefijo, requerimientos) {
    const base = validarRedBase(ip, prefijo);
    if (!Array.isArray(requerimientos) || requerimientos.length === 0) {
      throw new Error('Agrega al menos un requerimiento de subred');
    }
    const fin = base + 2 ** (32 - prefijo);
    const ordenados = requerimientos.map((requerimiento, indice) => {
      const hosts = Number(requerimiento.hosts);
      if (!Number.isInteger(hosts) || hosts < 1) {
        throw new Error(`La cantidad de hosts de "${requerimiento.nombre || `Subred ${indice + 1}`}" debe ser un entero mayor que cero`);
      }
      return { nombre: String(requerimiento.nombre || `Subred ${indice + 1}`), hosts, indice };
    }).sort((a, b) => b.hosts - a.hosts || a.indice - b.indice);

    let siguiente = base;
    let direccionesUsadas = 0;
    const subredes = ordenados.map((requerimiento) => {
      const bitsHosts = bitsParaHosts(requerimiento.hosts);
      const nuevoPrefijo = 32 - bitsHosts;
      if (nuevoPrefijo < prefijo) {
        throw new Error(`${requerimiento.nombre} requiere más direcciones que la red base /${prefijo}`);
      }
      const tamano = 2 ** bitsHosts;
      const inicio = Math.ceil(siguiente / tamano) * tamano;
      const final = inicio + tamano;
      if (final > fin) {
        throw new Error(`No hay espacio suficiente para asignar "${requerimiento.nombre}" (${requerimiento.hosts} hosts)`);
      }
      siguiente = final;
      direccionesUsadas += tamano;
      return {
        ...describirSubred(inicio, nuevoPrefijo, requerimiento.nombre),
        hostsSolicitados: requerimiento.hosts,
        bitsHosts
      };
    });

    return {
      direccionesTotales: fin - base,
      direccionesUsadas,
      primerLibre: siguiente < fin ? enteroAIp(siguiente) : null,
      subredes
    };
  }

  const api = {
    octetoABinario,
    pasosDecimalABinario,
    ipABinario,
    ipAEntero,
    enteroAIp,
    prefijoAMascara,
    mascaraAPrefijo,
    leerPrefijo,
    claseDeRed,
    esPrivada,
    hostsUtilizable,
    bitsParaHosts,
    analizarIp,
    subnetearFLSM,
    subnetearVLSM
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Subneteo = api;
})(typeof window !== 'undefined' ? window : globalThis);
