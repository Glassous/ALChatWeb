# AL Chat Web

一个基于 React 19 和 Go (Gin) 构建的现代化 AI 聊天应用，旨在提供流畅、智能且美观的对话体验。支持多种 AI 模型、实时流式输出、图片生成及完整的对话管理。

---

## ✨ 核心特性

- 💬 **实时流式对话**：基于 SSE (Server-Sent Events) 的毫秒级响应，体验丝滑。
- 🖼️ **图片生成**：集成火山引擎 (Volcengine) API，支持根据描述生成高质量图片。
- 🏷️ **智能标题生成**：自动根据对话内容总结并生成对话标题，方便历史回顾。
- 🔐 **完整认证体系**：支持用户注册、登录、找回密码及个人信息/头像管理。
- 🎨 **Material Design 3**：采用最新的 Material Web Components，提供现代化的 UI/UX 体验。
- 🌓 **智能主题**：支持浅色、深色及跟随系统的自动模式。
- 🚀 **多模型支持**：后端灵活支持 OpenAI 兼容接口，可配置多种专用模型（对话、搜索、多模态等）。
- 💾 **数据持久化**：使用 MongoDB 存储对话历史，Redis 负责频率限制。

---

## 🛠️ 技术栈

### 前端
- **框架**: [React 19](https://react.dev/)
- **构建工具**: [Vite](https://vitejs.dev/)
- **组件库**: [Material Web Components](https://github.com/material-components/material-web)
- **样式**: CSS Modules + Material Theme
- **语言**: [TypeScript](https://www.typescriptlang.org/)

### 后端
- **语言**: [Go 1.21+](https://go.dev/)
- **Web 框架**: [Gin](https://gin-gonic.com/)
- **数据库**: [MongoDB](https://www.mongodb.com/) (持久化) & [Redis](https://redis.io/) (限流)
- **AI 框架**: [Firebase Genkit](https://github.com/firebase/genkit)
- **云服务**: 阿里云 OSS (头像/图片存储)

---

## 🏗️ 项目结构

```text
alchat/
├── backend/              # Go 后端服务
│   ├── cmd/             # 应用入口 (main.go)
│   ├── internal/        # 核心业务逻辑
│   │   ├── config/     # 配置管理 (Env/YAML)
│   │   ├── database/   # 数据库驱动 (MongoDB, Redis)
│   │   ├── handlers/   # HTTP 控制器 (Auth, Chat, Conv)
│   │   ├── middleware/ # 中间件 (CORS, Auth, RateLimit)
│   │   ├── models/     # 数据模型定义
│   │   └── services/   # 业务服务 (AI, OSS, Image)
│   └── .air.toml        # 热重载配置
│
├── src/                 # React 前端
│   ├── components/     # 可复用 UI 组件
│   │   ├── ChatArea/   # 消息展示区
│   │   ├── InputArea/  # 输入交互区
│   │   └── ...
│   ├── pages/          # 路由页面 (Login, Register, Welcome)
│   ├── services/       # API 客户端封装
│   └── App.tsx         # 应用入口
│
├── public/             # 静态资源
├── package.json        # 前端依赖与脚本
└── README.md           # 本说明文件
```

---

## 🚀 快速开始

### 环境准备
- Node.js 18+
- Go 1.21+
- MongoDB 5.0+
- Redis (可选，用于限流)

### 1. 克隆与配置

```bash
git clone <repository-url>
cd alchatweb
```

**后端配置:**
```bash
cd backend
cp .env.example .env
# 编辑 .env 文件，填入你的 OpenAI API Key 和数据库地址
```

**前端配置:**
```bash
cd ..
cp .env.example .env
# 编辑 .env 文件，配置 VITE_API_BASE_URL
```

### 2. 启动服务

**使用脚本（推荐）:**
- **Windows:** `powershell -ExecutionPolicy Bypass -File start-dev.ps1`
- **Linux/macOS:** `bash start-dev.sh`

**手动启动:**
- **后端:** `cd backend && go run cmd/server/main.go`
- **前端:** `npm install && npm run dev`

---

## 📡 主要 API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/login` | 用户登录 | 否 |
| GET | `/api/conversations` | 获取所有对话列表 | 是 |
| POST | `/api/chat` | 发送聊天消息 (SSE) | 是 |
| POST | `/api/chat/image` | 生成 AI 图片 | 是 |
| PUT | `/api/auth/profile` | 更新用户资料 | 是 |

---

## 📄 许可协议

本项目采用 [Apache License 2.0](LICENSE) 许可协议。

Copyright 2026 AL Chat Web Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
