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
cd backend
npm install
npm test
cd ..
npm run build
pm2 restart sistema-distribuidora --update-env
pm2 save
```

Ao reiniciar o backend, as sessoes abertas antes da atualizacao sao invalidadas. Em ate 30 segundos, as abas abertas retornam automaticamente para a tela de login. O `index.html` tambem e servido sem cache para evitar que o navegador continue usando uma interface antiga depois do deploy.

Na atualizacao que introduz login por estabelecimento, o backend migra a unicidade dos usuarios e gera um codigo para cada estabelecimento existente. O backup anterior ao `git pull` e obrigatorio. Depois do deploy, consulte os codigos no painel do SuperAdmin. O acesso do SuperAdmin usa o estabelecimento `plataforma`.

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
- Login com o codigo correto do estabelecimento e rejeicao com codigo de outra conta
- Criacao de funcionario e reset de senha pelo SuperAdmin
- Limites de equipe dos planos Basico e Premium
- PDV
- Venda simples
- Pagamento Pix/cartao fake ou Mercado Pago teste
- Emissao fiscal fake
- Comprovantes

## Arquivos que nao vem pelo Git

Estes arquivos precisam existir no servidor, mas nao devem ser versionados:

- `.env`
- `backend/banco.sqlite`
- `backend/private/fiscal-certificates/` quando houver certificados A1 enviados pelo painel

## Quando rodar build

Rode `npm run build` quando houver atualizacao de codigo do frontend/backend via Git.

Nao precisa rodar build quando mudar apenas:

- `.env`
- certificado enviado pelo Painel Fiscal
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

Certificados novos devem ser enviados pelo Painel Fiscal. Para conferir o armazenamento privado:

```bash
ls -la /var/www/sistema_distribuidora/backend/private/fiscal-certificates
```

O caminho nao deve ser digitado no app. Se o certificado legado nao estiver disponivel, envie novamente o `.pfx` no Painel Fiscal.

Em producao, mantenha a pasta privada fora de qualquer diretorio servido pelo Nginx e com acesso restrito ao usuario que executa o backend.

Essa pasta nao e versionada pelo Git e nao faz parte do backup isolado do SQLite. Inclua-a futuramente em um backup cifrado ou esteja preparado para solicitar novo envio do certificado ao gestor apos uma restauracao.

A senha do certificado e cifrada usando a chave derivada de `JWT_SECRET`. Nao troque esse segredo em producao sem planejar a recifragem das credenciais armazenadas.

O backend valida arquivos PKCS#12 com OpenSSL no Debian/Ubuntu. Confirme a dependencia:

```bash
sudo apt install openssl -y
openssl version
```

