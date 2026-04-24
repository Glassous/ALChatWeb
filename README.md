# AL Chat Web

一个现代化的 AI 聊天应用，支持实时流式对话和对话历史管理。

## ✨ 功能特性

- 💬 实时 AI 对话（流式输出）
- 📝 对话历史管理
- 🏷️ 自动生成对话标题
- 🎨 Material Design 3 UI
- 🌓 深色/浅色主题切换
- 💾 MongoDB 数据持久化
- 🔌 OpenAI API 兼容

## 🛠️ 技术栈

### 前端
- React 19
- TypeScript
- Vite
- Material Web Components

### 后端
- Go 1.21+
- Gin Web Framework
- MongoDB
- Firebase Genkit

## 🚀 快速开始

### 方式一：使用启动脚本（推荐）

**Linux/macOS:**
```bash
bash start-dev.sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File start-dev.ps1
```

脚本会自动：
- ✅ 检查 MongoDB 是否运行
- ✅ 创建配置文件
- ✅ 安装依赖
- ✅ 启动后端和前端服务

### 方式二：手动启动

详细的本地开发设置指南请查看 [SETUP.md](./SETUP.md) 或 [QUICKSTART.md](./QUICKSTART.md)

**简要步骤：**

1. **安装依赖**
   - Node.js 18+
   - Go 1.21+
   - MongoDB 5.0+

2. **配置后端**
   ```bash
   cd backend
   cp .env.example .env
   # 编辑 .env 配置 API 密钥
   go mod tidy
   go run cmd/server/main.go
   ```

3. **配置前端**
   ```bash
   npm install
   cp .env.example .env
   npm run dev
   ```

4. **访问应用**
   打开浏览器访问 http://localhost:5173/

## 🏗️ 项目结构

```
alchat/
├── backend/              # Go 后端服务
│   ├── cmd/             # 应用入口
│   ├── internal/        # 内部包
│   │   ├── config/     # 配置管理
│   │   ├── database/   # 数据库连接
│   │   ├── handlers/   # HTTP 处理器
│   │   ├── middleware/ # 中间件
│   │   ├── models/     # 数据模型
│   │   └── services/   # 业务逻辑
│   └── README.md
│
├── src/                 # React 前端
│   ├── components/     # UI 组件
│   │   ├── ChatArea/  # 聊天区域
│   │   ├── InputArea/ # 输入区域
│   │   ├── Sidebar/   # 侧边栏
│   │   └── TopBar/    # 顶部栏
│   ├── services/       # API 客户端
│   └── App.tsx         # 主应用
│
├── public/             # 静态资源
├── .env.example        # 环境变量示例
├── package.json
├── README.md           # 本文件
└── SETUP.md           # 设置指南
```

## 🔧 配置说明

### 后端环境变量 (`backend/.env`)

```env
PORT=8080                                    # 服务器端口
MONGODB_URI=mongodb://localhost:27017       # MongoDB 连接
MONGODB_DATABASE=alchat                      # 数据库名称
OPENAI_API_KEY=your-api-key                 # OpenAI API 密钥
OPENAI_BASE_URL=https://api.openai.com/v1  # API 基础 URL
OPENAI_MODEL=gpt-3.5-turbo                  # 使用的模型
```

### 前端环境变量 (`.env`)

```env
VITE_API_BASE_URL=http://localhost:8080     # 后端 API 地址
```

## 📡 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/conversations` | 获取所有对话 |
| POST | `/api/conversations` | 创建新对话 |
| GET | `/api/conversations/:id` | 获取指定对话 |
| DELETE | `/api/conversations/:id` | 删除对话 |
| POST | `/api/chat` | 发送消息（SSE 流式） |

## 🎨 主题

应用支持三种主题模式：
- 🌞 浅色模式
- 🌙 深色模式
- 🔄 自动模式（跟随系统）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 🙏 致谢

- [Material Web Components](https://github.com/material-components/material-web)
- [Firebase Genkit](https://github.com/firebase/genkit)
- [Gin Web Framework](https://github.com/gin-gonic/gin)
- [MongoDB Go Driver](https://github.com/mongodb/mongo-go-driver)
