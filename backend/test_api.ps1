# AL Chat Backend API 测试脚本 (PowerShell)

$BASE_URL = "http://localhost:9080"

Write-Host "🧪 AL Chat Backend API 测试" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 1. 健康检查
Write-Host "1️⃣  测试健康检查..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/health" -Method Get
    Write-Host "✅ 健康检查通过: $($response | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "❌ 健康检查失败: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 2. 创建对话
Write-Host "2️⃣  创建新对话..." -ForegroundColor Yellow
try {
    $body = @{
        title = "测试对话"
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/conversations" -Method Post -Body $body -ContentType "application/json"
    $conversationId = $response.id
    Write-Host "✅ 对话创建成功" -ForegroundColor Green
    Write-Host "   对话ID: $conversationId" -ForegroundColor Gray
} catch {
    Write-Host "❌ 对话创建失败: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 3. 获取对话列表
Write-Host "3️⃣  获取对话列表..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/conversations" -Method Get
    Write-Host "✅ 对话列表获取成功" -ForegroundColor Green
    Write-Host "   对话数量: $($response.Count)" -ForegroundColor Gray
} catch {
    Write-Host "❌ 对话列表获取失败: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 4. 获取指定对话
Write-Host "4️⃣  获取指定对话..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/conversations/$conversationId" -Method Get
    Write-Host "✅ 对话详情获取成功" -ForegroundColor Green
    Write-Host "   标题: $($response.title)" -ForegroundColor Gray
} catch {
    Write-Host "❌ 对话详情获取失败: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 5. 测试聊天（需要有效的 API Key）
Write-Host "5️⃣  测试聊天功能..." -ForegroundColor Yellow
Write-Host "   发送消息: 'Hello, how are you?'" -ForegroundColor Gray
try {
    $body = @{
        conversation_id = $conversationId
        message = "Hello, how are you?"
    } | ConvertTo-Json
    
    # 注意: PowerShell 的 Invoke-RestMethod 不直接支持 SSE 流式响应
    # 这里只是发送请求，实际流式输出需要在浏览器或前端测试
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/chat" -Method Post -Body $body -ContentType "application/json"
    Write-Host "✅ 聊天请求发送成功 (流式输出请在前端测试)" -ForegroundColor Green
} catch {
    Write-Host "⚠️  聊天测试: $_" -ForegroundColor Yellow
    Write-Host "   (如果是 API Key 问题，请检查 .env 配置)" -ForegroundColor Gray
}
Write-Host ""

# 6. 删除对话
Write-Host "6️⃣  删除对话..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/conversations/$conversationId" -Method Delete
    Write-Host "✅ 对话删除成功" -ForegroundColor Green
} catch {
    Write-Host "❌ 对话删除失败: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "================================" -ForegroundColor Cyan
Write-Host "🎉 基础测试通过！" -ForegroundColor Green
Write-Host ""
Write-Host "💡 提示: 完整的流式聊天功能请在前端浏览器中测试" -ForegroundColor Cyan
