# Politica de Senhas e Recuperacao

Este documento define o fluxo atual de troca e recuperacao administrativa de senha no sistema.

## Estado atual

Implementado:

- senha minima de 8 caracteres, com letras e numeros;
- senha maxima de 128 caracteres;
- invalidacao de sessoes antigas por `authVersion`;
- login separado por estabelecimento;
- reset administrativo pelo SuperAdmin;
- reset administrativo pelo gestor para operadores do proprio estabelecimento;
- senha temporaria com troca obrigatoria no proximo login;
- bloqueio de operacoes enquanto a senha temporaria nao for trocada;
- auditoria de reset, troca de senha, ativacao, desativacao e exclusao de usuario.

Nao implementado ainda:

- recuperacao automatica por e-mail;
- token de recuperacao de uso unico;
- envio de notificacao por e-mail apos reset/troca;
- limite dedicado de tentativas para fluxo de recuperacao por e-mail.

## Regras de senha temporaria

Uma senha e considerada temporaria quando:

- o SuperAdmin cria o gestor inicial do estabelecimento;
- o SuperAdmin cria ou redefine senha de um usuario do estabelecimento;
- o gestor cria ou redefine senha de um operador;
- uma senha e alterada por outro usuario que nao o proprio titular da conta.

Quando `mustChangePassword = 1`:

- o login e permitido;
- o frontend abre o modal obrigatorio de troca de senha;
- chamadas autenticadas ficam bloqueadas, exceto troca de senha e verificacao de sessao;
- apos trocar a senha, `mustChangePassword` volta para `0`;
- a sessao antiga e invalidada e o usuario precisa entrar novamente.

## Responsabilidades por perfil

### SuperAdmin

Pode:

- criar o gestor inicial de cada estabelecimento;
- adicionar operadores pela tela de usuarios do estabelecimento;
- redefinir senha de gestor ou operador;
- consultar auditoria do reset.

Nao pode:

- ver a senha antiga;
- recuperar a senha antiga;
- criar senha para `superadmin` por rotas comuns;
- operar dados do estabelecimento como se fosse usuario interno.

### Gestor

Pode:

- criar operadores dentro do limite do plano;
- redefinir senha de operadores do proprio estabelecimento;
- ativar, desativar e excluir operadores.

Nao pode:

- redefinir propria senha por painel administrativo;
- redefinir senha de outro gestor;
- redefinir senha de outro estabelecimento;
- ver senha antiga de qualquer usuario.

### Operador

Pode:

- trocar a propria senha informando a senha atual;
- entrar com senha temporaria e cadastrar uma senha definitiva.

Nao pode:

- gerenciar usuarios;
- resetar senha de terceiros.

## Fluxo operacional recomendado

1. Gestor ou SuperAdmin confirma a identidade do usuario.
2. Gestor ou SuperAdmin define uma senha temporaria.
3. O sistema invalida sessoes antigas do usuario.
4. O usuario entra com estabelecimento, login e senha temporaria.
5. O sistema bloqueia o uso e exige nova senha.
6. O usuario troca a senha.
7. O sistema encerra a sessao e pede novo login com a senha definitiva.

## Evolucao futura: recuperacao por e-mail

Quando implementado, o fluxo devera seguir estas regras:

- resposta generica para evitar enumeracao de usuarios;
- token aleatorio, de uso unico, salvo com hash no banco;
- expiracao curta, idealmente 15 a 30 minutos;
- invalidacao de sessoes apos reset;
- aviso ao usuario ou gestor apos troca;
- limite de tentativas por IP e por conta;
- logs sem token, senha ou link completo.

## Checklist de seguranca

- Nunca enviar senha por e-mail.
- Nunca registrar senha em log.
- Nunca exibir senha antiga.
- Nunca armazenar token de recuperacao em texto puro.
- Usar HTTPS em producao antes de expor qualquer fluxo de senha.
- Registrar reset e troca em auditoria.
