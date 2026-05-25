param(
  [string]$OutputDir = "backend/certs",
  [string]$Password = "fake-a1-123456",
  [string]$SubjectName = "CN=Distribuidora Fake A1, O=Sistema Distribuidora Testes, C=BR",
  [string]$Cnpj = "01001001000101"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$targetDir = Join-Path $root $OutputDir
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$cert = New-SelfSignedCertificate `
  -Subject $SubjectName `
  -Type Custom `
  -KeySpec Signature `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(2) `
  -TextExtension @(
    "2.5.29.37={text}1.3.6.1.5.5.7.3.2"
  )

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
$pfxPath = Join-Path $targetDir "fake-a1.pfx"
$cerPath = Join-Path $targetDir "fake-a1.cer"
$infoPath = Join-Path $targetDir "fake-a1-info.json"

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

$info = [ordered]@{
  warning = "Certificado A1 fake para testes. Nao possui validade fiscal, ICP-Brasil ou uso em SEFAZ real."
  pfxPath = $pfxPath
  cerPath = $cerPath
  password = $Password
  subject = $cert.Subject
  thumbprint = $cert.Thumbprint
  notBefore = $cert.NotBefore.ToString("o")
  notAfter = $cert.NotAfter.ToString("o")
  cnpj = $Cnpj
  keyAlgorithm = "RSA"
  keyLength = 2048
  hashAlgorithm = "SHA256"
}

$info | ConvertTo-Json -Depth 4 | Set-Content -Path $infoPath -Encoding UTF8

Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force

Write-Host "A1 fake gerado com sucesso:"
Write-Host "PFX: $pfxPath"
Write-Host "CER: $cerPath"
Write-Host "Senha: $Password"
Write-Host "Info: $infoPath"
