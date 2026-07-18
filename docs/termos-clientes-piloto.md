# Termos Base para Clientes Piloto

Este documento e uma minuta operacional para uso interno. Ele organiza as regras que devem ser apresentadas a clientes piloto antes de usarem o sistema com dados reais.

Importante: este texto nao substitui contrato juridico, politica de privacidade ou revisao por advogado. A ideia e servir como base para conversa comercial, implantacao controlada e revisao juridica posterior.

## Dados das partes

### Plataforma

- Nome empresarial: [preencher]
- CNPJ/CPF: [preencher]
- Responsavel: [preencher]
- E-mail de suporte: [preencher]
- E-mail de privacidade/LGPD: [preencher]
- Endereco: [preencher]

### Cliente piloto

- Nome empresarial: [preencher]
- CNPJ/CPF: [preencher]
- Inscricao Estadual: [preencher quando houver]
- Responsavel gestor: [preencher]
- E-mail administrativo: [preencher]
- Telefone/WhatsApp: [preencher]
- Endereco do estabelecimento: [preencher]

## Objetivo do piloto

O piloto tem como objetivo validar o uso do sistema em ambiente real ou semirreal de operacao do estabelecimento, incluindo:

- cadastro de usuarios;
- cadastro de produtos;
- controle de estoque;
- vendas no PDV;
- comprovantes;
- pagamentos integrados quando configurados;
- modulo fiscal quando habilitado;
- relatorios gerenciais;
- notificacoes operacionais;
- backups e rotinas de suporte.

O piloto nao significa que todas as funcionalidades estejam em versao final. Recursos em teste devem ser identificados durante a implantacao.

## Papeis na LGPD

Para dados da propria plataforma, como cadastro do cliente, plano, suporte, cobranca, logs administrativos e relacionamento comercial, a plataforma tende a atuar como controladora.

Para dados operacionais do estabelecimento, como produtos, vendas, usuarios internos, XML fiscal, configuracoes de pagamento, estoque e relatorios, a plataforma tende a atuar como operadora, tratando os dados em nome do estabelecimento.

O cliente piloto tende a atuar como controlador dos dados do seu proprio negocio e dos dados de clientes finais que eventualmente inserir no sistema.

## Dados tratados

Durante o piloto, o sistema podera tratar:

- dados cadastrais do estabelecimento;
- dados de usuarios do estabelecimento;
- produtos, categorias, precos, custos, estoque e codigos de barras;
- vendas, itens vendidos, descontos, totais, horarios e comprovantes;
- dados de pagamento, como IDs de transacao, status, provedor e canal de confirmacao;
- dados fiscais do estabelecimento e dos produtos;
- certificado digital A1 quando o modulo fiscal estiver habilitado;
- XMLs fiscais, protocolos, rejeicoes e eventos simulados ou reais;
- notificacoes e logs operacionais;
- relatorios gerenciais e indicadores agregados.

O sistema nao deve armazenar numero completo de cartao, CVV, senha bancaria, senha de conta Mercado Pago ou segredo de conta bancaria do cliente final.

## Responsabilidades da plataforma

A plataforma deve:

- manter o sistema operacional dentro do escopo combinado para o piloto;
- aplicar controles de acesso por usuario e perfil;
- manter senhas com hash e exigir troca de senha temporaria;
- isolar os dados por estabelecimento;
- manter segredos fora do Git e fora da interface publica;
- tratar tokens, certificados e credenciais como dados sensiveis de seguranca;
- manter rotina de backup e restauracao conforme documentacao tecnica;
- registrar logs e auditoria sem expor tokens, senhas ou certificados;
- comunicar falhas relevantes que afetem disponibilidade, dados ou seguranca;
- apoiar o cliente em configuracoes iniciais de pagamento, fiscal e usuarios.

## Responsabilidades do cliente piloto

O cliente piloto deve:

- fornecer dados corretos do estabelecimento;
- cadastrar apenas usuarios autorizados;
- remover ou inativar usuarios que deixarem de operar o sistema;
- manter sigilo das senhas de acesso;
- conferir dados fiscais antes de emitir documentos;
- validar com contador dados como CFOP, NCM, CST/CSOSN, CRT, regime tributario e Inscricao Estadual;
- usar certificado A1 somente se tiver autorizacao para isso;
- informar imediatamente suspeita de acesso indevido, perda de senha ou uso incorreto;
- cumprir suas obrigacoes fiscais, contabeis e legais perante clientes finais e orgaos publicos.

## Certificado A1

Quando o modulo fiscal estiver habilitado, o cliente podera enviar certificado A1 para uso pelo sistema.

Regras minimas:

- o certificado deve pertencer ao estabelecimento ou a entidade autorizada;
- a senha do certificado deve ser fornecida pelo responsavel autorizado;
- o arquivo deve ser enviado apenas pelo fluxo seguro do sistema;
- o certificado nao deve ser enviado por WhatsApp, e-mail comum ou Git;
- a plataforma deve armazenar o certificado em area privada do servidor;
- o cliente pode solicitar remocao ou troca do certificado;
- a plataforma deve registrar a operacao sem exibir a senha ou o conteudo do arquivo.

## Pagamentos

O sistema pode integrar provedores como Mercado Pago e provedores fake para testes internos.

Durante o piloto:

- o cliente deve autorizar o uso da conta recebedora quando a integracao for real;
- tokens e credenciais devem ser tratados como segredos;
- pagamentos Pix podem depender de polling, webhook ou ambos, conforme disponibilidade tecnica do provedor;
- pagamentos em teste podem nao representar dinheiro real;
- comprovantes do sistema nao substituem comprovante oficial do provedor quando houver divergencia;
- divergencias entre sistema e provedor devem ser conferidas pela conta oficial do provedor.

## Fiscal

O modulo fiscal pode operar em modo simulado, fake ou real, conforme configuracao.

Durante o piloto:

- nota fiscal real somente deve ser ativada com CNPJ, IE, certificado e credenciamento validos;
- o cliente deve validar dados fiscais com contador;
- rejeicoes fiscais podem ocorrer por dados incorretos de produto, estabelecimento ou operacao;
- XMLs simulados nao possuem validade juridica;
- XMLs reais, quando emitidos, devem ser tratados como documentos fiscais do estabelecimento;
- a plataforma pode apoiar tecnicamente, mas nao substitui consultoria contabil ou fiscal.

## Relatorios com IA

O sistema pode usar IA para gerar relatorios gerenciais diarios e semanais.

Regras:

- a IA deve receber preferencialmente dados agregados;
- tokens, senhas, certificados e dados pessoais desnecessarios nao devem ser enviados;
- o relatorio e apoio gerencial, nao decisao automatica obrigatoria;
- o gestor deve revisar as recomendacoes antes de tomar decisoes comerciais;
- a plataforma pode suspender temporariamente relatorios de IA em caso de falha, custo, indisponibilidade ou risco operacional.

## Backups e restauracao

A plataforma mantem rotina de backup SQLite documentada em `docs/backup-sqlite.md`.

Politica inicial para piloto:

- backup local diario no VPS;
- pacote de copia externa preparado pelo comando `tools/export-sqlite-backup.sh`;
- manifesto com SHA-256 para verificar integridade;
- restauracao com copia de seguranca previa;
- backup externo definitivo a ser definido antes de escalar clientes pagantes.

O backup reduz risco de perda, mas nao garante recuperacao instantanea em todos os cenarios. O prazo de restauracao deve ser combinado no suporte.

## Suporte e acesso administrativo

A plataforma pode acessar dados do estabelecimento somente quando necessario para:

- implantacao;
- suporte solicitado;
- correcao de erro;
- auditoria de seguranca;
- manutencao tecnica;
- cumprimento de obrigacao legal ou contratual.

Sempre que possivel, o acesso administrativo deve ser limitado, rastreado e proporcional ao problema.

## Incidentes

Em caso de suspeita de incidente de seguranca:

- a plataforma deve conter o problema;
- preservar evidencias tecnicas;
- identificar estabelecimentos afetados;
- comunicar o cliente piloto quando houver impacto relevante;
- orientar troca de senhas, revogacao de tokens ou troca de certificado quando necessario;
- avaliar, com apoio juridico, comunicacao a titulares e ANPD quando cabivel.

O cliente piloto deve comunicar imediatamente qualquer suspeita de acesso indevido, vazamento, perda de credencial ou uso irregular.

## Direitos dos titulares

Quando houver pedido de titular de dados:

- se o dado for da conta da plataforma, a plataforma respondera como controladora;
- se o dado pertencer a operacao do estabelecimento, o cliente piloto devera orientar a resposta como controlador;
- a plataforma apoiara tecnicamente quando atuar como operadora;
- dados fiscais, contabeis, auditoria e defesa juridica podem ter retencao obrigatoria.

## Subprocessadores e terceiros

Durante o piloto, podem ser usados terceiros como:

- provedor de VPS/hospedagem;
- Mercado Pago ou outro provedor de pagamento;
- Google/Gemini para relatorios de IA;
- SEFAZ ou ambiente fiscal aplicavel;
- provedor de e-mail transacional futuro;
- destino externo de backup futuro.

A lista deve ser revisada antes de contrato comercial definitivo.

## Prazo do piloto

O piloto tera duracao inicial de [preencher] dias, podendo ser prorrogado por acordo entre as partes.

Ao final do piloto, as partes poderao:

- encerrar o uso;
- prorrogar testes;
- migrar para plano comercial;
- exportar dados essenciais do estabelecimento;
- manter dados pelo prazo necessario para auditoria, fiscal, suporte e obrigacoes legais.

## Limitacoes do piloto

O cliente reconhece que:

- o sistema esta em evolucao;
- funcionalidades podem mudar durante o piloto;
- algumas integracoes dependem de terceiros;
- recursos fiscais reais dependem de CNPJ, IE, certificado, credenciamento e configuracao correta;
- pagamentos reais dependem de conta recebedora, credenciais e politicas do provedor;
- falhas podem ocorrer e devem ser reportadas para correcao.

## Suspensao e encerramento

A plataforma podera suspender temporariamente o acesso em caso de:

- risco de seguranca;
- uso indevido;
- tentativa de acesso nao autorizado;
- fraude;
- descumprimento relevante destes termos;
- necessidade tecnica emergencial.

Em caso de encerramento, deve ser combinado prazo razoavel para exportacao de dados operacionais, observadas obrigacoes fiscais, auditoria e seguranca.

## Checklist de aceite para iniciar piloto

- [ ] Dados do estabelecimento conferidos.
- [ ] Gestor principal cadastrado.
- [ ] Usuarios e perfis revisados.
- [ ] Responsavel fiscal/contador identificado.
- [ ] Politica de senhas apresentada.
- [ ] Modulo fiscal configurado como desativado, simulado ou real.
- [ ] Certificado A1 enviado apenas se necessario.
- [ ] Conta de pagamento configurada apenas se autorizada.
- [ ] Backup diario habilitado.
- [ ] Canal de suporte definido.
- [ ] Canal de privacidade definido.
- [ ] Cliente ciente das limitacoes do piloto.

## Pendencias para revisao juridica

- Nome juridico definitivo das partes.
- Responsabilidade civil e limitacao de responsabilidade.
- SLA de suporte e disponibilidade.
- Preco, gratuidade ou desconto do piloto.
- Prazo de retencao por tipo de dado.
- Condicoes de encerramento e exportacao.
- Clausulas de tratamento de dados pessoais.
- Lista formal de subprocessadores.
- Politica de privacidade publica.
- Termos de uso comerciais.

## Referencias oficiais

- LGPD - Lei 13.709/2018: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Materiais educativos e publicacoes da ANPD: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes
- Guia da ANPD sobre agentes de tratamento e encarregado: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-para-definicoes-dos-agentes-de-tratamento-de-dados-pessoais-e-do-encarregado
- Regulamento da ANPD para agentes de tratamento de pequeno porte: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022
