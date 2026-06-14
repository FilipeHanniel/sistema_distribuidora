# Arquitetura atual de pagamentos Pix

Atualizado em: 12/06/2026

## Decisao atual

O sistema confirma pagamentos Pix consultando diretamente o provider em intervalos regulares (polling).

O webhook Mercado Pago fica adiado ate existir um ambiente de producao controlado para validar o ciclo real de uma cobranca Pix. O sandbox cria pagamentos de teste com comportamento especial e nao representa de forma confiavel todas as transicoes de uma cobranca real.

## Fluxo do PDV

1. O frontend envia os itens, valor, conta recebedora e Device ID ao backend.
2. O backend recupera do SQLite as credenciais criptografadas da conta recebedora.
3. O backend cria uma Order no Mercado Pago usando o Access Token da conta.
4. O QR Code, Order ID, Payment ID e referencia externa sao salvos em `payment_transactions`.
5. O frontend consulta o status local a cada `PAYMENT_POLLING_INTERVAL_MS`.
6. O backend consulta a Order no Mercado Pago com o mesmo Access Token usado na criacao.
7. Quando o provider confirma o pagamento, o backend registra uma unica venda, atualiza estoque e inicia o fluxo fiscal.

## Protecoes mantidas

- O Access Token nunca e enviado ao frontend.
- Cada conta recebedora pertence a um estabelecimento.
- A criacao da Order usa `X-Idempotency-Key`.
- A finalizacao da venda faz uma reivindicacao atomica da transacao antes de gerar a venda.
- A venda usa o ID da transacao Pix como identificador unico, impedindo duplicidade mesmo apos uma interrupcao do processo.
- Atualizacoes concorrentes so alteram uma transacao que ainda esteja pendente.
- Uma confirmacao interrompida em `processing` pode ser retomada sem baixar o estoque novamente.
- Precos e total da venda sao recalculados pelo backend antes de criar a cobranca.
- A baixa de estoque confirma a disponibilidade dentro da mesma transacao SQLite.
- Pix e cartao nao podem ser registrados pela rota de venda direta sem confirmacao do provider.
- O comprovante registra o provider, os identificadores e o canal `Consulta automatica`.
- O cancelamento envia uma chave de idempotencia propria.
- A tentativa de pagamento e registrada antes da chamada ao provider; falhas de criacao continuam visiveis para suporte.

## Painel de transacoes e conciliacao

O gestor acessa **Transacoes** no menu lateral para acompanhar todas as tentativas de Pix e cartao do estabelecimento.

O painel permite:

- filtrar por periodo, status, metodo, provider e identificadores;
- visualizar IDs locais, Order ID, Payment ID e referencia externa;
- identificar pagamento confirmado sem venda vinculada;
- identificar cobranca vencida ainda pendente ou falha retornada pelo provider;
- reconsultar manualmente uma cobranca pendente;
- retomar com seguranca a finalizacao de uma venda ja paga.

A conciliacao reutiliza a finalizacao atomica da transacao. Consultas repetidas nao devem criar vendas duplicadas nem baixar o estoque novamente.

Tentativas com status `error` e sem ID do provider falharam antes da criacao da cobranca. Nesse caso, o operador deve iniciar uma nova venda no PDV.

## Ambiente de teste Mercado Pago

No modo de teste, o nome `APRO` e enviado automaticamente para permitir que o sandbox retorne um pagamento aprovado. O backend salva inicialmente a transacao local como pendente e confirma o resultado por consulta ao provider. Isso exercita o fluxo real do sistema sem tratar a resposta inicial como venda concluida.

## Configuracao

```env
PAYMENT_POLLING_INTERVAL_MS=10000
PAYMENT_PROCESSING_TIMEOUT_MS=120000
VITE_MERCADO_PAGO_PUBLIC_KEY=
```

O Access Token nao fica no `.env`. Ele e cadastrado na conta recebedora do estabelecimento e armazenado criptografado no SQLite.

## Webhook futuro

Antes de reativar webhook:

1. Validar com uma cobranca Pix real controlada.
2. Confirmar a aplicacao e o Access Token proprietarios da Order.
3. Implementar validacao da assinatura em modulo isolado e coberto por testes.
4. Manter polling como contingencia, sem permitir dupla finalizacao.
5. Registrar eventos recebidos sem expor segredos.
