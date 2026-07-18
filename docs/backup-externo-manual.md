# Backup Externo Manual

Esta e a politica inicial mais simples para proteger o banco fora do VPS.

Ela deve ser usada enquanto o projeto esta em fase piloto ou validacao comercial, antes de contratar um armazenamento externo automatico.

## Objetivo

Manter uma copia periodica do backup SQLite fora do servidor principal.

Isso protege contra perda total do VPS, erro grave de deploy, exclusao acidental do banco ou indisponibilidade do provedor.

## Frequencia inicial

Durante pilotos:

- fazer copia externa manual pelo menos 1 vez por semana;
- fazer copia externa manual antes de alteracoes grandes no sistema;
- fazer copia externa manual antes de migracao de banco, fiscal ou pagamentos;
- fazer copia externa manual depois de cadastrar cliente real importante.

Quando houver clientes pagantes ativos, a meta deve evoluir para copia diaria automatica fora do VPS.

## Onde guardar

Destino inicial recomendado:

```text
C:\Users\SEU_USUARIO\Backups\sistema_distribuidora
```

Depois de copiar para a maquina local, sincronize essa pasta com um segundo destino, como Google Drive, OneDrive, HD externo ou outro computador.

Evite guardar somente na mesma maquina que voce usa para desenvolver.

## Passo 1 - gerar pacote no VPS

No servidor:

```bash
cd /var/www/sistema_distribuidora
bash tools/backup-sqlite.sh
bash tools/export-sqlite-backup.sh --latest
cat /var/backups/sistema_distribuidora/offsite-ready/latest-offsite-package.txt
```

O ultimo comando mostrara o caminho do pacote mais recente, por exemplo:

```text
/var/backups/sistema_distribuidora/offsite-ready/banco-offsite-20260718-030010
```

Copie esse caminho para usar no `scp`.

## Passo 2 - copiar para o Windows com Git Bash

No Git Bash da sua maquina local:

```bash
mkdir -p ~/Backups/sistema_distribuidora
scp -r root@SEU_SERVIDOR:/var/backups/sistema_distribuidora/offsite-ready/banco-offsite-YYYYMMDD-HHMMSS ~/Backups/sistema_distribuidora/
```

Exemplo usando dominio:

```bash
scp -r root@testedistrib.duckdns.org:/var/backups/sistema_distribuidora/offsite-ready/banco-offsite-YYYYMMDD-HHMMSS ~/Backups/sistema_distribuidora/
```

Exemplo usando IP:

```bash
scp -r root@200.234.218.79:/var/backups/sistema_distribuidora/offsite-ready/banco-offsite-YYYYMMDD-HHMMSS ~/Backups/sistema_distribuidora/
```

## Passo 3 - conferir integridade no Git Bash

Entre na pasta copiada:

```bash
cd ~/Backups/sistema_distribuidora/banco-offsite-YYYYMMDD-HHMMSS
sha256sum -c *.sha256
```

Resultado esperado:

```text
banco-YYYYMMDD-HHMMSS.sqlite.gz: OK
```

Se nao aparecer `OK`, descarte a copia e repita o `scp`.

## Passo 4 - conferir conteudo minimo

A pasta copiada deve ter:

```text
banco-YYYYMMDD-HHMMSS.sqlite.gz
banco-YYYYMMDD-HHMMSS.sqlite.gz.manifest.json
banco-YYYYMMDD-HHMMSS.sqlite.gz.sha256
offsite-package.json
RESTORE.txt
```

O arquivo `RESTORE.txt` acompanha o pacote para orientar uma restauracao futura.

## Passo 5 - registrar a copia

Mantenha um registro simples em planilha, nota ou arquivo interno:

```text
Data:
Pacote:
Destino:
Hash conferido:
Responsavel:
Observacao:
```

Exemplo:

```text
Data: 18/07/2026
Pacote: banco-offsite-20260718-030010
Destino: Notebook + Google Drive
Hash conferido: sim
Responsavel: Filipe
Observacao: copia feita antes de atualizacao do servidor
```

## Retencao manual

Enquanto o backup externo for manual:

- manter pelo menos os 4 ultimos pacotes semanais;
- manter pelo menos 1 pacote mensal por 6 meses;
- antes de apagar qualquer copia antiga, conferir se existem copias mais recentes em pelo menos dois lugares.

## Restauracao

Para restaurar, use o `RESTORE.txt` dentro do pacote ou siga a rotina principal em:

```text
docs/backup-sqlite.md
```

Nunca restaure diretamente sem parar a aplicacao e sem confirmar qual backup sera usado.

## Limitacao desta politica

Esta politica depende de disciplina humana. Ela e boa para piloto, mas nao e ideal para operacao comercial com muitos clientes.

Quando houver clientes pagantes, a proxima evolucao recomendada e configurar copia automatica para armazenamento externo com monitoramento.
