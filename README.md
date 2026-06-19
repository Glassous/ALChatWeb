# AL Chat Web

一個基于 **React 19** 和 **Go (Gin)** 构建的现代化、高性能 AI 智能对话平台，旨在为用户提供美观、流畅且功能强大的 AI 交互体验。

本项目采用 **MySQL + MongoDB + Redis 混合数据架构**，实现业务数据与会话记录解耦，确保生产环境下的数据持久化、高吞吐以及高扩展性。

---

## ✨ 核心特性

- 💬 **实时流式对话**：基于 **SSE (Server-Sent Events)** 的毫秒级响应，打字机输出丝滑流畅。
- 🔍 **智能联网搜索**：在 Daily 模式下内置智能路由，可自动判断并调用 Bocha AI 联网搜索并进行回答整理。
- 🖼️ **多模态与图像生成**：全面支持 OpenAI 兼容接口，可灵活对接各类画图与多模态大模型。
- 🔐 **完备的主体业务系统**：
  - **用户认证**：支持验证码注册/登录、JWT Token 校验（结合 Redis 白/黑名单实现安全登出）。
  - **会员与积分**：包含 Free/Pro/Max 会员等级划分、每日积分重置、根据输入/输出 Token 精确扣除积分。
  - **内容运营**：公告（Announcements）发布、系统提示词（System Prompt）自定义、用户反馈（Feedbacks）收集与邮件回复。
- 🎨 **Material Design 3 极简美学**：前端完全采用最新的 Material Web Components 与现代 Vanilla CSS，支持流畅的动效、跟随系统的深浅色模式切换。
- 📦 **Docker-Compose 一键部署**：完整支持容器化编排，所有数据库服务及宿主机端口映射支持环境变量参数化安全配置。

---

## 🛠️ 技术栈

### 前端
- **核心框架**: [React 19](https://react.dev/)
- **构建工具**: [Vite](https://vitejs.dev/)
- **UI 组件库**: [Material Web Components (MWC)](https://github.com/material-components/material-web)
- **语言**: [TypeScript](https://www.typescriptlang.org/)
- **样式**: Vanilla CSS + Material Theme Token

### 后端
- **开发语言**: [Go 1.21+](https://go.dev/)
- **Web 框架**: [Gin](https://gin-gonic.com/)
- **ORM 框架**: [GORM](https://gorm.io/) (连接 MySQL)
- **双数据库引擎**: 
  - **MySQL (v9.0+)**：存储结构化业务数据（用户、配置、公告、反馈等）。
  - **MongoDB**：存储海量非结构化会话（Conversations, Messages, Shared Conversations 等）。
  - **Redis (Alpine)**：负责邮箱验证码存储、Token 黑名单、接口请求限流。
- **对象存储**: 腾讯云 COS (用户头像、历史参考图片)
- **邮件服务**: SMTP (QQ 邮箱发信)

---

## 🏗️ 项目结构

```text
alchatweb/
├── backend/                  # Go 后端服务
│   ├── cmd/
│   │   ├── server/          # 主服务启动入口 (main.go)
│   │   └── migrate/         # 一键数据迁移与 Schema 初始化工具 (main.go)
│   ├── internal/
│   │   ├── agent/           # 智能 Agent 路由与执行链
│   │   ├── config/          # 基于配置文件的环境变量加载
│   │   ├── database/        # 数据库初始化 (MongoDB, MySQL, Redis)
│   │   ├── handlers/        # API 控制器 (Auth, Chat, Admin, ALing 等)
│   │   ├── middleware/      # 安全与频控中间件 (CORS, JWT, RateLimit)
│   │   ├── models/          # 统一数据结构定义与 GORM/BSON 序列化器
│   │   └── services/        # 三方服务封装 (AIService, COSService, Email 等)
│   ├── Dockerfile.dev       # 容器化热重载开发环境配置
│   └── .air.toml            # Go 语言 Air 热重载配置文件
│
├── src/                      # React 前端源文件
│   ├── components/          # 可复用组件 (ChatArea, Sidebar, UserSettings 等)
│   ├── services/            # API 请求客户端 (api.ts)
│   ├── App.tsx              # 前端主入口
│   └── main.tsx
│
├── docker-compose.yml        # Docker 容器服务编排文件
├── start-dev.ps1             # Windows 本地开发一键启动脚本
├── start-dev.sh              # Linux/macOS 本地开发一键启动脚本
└── README.md                 # 说明文档
```

---

## 🚀 快速开始

### 方式 A：Docker 一键本地开发（推荐）

1.  **复制配置文件**
    在项目根目录和 `/backend` 目录下分别复制环境配置文件：
    ```bash
    # 根目录下
    cp .env.example .env
    # backend 目录下
    cp backend/.env.example backend/.env
    ```
2.  **配置密钥**
    编辑 `backend/.env`，写入您的大模型 Key、邮箱 SMTP 密钥及腾讯云 COS 密钥。
3.  **运行启动脚本**
    - **Windows**: 双击或在 PowerShell 中运行 `powershell -ExecutionPolicy Bypass -File start-dev.ps1`
    - **Linux/macOS**: 运行 `bash start-dev.sh`
    该脚本会自动启动所有的数据库容器，并在本地热构建前端和后端。

---

### 方式 B：手动生产部署与数据迁移

若您需要将历史纯 MongoDB 数据库的数据导入到当前架构，请遵循以下迁移流程：

#### 1. 启动容器服务
在您的云服务器或本地运行：
```bash
docker compose up -d mysql mongodb redis
```
*(这会自动拉起 MySQL 9.x、MongoDB 及 Redis 服务。物理解析的端口和数据库密码会从根目录下的 `.env` 中安全读取)*

#### 2. 一键运行数据迁移与建表脚本
在后端目录下执行以下命令，脚本会自动在 MySQL 中建立最新的表结构，并将 MongoDB 中历史的 `users` 和 `configs` 存量数据**零损耗**转移至 MySQL 中：
```bash
# 本地宿主机运行：
cd backend && go run cmd/migrate/main.go

# 或者是直接在 Docker 后端容器内部运行：
docker compose exec backend go run cmd/migrate/main.go
```

#### 3. 重启并载入最新后端代码
```bash
docker compose stop backend
```
```bash
docker compose up -d --build backend
```

#### 4. 安全清理 MongoDB 中的旧冗余集合
验证系统功能无误后，运行以下命令清除 MongoDB 中的历史旧集合以释放空间：
```bash
docker compose exec mongodb mongosh alchat --eval "db.users.drop(); db.configs.drop(); db.announcements.drop(); db.feedbacks.drop();"
```

---

## 📡 核心 API 概览

| 请求方法 | API 路径 | 描述 | 需要 Token 认证 |
| :--- | :--- | :--- | :---: |
| **POST** | `/api/auth/register` | 用户发送验证码注册 | 否 |
| **POST** | `/api/auth/login` | 用户凭账号密码登录 | 否 |
| **GET** | `/api/auth/profile` | 获取当前登录用户的 Profile 详情 | **是** |
| **PUT** | `/api/auth/system-prompt`| 更新个性化系统提示词设置 | **是** |
| **GET** | `/api/conversations` | 获取用户的所有会话列表 | **是** |
| **POST** | `/api/chat` | 发送流式对话消息（SSE 服务端事件推送）| **是** |
| **POST** | `/api/chat/image` | 触发画图任务并在后台生成图片 | **是** |
| **POST** | `/api/aling/translator/translate` | ALing 流式对照翻译 | **是** |

---

## 📄 许可协议

本项目采用 [Apache License 2.0](LICENSE) 许可协议开源。

Copyright 2026 AL Chat Web Contributors.
Licensed under the Apache License, Version 2.0.
