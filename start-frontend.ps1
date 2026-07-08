$scriptRoot = $PSScriptRoot

# Load secrets from .env (first match wins for duplicates)
$envFile = Join-Path -Path $scriptRoot -ChildPath ".env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and $line -notmatch '^\s*#') {
            $idx = $line.IndexOf('=')
            if ($idx -gt 0) {
                $key = $line.Substring(0, $idx).Trim()
                $value = $line.Substring($idx + 1).Trim().Trim('"')
                if (-not (Test-Path "env:$key")) {
                    Set-Item -Path "env:$key" -Value $value
                }
            }
        }
    }
}

# Set defaults (always override BASE_PATH, Git Bash sets this to C:/Program Files/Git/)
if (-not (Test-Path "env:PORT")) {
    if (Test-Path "env:FRONTEND_PORT") {
        $env:PORT = $env:FRONTEND_PORT
    } else {
        $env:PORT = '18784'
    }
}
$env:BASE_PATH = '/'

corepack pnpm --filter @workspace/video-archive run dev
