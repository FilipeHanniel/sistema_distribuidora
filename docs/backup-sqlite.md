# Backup e Restauracao do SQLite

O banco principal da aplicacao fica em:

```text
/var/www/sistema_distribuidora/backend/banco.sqlite
```

Esse arquivo contem dados reais dos estabelecimentos e nao vai para o Git.

## O que foi profissionalizado

- Backup usa a API do SQLite via `better-sqlite3`, mais segura que copiar o arquivo enquanto o sistema pode estar usando o banco.
- Antes e depois do backup, o script executa `integrity_check`.
- Cada backup `.sqlite.gz` ganha um manifesto `.manifest.json` com data, hash SHA-256, tamanho e tabelas detectadas.
- Restauracao exige confirmacao explicita.
- Antes de substituir o banco atual, o script cria uma copia `before-restore`.
- A restauracao falha se encontrar arquivos `-wal` ou `-shm`, sinal de que a aplicacao pode estar usando o banco.
- Existe teste automatizado que cria, altera, restaura e valida um banco temporario.

## Backup manual no VPS

No servidor:

```bash
cd /var/www/sistema_distribuidora
bash tools/backup-sqlite.sh
```

Tambem pode usar:

```bash
npm run backup:sqlite
```

Por padrao, no VPS o backup sera salvo em:

```text
/var/backups/sistema_distribuidora
```

Exemplo de arquivos:

```text
banco-20260717-030000.sqlite.gz
banco-20260717-030000.sqlite.gz.manifest.json
```

## Backup manual na maquina local

Na maquina local, o caminho padrao do backup e:

```text
backups/
```

Comando:

```bash
npm run backup:sqlite
```

Para escolher caminhos manualmente:

```bash
DB_FILE=backend/banco.sqlite BACKUP_DIR=backups npm run backup:sqlite
```

No PowerShell:

```powershell
$env:DB_FILE="backend/banco.sqlite"
$env:BACKUP_DIR="backups"
npm run backup:sqlite
```

## Backup automatico diario no VPS

Abra o cron:

```bash
crontab -e
```

Adicione:

```cron
0 3 * * * cd /var/www/sistema_distribuidora && bash tools/backup-sqlite.sh >> /var/log/sistema-distribuidora-backup.log 2>&1
```

Isso cria backup todos os dias as 03h.

## Pacote para copia externa

O backup diario protege contra erros operacionais, mas continua no VPS. Para facilitar uma copia fora do servidor, existe um comando que gera uma pasta pronta para envio externo.

No servidor:

```bash
cd /var/www/sistema_distribuidora
bash tools/export-sqlite-backup.sh
```

Tambem pode usar:

```bash
npm run backup:sqlite:export
```

Por padrao, esse comando cria um backup novo e gera um pacote em:

```text
/var/backups/sistema_distribuidora/offsite-ready
```

Exemplo:

```text
banco-offsite-20260717-031000/
  banco-20260717-031000.sqlite.gz
  banco-20260717-031000.sqlite.gz.manifest.json
  banco-20260717-031000.sqlite.gz.sha256
  offsite-package.json
  RESTORE.txt
```

Esse diretorio pode ser copiado para outro servidor, HD externo, Google Drive, S3 ou outro armazenamento. O arquivo `.sha256` permite conferir se a copia chegou integra.

Para exportar apenas o backup mais recente, sem criar outro backup:

```bash
bash tools/export-sqlite-backup.sh --latest
```

Para escolher o destino:

```bash
OFFSITE_BACKUP_DIR=/mnt/backup-externo/sistema_distribuidora bash tools/export-sqlite-backup.sh
```

## Backup automatico com pacote externo

Se quiser gerar o backup e o pacote externo todos os dias, adicione ao cron:

```cron
10 3 * * * cd /var/www/sistema_distribuidora && bash tools/export-sqlite-backup.sh --latest >> /var/log/sistema-distribuidora-backup-offsite.log 2>&1
```

Esse exemplo presume que o backup das 03h ja foi criado. Por isso ele roda as 03h10 usando `--latest`.

## Retencao

Por padrao, backups com mais de 15 dias sao removidos automaticamente.

Para manter 30 dias:

```bash
KEEP_DAYS=30 bash tools/backup-sqlite.sh
```

No cron:

```cron
0 3 * * * cd /var/www/sistema_distribuidora && KEEP_DAYS=30 bash tools/backup-sqlite.sh >> /var/log/sistema-distribuidora-backup.log 2>&1
```

## Conferir se o backup funcionou

```bash
ls -lah /var/backups/sistema_distribuidora
tail -n 50 /var/log/sistema-distribuidora-backup.log
```

Para conferir o manifesto:

```bash
cat /var/backups/sistema_distribuidora/banco-YYYYMMDD-HHMMSS.sqlite.gz.manifest.json
```

O campo `backupIntegrity` deve estar como:

```json
"backupIntegrity": "ok"
```

Para conferir o ultimo pacote externo gerado:

```bash
cat /var/backups/sistema_distribuidora/offsite-ready/latest-offsite-package.txt
```

## Restaurar um backup

Atencao: restaurar substitui o banco atual. Faca isso apenas quando tiver certeza.

1. Pare a aplicacao:

```bash
pm2 stop sistema-distribuidora
```

2. Execute a restauracao com confirmacao:

```bash
cd /var/www/sistema_distribuidora
bash tools/restore-sqlite.sh --backup /var/backups/sistema_distribuidora/banco-YYYYMMDD-HHMMSS.sqlite.gz --yes
```

Tambem pode usar:

```bash
npm run restore:sqlite -- --backup /var/backups/sistema_distribuidora/banco-YYYYMMDD-HHMMSS.sqlite.gz --yes
```

O script cria automaticamente uma copia do banco anterior no formato:

```text
/var/www/sistema_distribuidora/backend/banco.sqlite.before-restore-YYYYMMDD-HHMMSS
```

3. Suba a aplicacao:

```bash
pm2 restart sistema-distribuidora --update-env
pm2 status
```

4. Teste login, PDV, comprovantes e fiscal.

## Restauracao bloqueada por seguranca

Se aparecer erro sobre arquivos `-wal` ou `-shm`, significa que o SQLite pode estar ativo.

Confira:

```bash
ls -lah /var/www/sistema_distribuidora/backend/banco.sqlite*
```

Pare a aplicacao e tente novamente:

```bash
pm2 stop sistema-distribuidora
bash tools/restore-sqlite.sh --backup /var/backups/sistema_distribuidora/banco-YYYYMMDD-HHMMSS.sqlite.gz --yes
```

## Teste automatizado

O teste de restauracao roda junto com os testes do backend:

```bash
cd backend
npm test
```

Ele valida que:

- um banco SQLite temporario e criado;
- o backup comprimido e gerado;
- o manifesto e criado;
- um pacote externo e gerado com manifesto, guia de restauracao e SHA-256;
- backups antigos sao removidos pela retencao;
- o banco alterado volta ao estado original apos restore;
- o banco substituido fica salvo como `before-restore`.

## Limite atual

O comando `export` prepara a copia externa, mas o servidor so fica protegido contra perda total do VPS se essa pasta for realmente copiada para outro destino.

Na implantacao comercial, defina um destino definitivo, como outro servidor, S3, Google Drive ou armazenamento equivalente, e monitore se a copia externa esta sendo criada.
