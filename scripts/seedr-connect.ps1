param([switch]$Configure)
$ErrorActionPreference = 'Stop'
$taskSeedrNode = Get-Command node -ErrorAction Stop
$taskSeedrChecker = Join-Path $PSScriptRoot $(if ($Configure) { 'seedr-configure.mjs' } else { 'seedr-check.mjs' })
Write-Host 'Read-only Seedr check: one storage quota request; no file changes.'
Write-Host 'For a diagnostic, account.read is sufficient. Live setup requires account.read, files.read/write, tasks.read/write and media.read.'
if ($Configure) {
    Write-Host 'This configures ONE real account in full LinkBox V1 mode and saves its token in ignored apps/worker/.dev.vars.'
    Write-Host 'Only app-managed downloads are shared; cleanup after 3h and expiry after 24h can remove them. Keep the local config private.'
} else {
    Write-Host 'Your token will not be saved, printed, or passed on the command line.'
}
$taskSeedrSecret = Read-Host 'Paste your Seedr token (input hidden)' -AsSecureString
$taskSeedrPointer = [IntPtr]::Zero
try {
    $taskSeedrPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSeedrSecret)
    $taskSeedrPlaintext = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskSeedrPointer)
    $taskSeedrPlaintext | & $taskSeedrNode.Source $taskSeedrChecker
    $taskSeedrExitCode = $LASTEXITCODE
}
finally {
    if ($taskSeedrPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSeedrPointer)
    }
    $taskSeedrPlaintext = $null
    $taskSeedrSecret.Dispose()
}
exit $taskSeedrExitCode
