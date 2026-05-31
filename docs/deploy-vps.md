# Deploy no VPS

Este documento descreve o fluxo padrao para atualizar o sistema no VPS Debian.

## Caminhos principais

- Projeto: `/var/www/sistema_distribuidora`
- Backend SQLite: `/var/www/sistema_distribuidora/backend/banco.sqlite`
- Variaveis de ambiente: `/var/www/sistema_distribuidora/.env`
- Certificados A1: `/var/www/sistema_distribuidora/backend/certs/`
- Backups: `/var/backups/sistema_distribuidora`

## Processos PM2 esperados

- `sistema-distribuidora`
- `sefaz-fake`

Conferir:

```bash
pm2 status
```

## Atualizacao padrao

Entre no servidor via SSH e rode:

```bash
cd /var/www/sistema_distribuidora
bash tools/backup-sqlite.sh
git pull --rebase
npm install
npm run build
pm2 restart sistema-distribuidora
pm2 save
```

Se tambem houver atualizacao no servidor fake da SEFAZ:

```bash
pm2 restart sefaz-fake
pm2 save
```

## Conferencia apos atualizar

```bash
pm2 status
pm2 logs sistema-distribuidora --lines 50
```

Teste no navegador:

- Login
- PDV
- Venda simples
- Pagamento Pix/cartao fake ou Mercado Pago teste
- Emissao fiscal fake
- Comprovantes

## Arquivos que nao vem pelo Git

Estes arquivos precisam existir no servidor, mas nao devem ser versionados:

- `.env`
- `backend/banco.sqlite`
- `backend/certs/*.pfx`

## Variaveis importantes para pagamentos

Para validar webhooks do Mercado Pago, configure no `.env`:

```env
MERCADO_PAGO_WEBHOOK_SECRET=sua_chave_secreta_do_webhook
```

Essa chave fica em Mercado Pago Developers, na aplicacao, em Webhooks/Notificacoes.

## Quando rodar build

Rode `npm run build` quando houver atualizacao de codigo do frontend/backend via Git.

Nao precisa rodar build quando mudar apenas:

- `.env`
- certificado em `backend/certs/`
- dados no banco

Nestes casos, normalmente basta:

```bash
pm2 restart sistema-distribuidora
```

## Erros comuns

### `git pull` bloqueado por alteracao local

Verifique:

```bash
git status
git diff caminho/do/arquivo
```

Se a alteracao foi manual no servidor e ja esta corrigida no Git:

```bash
git checkout -- caminho/do/arquivo
git pull --rebase
```

### Certificado A1 nao encontrado

Conferir se existe:

```bash
ls -la /var/www/sistema_distribuidora/backend/certs
```

No app, o caminho deve ser relativo, sem barra inicial:

```text
backend/certs/fake-a1.pfx
```
