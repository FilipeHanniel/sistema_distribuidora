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
  const backupDir = path.resolve(overrides.backupDir || process.env.BACKUP_DIR || defaultBackupDir);
  return {
    appDir,
    dbFile: path.resolve(overrides.dbFile || process.env.DB_FILE || path.join(appDir, 'backend', 'banco.sqlite')),
    backupDir,
    offsiteDir: path.resolve(overrides.offsiteDir || process.env.OFFSITE_BACKUP_DIR || path.join(backupDir, 'offsite-ready')),
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

const safeReadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
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

const listBackups = async ({ backupDir, prefix }) => {
  if (!(await fileExists(backupDir))) return [];

  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(`${prefix}-`) || !entry.name.endsWith('.sqlite.gz')) continue;

    const backupFile = path.join(backupDir, entry.name);
    const manifestFile = `${backupFile}.manifest.json`;
    const stat = await fs.stat(backupFile);
    backups.push({
      backupFile,
      manifestFile,
      mtimeMs: stat.mtimeMs,
      name: entry.name,
      hasManifest: await fileExists(manifestFile),
    });
  }

  return backups.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.name.localeCompare(a.name);
  });
};

const resolveExportBackup = async (config, options = {}) => {
  const requested = options.backupFile || options.backup || process.env.BACKUP_FILE;
  if (requested) {
    const backupFile = path.resolve(requested);
    return { backupFile, manifestFile: `${backupFile}.manifest.json`, createdNow: false };
  }

  if (options.latest) {
    const [latest] = await listBackups(config);
    if (!latest) {
      throw new Error(`Nenhum backup encontrado em: ${config.backupDir}`);
    }
    return { backupFile: latest.backupFile, manifestFile: latest.manifestFile, createdNow: false };
  }

  const created = await createBackup(options);
  return { backupFile: created.backupFile, manifestFile: created.manifestFile, createdNow: true };
};

const buildRestoreGuide = ({ packageName, backupName, manifestName, checksumName }) => [
  'Pacote externo de backup SQLite',
  '',
  `Pacote: ${packageName}`,
  '',
  'Arquivos:',
  `- ${backupName}: backup comprimido do banco.`,
  `- ${manifestName}: manifesto com tabelas, tamanho, hash e integridade.`,
  `- ${checksumName}: hash SHA-256 para conferir a copia.`,
  '',
  'Como conferir o hash no servidor:',
  '',
  `sha256sum -c ${checksumName}`,
  '',
  'Como restaurar:',
  '',
  'cd /var/www/sistema_distribuidora',
  'pm2 stop sistema-distribuidora',
  `bash tools/restore-sqlite.sh --backup /caminho/do/pacote/${backupName} --yes`,
  'pm2 restart sistema-distribuidora --update-env',
  '',
  'Importante: mantenha uma copia deste pacote fora do VPS.',
  '',
].join('\n');

export const exportBackupPackage = async (options = {}) => {
  const config = resolveConfig(options);
  const now = options.now || new Date();
  const packageName = `${config.prefix}-offsite-${timestamp(now)}`;
  const packageDir = path.join(config.offsiteDir, packageName);

  const { backupFile, manifestFile, createdNow } = await resolveExportBackup(config, options);
  if (!(await fileExists(backupFile))) {
    throw new Error(`Backup nao encontrado: ${backupFile}`);
  }
  if (!(await fileExists(manifestFile))) {
    throw new Error(`Manifesto nao encontrado: ${manifestFile}`);
  }

  const manifest = await safeReadJson(manifestFile);
  const sha256 = await sha256File(backupFile);
  if (manifest.sha256 && manifest.sha256 !== sha256) {
    throw new Error('Hash do backup nao confere com o manifesto. Exporte outro backup antes de copiar.');
  }

  await fs.mkdir(packageDir, { recursive: true });

  const backupName = path.basename(backupFile);
  const manifestName = path.basename(manifestFile);
  const checksumName = `${backupName}.sha256`;
  const metadataName = 'offsite-package.json';
  const guideName = 'RESTORE.txt';

  const exportedBackup = path.join(packageDir, backupName);
  const exportedManifest = path.join(packageDir, manifestName);
  const checksumFile = path.join(packageDir, checksumName);
  const metadataFile = path.join(packageDir, metadataName);
  const restoreGuideFile = path.join(packageDir, guideName);

  await fs.copyFile(backupFile, exportedBackup);
  await fs.copyFile(manifestFile, exportedManifest);
  await fs.writeFile(checksumFile, `${sha256}  ${backupName}\n`);

  const packageManifest = {
    version: 1,
    kind: 'sqlite-offsite-package',
    createdAt: now.toISOString(),
    createdBackupInThisRun: createdNow,
    sourceBackup: backupFile,
    exportedBackup,
    exportedManifest,
    sha256,
    files: {
      backup: backupName,
      manifest: manifestName,
      checksum: checksumName,
      restoreGuide: guideName,
    },
  };

  await fs.writeFile(metadataFile, `${JSON.stringify(packageManifest, null, 2)}\n`);
  await fs.writeFile(restoreGuideFile, buildRestoreGuide({
    packageName,
    backupName,
    manifestName,
    checksumName,
  }));
  await fs.writeFile(path.join(config.offsiteDir, 'latest-offsite-package.txt'), `${packageDir}\n`);

  return {
    packageDir,
    backupFile: exportedBackup,
    manifestFile: exportedManifest,
    checksumFile,
    metadataFile,
    restoreGuideFile,
    sha256,
    createdBackupInThisRun: createdNow,
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
  const booleanFlags = new Set(['yes', 'latest']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (booleanFlags.has(key)) {
        args[key] = true;
      } else {
        args[key] = argv[i + 1];
        i += 1;
      }
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

  if (command === 'export') {
    const backupFile = args.backup || args._[0];
    const result = await exportBackupPackage({ ...args, backupFile });
    console.log(`Pacote externo criado: ${result.packageDir}`);
    console.log(`Backup exportado: ${result.backupFile}`);
    console.log(`Checksum SHA-256: ${result.checksumFile}`);
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
  console.error('  node tools/sqlite-maintenance.mjs export [--latest] [--offsite-dir caminho] [--backup arquivo.sqlite.gz]');
  console.error('  node tools/sqlite-maintenance.mjs restore --backup arquivo.sqlite.gz --yes [--db-file caminho]');
  process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
