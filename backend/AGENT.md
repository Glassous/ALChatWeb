# Agent 部署与验收

Agent 运行在现有 FastAPI 单 Uvicorn worker 内，使用项目日常模型（`OPENAI_*` 和现有管理端日常模型覆盖配置）。日常模型必须支持标准工具调用；搜索、Superbox 或多模态服务至少启用一个。Web 与 Android 的普通持久会话支持图片、视频附件，上传沿用 COS 预签名链路。视频仅提供原始 URL，本版不分析视频内容。管理端配置方式不变。

## 部署

停止 API 后更新依赖、执行迁移，再启动 API。迁移创建 SQL `agent_usage` 表及 MongoDB `agent_runs` / `agent_events` 索引；重复执行不会覆盖已有数据。数据库结构仍由显式迁移创建。

```powershell
cd backend
.venv/Scripts/python.exe -m pip install -e ".[test]"
.venv/Scripts/python.exe -m app.migrate
.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 1
```

Docker 使用原有迁移流程：停止 backend，构建 backend 镜像，执行 `docker compose run --rm backend python -m app.migrate`，再启动 backend。不要增加 worker 数量或同时部署多个执行实例。

本轮 Superbox 升级不新增 SQL 表。已有 Agent 存储无需再次迁移，但必须安装新增依赖 `jsonschema>=4.23,<5`：本地执行 `pip install -e .`，Docker 正式部署应重建 backend 镜像。只在没有运行中的任务时重启后端。现有环境变量会覆盖新默认值，部署时检查是否仍显式配置旧预算。

已有部署仅缺少 Agent 存储时，可使用下面的增量命令。它只创建 `agent_usage` 表和 Agent 索引，不导入旧数据，不修改现有账号；可重复执行。更新后端代码后，在没有运行中的任务时重启 backend。

```powershell
docker exec alchat-backend python -m app.migrate --agent-only
docker restart alchat-backend
```

提交任务前会检查计费表及其字段，缺少结构返回 HTTP 503 并提示迁移命令，不创建消息、不调用模型。执行中的数据库故障会保留已有输出并结束步骤。后端日志记录数据库驱动、错误码和调用位置，不记录 SQL 参数、原始请求头或异常中的凭证。

JWT 的 `InsecureKeyLengthWarning` 与 Agent 计费错误无关。HS256 的 `JWT_SECRET` 应使用至少 32 字节的随机密钥。更换密钥会使已有登录失效；如果 `CUSTOM_MODEL_ENCRYPTION_KEY` 未单独配置，需要在更换 JWT 密钥前把原 JWT 密钥保存为独立的加密密钥，避免已有自定义模型及 Hermes 密钥无法解密。不要把实际密钥写入文档或版本控制。

| 环境变量 | 默认值 |
|---|---:|
| `AGENT_MAX_MODEL_CALLS` | 16 |
| `AGENT_MAX_SEARCH_CALLS` | 12 |
| `AGENT_MAX_PLUGIN_CALLS` | 24 |
| `AGENT_TIMEOUT_SECONDS` | 600 |
| `AGENT_MODEL_TIMEOUT_SECONDS` | 60 |
| `AGENT_SEARCH_TIMEOUT_SECONDS` | 30 |
| `AGENT_PLUGIN_TIMEOUT_SECONDS` | 30 |
| `AGENT_DISCOVERY_TIMEOUT_SECONDS` | 10 |
| `AGENT_FINAL_RESERVE_SECONDS` | 60 |
| `SUPERBOX_ENABLED` | true |
| `SUPERBOX_BASE_URL` | https://superbox.fiacloud.top/api/v1 |

每次搜索最多 10 条结果，摘要最多 2000 字符；每轮模型文本展示最多 32768 字符，超过上限终止任务并保留部分输出。取消和总时长限制采用协作方式，已发出的无输出上游请求可能需要等待请求超时；取消后不会再调用模型或搜索。页面关闭只结束连接，后端继续执行；后端重启将未完成任务标记为中断。

搜索和插件独立计数。实际失败请求消耗相应预算，参数校验失败和预算拦截不计数。耗尽一类预算后仅关闭对应工具，其余能力仍可执行；单轮超额请求各自收到配对的工具结果，步骤显示“未执行”。预留最后一次模型调用整理答案；剩余研究时间不足时关闭所有工具。最终整理时间最多为配置预留值、单次模型超时及总时长三分之一中的最小值（默认 60 秒），短超时测试也能保留实际执行时间。正常整理成功为“已完成”，同时保存预算提示。取消、余额不足或真正的故障保持原有终态，已获得的来源和插件结果保留。

## Superbox 动态插件与统一步骤

每个新任务在首次模型调用前读取 `/skill`、`/skill.json`、`/openapi.json`，保存目录版本、内容摘要、可用操作和未支持原因。Markdown 不可用时使用清单说明；必要目录或 OpenAPI 不可用时降级到已配置的搜索，没有可用工具则明确失败。刷新、SSE 重连或幂等提交只读取原任务，不重新发现或执行功能。

从清单与 OpenAPI 动态注册 JSON 请求体、查询参数和路径参数功能，支持内部 schema 引用，拒绝外部或循环引用。新增兼容 JSON 功能会在下一任务自动出现。EXIF 读取和编辑使用专用 multipart 适配，可写标签查询沿用 JSON 适配；其他文件接口、请求头及 Cookie 参数暂不支持，原因在发现步骤展开后可见。

附件统一从当前分支的媒体标签解析；COS MIME 优先，缺失时参考标签与扩展名。原始 URL 作为模型可读文字保留，供应商图片域名转换不会覆盖原始 URL。`analyze_image(image_url, question)` 使用现有 `MULTIMODAL_*` 配置分析图片，日常模型继续负责调度；工具读取 COS 原文件，支持 JPEG、PNG、WebP、GIF，读取上限 50 MiB，供应商额外限制或不可用会返回明确错误。图片分析与日常模型共享模型次数、时限和积分账目，并保留最后一次模型调用整理答案。步骤类型 `media` 只保存 URL、问题、分析摘要和错误，不保存图片字节或 Base64。

EXIF 支持 JPEG、PNG、WebP，原图上限 20 MiB，模型通过 `body.image_url` 指定当前分支附件或本次生成结果。`body.changes` 是 1–100 项结构化操作数组，`set` 需要 1–4096 字符的 `value`，`delete` 不需要值。后端从 COS 读取原文件提交给 Superbox，不重新编码像素。编辑前必须用读取或标签查询验证可写 key；只读 key 拒绝修改。成功返回图片格式、大小和新 COS URL，原文件不覆盖；JSON 响应上限仍为 2 MiB，EXIF 图片响应独立上限为 21 MiB。

无法恢复的图片/插件错误会在正式回复说明“当前做不到”、原因及已完成部分。只有修改结果成功上传 COS 才算交付；后端确保正式回复包含预览和下载链接，最后一轮模型失败也保留已生成结果。仅上传图片时默认概述内容；仅上传视频时直接正式说明无法分析视频并提供链接。取消保持原有语义。部署无需新增依赖或数据库迁移；更新代码并在没有运行中任务时重启后端。人工验收见 [AGENT_MEDIA_TESTS.md](tests/agent_media/AGENT_MEDIA_TESTS.md)。

调用只使用配置的 HTTPS 服务地址及已发现的路径，忽略文档中的 HTTP 基础地址，不接受模型指定任意 URL、不跟随重定向、不转发用户 JWT。插件 HTTP 请求具有覆盖整个请求的绝对超时，不自动重试。参数及响应上限分别为 1 MiB / 2 MiB；传给模型的结果最多 32768 字符，步骤参数和结果预览最多 8192 字符，截断会明确标记。常见凭证字段隐藏，卡片不展示原始请求头，也不执行返回的 HTML。

统一卡片展示发现、模型、搜索和插件步骤；最终整理使用“整理答案”标题。每行包含来源、状态、耗时和摘要，运行步骤默认展开，其他可折叠；文本、JSON 参数和结果可复制，搜索来源沿用现有引用展示。外层显示模型、搜索、插件预算及停止按钮。最终答案独立展示，历史和分享保留步骤，分享副本不连接原任务。

按全部模型调用累计输入/输出用量，输入每 Token 0.001 Credits，输出每 Token 0.004 Credits，沿用当前积分两位小数精度。上游未返回用量时估算消息与输出（含工具参数）。每次调用的账目及积分扣减共用 SQL 事务；取消、重连和重复提交不重复扣费。下一轮调用前检查余额，已完成调用可能使余额小于零，之后停止继续调用。搜索供应商费用不额外扣积分。没有任何响应或用量的上游失败无法确认实际消耗，不估算该次费用。

运行快照长期保留，事件日志的 MongoDB TTL 为 24 小时；日志过期后重连发送完整快照。对话删除后运行接口不再提供访问，运行和计费记录保留供排查。分享展示保存的步骤，保存分享生成的副本不关联原运行。

## 接口

全部要求 `Authorization: Bearer <JWT>`。

- `POST /api/agent/runs`：`conversation_id`、`message`、`request_id`，可选 `parent_message_id`、`location`。首次返回 201，同用户相同请求标识及内容返回原任务 200；标识与不同内容冲突返回 409。普通持久会话支持文本及现有 `<image src="…">`、`<file src="…">` 附件格式，无新增必填字段。
- `GET /api/agent/runs/{id}`：返回快照，包含消息 ID、`status`、`steps`、`content`、`error`、`credits`、`seq`。
- `GET /api/agent/runs/{id}/events?after_seq=0`：SSE `data` JSON 为 `{run_id, seq, type, data}`。类型为 `status`、`step`、`terminal`、`snapshot`；快照需整体替换客户端状态，其余按序号去重。
- `POST /api/agent/runs/{id}/cancel`：幂等返回当前状态，运行中先变为 `cancelling`，结束为 `cancelled`；已结束任务不改变状态。

状态为 `running`、`cancelling`、`completed`、`cancelled`、`failed`、`interrupted`。运行期间同会话普通聊天、画图、启动另一个 Agent 和删除会话返回 409。

兼容性扩展均为可选字段：快照包含 `budget`（三类用量、上限、阶段、已耗尽预算）、`notice`、`finish_reason`、`discovery`；步骤 `type` 增加 `discovery` / `plugin`，步骤状态支持 `skipped`。步骤可携带 `provider`、操作元数据、预览和截断标志。对应消息字段为 `agent_budget`、`agent_notice`、`agent_finish_reason`、`agent_discovery`。旧记录缺少这些字段时继续展示；SSE 路由、序号和事件类型不变。

## 基本验证

```powershell
# 后端完整测试：隔离数据库与 AI，使用真实 LangChain Agent 循环
.venv/Scripts/python.exe -m pytest -q
# 临时本地 HTTP 服务：没有外部服务调用或真实费用
.venv/Scripts/python.exe smoke_agent_api.py --isolated
# Web 构建与静态检查（在 alchatweb 根目录）
npm run build
npm run lint
```

真实接口冒烟测试可在独立测试账号登录后将其 JWT 设置到环境变量 `ALCHAT_SMOKE_TOKEN`，运行 `python smoke_agent_api.py --base-url http://localhost:8080`。它创建并清理测试会话，会产生真实调用费用；失败记录与计费记录会保留。不要使用生产账号或共享账号进行测试。

## 用户手动验收

1. 普通会话选择 Agent：检查与专家、搜索、Hermes、画图互斥，附件入口不可用，临时会话没有 Agent 入口。
2. 用无需搜索的问题验证直接回答；用需比较多个来源的问题验证多轮搜索、结果编号和 `ref(n)` 引用。
3. 展开步骤查看搜索词、来源、结果摘要和耗时；最终答案不包含执行日志。断开页面后再打开会话，确认任务继续并恢复步骤，不出现重复文本。
4. 任务运行时停止，确认先出现“停止中”，然后“已取消”；已完成步骤保留，后端停止新调用。切换会话不会取消原任务。
5. 以不支持工具调用的日常模型验证明确报错；验证搜索源故障、额度不足、次数上限和超时状态。
6. 重启后端，确认未完成任务显示“中断”，无需再次扣费；检查历史、分支、分享和分享副本显示。
7. 使用另一账号访问任务，确认快照、事件、取消均被拒绝；比较模型调用记录与积分变化。
8. 请求“用 Superbox 解码 aGVsbG8=”或“格式化这段 JSON”，检查发现步骤、自动选用功能、参数及结果复制；关闭搜索密钥后仍可使用 Superbox。
9. 调低单类预算验证：搜索用完仍可调用插件，插件用完仍可搜索；最终整理阶段不再执行工具，完成后显示预算提示。

隔离自动测试不验证真实模型答案质量、供应商稳定性或完整浏览器交互效果；这些由上述手动验收覆盖。真实数据库修复检查的范围见下方记录。

## 本次验证记录（2026-10-02）

| 检查 | 结果 |
|---|---|
| Web `npm run build` | 通过；保留已有的大 bundle 提示 |
| Web `npm run lint` | 通过 |
| Python wheel 打包 | 通过，构建依赖放在临时隔离环境 |
| 后端完整 `pytest -q` | 116 通过，含原有 92 项和本轮 24 项临时验证 |
| 本地 Uvicorn HTTP 冒烟 | 15 项通过 |
| 显式迁移重复执行 | 已在隔离存储中验证 |
| Docker 增量 Agent 迁移 | 真实 MySQL / MongoDB 执行两次成功 |
| 真实 MySQL 计费去重 | 临时测试账号调用两次，仅一条账目及一次扣减，测试数据已清理 |
| 修复后的后端 | 已重启；`/health` 返回 200 |
| 真实 Superbox 文本接口 | 10 项通过；2 个文件接口已明确排除 |
| 插件 HTTP / SSE 冒烟 | 13 项通过：脚本化模型与隔离存储，调用真实 Superbox |
| Docker 内 Superbox | 发现 10 个可用操作并成功调用 Base64 解码 |

测试使用 LangChain 1.4.2、LangGraph 1.2.12、langchain-openai 1.6.6，脚本化模型和搜索结果，以及 SQLite / mongomock / fakeredis。旧测试的 SSE 无限等待、HTTP DELETE 写法和 CORS 断言已修正；分享默认分支的同时间戳选择增加 ObjectId 次序，避免漏掉更晚的助手消息。

首次隔离验证未访问 Docker。后续针对 `ProgrammingError` 排查，确认运行容器中的 MySQL 缺少 `agent_usage` 表，已完成增量迁移并验证重复执行、SQL 计费和后端健康检查。新增回归测试覆盖缺表时拒绝提交、迁移后恢复、数据库错误分类、部分输出及步骤保存、日志不泄漏参数。没有调用真实模型或搜索供应商，未自动重试历史失败任务，未更换现有 JWT 密钥。Android 和管理端前端没有改动。

本轮 24 项临时验证覆盖真实 LangChain 循环中的动态新增功能、独立预算、批量超额及消息配对、参数修正、目录降级、引用解析、取消、余额不足、绝对超时、结果截断和凭证隐藏。验证结束删除临时测试脚本和本次临时数据；保留现有 92 项测试及正式构建产物。真实 Superbox 使用 hello、零时间戳等无敏感样例，没有调用真实模型；完整模型效果及浏览器业务验收由用户完成。
