# Backup e Restauracao do SQLite

O banco principal da aplicacao fica em:

```text
/var/www/sistema_distribuidora/backend/banco.sqlite
```

Como este arquivo contem os dados reais dos estabelecimentos, ele nao vai para o Git.

## Backup manual

No servidor:

```bash
cd /var/www/sistema_distribuidora
bash tools/backup-sqlite.sh
```

O backup sera salvo em:

```text
/var/backups/sistema_distribuidora
```

Exemplo de arquivo:

```text
banco-20260527-030000.sqlite.gz
```

## Configurar backup automatico diario

No servidor, abra o cron:

```bash
crontab -e
```

Adicione a linha:

```cron
0 3 * * * cd /var/www/sistema_distribuidora && bash tools/backup-sqlite.sh >> /var/log/sistema-distribuidora-backup.log 2>&1
```

Isso cria backup todo dia as 03h.

## Conferir se o backup funcionou

```bash
ls -lah /var/backups/sistema_distribuidora
tail -n 50 /var/log/sistema-distribuidora-backup.log
```

## Restaurar um backup

Atencao: restaurar substitui o banco atual. Faca isso apenas quando tiver certeza.

1. Pare a aplicacao:

```bash
pm2 stop sistema-distribuidora
```

2. Faca uma copia de seguranca do banco atual:

```bash
cp /var/www/sistema_distribuidora/backend/banco.sqlite /var/www/sistema_distribuidora/backend/banco.sqlite.before-restore
```

3. Descompacte o backup escolhido:

```bash
gunzip -c /var/backups/sistema_distribuidora/banco-YYYYMMDD-HHMMSS.sqlite.gz > /var/www/sistema_distribuidora/backend/banco.sqlite
```

4. Suba a aplicacao:

```bash
pm2 start sistema-distribuidora
pm2 status
```

5. Teste login, PDV e comprovantes.

## Retencao

O script remove automaticamente backups com mais de 15 dias.

Para mudar isso, rode com:

```bash
KEEP_DAYS=30 bash tools/backup-sqlite.sh
```

Ou ajuste o cron:

```cron
0 3 * * * cd /var/www/sistema_distribuidora && KEEP_DAYS=30 bash tools/backup-sqlite.sh >> /var/log/sistema-distribuidora-backup.log 2>&1
```

## Observacao importante

Este backup fica no mesmo servidor. Ele protege contra erro de deploy e corrupcao local simples, mas nao protege contra perda total do VPS.

Em uma fase posterior, envie uma copia para outro destino, como outro servidor, S3, Google Drive ou armazenamento equivalente.

