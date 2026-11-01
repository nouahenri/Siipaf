# Enregistre la cle API Google AI Studio (Gemini, assistante Sita) dans server/.env.
# La cle est saisie masquee, n'est jamais affichee ni ecrite dans l'historique ; server/.env n'est pas versionne.
$envFile = Join-Path $PSScriptRoot '..\.env'
$secure = Read-Host 'Cle API Google AI Studio (collez-la puis Entree)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$key = "$key".Trim()
if (-not ($key.StartsWith('AIza') -or $key.StartsWith('AQ.'))) { Write-Host 'Cle refusee : une cle Google AI Studio commence par AQ. (nouveau format) ou AIza (ancien)' -ForegroundColor Red; exit 1 }
$lines = @()
if (Test-Path $envFile) { $lines = @([IO.File]::ReadAllLines($envFile) | Where-Object { $_ -notmatch '^GEMINI_API_KEY=' }) }
$lines += "GEMINI_API_KEY=$key"
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))
Write-Host ('Cle enregistree dans server/.env (se termine par ...' + $key.Substring($key.Length - 4) + ').') -ForegroundColor Green
