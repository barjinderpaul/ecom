import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

export function createPool(config) {
  return mysql.createPool({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // DECIMAL columns as JS numbers; every value here is far below 2^53.
    decimalNumbers: true,
    // DATETIME values are stored and read as UTC so ISO timestamps round-trip.
    timezone: 'Z',
    charset: 'utf8mb4',
  });
}

export async function applySchema(pool, schemaUrl = new URL('./schema.sql', import.meta.url)) {
  const sql = await readFile(schemaUrl, 'utf8');
  const statements = sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
  return statements.length;
}

export async function pingMysql(pool) {
  await pool.query('SELECT 1');
}
