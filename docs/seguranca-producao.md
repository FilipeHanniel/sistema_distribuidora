# Seguranca em Producao

Este checklist registra os controles minimos antes de operar clientes reais.

Documento complementar: [LGPD basica para o sistema](lgpd-basica.md).

Documento complementar: [Politica de senhas e recuperacao](politica-senhas-recuperacao.md).

## Variaveis obrigatorias

- `NODE_ENV=production`
- `JWT_SECRET`: use um segredo aleatorio, com pelo menos 32 caracteres.
- `SUPERADMIN_PASSWORD`: necessario somente na primeira inicializacao sem superadmin cadastrado.
- `MASTER_PASSWORD`: deixe vazio/remova em producao, salvo emergencia controlada.
- `ALLOWED_ORIGINS`: defina o dominio publico do sistema, separado por virgula quando houver mais de um.
- `ENFORCE_HTTPS=true`: habilite somente depois que o Nginx estiver enviando `X-Forwarded-Proto`.

## HTTPS

Quando `ENFORCE_HTTPS=true`, o backend:

- redireciona `GET` e `HEAD` de HTTP para HTTPS;
- rejeita chamadas de API sem HTTPS com status `426`;
- adiciona `Strict-Transport-Security` e outros headers basicos de seguranca.

No Nginx, mantenha os headers de proxy:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

## Sessoes e senhas

- Tokens expiram automaticamente.
- Reinicio/deploy invalida sessoes antigas.
- Redefinicao ou troca de senha incrementa `authVersion` e invalida tokens anteriores.
- Senhas temporarias exigem troca no proximo login e bloqueiam operacoes ate a troca.
- Senhas novas precisam ter 8 a 128 caracteres, com letras e numeros.

## Logs

Logs de erro de provedores e auditoria passam por sanitizacao antes de serem gravados no console/banco. Mesmo assim, evite registrar manualmente:

- access tokens;
- senhas;
- certificados;
- chaves Pix;
- assinaturas webhook;
- payloads completos com credenciais.

## Privacidade e LGPD

Antes de operar clientes reais, mantenha atualizados:

- inventario de dados tratados pela plataforma;
- lista de provedores externos/subprocessadores;
- politica de privacidade e termos de uso;
- procedimento para atender pedidos de titulares;
- procedimento de resposta a incidentes.

Base inicial: [docs/lgpd-basica.md](lgpd-basica.md).
