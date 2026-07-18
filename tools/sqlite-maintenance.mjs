#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const Database = require('../backend/node_modules/better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_APP_DIR = process.platform === 'win32'
  ? path.resolve(__dirname, '..')
  : '/var/www/sistema_distribuidora';

const timestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
};

const resolveConfig = (overrides = {}) => {
  const appDir = overrides.appDir || process.env.APP_DIR || DEFAULT_APP_DIR;
  const defaultBackupDir = process.platform === 'win32'
    ? path.join(appDir, 'backups')
    : '/var/backups/sistema_distribuidora';
  return {
    appDir,
    dbFile: path.resolve(overrides.dbFile || process.env.DB_FILE || path.join(appDir, 'backend', 'banco.sqlite')),
    backupDir: path.resolve(overrides.backupDir || process.env.BACKUP_DIR || defaultBackupDir),
    keepDays: Number(overrides.keepDays ?? process.env.KEEP_DAYS ?? 15),
    prefix: overrides.prefix || process.env.BACKUP_PREFIX || 'banco',
  };
};

const ensurePositiveInteger = (value, fallback) => {
  if (Number.isInteger(value) && value > 0) return value;
  return fallback;
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const sha256File = async (filePath) => {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
};

const gzipFile = async (source, target) => {
  await pipeline(createReadStream(source), zlib.createGzip({ level: 9 }), createWriteStream(target));
};

const gunzipFile = async (source, target) => {
  await pipeline(createReadStream(source), zlib.createGunzip(), createWriteStream(target));
};

const copySqlite = async (source, target) => {
  await fs.copyFile(source, target);
};

const validateSqlite = (dbFile) => {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`integrity_check falhou: ${integrity}`);
    }
    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => row.name);
    return { integrity, tables };
  } finally {
    db.close();
  }
};

const createSqliteBackup = async (source, target) => {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
};

const pruneOldBackups = async ({ backupDir, prefix, keepDays }) => {
  const safeKeepDays = ensurePositiveInteger(keepDays, 15);
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const cutoff = Date.now() - safeKeepDays * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isBackup = entry.name.startsWith(`${prefix}-`) && (
      entry.name.endsWith('.sqlite.gz') ||
      entry.name.endsWith('.sqlite.gz.manifest.json')
    );
    if (!isBackup) continue;

    const filePath = path.join(backupDir, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs <= cutoff) {
      await fs.unlink(filePath);
      removed.push(filePath);
    }
  }

  return removed;
};

export const createBackup = async (options = {}) => {
  const config = resolveConfig(options);
  const keepDays = ensurePositiveInteger(config.keepDays, 15);
  const now = options.now || new Date();
  const stamp = timestamp(now);
  const tmpFile = path.join(config.backupDir, `${config.prefix}-${stamp}.sqlite.tmp`);
  const gzFile = path.join(config.backupDir, `${config.prefix}-${stamp}.sqlite.gz`);
  const manifestFile = `${gzFile}.manifest.json`;

  if (!(await fileExists(config.dbFile))) {
    throw new Error(`Banco nao encontrado: ${config.dbFile}`);
  }

  await fs.mkdir(config.backupDir, { recursive: true });

  const sourceValidation = validateSqlite(config.dbFile);
  await createSqliteBackup(config.dbFile, tmpFile);
  const backupValidation = validateSqlite(tmpFile);
  await gzipFile(tmpFile, gzFile);
  await fs.unlink(tmpFile);

  const stat = await fs.stat(gzFile);
  const sha256 = await sha256File(gzFile);
  const manifest = {
    version: 1,
    kind: 'sqlite-backup',
    source: config.dbFile,
    backup: gzFile,
    createdAt: now.toISOString(),
    sizeBytes: stat.size,
    sha256,
    sourceIntegrity: sourceValidation.integrity,
    backupIntegrity: backupValidation.integrity,
    tables: backupValidation.tables,
    keepDays,
    nodeVersion: process.version,
  };

  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const removed = await pruneOldBackups({ backupDir: config.backupDir, prefix: config.prefix, keepDays });

  return {
    backupFile: gzFile,
    manifestFile,
    manifest,
    removed,
  };
};

const resolveRestoreBackupFile = (options = {}) => {
  const positional = options.backupFile || process.env.BACKUP_FILE;
  if (positional) return path.resolve(positional);
  throw new Error('Informe o backup com --backup caminho/arquivo.sqlite.gz ou BACKUP_FILE.');
};

const prepareRestoreSource = async ({ backupFile, restoreDir, prefix }) => {
  const tmpRestore = path.join(restoreDir, `${prefix}-restore-${timestamp()}.sqlite.tmp`);
  if (backupFile.endsWith('.gz')) {
    await gunzipFile(backupFile, tmpRestore);
  } else {
    await copySqlite(backupFile, tmpRestore);
  }
  return tmpRestore;
};

const assertRestoreIsSafe = async (dbFile, options = {}) => {
  if (!options.yes && process.env.RESTORE_CONFIRM !== 'yes') {
    throw new Error('Restauracao bloqueada. Use --yes ou RESTORE_CONFIRM=yes quando tiver certeza.');
  }
  const activeFiles = [`${dbFile}-wal`, `${dbFile}-shm`];
  const active = [];
  for (const file of activeFiles) {
    if (await fileExists(file)) active.push(file);
  }
  if (active.length > 0 && process.env.ALLOW_ACTIVE_SQLITE_RESTORE !== 'true') {
    throw new Error(`Arquivos WAL/SHM encontrados. Pare a aplicacao antes de restaurar: ${active.join(', ')}`);
  }
};

export const restoreBackup = async (options = {}) => {
  const config = resolveConfig(options);
  const backupFile = resolveRestoreBackupFile(options);
  const restoreDir = path.dirname(config.dbFile);
  const now = options.now || new Date();

  if (!(await fileExists(backupFile))) {
    throw new Error(`Backup nao encontrado: ${backupFile}`);
  }

  await assertRestoreIsSafe(config.dbFile, options);
  await fs.mkdir(restoreDir, { recursive: true });

  const tmpRestore = await prepareRestoreSource({ backupFile, restoreDir, prefix: config.prefix });
  const restoreValidation = validateSqlite(tmpRestore);
  const safetyBackup = await fileExists(config.dbFile)
    ? path.join(restoreDir, `${path.basename(config.dbFile)}.before-restore-${timestamp(now)}`)
    : null;

  if (safetyBackup) {
    await fs.copyFile(config.dbFile, safetyBackup);
  }

  await fs.copyFile(tmpRestore, config.dbFile);
  await fs.unlink(tmpRestore);

  const finalValidation = validateSqlite(config.dbFile);
  return {
    restoredTo: config.dbFile,
    backupFile,
    safetyBackup,
    integrity: finalValidation.integrity,
    tables: restoreValidation.tables,
  };
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') {
      args.yes = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args._.push(arg);
    }
  }
  return args;
};

const runCli = async () => {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (command === 'backup') {
    const result = await createBackup(args);
    console.log(`Backup criado: ${result.backupFile}`);
    console.log(`Manifesto criado: ${result.manifestFile}`);
    if (result.removed.length > 0) console.log(`Backups antigos removidos: ${result.removed.length}`);
    return;
  }

  if (command === 'restore') {
    const backupFile = args.backup || args._[0];
    const result = await restoreBackup({ ...args, backupFile });
    console.log(`Banco restaurado: ${result.restoredTo}`);
    if (result.safetyBackup) console.log(`Backup de seguranca anterior: ${result.safetyBackup}`);
    console.log(`Integridade final: ${result.integrity}`);
    return;
  }

  console.error('Uso:');
  console.error('  node tools/sqlite-maintenance.mjs backup [--db-file caminho] [--backup-dir caminho]');
  console.error('  node tools/sqlite-maintenance.mjs restore --backup arquivo.sqlite.gz --yes [--db-file caminho]');
  process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
