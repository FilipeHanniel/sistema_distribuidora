# Cronograma de Desenvolvimento

Atualizado em: 17/07/2026

## Fase 1 - Estabilizacao da base online

Status: concluida

Objetivo: garantir que o sistema rode com confianca em ambiente real, sem depender de ajustes manuais.

- Revisar deploy no VPS com PM2, Nginx, `.env`, banco SQLite e certificados. Concluido em 14/06/2026.
- Documentar passo a passo de atualizacao do servidor. [docs/deploy-vps.md](deploy-vps.md) Concluido em 14/06/2026.
- Validar backups do `backend/banco.sqlite`. Concluido em 14/06/2026.
- Criar rotina simples de backup automatico diario. [docs/backup-sqlite.md](backup-sqlite.md) Concluido em 14/06/2026.
- Separar claramente dados versionados e dados privados/locais. Concluido em 14/06/2026.
- Testar fluxo completo: venda, pagamento, fiscal fake, comprovante e historico. Concluido em 14/06/2026.
- Invalidar sessoes antigas e impedir cache do frontend apos reinicio/deploy. Concluido em 14/06/2026.

## Fase 2 - Pagamentos profissionais

Status: em fechamento

Objetivo: deixar Pix e cartao preparados para uso real por estabelecimento.

- Consolidar tela de Recebimentos. Concluido em 14/06/2026.
- Melhorar edicao de contas e ocultacao de contas inativas. Concluido em 14/06/2026.
- Mercado Pago Pix em ambiente de teste confirmado por polling. [docs/pagamentos-pix.md](pagamentos-pix.md)
- Mercado Pago Point preparado para credito, debito, parcelas, cancelamento e simulacao oficial de teste. [docs/pagamentos-cartao-point.md](pagamentos-cartao-point.md)
- Assistente Mercado Pago Point para criar loja/caixa, localizar terminal associado e ativar modo PDV. Concluido em 16/06/2026.
- Teste real do Point bloqueado ate haver Terminal Point fisico/maquininha Mercado Pago.
- Registrar confirmacao do provedor e canal de consulta no comprovante. Concluido em 14/06/2026.
- Validar webhook Mercado Pago somente em ambiente de producao controlado. Pendente por depender de cobranca real controlada.
- Criar painel de transacoes de pagamento. Concluido em 14/06/2026.
- Registrar falhas de criacao e permitir conciliacao manual segura. Concluido em 14/06/2026.
- Definir padrao para novos provedores: Asaas, Sicoob, Itau, Santander, Bradesco.

## Fase 3 - Fiscal NFC-e

Status: proxima frente

Objetivo: preparar o caminho profissional para emissao fiscal real.

- Manter Sefaz Fake para testes internos. Concluido em 14/06/2026.
- Melhorar logs XML de envio e resposta. Concluido em 14/06/2026.
- Exibir rejeicoes fiscais de forma clara para o gestor. Concluido em 14/06/2026.
- Criar upload seguro de certificado A1 no painel Fiscal. Concluido em 14/06/2026.
- Remover dependencia de caminho manual do certificado. Concluido em 14/06/2026.
- Validar cadastro fiscal do estabelecimento. Concluido em 16/06/2026.
- Avancar assinatura XML em padrao real. Concluido em 16/06/2026 com XMLDSig inicial.
- Validar tecnicamente XML fiscal antes da autorizacao. Concluido em 26/06/2026 com validacao estrutural e suporte a XSD oficial.
- Preparar `SefazGoProvider` para homologacao real quando houver CNPJ/IE/certificado.

## Fase 4 - Produto SaaS e multiempresa

Status: concluida

Objetivo: transformar o sistema em plataforma comercial para multiplos estabelecimentos.

- Refinar onboarding do SuperAdmin. Concluido em 28/06/2026 com codigo de acesso, gestor inicial, configuracoes automaticas, diagnostico de implantacao e exclusao protegida de contas com historico.
- Criar planos e limites por plano. Concluido em 28/06/2026 com basic (gestor + 3), premium (gestor + 6) e enterprise ilimitado.
- Implementar bloqueio por inadimplencia. Concluido em 28/06/2026 com vencimento, tolerancia configuravel, reconciliacao automatica, notificacoes, suspensao, bloqueio operacional e reativacao por pagamento.
- Melhorar dashboard do SuperAdmin com metricas de plataforma. Concluido em 28/06/2026 com MRR, ARPA, crescimento, risco, comparacao entre negocios e ranking de desempenho.
- Criar configuracoes por estabelecimento. Concluido em 28/06/2026 com identidade comercial, limite unificado de estoque e preferencias do comprovante.
- Separar login por estabelecimento e permitir o mesmo nome de usuario em contas diferentes. Concluido em 28/06/2026.
- Revisar isolamento de dados por tenant. Concluido em 28/06/2026 com banco temporario e testes de integracao para login, produtos, usuarios, vendas, recebimentos, configuracoes e SuperAdmin.
- Criar trilha de auditoria para acoes sensiveis. Concluido em 28/06/2026 cobrindo usuarios, produtos, estoque, vendas, recebimentos, Point, fiscal, certificados, assinaturas e pagamentos da plataforma.

## Fase 5 - Operacao do estabelecimento

Status: em andamento

Objetivo: melhorar o dia a dia do gestor e operador.

- Refinar PDV para fluxo rapido com leitor de codigo de barras. Concluido em 28/06/2026 com consulta direta ao backend, captura global do leitor USB, atalhos de foco e retorno visual do bip.
- Melhorar cadastro rapido de produto com campos fiscais opcionais. Concluido em 28/06/2026 com permissao controlada para operador, codigo unico por estabelecimento, inclusao imediata no carrinho e formulario fiscal recolhivel.
- Criar compras/entrada de estoque. Concluido em 28/06/2026 com rascunho, recebimento atomico, custo medio, cancelamento protegido e auditoria.
- Criar fornecedores. Concluido em 28/06/2026 com cadastro, edicao, inativacao e isolamento por estabelecimento.
- Criar razao de movimentacoes de estoque. Concluido em 28/06/2026 cobrindo saldo inicial, compras, reversoes, vendas e ajustes manuais.
- Criar relatorios de estoque, margem e ruptura. Concluido em 14/07/2026 com calculo backend por estabelecimento, margem por produto, curva de faturamento, produtos parados, estoque baixo ativo e risco de ruptura por saida dos ultimos 90 dias.
- Melhorar relatorio de gestao com IA. Concluido em 17/07/2026 com geracao economica programada, leitura por cache no painel, uso de dados operacionais de estoque/margem/ruptura/produtos parados/pagamentos/fiscal e prompt com blocos padronizados para o gestor.
- Criar central de notificacoes mais completa. Concluido em 14/07/2026 com sincronizacao operacional automatica, alertas de ruptura, estoque baixo, produtos parados, compra recebida, pagamento pendente/erro, falha fiscal, venda sem NF autorizada e leitura visual por tipo.
  - Gerar alertas para risco de ruptura, produtos parados e estoque baixo ativo.
  - Notificar compra recebida, falha fiscal, venda sem NF autorizada, pagamento pendente/erro e vencimento de assinatura.
  - Melhorar a leitura visual da central por tipo, referencia e horario.

## Fase 6 - Seguranca e conformidade

Status: em andamento

Objetivo: reduzir risco antes de escalar clientes reais.

- Exigir HTTPS em producao. Preparado em 17/07/2026 com `ENFORCE_HTTPS`, `trust proxy`, redirecionamento seguro e headers HTTP basicos, dependente de Nginx com `X-Forwarded-Proto`.
- Revisar segredos no `.env`. Concluido em 17/07/2026 com validacao de `JWT_SECRET` em producao, aviso para `MASTER_PASSWORD`, `ALLOWED_ORIGINS` explicito e checklist em [docs/seguranca-producao.md](seguranca-producao.md).
- Criar politica de troca de senha e recuperacao. Concluido em 17/07/2026 com regra minima de senha, reset administrativo por SuperAdmin/gestor, senha temporaria com troca obrigatoria, bloqueio operacional ate a troca, invalidacao de sessoes e documentacao em [docs/politica-senhas-recuperacao.md](politica-senhas-recuperacao.md). Recuperacao automatica por e-mail fica como evolucao futura.
- Melhorar permissoes por perfil. Concluido em 17/07/2026 com politica nomeada de permissoes no backend, menus/rotas do frontend por permissao e testes para limitar operador ao fluxo do caixa.
- Auditar logs para evitar vazamento de tokens/certificados. Concluido em 17/07/2026 com sanitizacao de auditoria e logs de erro de provedores.
- Criar rotina de backup e restauracao testada. Concluido em 17/07/2026 com backup validado por `integrity_check`, manifesto SHA-256, restauracao com copia `before-restore`, bloqueio de WAL/SHM e teste automatizado em banco temporario.
- Preparar copia externa dos backups fora do VPS. Concluido em 17/07/2026 com pacote `offsite-ready`, manifesto, SHA-256, guia de restauracao e script `tools/export-sqlite-backup.sh`. A escolha do armazenamento externo definitivo fica para operacao comercial.
- Definir destino externo inicial dos backups. Concluido em 18/07/2026 com politica simples de copia manual para maquina local/Drive em [docs/backup-externo-manual.md](backup-externo-manual.md). Automacao externa fica para quando houver clientes pagantes.
- Documentar LGPD basica para dados de clientes/usuarios. Concluido em 17/07/2026 com inventario inicial, papeis controlador/operador, cuidados com IA, fluxo de titulares, incidentes e checklist contratual em [docs/lgpd-basica.md](lgpd-basica.md).
- Preparar termos/contrato LGPD para clientes piloto. Concluido em 18/07/2026 com minuta operacional em [docs/termos-clientes-piloto.md](termos-clientes-piloto.md), incluindo papeis LGPD, certificado A1, pagamentos, fiscal, IA, backups, suporte, incidentes e checklist de aceite.

## Fase 7 - Qualidade e testes

Status: pendente

Objetivo: reduzir regressao conforme o sistema cresce.

- Criar testes de backend para vendas, pagamentos e fiscal.
- Criar testes de integracao com providers fake.
- Criar testes de frontend para fluxos criticos.
- Criar seed de dados de demonstracao.
- Criar checklist antes de deploy.

## Fase 8 - Preparacao comercial

Status: pendente

Objetivo: deixar o produto apresentavel e operavel para primeiros clientes.

- Criar ambiente demo.
- Criar manual rapido do gestor.
- Criar manual rapido do operador.
- Criar pagina/argumento comercial simples.
- Definir processo de implantacao de cliente.
- Definir suporte, backup e responsabilidades.

## Proximo passo recomendado

Avancar a Fase 6 - Seguranca e conformidade antes de escalar clientes reais:

1. Criar recuperacao automatica por e-mail quando houver servico de e-mail transacional.
2. Revisar a minuta de termos para clientes piloto com advogado/contador antes de uso comercial real.
3. Evoluir backup externo manual para copia automatica quando houver clientes pagantes.

Configuracao segura para o VPS: [configuracao-producao.md](configuracao-producao.md)
