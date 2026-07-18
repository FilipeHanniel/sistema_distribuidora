# LGPD Basica para o Sistema

Este documento e uma base operacional para desenvolvimento, implantacao e suporte. Ele nao substitui revisao juridica, mas ajuda a deixar claro quais dados o sistema trata, quem e responsavel por cada dado e quais cuidados tecnicos devem existir antes de atender clientes reais.

## Referencias oficiais

- Lei Geral de Protecao de Dados Pessoais - LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Materiais educativos e publicacoes da ANPD: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes
- Regulamento da ANPD para agentes de tratamento de pequeno porte: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022

## Papeis no nosso produto

### Plataforma

Para dados da propria plataforma, como cadastro do estabelecimento, plano, cobranca, suporte e logs administrativos, a plataforma tende a atuar como controladora, pois decide finalidade e meios do tratamento desses dados.

Para dados operacionais do estabelecimento, como produtos, vendas, operadores, clientes da loja, XML fiscal e movimentacoes, a plataforma tende a atuar como operadora, porque trata os dados em nome do estabelecimento.

Essa divisao precisa aparecer no contrato com o cliente.

### Estabelecimento

O estabelecimento tende a ser controlador dos dados do seu negocio. Ele decide quais produtos cadastra, quais usuarios operadores cria, quais dados fiscais informa, quando emite documentos fiscais e quais dados de clientes finais coleta.

### Provedores externos

Mercado Pago, SEFAZ, provedor de VPS, Google/Gemini e futuros bancos/provedores podem atuar como controladores independentes, operadores ou suboperadores, conforme o servico usado e o contrato aplicavel. Antes de producao, cada fornecedor deve entrar em uma lista de subprocessadores.

## Inventario inicial de dados

| Grupo de dados | Exemplos | Finalidade | Base legal provavel | Retencao sugerida |
| --- | --- | --- | --- | --- |
| Estabelecimento | Nome comercial, codigo de login, plano, status, contato, configuracoes | Contratacao, acesso, suporte e gestao da plataforma | Execucao de contrato, legitimo interesse e exercicio regular de direitos | Enquanto houver contrato e periodo adicional para auditoria |
| Usuarios do estabelecimento | Nome, usuario, papel, senha criptografada, status, versao de autenticacao | Controle de acesso e operacao do sistema | Execucao de contrato e legitimo interesse em seguranca | Enquanto usuario estiver ativo e periodo de auditoria |
| Produtos e estoque | Nome, codigo de barras, categoria, preco, custo, estoque, dados fiscais opcionais | Venda, estoque, relatorios e emissao fiscal | Execucao de contrato e obrigacao legal quando fiscal | Enquanto necessario para operacao e registros fiscais |
| Fornecedores e compras | Nome, contato, pedidos, itens, custos e recebimentos | Entrada de estoque, custo medio e auditoria | Execucao de contrato e legitimo interesse | Enquanto necessario para operacao e auditoria |
| Vendas e pagamentos | Itens, total, forma de pagamento, IDs do provedor, status, comprovante | Confirmar venda, conciliar pagamento e gerar comprovante | Execucao de contrato, obrigacao legal e exercicio regular de direitos | Pelo prazo fiscal/contabil aplicavel |
| Fiscal | CNPJ/CPF quando aplicavel, IE, regime, certificado A1, XML, protocolo, rejeicoes | Emissao e guarda fiscal | Obrigacao legal | Conforme prazo fiscal/contabil aplicavel |
| Relatorios de IA | Indicadores agregados de venda, margem, estoque, ruptura e recomendacoes | Apoio gerencial diario/semanal | Execucao de contrato e legitimo interesse | Periodo configuravel por estabelecimento |
| Notificacoes | Alertas de estoque, fiscal, pagamento, assinatura e operacao | Avisar gestor/operador sobre eventos relevantes | Execucao de contrato e legitimo interesse | Periodo curto, com limpeza futura |
| Logs e auditoria | Usuario, acao, recurso, horario, metadados sanitizados | Seguranca, rastreabilidade e investigacao | Legitimo interesse e exercicio regular de direitos | 6 a 24 meses, a definir |
| Backups | Copia do banco SQLite, manifesto, hash e data | Continuidade do negocio e restauracao | Legitimo interesse e execucao de contrato | Politica definida em `docs/backup-sqlite.md` |

## Dados que devemos evitar

- Nao armazenar numero completo de cartao, CVV ou senha de conta bancaria.
- Nao enviar certificados, tokens, senhas, chaves Pix ou dados fiscais sensiveis para IA.
- Nao coletar CPF/CNPJ do cliente final quando a venda nao exigir documento fiscal identificado.
- Nao manter payloads completos de provedores quando apenas IDs, status e mensagens sanitizadas forem suficientes.

## Controles ja previstos no sistema

- Isolamento por estabelecimento em rotas, consultas e testes de integracao.
- Permissoes por perfil para limitar operador, gestor e superadmin.
- Senhas com hash, politica minima e invalidacao de sessoes antigas apos troca/reset.
- `.env` fora do Git para segredos, tokens e chaves privadas.
- Upload seguro de certificado A1, sem depender de caminho manual do computador do usuario.
- HTTPS em producao com `ENFORCE_HTTPS`, Nginx e headers de proxy.
- Logs e auditoria com sanitizacao para reduzir risco de vazamento.
- Backup SQLite com verificacao de integridade, manifesto SHA-256 e rotina de restauracao.

## Uso de IA

A IA deve ser usada de forma economica e com dados minimizados:

- Gerar relatorio diario uma vez ao dia, apos fechamento das vendas do dia anterior.
- Gerar relatorio semanal uma vez por semana.
- Usar preferencialmente dados agregados: totais, margens, ranking, ruptura, estoque baixo, produtos parados e falhas operacionais.
- Evitar nomes de clientes finais, documentos pessoais, tokens, certificados e credenciais.
- Registrar no sistema que o relatorio e recomendacao gerencial, nao decisao automatica obrigatoria.

## Atendimento a titulares

Fluxo operacional sugerido:

1. Receber pedido por canal oficial a definir, como `privacidade@dominio`.
2. Confirmar identidade e vinculo com o estabelecimento.
3. Registrar solicitacao em trilha interna.
4. Identificar se a plataforma atua como controladora ou operadora naquele dado.
5. Quando o dado pertencer ao estabelecimento, envolver o gestor/controlador antes de alterar, exportar ou excluir.
6. Corrigir, exportar, restringir ou eliminar dados quando cabivel.
7. Preservar dados que tenham obrigacao fiscal, contabil, contratual ou defesa juridica.
8. Responder dentro do prazo definido pela politica interna e pelo contrato.

## Incidentes de seguranca

Fluxo minimo:

1. Conter o incidente: suspender acesso, revogar tokens, trocar senhas e preservar evidencias.
2. Identificar dados afetados, estabelecimentos envolvidos e periodo do incidente.
3. Verificar se houve dados pessoais, fiscais, certificados ou credenciais.
4. Notificar o estabelecimento afetado quando a plataforma atuar como operadora.
5. Avaliar, com apoio juridico, comunicacao a ANPD e aos titulares.
6. Registrar causa raiz, impacto, medidas adotadas e prevencao de recorrencia.

## Contratos e politicas antes de clientes reais

Antes de vender para clientes reais, preparar:

- Termos de uso do sistema.
- Politica de privacidade da plataforma.
- Clausula ou anexo de tratamento de dados entre plataforma e estabelecimento.
- Lista de subprocessadores: VPS, Mercado Pago, Google/Gemini, provedores fiscais e futuros bancos.
- Politica de backup, retencao e restauracao.
- Politica de suporte e acesso administrativo.
- Procedimento de resposta a incidentes.
- Processo de encerramento de contrato e exportacao de dados.

## Decisoes pendentes

- Definir canal oficial de privacidade.
- Definir responsavel interno pelo atendimento LGPD.
- Validar bases legais e prazos de retencao com contador/juridico.
- Criar exportacao de dados por estabelecimento.
- Criar rotina de exclusao/inativacao com preservacao fiscal e auditoria.
- Planejar backup externo fora do VPS.
