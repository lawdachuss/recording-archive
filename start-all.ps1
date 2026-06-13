Write-Host "=== Starting all services ===" -ForegroundColor Cyan

Write-Host "[1/4] Typechecking..." -ForegroundColor Yellow
pnpm run typecheck; if (-not $?) { Write-Host "Typecheck failed!" -ForegroundColor Red; exit 1 }

Write-Host "[2/4] Building API server..." -ForegroundColor Yellow
pnpm --filter @workspace/api-server run build; if (-not $?) { Write-Host "API build failed!" -ForegroundColor Red; exit 1 }

Write-Host "[3/4] Starting API server on port 8080..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSScriptRoot\start-api.ps1'" -WindowStyle Normal

Write-Host "[4/4] Starting frontend dev server on port 18784..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSScriptRoot\start-frontend.ps1'" -WindowStyle Normal

Write-Host "=== All services started ===" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:18784" -ForegroundColor Green
Write-Host "  API:      http://localhost:8080" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C in each window to stop services." -ForegroundColor Gray
