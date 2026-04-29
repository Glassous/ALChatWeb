#!/bin/bash

# AL Chat 开发环境启动脚本

echo "🚀 AL Chat 开发环境启动"
echo "================================"
echo ""

# 检查 MongoDB
echo "📊 检查 MongoDB..."
if ! command -v mongosh &> /dev/null; then
    echo "❌ MongoDB 未安装或未在 PATH 中"
    echo "   请先安装 MongoDB: https://www.mongodb.com/try/download/community"
    exit 1
fi

# 尝试连接 MongoDB
if ! mongosh --eval "db.version()" --quiet &> /dev/null; then
    echo "⚠️  MongoDB 未运行，尝试启动..."
    
    # 根据操作系统启动 MongoDB
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        brew services start mongodb-community
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        sudo systemctl start mongodb
    else
        echo "❌ 无法自动启动 MongoDB，请手动启动"
        exit 1
    fi
    
    # 等待 MongoDB 启动
    sleep 3
fi

# 检查 Redis
echo "📊 检查 Redis..."
if ! command -v redis-cli &> /dev/null; then
    echo "⚠️  Redis 未安装或未在 PATH 中"
else
    if ! redis-cli ping &> /dev/null; then
        echo "⚠️  Redis 未运行，请确保 Redis 已启动"
    else
        echo "✅ Redis 运行中"
    fi
fi
echo ""

# 检查后端配置
echo "🔧 检查后端配置..."
if [ ! -f "backend/.env" ]; then
    echo "⚠️  backend/.env 不存在，从示例创建..."
    cp backend/.env.example backend/.env
    echo "⚠️  请编辑 backend/.env 设置你的 OPENAI_API_KEY"
    echo "   然后重新运行此脚本"
    exit 1
fi

# 检查 API Key
if grep -q "your-api-key-here" backend/.env; then
    echo "⚠️  请先在 backend/.env 中设置你的 OPENAI_API_KEY"
    exit 1
fi

echo "✅ 后端配置完成"
echo ""

# 检查前端配置
echo "🎨 检查前端配置..."
if [ ! -f ".env" ]; then
    echo "⚠️  .env 不存在，从示例创建..."
    cp .env.example .env
fi

echo "✅ 前端配置完成"
echo ""

# 检查依赖
echo "📦 检查依赖..."

# 检查 Air
if ! command -v air &> /dev/null; then
    echo "   安装 Air (Go 热重载工具)..."
    go install github.com/air-verse/air@latest
fi

# Go 依赖
if [ ! -d "backend/vendor" ] && [ ! -f "backend/go.sum" ]; then
    echo "   安装 Go 依赖..."
    cd backend
    go mod download
    cd ..
fi

# Node 依赖
if [ ! -d "node_modules" ]; then
    echo "   安装 Node 依赖..."
    npm install
fi

echo "✅ 依赖检查完成"
echo ""

# 启动服务
echo "🚀 启动服务..."
echo ""

# 启动后端（使用 Air 实现热重载）
echo "   启动后端服务 (Air)..."
cd backend
air -c .air.toml > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# 等待后端启动
sleep 3

# 检查后端是否启动成功
if curl -s http://localhost:8080/health > /dev/null; then
    echo "✅ 后端服务启动成功 (PID: $BACKEND_PID)"
else
    echo "❌ 后端服务启动失败，查看 backend.log 获取详情"
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

echo ""

# 启动前端
echo "   启动前端服务..."
echo ""
echo "================================"
echo "✅ 开发环境已启动！"
echo ""
echo "📝 访问地址:"
echo "   前端: http://localhost:5173/"
echo "   后端: http://localhost:8080/"
echo ""
echo "📊 后端日志: backend.log"
echo "🛑 停止后端: kill $BACKEND_PID"
echo ""
echo "================================"
echo ""

# 启动前端（前台运行）
npm run dev

# 前端退出后，清理后端进程
echo ""
echo "🛑 停止后端服务..."
kill $BACKEND_PID 2>/dev/null
echo "✅ 已停止所有服务"
