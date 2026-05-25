# Certificado A1 fake

Este diretorio contem ferramentas para gerar um certificado A1 fake de teste.

O arquivo gerado em `backend/certs/fake-a1.pfx` tem formato tecnico PKCS#12/PFX com chave privada RSA e certificado X.509 autoassinado. Ele serve para testar leitura de certificado e assinatura XML no sistema.

Ele nao possui validade fiscal, cadeia ICP-Brasil, credenciamento ou qualquer uso real na SEFAZ.

## Windows

```powershell
powershell -ExecutionPolicy Bypass -File tools/certs/create-fake-a1.ps1
```

Saida esperada:

```txt
backend/certs/fake-a1.pfx
backend/certs/fake-a1.cer
backend/certs/fake-a1-info.json
```

Senha padrao:

```txt
fake-a1-123456
```

Os arquivos em `backend/certs/` ficam fora do Git.
