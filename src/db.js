import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const defaultPath = fileURLToPath(new URL('../data/campusspace.sqlite', import.meta.url));

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hex, 'hex'));
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(path = process.env.CAMPUS_DB || defaultPath) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL');
  db.exec(schema);
  return db;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  openDatabase().close();
  console.log('Схема базы CampusSpace создана.');
}
