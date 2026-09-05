# AL Chat Web

AL Chat Web 是一个基于 **React 19** 和 **Go (Gin)** 构建的现代化、高性能、功能丰富的 AI 智能对话平台，专为 Web 端进行了深度优化与交互设计。

本项目采用 **MySQL + MongoDB + Redis 混合数据架构**，支持多分支对话历史管理、实时代码运行沙箱 (Workspace) 等特性，为用户提供兼具美学与实用性的 AI 交互体验。


---

## ✨ 核心特性

- 💬 **流式对话与思维链**：基于 **SSE (Server-Sent Events)** 实现毫秒级打字机流式输出。支持展示大模型的 Reasoning 思考过程（思维链），让生成逻辑更透明。
- 🌳 **分支对话历史树 (Conversation Branching)**：
  - 用户可随时对已发送的任意历史消息进行二次编辑，系统将自动分裂出新的对话分支。
  - 前端通过优雅的可视化节点与连接线拓扑图（基于 `react-xarrows`），支持在不同的历史分支间无缝切换、编辑和管理。
- 🖥️ **代码运行沙箱工作区 (Workspace)**：
  - 智能识别 AI 生成的代码块（支持 HTML, CSS, SVG 等）。
  - 右侧提供独立的预览沙箱，支持实时渲染运行、源码编辑与动态交互，为开发者提供类似 Claude Artifacts 的沉浸式调试环境。
- 🖼️ **多模态与图像生成**：
  - **画图任务**：集成火山引擎 (Volcengine) 图像生成大模型接口，支持后台异步画图并在会话中渲染呈现。
  - **多模态对话**：支持直接上传并解析图片，实现与多模态模型的看图对话。
- 🔐 **完备的主体业务系统**：
  - **安全认证**：邮箱验证码注册/重置密码，JWT 双 Token 校验，配合 Redis 缓存实现安全的登录与登出白/黑名单机制。
  - **会员与积分扣减**：支持 Free/Pro/Max 会员等级。按输入/输出 Token 扣除积分，支持每日定时重置积分。
  - **运营管理**：内置系统公告管理、全局提示词自定义、用户意见反馈及邮件自动回复等。
- 🎨 **Material Design 3 极简美学**：
  - 前端完全使用最新的 Material Web Components (MWC) 与现代 Vanilla CSS 构建。
  - 支持平滑的微交互、骨架屏加载、以及跟随系统的深浅色主题无缝切换。

---

## 🛠️ 技术栈

### 前端 (Frontend)
- **核心框架**: [React 19](https://react.dev/)
- **构建工具**: [Vite](https://vitejs.dev/)
- **UI 组件库**: [Material Web Components (MWC)](https://github.com/material-components/material-web)
- **动画库**: [Framer Motion](https://www.framer.com/motion/)
- **网络图拓扑**: [React Xarrows](https://github.com/elrumordelaluz/react-xarrows)
- **样式**: Vanilla CSS + CSS Variables (Material Theme Tokens)

### 业务后端 (Go Backend)
- **开发语言**: [Go 1.21+](https://go.dev/)
- **Web 框架**: [Gin](https://gin-gonic.com/)
- **ORM 框架**: [GORM](https://gorm.io/) (连接 MySQL)
- **双数据库引擎**: 
  - **MySQL (v9.0+)**：存储用户、配置、公告、积分流水、反馈等结构化核心业务数据。
  - **MongoDB**：作为高吞吐的会话存储引擎，持久化海量非结构化的会话（Conversations, Messages, Shared Conversations）。
  - **Redis (Alpine)**：负责邮箱验证码、Token 登出黑名单、接口请求限流（Rate Limit）缓存。
- **第三方集成**: 
  - 腾讯云 COS (用户头像、历史参考图片等静态资源存储)
  - SMTP 邮件服务 (QQ 邮箱/Outlook 自动发信)

---

## 🏗️ 项目结构

```text
alchatweb/
├── backend/                  # Go 后端服务
│   ├── cmd/
│   │   ├── server/          # 业务主服务启动入口 (main.go)
│   │   └── migrate/         # 一键数据迁移与 Schema 自动初始化工具
│   ├── internal/
│   │   ├── config/          # 基于 GoDotEnv 的环境变量加载
│   │   ├── database/        # 数据库连接初始化 (MongoDB, MySQL, Redis)
│   │   ├── handlers/        # 业务 API 控制器 (Auth, Chat, Admin, ALing 等)
│   │   ├── middleware/      # 安全与频控中间件 (CORS, JWT, RateLimit)
│   │   ├── models/          # 统一数据模型定义 (GORM Schema & BSON Tags)
│   │   └── services/        # 腾讯云 COS、SMTP 邮箱、各 LLM API 服务的统一封装
│   ├── Dockerfile.dev       # 容器化开发构建配置
│
├── src/                      # React 前端源文件
│   ├── components/          # 核心交互组件
│   │   ├── ChatArea/        # 聊天消息列表渲染、思维链与流式渲染控制
│   │   ├── Workspace/       # 代码实时沙箱渲染与可视化预览工作区
│   │   ├── Sidebar/         # 侧边栏及分支对话历史树交互
│   │   └── ...
│   ├── pages/               # 独立页面 (Login, Register, ALing 翻译, UserSettings)
│   ├── services/            # API 请求统一客户端封装 (api.ts)
│   ├── App.tsx              # 前端路由与根逻辑
│   └── main.tsx
│
├── docker-compose.yml        # Docker 容器服务编排文件
├── start-dev.ps1             # Windows 本地开发一键热启动脚本
├── start-dev.sh              # Linux/macOS 本地开发一键热启动脚本
└── README.md                 # 说明文档
```

---

## 🚀 快速启动与部署

推荐使用容器方式启动数据库与 Go 后端，并使用 Vite 启动 Web 前端。

### 1. 配置本地环境变量
在 `alchatweb/` 根目录和 `alchatweb/backend/` 目录下分别复制配置文件：

- **根目录环境变量** (用于本地 Docker 数据库端口映射)：
  ```bash
  cp .env.example .env
  ```
- **Go 后端环境变量** (用于业务逻辑及 API Key)：
  ```bash
  cp backend/.env.example backend/.env
  ```
  编辑 `backend/.env`，重点配置：
  - 大模型 API Key 及自定义 Base URL
  - Redis、MySQL 和 MongoDB 连接信息

### 2. 运行一键热启动开发脚本
在 `alchatweb/` 根目录下运行以下脚本，将会一键拉起 MySQL、MongoDB、Redis 容器，并自动以热重载模式构建并启动 Go 后端及前端 Vite 开发服务器：

- **Windows 用户**:
  ```powershell
  # 以管理员身份运行 PowerShell
  Set-ExecutionPolicy Bypass -Scope Process
  .\start-dev.ps1
  ```
- **Linux/macOS 用户**:
  ```bash
  bash start-dev.sh
  ```

### 3. 初始化数据库（MySQL 自动建表与迁移）
在后端服务运行前，运行数据迁移脚本。该脚本会自动在 MySQL 中建立最新的表结构（如 `users`, `configs`, `announcements`, `feedbacks` 等），并自动将 MongoDB 历史存量用户数据无损导入到 MySQL 中：
```bash
# 进入后端目录
cd backend

# 本地直接运行迁移
go run cmd/migrate/main.go

# 或者如果是在 Docker 容器中运行
docker compose exec backend go run cmd/migrate/main.go
```

---

## 📡 核心 API 概览

| 模块 | 请求方法 | API 路径 | 描述 | 鉴权认证 |
| :--- | :--- | :--- | :--- | :---: |
| **认证** | **POST** | `/api/auth/register` | 用户发送验证码并注册 | 否 |
| **认证** | **POST** | `/api/auth/login` | 账号密码登录获取 JWT | 否 |
| **个人** | **GET** | `/api/auth/profile` | 获取当前用户的 Profile 详情 | **是** |
| **对话** | **GET** | `/api/conversations` | 获取当前用户的全部历史会话列表 | **是** |
| **会话** | **POST** | `/api/conversations` | 创建新对话会话 | **是** |
| **聊天** | **POST** | `/api/chat` | 发送流式对话消息（支持 SSE 状态推送） | **是** |
| **画图** | **POST** | `/api/chat/image` | 触发画图任务并在后台异步生成图片 | **是** |
| **翻译** | **POST** | `/api/aling/translator/translate` | ALing 专属流式双语对照翻译 | **是** |

---

## 📄 许可协议

本项目采用 [Apache License 2.0](LICENSE) 许可协议开源。

Copyright 2026 AL Chat Web Contributors.
Licensed under the Apache License, Version 2.0.
