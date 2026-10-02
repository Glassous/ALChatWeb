# Agent 附件与 Superbox 接口交付说明

实现范围：后端、Web、Android。未修改管理端，未部署，无数据库迁移。仅完成构建验证，功能尚未验证；以下清单由人工验收。

## 接口变化

### 上传：POST /api/chat/upload-reference

使用已有用户认证，multipart/form-data，每个请求一个 `file`（兼容旧 `image` 字段）。新增 `mode`，省略时为 `daily`；PDF、DOCX、XLSX 仅允许 `agent`，非空且不超过 5 MiB，校验扩展名和 PDF／Office 文件结构。媒体沿用原上传限制。文档不能通过 `/api/cos/presign` 获得上传凭证。

成功响应保留 `url`，并增加：

```json
{
  "url": "https://COS域名/reference_files/对象.pdf",
  "filename": "报告.pdf",
  "mime_type": "application/pdf",
  "size": 1024,
  "type": "document"
}
```

`type` 为 `image`、`video`、`document` 或 `file`。`size` 单位为字节。

### 聊天与运行

`POST /api/chat`、`POST /api/chat/image`、`POST /api/agent/runs` 增加可选 `attachments` 数组，项目与上传响应相同，按 URL 关联 `<image src="…">`、`<file src="…">`、`<video src="…">`。后端 HEAD 核对项目 COS 对象的类型与大小，不采用客户端声明的大小。普通聊天及画图拒绝新消息中的文档。原定位标签保持兼容。

消息、Agent 运行快照及终态事件包含可选 `attachments`；历史、分支、分享和分享副本保留描述。旧消息按 URL 推断文件名／格式，缺失大小显示“未知”。无需补填历史数据库。

### Agent 创建文本文件

新增 `create_text_file(filename, content)` 工具。两个参数均必填：文件名须含受支持的纯文本扩展名（例如 `报告.txt`、`笔记.md`、`数据.csv`），内容须为非空纯文本，以 UTF-8 保存，最大 10 MiB。不接受路径、二进制格式和空字符。沿用插件调用预算、任务截止时间、取消及最终整理机制；只有 COS 保存成功才返回文件描述、登记交付，并通过 `<file src="…">` 显示聊天文件卡片。

### Agent 文件能力

`transfer_file(url)` 为 Agent 工具，沿用插件预算、任务截止时间、取消和最终整理阶段限制。公开 HTTP／HTTPS 直链仅允许 80／443 端口，逐跳检查公网 DNS 地址并固定连接地址，最多三次重定向，最多 10 MiB；DNS、下载和流读取受绝对截止时间限制，不携带用户凭证。成功结果在同一任务中复用，新增 COS 对象不覆盖来源。只有保存成功才登记交付文件，结果可继续交给 Superbox 文档转换或看图工具。普通网页引用保留链接。

## Superbox 适配

依据公开 OpenAPI 与使用说明（本次文档版本 1.2.0）动态发现全部业务操作，排除健康检查和接口目录等管理操作；保留版本和文档摘要，不兼容操作显示原因。处理路径前缀、本地引用、组合类型、可空字段、默认值、必填和参数约束；说明按操作组织。

GET 查询、JSON、文档 multipart 和 EXIF 原图 multipart 按接口传输；金额、汇率和时间戳不转为数值。文档转换使用已转存 COS `file_url`、`format`（默认 Markdown），正文解析由 Superbox 完成。EXIF 修改数组序列化为 `changes`，编辑前必须确认可写标签；按 HTTP 状态与 Content-Type 区分错误 JSON 和图片二进制。不自动重试修改请求。

成功 JSON 按响应 schema 校验，保留业务字段和批量单项失败。错误包含 `code`、`message`、`details`、`http_status`（无响应时为 null），兼容原 `error` 字段，区分超限、格式、繁忙、服务不可用和超时。

文档全文保存 `.md`／`.txt`；超过模型预览上限的纯文本结果保存 `.txt`，其他 JSON 保存 `.json`。模型返回有限预览、截断标志及完整文件描述，文档同时保留格式、来源类型、统计和警告。沿用统一步骤卡片，没有新增汇率或时间专用卡片。

## 两端展示与发送

用户气泡中的所有上传附件均为可点击文件卡片；图片／视频预览层包含媒体内容、文件信息和下载，TXT、Markdown、CSV、JSON、配置和代码等纯文本文件可加载并预览原文（最大 10 MiB），保持原始换行与空白，不渲染 Markdown／表格；其他格式仅显示名称、格式、大小与下载。Web 使用 ModalCard（遮罩、关闭、Esc），Android 使用 Compose Dialog（关闭、返回）及系统下载服务。下载失败保留弹窗并提示。卡片独立于文字折叠，纯附件消息可展示；助手图片与正文按原顺序渲染，非图片结果复用文件卡片。

上传期间可以编辑文字，发送按钮、Enter、键盘入口、重试／编辑发送及最终回调受上传状态限制，不自动发送。失败保留文字和成功附件；会话切换、删除与过期上传结果隔离。退出 Agent 移除文档并提示，保留文字和允许的媒体附件。

## 构建验证

- Web：`npm run build`，产物 `alchatweb/dist/`。
- Android：`:app:assembleDebug`（等价于 `gradlew.bat :app:assembleDebug`），产物 `ALChat/app/build/outputs/apk/debug/app-debug.apk`。
- 后端：`.venv/Scripts/python.exe -m compileall -q app`；setuptools wheel 构建，产物 `alchatweb/backend/build/alchat_backend-1.0.0-py3-none-any.whl`。

本机 Android 构建复用已有 Gradle 用户缓存，以进程环境 `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=D:\.Resource\Project\ALChat\ALChat\build\tcp-sockets-only`（该目录不存在，促使 JDK 使用 TCP 回退）以及 `-Pkotlin.compiler.execution.strategy=in-process` 避开本机运行时 socket 问题；未修改 Gradle 工程配置。

Web 有大于 500 kB 的产物体积警告；Android 有已有弃用／空值编译警告，不影响构建。未新增或运行功能、单元、集成、接口冒烟、UI 自动化测试或 lint。读取公开接口文档仅用于适配，不执行业务调用。

## 人工验收清单（未执行）

- [ ] Web 模式互斥：选中 Agent 时日常／专家和图片生成入口隐藏；选中专家或图片生成时 Agent 入口隐藏；退出当前模式返回日常，草稿文字保留。Hermes 也使用同一个模式状态。
- [ ] Web 上传视频菜单、待发送视频占位和消息视频卡片使用统一细线胶片图标，20／28／32 像素下清晰。
- [ ] 上传入口保持回形针；菜单文档项为文件图标 + “附件”，不显示格式和体积；Web／Android 菜单、Android 快捷区中 Agent 位于 Hermes 前。
- [ ] Agent 生成命名 TXT／MD／CSV／JSON 文件：完整内容和原文件名正确，卡片出现；缺少参数、超限、无效格式、COS 保存失败不登记成功交付。
- [ ] 两端纯文本弹窗显示原始换行、缩进、Markdown 标记、CSV 分隔符与 HTML 字符；不渲染格式。关闭时取消加载，加载失败可重试且仍能下载。
- [ ] Web 下载按钮与关闭按钮匹配现有弹窗风格，明暗主题可见，下载中为禁用状态。

- [ ] Web／Android：Agent 分别选择 PDF、DOCX、XLSX，与图片／视频混合；5 MiB 边界、空文件、超限、伪造文件与加密／宏 Office 的提示正确。
- [ ] 普通模式选择／拖拽／粘贴文档被拒；直接提交文档到普通聊天、画图和预签名接口也被拒。
- [ ] 上传期间持续输入，按钮、Enter、键盘、重试和编辑均不能发送；上传结束仍需主动发送。
- [ ] 多附件中部分失败，文字和成功附件仍在；删除／切换模式或会话后，迟到结果不会重新插入。
- [ ] 退出 Agent 提示移除文档，文字与允许的媒体保留；纯附件发送、长文字折叠均能看到所有附件卡片。
- [ ] 用户图片／视频／文档卡片弹窗信息正确；关闭、遮罩、Esc／返回正确；非媒体不解析正文。
- [ ] Web 原文件名下载、Android 系统下载正常；下载失败提示且弹窗保持打开。
- [ ] Agent 转存公开任意格式、10 MiB 边界、重定向、公网限制、慢响应与取消正确；重复直链复用结果，源文件不被覆盖。
- [ ] 直链图片转存后可看图；外部文档先转存再由 Superbox 转换；普通网页引用保持链接。
- [ ] Superbox 发现全部当前业务操作，步骤显示版本／摘要、不兼容原因，GET、JSON、multipart 与字符串数值符合规范。
- [ ] 文档 Markdown／TXT 全文下载，来源类型、统计与警告保留；长文本／JSON 下载完整且预览明确截断。
- [ ] EXIF 原图读取、可写标签确认、set／delete、错误与二进制交付正确；不支持格式、超限、繁忙、503、超时、批量单项失败各自可识别。
- [ ] 预算耗尽、停止与最终整理行为正确；COS 保存失败不登记成功交付；修改请求不会自动重试。
- [ ] 助手“文字—图片—文字—文件—文字”顺序正确；所有正文保留，文件点击不触发气泡选择或朗读。
- [ ] 历史刷新、分支重试／编辑、分享和副本保留名称／格式／大小；旧记录无大小显示未知。

后续发布顺序：后端 → Web → Android。本次未发布。
