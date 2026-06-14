# Pagamentos com cartao Mercado Pago Point

Atualizado em: 14/06/2026

## Arquitetura

O sistema utiliza a API de Orders do Mercado Pago Point. Os dados sensiveis do cartao nao passam pelo navegador, backend ou banco da plataforma: a leitura, senha e autorizacao acontecem na maquininha.

Fluxo:

1. O operador escolhe credito ou debito e, no credito, a quantidade de parcelas.
2. O backend valida produtos, estoque, total, conta recebedora e terminal.
3. Uma transacao local pendente e criada antes da chamada externa.
4. O backend cria uma Order `point` no Mercado Pago com chave de idempotencia.
5. A maquininha processa o cartao.
6. O backend consulta a Order periodicamente.
7. Somente apos o status confirmado o sistema registra uma unica venda, baixa o estoque e inicia o fluxo fiscal.

## Configuracao da conta

No painel de Recebimentos, a conta Mercado Pago precisa ter:

- Access Token correspondente ao ambiente;
- ambiente `teste` ou `producao`;
- opcao de terminal/cartao habilitada;
- modalidade e parcelas padrao.

Depois de salvar a conta, o botao `Configurar Point` executa o fluxo oficial:

1. cria a loja e o caixa no Mercado Pago;
2. aguarda a associacao fisica da maquininha pelo aplicativo Mercado Pago;
3. busca os terminais associados ao caixa;
4. ativa o terminal escolhido no modo PDV e salva o Terminal ID.

A associacao fisica nao pode ser automatizada pela API. O responsavel deve ligar a maquininha, escanear o QR exibido com o aplicativo Mercado Pago da conta recebedora e selecionar a loja e o caixa criados. Depois de ativar o modo PDV, reinicie o terminal.

Cada caixa aceita apenas um terminal em modo PDV. Para integrar outra maquininha, sera necessario criar outro caixa.

No ambiente de teste, informe no assistente o `User ID` numerico exibido nas credenciais de teste da integracao. Ele identifica a conta recebedora usada para criar a loja.

## Testes

O Mercado Pago nao processa cartoes reais em terminais fisicos usando contas de teste. Por isso, quando a conta esta em ambiente de teste, o popup do PDV oferece os cenarios oficiais:

- aprovar;
- recusar;
- exigir acao no terminal;
- expirar.

O backend envia o evento ao endpoint oficial de simulacao e continua consultando a Order. A mudanca normalmente leva ate 10 segundos; `action_required` pode levar mais tempo.

## Cancelamento

- Em teste, o cancelamento usa o evento oficial `canceled`.
- Em producao, o backend solicita o cancelamento da Order ao Mercado Pago.
- Se a Order ja estiver no terminal, pode ser necessario cancelar diretamente na maquininha.
- Um pagamento ja confirmado nao pode ser cancelado como simples abandono do checkout; estorno e reembolso pertencem a outro fluxo.

## Protecoes

- Access Token armazenado criptografado no SQLite e nunca enviado ao frontend.
- Chave de idempotencia na criacao e no cancelamento produtivo.
- Isolamento por estabelecimento em todas as rotas.
- Venda finalizada de forma atomica e idempotente.
- Cancelamento e simulacao permitidos somente para transacoes pendentes.
- Simulacao bloqueada em contas de producao.

## Documentacao oficial

- Configurar terminal: https://www.mercadopago.com.br/developers/pt/docs/mp-point/configure-terminal
- Processar pagamentos: https://www.mercadopago.com.br/developers/pt/docs/mp-point/payment-processing
- Testar integracao: https://www.mercadopago.com.br/developers/pt/docs/mp-point/integration-test
