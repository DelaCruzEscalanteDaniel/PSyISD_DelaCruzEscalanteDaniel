// Consultas a la tabla usuarios. Siempre con ? (consulta parametrizada), nunca pegando texto en el SQL.
const bcrypt = require('bcryptjs');

const HASH_FALSO = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.qkT1n5nI0ZBQ6mYbqbDEhEBv8E9S';

function crearModeloUsuarios(pool) {
  // Regresa el usuario (sin el hash) si la contraseña es correcta, o null si no.
  async function verificar(usuario, contrasena) {
    const [filas] = await pool.query(
      'SELECT id, usuario, nombre, rol, contrasena_hash FROM usuarios WHERE usuario = ?',
      [String(usuario || '')]
    );
    // Si no existe, comparamos contra un hash cualquiera para tardar lo mismo (no delata qué usuarios existen).
    const hash = filas.length ? filas[0].contrasena_hash : HASH_FALSO;
    const correcta = await bcrypt.compare(String(contrasena || ''), hash);
    if (!filas.length || !correcta) return null;
    const { contrasena_hash: _hash, ...sinHash } = filas[0];
    return sinHash;
  }

  return { verificar };
}

module.exports = { crearModeloUsuarios };
