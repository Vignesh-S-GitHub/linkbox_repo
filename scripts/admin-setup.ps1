param([switch]$Production)
$ErrorActionPreference = 'Stop'
$taskAdminNode = Get-Command node -ErrorAction Stop
$taskAdminScript = Join-Path $PSScriptRoot 'admin-setup.mjs'
Write-Host 'Configure private owner access. No Seedr files or tokens are changed.'
Write-Host 'Use a unique random 32-128 character key (letters, numbers, . _ ~ -). Save it in your password manager.'
Write-Host 'Input is hidden. The raw key is never saved or passed on the command line.'
$taskAdminSecret = Read-Host 'Admin access key (input hidden)' -AsSecureString
$taskAdminPointer = [IntPtr]::Zero
try {
    $taskAdminPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskAdminSecret)
    $taskAdminPlaintext = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskAdminPointer)
    if ($Production) { $taskAdminPlaintext | & $taskAdminNode.Source $taskAdminScript --production }
    else { $taskAdminPlaintext | & $taskAdminNode.Source $taskAdminScript }
    $taskAdminExitCode = $LASTEXITCODE
} finally {
    if ($taskAdminPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskAdminPointer) }
    $taskAdminPlaintext = $null
    $taskAdminSecret.Dispose()
}
exit $taskAdminExitCode
