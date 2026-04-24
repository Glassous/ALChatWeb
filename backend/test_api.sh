#!/bin/bash

# AL Chat Backend API 测试脚本

BASE_URL="http://localhost:8080"

echo "🧪 AL Chat Backend API 测试"
echo "================================"
echo ""

# 1. 健康检查
echo "1️⃣  测试健康检查..."
response=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo "✅ 健康检查通过: $body"
else
    echo "❌ 健康检查失败 (HTTP $http_code)"
    exit 1
fi
echo ""

# 2. 创建对话
echo "2️⃣  创建新对话..."
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/conversations" \
    -H "Content-Type: application/json" \
    -d '{"title":"测试对话"}')
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "201" ]; then
    echo "✅ 对话创建成功"
    conversation_id=$(echo "$body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    echo "   对话ID: $conversation_id"
else
    echo "❌ 对话创建失败 (HTTP $http_code)"
    echo "   响应: $body"
    exit 1
fi
echo ""

# 3. 获取对话列表
echo "3️⃣  获取对话列表..."
response=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/conversations")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo "✅ 对话列表获取成功"
    echo "   响应: $body"
else
    echo "❌ 对话列表获取失败 (HTTP $http_code)"
    exit 1
fi
echo ""

# 4. 获取指定对话
echo "4️⃣  获取指定对话..."
response=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/conversations/$conversation_id")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo "✅ 对话详情获取成功"
    echo "   响应: $body"
else
    echo "❌ 对话详情获取失败 (HTTP $http_code)"
    exit 1
fi
echo ""

# 5. 测试聊天（需要有效的 API Key）
echo "5️⃣  测试聊天功能（流式输出）..."
echo "   发送消息: 'Hello, how are you?'"
echo "   响应:"
curl -s -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"conversation_id\":\"$conversation_id\",\"message\":\"Hello, how are you?\"}" \
    | while IFS= read -r line; do
        if [[ $line == data:* ]]; then
            echo "   $line"
        fi
    done
echo ""
echo "✅ 聊天测试完成"
echo ""

# 6. 删除对话
echo "6️⃣  删除对话..."
response=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/conversations/$conversation_id")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo "✅ 对话删除成功"
else
    echo "❌ 对话删除失败 (HTTP $http_code)"
    exit 1
fi
echo ""

echo "================================"
echo "🎉 所有测试通过！"
