#!/usr/bin/env node
/**
 * Reaplica el esquema (vistas y procedures) sobre una base ya creada.
 *
 * Por que existe: init/01-bootstrap.sh solo corre la primera vez, cuando el
 * volumen de MySQL esta vacio. Para publicar un cambio en un SP sin borrar los
 * datos hace falta volver a cargar el archivo, y eso no se puede hacer con el
 * driver de Node: DELIMITER es un comando del cliente `mysql`, no del servidor,
 * y sin el, un CREATE PROCEDURE con `;` adentro se corta al primer punto y coma.
 *
 * Este script parte los archivos respetando DELIMITER y manda cada sentencia
 * entera por el driver, que si entiende de conexiones y no de sintaxis de CLI.
 *
 * IMPORTANTE: correr como root (o el usuario que creo los objetos). MySQL 8 no
 * deja que un usuario comun toque rutinas cuyo DEFINER es una cuenta con
 * SYSTEM_USER, y el bootstrap las crea como root.
 *
 * Uso:
 *   node scripts/apply-sql.mjs                 # vistas + todos los procedures
 *   node scripts/apply-sql.mjs procedures/players.sql
 *
 * Toma la conexion de la .env del backend; MYSQL_ROOT_PASSWORD, si esta,
 * fuerza el usuario root.
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

loadDotEnv(join(ROOT, '.env'));

/** Parser minimo de .env: solo `CLAVE=valor`, sin export ni multilinea. */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, '').trim();
    }
  }
}

/**
 * Parte un archivo .sql en sentencias, honrando `DELIMITER //`.
 *
 * No es un parser de SQL: es un separador. Ignora comentarios de linea para
 * que un `--` con un `;` adentro no confunda el corte, y va acumulando hasta
 * encontrar el delimitador vigente.
 */
function splitStatements(sql) {
  const statements = [];
  let delimiter = ';';
  let buffer = '';

  for (const rawLine of sql.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith('--') || trimmed === '') {
      if (buffer === '') continue;
      buffer += '\n' + line;
      continue;
    }

    const delimiterChange = trimmed.match(/^DELIMITER\s+(\S+)$/i);
    if (delimiterChange) {
      if (buffer.trim()) {
        statements.push(buffer.trim());
        buffer = '';
      }
      delimiter = delimiterChange[1];
      continue;
    }

    buffer += (buffer ? '\n' : '') + line;

    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = '';
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function main() {
  const target = process.argv[2];
  const databaseDir = join(ROOT, 'database');

  const files = target
    ? [join(databaseDir, target)]
    : [
        join(databaseDir, 'views.sql'),
        ...readdirSync(join(databaseDir, 'procedures'))
          .filter((file) => file.endsWith('.sql'))
          .sort()
          .map((file) => join(databaseDir, 'procedures', file)),
      ];

  const rootPassword = process.env.MYSQL_ROOT_PASSWORD;

  const connection = await createConnection({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: rootPassword ? 'root' : (process.env.MYSQL_USER ?? 'root'),
    password: rootPassword ?? process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'murieron_en_madrid',
    multipleStatements: false,
  });

  try {
    for (const file of files) {
      const statements = splitStatements(readFileSync(file, 'utf8'));
      process.stdout.write(`${file.replace(ROOT, '.')}  (${statements.length})\n`);
      for (const statement of statements) {
        try {
          await connection.query(statement);
        } catch (error) {
          console.error(`\nFallo en ${file}:\n${statement.slice(0, 200)}...\n`);
          throw error;
        }
      }
    }
    process.stdout.write('esquema aplicado\n');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
