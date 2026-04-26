# AL Chat 开发环境启动脚本 (PowerShell)

Write-Host "🚀 AL Chat 开发环境启动" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 检查 MongoDB
Write-Host "📊 检查 MongoDB..." -ForegroundColor Yellow
try {
    $null = mongosh --eval "db.version()" --quiet 2>&1
    Write-Host "✅ MongoDB 运行中" -ForegroundColor Green
} catch {
    Write-Host "❌ MongoDB 未运行" -ForegroundColor Red
    Write-Host "   请启动 MongoDB: net start MongoDB" -ForegroundColor Gray
    exit 1
}
Write-Host ""

# 检查后端配置
Write-Host "🔧 检查后端配置..." -ForegroundColor Yellow
if (-not (Test-Path "backend\.env")) {
    Write-Host "⚠️  backend\.env 不存在，从示例创建..." -ForegroundColor Yellow
    Copy-Item "backend\.env.example" "backend\.env"
    Write-Host "⚠️  请编辑 backend\.env 设置你的 OPENAI_API_KEY" -ForegroundColor Yellow
    Write-Host "   然后重新运行此脚本" -ForegroundColor Gray
    exit 1
}

# 检查 API Key
$envContent = Get-Content "backend\.env" -Raw
if ($envContent -match "your-api-key-here") {
    Write-Host "⚠️  请先在 backend\.env 中设置你的 OPENAI_API_KEY" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ 后端配置完成" -ForegroundColor Green
Write-Host ""

# 检查前端配置
Write-Host "🎨 检查前端配置..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Write-Host "⚠️  .env 不存在，从示例创建..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
}

Write-Host "✅ 前端配置完成" -ForegroundColor Green
Write-Host ""

# 检查依赖
Write-Host "📦 检查依赖..." -ForegroundColor Yellow

# 检查 Air
if (-not (Get-Command air -ErrorAction SilentlyContinue)) {
    Write-Host "   安装 Air (Go 热重载工具)..." -ForegroundColor Gray
    go install github.com/air-verse/air@latest
}

# Go 依赖
if (-not (Test-Path "backend\go.sum")) {
    Write-Host "   安装 Go 依赖..." -ForegroundColor Gray
    Push-Location backend
    go mod download
    Pop-Location
}

# Node 依赖
if (-not (Test-Path "node_modules")) {
    Write-Host "   安装 Node 依赖..." -ForegroundColor Gray
    npm install
}

Write-Host "✅ 依赖检查完成" -ForegroundColor Green
Write-Host ""

# 启动服务
Write-Host "🚀 启动服务..." -ForegroundColor Yellow
Write-Host ""

# 启动后端（使用 Air 实现热重载）
Write-Host "   启动后端服务 (Air)..." -ForegroundColor Gray
$backendDir = Join-Path $PSScriptRoot "backend"
$backendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    air -c .air.toml
} -ArgumentList $backendDir

# 等待后端启动
Start-Sleep -Seconds 3

# 检查后端是否启动成功
try {
    $response = Invoke-RestMethod -Uri "http://localhost:8080/health" -Method Get -TimeoutSec 5
    Write-Host "✅ 后端服务启动成功 (Job ID: $($backendJob.Id))" -ForegroundColor Green
} catch {
    Write-Host "❌ 后端服务启动失败" -ForegroundColor Red
    Stop-Job -Job $backendJob
    Remove-Job -Job $backendJob
    exit 1
}

Write-Host ""

# 启动前端
Write-Host "   启动前端服务..." -ForegroundColor Gray
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "✅ 开发环境已启动！" -ForegroundColor Green
Write-Host ""
Write-Host "📝 访问地址:" -ForegroundColor Cyan
Write-Host "   前端: http://localhost:5173/" -ForegroundColor Gray
Write-Host "   后端: http://localhost:8080/" -ForegroundColor Gray
Write-Host ""
Write-Host "🛑 停止服务: 按 Ctrl+C 然后运行以下命令" -ForegroundColor Yellow
Write-Host "   Stop-Job -Id $($backendJob.Id); Remove-Job -Id $($backendJob.Id)" -ForegroundColor Gray
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 启动前端（前台运行）
try {
    npm run dev
} finally {
    # 前端退出后，清理后端进程
    Write-Host ""
    Write-Host "🛑 停止后端服务..." -ForegroundColor Yellow
    Stop-Job -Job $backendJob
    Remove-Job -Job $backendJob
    Write-Host "✅ 已停止所有服务" -ForegroundColor Green
}
