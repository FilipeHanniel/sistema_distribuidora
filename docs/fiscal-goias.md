# Fiscal NFC-e em Goias

Este projeto deve tratar a impressao fiscal automatica como emissao de NFC-e modelo 65, nao como simples comprovante interno.

## Fontes oficiais consultadas

- Secretaria da Economia de Goias: pagina de NFC-e, modelo 65, requisitos de inscricao estadual, e-CNPJ, credenciamento, software emissor e CSC.
- Secretaria da Economia de Goias: pagina de documentos fiscais e servicos com certificado digital, incluindo CSC, lotes e consulta por chave.
- Secretaria da Economia de Goias: comunicados de vinculacao entre meios de pagamento eletronico e NF-e/NFC-e.
- Portal Nacional da NF-e: Manual de especificacoes tecnicas do DANFE NFC-e e QR Code.

## Decisoes de implementacao

- O sistema guarda uma configuracao fiscal por estabelecimento.
- O PDV pode preparar um documento fiscal para cada venda paga.
- O modo fiscal inicial e um simulador interno da SEFAZ, sem comunicacao externa.
- A arquitetura separa o app do provedor fiscal para permitir trocar o simulador por SEFAZ GO real.
- A impressao automatica so deve acontecer depois da autorizacao da SEFAZ ou dentro de regra formal de contingencia.
- O comprovante atual continua sendo recibo interno, sem valor fiscal.
- Segredos fiscais, como CSC e senha do certificado, nao voltam para o frontend e sao armazenados cifrados no backend.

## Campos minimos por estabelecimento

- CNPJ do emitente.
- Inscricao estadual.
- Razao social e nome fantasia.
- Ambiente: homologacao ou producao.
- Modelo: NFC-e 65.
- Serie e proxima numeracao.
- Regime tributario.
- ID CSC e CSC.
- Certificado digital A1 e senha no servidor.
- Flags para emitir apos pagamento confirmado e imprimir apos autorizacao.

## Campos fiscais minimos por produto

- NCM.
- CFOP.
- CSOSN ou CST.
- Unidade fiscal.
- Origem da mercadoria.
- Aliquota de ICMS quando aplicavel.

## Simulador interno

O `FakeSefazProvider` valida os cadastros e retorna autorizacao ou rejeicao simulada. Quando autorizado, gera chave de acesso fake no formato de 44 digitos, protocolo simulado, URL de QR Code simulada, cStat e XML NFC-e estruturado para testes de fluxo.

As rejeicoes usam codigos internos com prefixo `SIM-` para lembrar que sao simuladas. Elas nao substituem os codigos oficiais da SEFAZ, mas aproximam o comportamento do sistema final: cada documento pode ficar autorizado, rejeitado, pendente de configuracao ou pendente de autorizacao.

Ele nao substitui a homologacao oficial. Serve para deixar o produto pronto antes de termos CNPJ, IE, certificado digital e credenciamento real em Goias.

## Estrutura para emissao propria

- `fiscalProviders.js`: escolhe o provedor fiscal atual e contem o simulador.
- `fiscalXmlBuilder.js`: monta a estrutura XML NFC-e base.
- Futuro `SefazGoProvider`: deve assinar XML, validar schema, enviar para webservice, consultar recibo/protocolo, tratar rejeicoes reais e gravar XML autorizado.

## Proximas etapas tecnicas

1. Escolher biblioteca/motor para assinar XML NFC-e com certificado A1 e validar schemas.
2. Mapear campos fiscais dos produtos: NCM, CFOP, CSOSN/CST, unidade, origem, aliquotas e beneficios fiscais quando aplicavel.
3. Implementar webservices de autorizacao, consulta, cancelamento, inutilizacao e contingencia conforme ambiente GO.
4. Gerar DANFE NFC-e e QR Code conforme manual nacional.
5. Ligar impressao automatica apenas para documentos com status autorizado.
