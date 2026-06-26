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
- O gestor envia o certificado A1 pelo Painel Fiscal. O backend valida formato PKCS#12, senha, chave privada e validade antes de armazenar.
- Certificados enviados ficam em diretorios privados separados por estabelecimento, com nomes aleatorios e permissoes restritas.
- Caminhos internos, senha e conteudo do certificado nunca retornam para o frontend.

## Campos minimos por estabelecimento

- CNPJ do emitente.
- Inscricao estadual.
- Razao social e nome fantasia.
- Endereco fiscal completo do emitente: logradouro, numero, bairro, municipio, codigo IBGE, UF e CEP.
- Ambiente: homologacao ou producao.
- Modelo: NFC-e 65.
- Serie e proxima numeracao.
- Regime tributario e CRT.
- ID CSC e CSC.
- Certificado digital A1 e senha no servidor.
- Flags para emitir apos pagamento confirmado e imprimir apos autorizacao.

## Validacao do cadastro fiscal

O Painel Fiscal exibe um checklist de prontidao por estabelecimento. Quando o modulo fiscal esta desativado, o sistema trata o estabelecimento como controle interno: vendas, estoque e comprovantes seguem funcionando sem tentar emitir documento fiscal.

Quando o modulo fiscal esta ativo, o backend valida os seguintes grupos antes de preparar emissao:

- Emitente: CNPJ, razao social, inscricao estadual e regime tributario.
- Endereco fiscal: logradouro, numero, bairro, municipio, codigo IBGE, UF e CEP.
- NFC-e: serie, proxima numeracao, ID CSC e CSC.
- Certificado: A1 armazenado no diretorio privado, senha cifrada e validade do certificado.

Essa validacao nao substitui a homologacao oficial. Ela serve para impedir erros obvios antes de evoluir para assinatura XML, schemas e webservices da SEFAZ.

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
- `fiscalXmlSigner.js`: assina o `infNFe` com certificado A1 em XMLDSig, usando `SignedInfo`, `DigestValue`, `SignatureValue` e `X509Certificate`.
- `fiscalXmlValidator.js`: valida tecnicamente o XML assinado, incluindo estrutura NFC-e, totais, chave de acesso, assinatura e validacao XSD opcional.
- Futuro `SefazGoProvider`: deve enviar para webservice oficial, consultar recibo/protocolo, tratar rejeicoes reais e gravar XML autorizado.

## Assinatura XML

O sistema ja possui uma primeira assinatura XML em padrao XMLDSig para NFC-e:

- referencia o `infNFe` por `URI="#NFe..."`;
- calcula `DigestValue` com SHA-1 sobre o `infNFe` canonicalizado;
- assina o `SignedInfo` com RSA-SHA1 usando a chave privada do certificado A1;
- inclui o certificado X.509 em `KeyInfo/X509Data`;
- impede nova assinatura quando o XML ja possui `<Signature>`.

No Windows, a assinatura usa PowerShell/.NET para acessar o PFX. No Linux/VPS, usa OpenSSL para extrair chave/certificado e `crypto` do Node para assinar. Essa etapa ainda nao substitui o envio oficial ao webservice da SEFAZ.

## Validacao tecnica do XML

O sistema possui validacao tecnica antes da autorizacao fiscal:

- confere raiz `nfeProc` versao 4.00 e namespace oficial da NF-e;
- confere NFC-e modelo 65, cUF de Goias, ambiente, forma de emissao e campos principais de `ide`;
- valida emitente, endereco, CNPJ, IE, UF, municipio, CEP e CRT;
- valida itens, NCM, CFOP, quantidade, preco unitario, total do item e grupos minimos de impostos;
- confere totais da NFC-e e total pago;
- valida a chave de acesso com 44 digitos e digito verificador;
- valida a assinatura XMLDSig e o `DigestValue`;
- permite validacao XSD oficial quando `NFCE_XSD_PATH` aponta para o schema baixado dos portais oficiais.

Sem `NFCE_XSD_PATH`, a validacao estrutural propria continua ativa. Com `FISCAL_XSD_STRICT=true`, a ausencia do schema oficial passa a rejeitar tecnicamente o XML.

## Proximas etapas tecnicas

1. Baixar e versionar operacionalmente o pacote oficial de schemas no VPS.
2. Mapear campos fiscais dos produtos: NCM, CFOP, CSOSN/CST, unidade, origem, aliquotas e beneficios fiscais quando aplicavel.
3. Implementar webservices de autorizacao, consulta, cancelamento, inutilizacao e contingencia conforme ambiente GO.
4. Gerar DANFE NFC-e e QR Code conforme manual nacional.
5. Ligar impressao automatica apenas para documentos com status autorizado.
