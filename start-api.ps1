$scriptRoot = $PSScriptRoot

# Load secrets from .env
$envFile = Join-Path -Path $scriptRoot -ChildPath ".env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and $line -notmatch '^\s*#') {
            $idx = $line.IndexOf('=')
            if ($idx -gt 0) {
                $key = $line.Substring(0, $idx).Trim()
                $value = $line.Substring($idx + 1).Trim().Trim('"')
                Set-Item -Path "env:$key" -Value $value
            }
        }
    }
}

$env:NODE_ENV = 'development'
$env:THREAD_STREAM_WORKER_PATH = Join-Path -Path $scriptRoot -ChildPath "artifacts\api-server\dist\thread-stream-worker.mjs"

pnpm --filter @workspace/api-server run build; if ($?) { Set-Location -LiteralPath (Join-Path -Path $scriptRoot -ChildPath "artifacts\api-server"); node --enable-source-maps ./dist/index.mjs }
