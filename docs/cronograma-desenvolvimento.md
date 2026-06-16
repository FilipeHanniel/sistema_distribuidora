# Cronograma de Desenvolvimento

Atualizado em: 16/06/2026

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

Avancar a Fase 3 - Fiscal NFC-e, mantendo a Fase 2 apenas com pendencias externas/controladas:

1. Evoluir assinatura XML e validacao por schemas antes de qualquer tentativa real com Sefaz.
2. Criar testes automatizados de venda duplicada, falha fiscal e certificado invalido.
3. Preparar `SefazGoProvider` para homologacao real quando houver CNPJ/IE/certificado de empresa.
4. Retomar Mercado Pago Point quando houver uma maquininha disponivel.
5. Retomar webhook Mercado Pago apenas com uma cobranca real controlada.

Configuracao segura para o VPS: [configuracao-producao.md](configuracao-producao.md)
