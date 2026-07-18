const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { after, test } = require('node:test');
const Database = require('better-sqlite3');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribuidora-backup-test-'));
const toolsUrl = pathToFileURL(path.join(__dirname, '..', 'tools', 'sqlite-maintenance.mjs')).href;

after(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

const readSampleValue = (dbFile) => {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT value FROM sample WHERE id = 1').get().value;
  } finally {
    db.close();
  }
};

test('cria backup SQLite validado e restaura com copia de seguranca previa', async () => {
  const { createBackup, restoreBackup } = await import(toolsUrl);
  const dbFile = path.join(tempDir, 'banco.sqlite');
  const backupDir = path.join(tempDir, 'backups');
  await fsp.mkdir(backupDir, { recursive: true });

  const db = new Database(dbFile);
  db.exec(`
    CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO sample (id, value) VALUES (1, 'valor-original');
  `);
  db.close();

  const oldBackup = path.join(backupDir, 'banco-20000101-000000.sqlite.gz');
  const oldManifest = `${oldBackup}.manifest.json`;
  await fsp.writeFile(oldBackup, 'backup-antigo');
  await fsp.writeFile(oldManifest, '{}');
  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await fsp.utimes(oldBackup, oldDate, oldDate);
  await fsp.utimes(oldManifest, oldDate, oldDate);

  const backup = await createBackup({
    dbFile,
    backupDir,
    keepDays: 1,
    now: new Date('2026-07-17T12:00:00.000Z'),
  });

  assert.equal(fs.existsSync(backup.backupFile), true);
  assert.equal(fs.existsSync(backup.manifestFile), true);
  assert.equal(fs.existsSync(oldBackup), false);
  assert.equal(fs.existsSync(oldManifest), false);
  assert.equal(backup.manifest.backupIntegrity, 'ok');
  assert.equal(backup.manifest.sha256.length, 64);
  assert.deepEqual(backup.manifest.tables, ['sample']);

  const mutated = new Database(dbFile);
  mutated.prepare('UPDATE sample SET value = ? WHERE id = 1').run('valor-alterado');
  mutated.close();
  assert.equal(readSampleValue(dbFile), 'valor-alterado');

  const restored = await restoreBackup({
    dbFile,
    backupFile: backup.backupFile,
    yes: true,
    now: new Date('2026-07-17T12:30:00.000Z'),
  });

  assert.equal(restored.integrity, 'ok');
  assert.equal(fs.existsSync(restored.safetyBackup), true);
  assert.equal(readSampleValue(dbFile), 'valor-original');
  assert.equal(readSampleValue(restored.safetyBackup), 'valor-alterado');
});
