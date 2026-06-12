# Configuracao de producao

Atualizado em: 12/06/2026

## Variaveis obrigatorias

Antes de iniciar o backend com `NODE_ENV=production`, substitua os valores de exemplo:

```env
JWT_SECRET=gere_um_segredo_longo_e_aleatorio
SUPERADMIN_PASSWORD=defina_uma_senha_forte_na_primeira_inicializacao
ALLOWED_ORIGINS=https://seu-dominio
```

`JWT_SECRET` protege os tokens de sessao e tambem participa da criptografia das credenciais armazenadas. Nao o altere em um servidor que ja possui contas Pix cadastradas sem planejar a migracao dessas credenciais.

`SUPERADMIN_PASSWORD` e usada apenas para criar o primeiro SuperAdmin quando ainda nao existe um no banco.

## Senha mestra

`MASTER_PASSWORD` e opcional e deve permanecer vazia em producao, salvo quando houver uma necessidade operacional consciente. Valores de exemplo nao habilitam a senha mestra em producao.

## Arquivos fora do Git

Os seguintes arquivos devem ser transferidos e protegidos separadamente no servidor:

- `.env`
- `backend/banco.sqlite`
- `backend/certs/`
- backups do SQLite

## Pagamentos

O sistema confirma Pix por polling. Consulte [pagamentos-pix.md](pagamentos-pix.md) antes de alterar as variaveis de pagamento ou reativar webhook.
