# Entrada protegida; JWT apenas em memória/ambiente deste processo e do filho Node.
$ErrorActionPreference = 'Stop'
$multiccSecure = $null
$multiccPtr = [IntPtr]::Zero
$multiccExit = 1
try {
    Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..'))
    $multiccSecure = Read-Host 'Cole o access_token da sessão Financial Hub e pressione Enter (entrada oculta)' -AsSecureString
    $multiccPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($multiccSecure)
    $env:MULTICC_GATEWAY_JWT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($multiccPtr).Trim()
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($multiccPtr)
    $multiccPtr = [IntPtr]::Zero
    Set-Clipboard -Value ''
    if ($env:MULTICC_GATEWAY_JWT -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
        throw 'Entrada não parece um JWT. Copie somente access_token, sem Bearer ou aspas.'
    }
    Write-Host 'Entrada recebida. Iniciando coleta somente leitura; o progresso aparecerá por produto.'
    & node (Join-Path $PSScriptRoot 'produtos-load.mjs')
    $multiccExit = $LASTEXITCODE
}
finally {
    Remove-Item Env:MULTICC_GATEWAY_JWT -ErrorAction SilentlyContinue
    if ($multiccPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($multiccPtr) }
    if ($null -ne $multiccSecure) { $multiccSecure.Dispose() }
    Set-Clipboard -Value ''
}
Write-Host "Coleta encerrada (código $multiccExit). JWT removido do ambiente; resultados salvos sem credenciais."
