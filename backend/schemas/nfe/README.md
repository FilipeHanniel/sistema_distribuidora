# Schemas oficiais NF-e/NFC-e

Esta pasta e reservada para os schemas oficiais XSD da NF-e/NFC-e.

Por seguranca operacional, o repositorio nao inclui automaticamente um pacote
de schemas baixado de terceiros. Em producao, baixe o pacote oficial no Portal
Nacional da NF-e ou no Portal DF-e/SVRS e copie os arquivos para esta pasta.

Configuracao sugerida no `.env`:

```env
NFCE_XSD_PATH=backend/schemas/nfe/nfeProc_v4.00.xsd
FISCAL_XSD_STRICT=true
```

No Windows, a validacao XSD usa PowerShell/.NET. No Debian/VPS, instale
`xmllint` se quiser validar contra XSD no servidor:

```bash
sudo apt install libxml2-utils
```

Sem `NFCE_XSD_PATH`, o sistema executa a validacao estrutural propria e segue
registrando rejeicoes tecnicas internas quando o XML estiver inconsistente.
