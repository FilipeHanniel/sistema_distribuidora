# Cronograma de Desenvolvimento

Atualizado em: 14/06/2026

## Fase 1 - Estabilizacao da base online

Status: em andamento

Objetivo: garantir que o sistema rode com confianca em ambiente real, sem depender de ajustes manuais.

- Revisar deploy no VPS com PM2, Nginx, `.env`, banco SQLite e certificados.
- Documentar passo a passo de atualizacao do servidor. [docs/deploy-vps.md](deploy-vps.md)
- Validar backups do `backend/banco.sqlite`.
- Criar rotina simples de backup automatico diario. [docs/backup-sqlite.md](backup-sqlite.md)
- Separar claramente dados versionados e dados privados/locais.
- Testar fluxo completo: venda, pagamento, fiscal fake, comprovante e historico.

## Fase 2 - Pagamentos profissionais

Status: em andamento

Objetivo: deixar Pix e cartao preparados para uso real por estabelecimento.

- Consolidar tela de Recebimentos.
- Melhorar edicao de contas e ocultacao de contas inativas.
- Mercado Pago Pix em ambiente de teste confirmado por polling. [docs/pagamentos-pix.md](pagamentos-pix.md)
- Mercado Pago Point preparado para credito, debito, parcelas, cancelamento e simulacao oficial de teste. [docs/pagamentos-cartao-point.md](pagamentos-cartao-point.md)
- Registrar confirmacao do provedor e canal de consulta no comprovante.
- Validar webhook Mercado Pago somente em ambiente de producao controlado.
- Criar painel de transacoes de pagamento. Concluido em 14/06/2026.
- Registrar falhas de criacao e permitir conciliacao manual segura. Concluido em 14/06/2026.
- Definir padrao para novos provedores: Asaas, Sicoob, Itau, Santander, Bradesco.

## Fase 3 - Fiscal NFC-e

Status: em andamento

Objetivo: preparar o caminho profissional para emissao fiscal real.

- Manter Sefaz Fake para testes internos.
- Melhorar logs XML de envio e resposta.
- Exibir rejeicoes fiscais de forma clara para o gestor.
- Criar upload seguro de certificado A1 no painel Fiscal. Concluido em 14/06/2026.
- Remover dependencia de caminho manual do certificado. Concluido em 14/06/2026.
- Validar cadastro fiscal do estabelecimento.
- Avancar assinatura XML em padrao real.
- Preparar `SefazGoProvider` para homologacao real quando houver CNPJ/IE/certificado.

## Fase 4 - Produto SaaS e multiempresa

Status: base criada

Objetivo: transformar o sistema em plataforma comercial para multiplos estabelecimentos.

- Refinar onboarding do SuperAdmin.
- Criar planos e limites por plano.
- Implementar bloqueio por inadimplencia.
- Melhorar dashboard do SuperAdmin com metricas de plataforma.
- Criar configuracoes por estabelecimento.
- Revisar isolamento de dados por tenant.
- Criar trilha de auditoria para acoes sensiveis.

## Fase 5 - Operacao do estabelecimento

Status: base funcional

Objetivo: melhorar o dia a dia do gestor e operador.

- Refinar PDV para fluxo rapido com leitor de codigo de barras.
- Melhorar cadastro rapido de produto com campos fiscais opcionais.
- Criar compras/entrada de estoque.
- Criar fornecedores.
- Criar relatorios de estoque, margem e ruptura.
- Melhorar relatorio de gestao com IA.
- Criar central de notificacoes mais completa.

## Fase 6 - Seguranca e conformidade

Status: pendente

Objetivo: reduzir risco antes de escalar clientes reais.

- Exigir HTTPS em producao.
- Revisar segredos no `.env`.
- Criar politica de troca de senha e recuperacao.
- Melhorar permissoes por perfil.
- Auditar logs para evitar vazamento de tokens/certificados.
- Criar rotina de backup e restauracao testada.
- Documentar LGPD basica para dados de clientes/usuarios.

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

Consolidar a Fase 2 sem depender do webhook em sandbox:

1. Validar novamente venda + Pix Mercado Pago teste por polling + fiscal fake + comprovante.
2. Validar o painel de transacoes e conciliacao no VPS.
3. Preparar testes automatizados de venda duplicada e falha fiscal.
4. Definir o contrato padrao para novos provedores de pagamento.
5. Retomar webhook apenas com uma cobranca real controlada.

Configuracao segura para o VPS: [configuracao-producao.md](configuracao-producao.md)
