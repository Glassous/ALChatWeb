# Python 后端切换

新服务保持原端口、路径、JWT 密钥、数据库、Redis 键和 COS Bucket。生产环境仅运行一个 Uvicorn worker，因为聊天和翻译流的短时重放保存在进程内。

## 切换前

1. 保留正在运行的 Go 容器镜像 ID、Compose 配置和全部环境变量。`JWT_SECRET`、`CUSTOM_MODEL_ENCRYPTION_KEY`、数据库 DSN、对象存储和 AI 密钥必须原样带入 Python 服务。
2. 在停机窗口备份 MySQL、MongoDB、Redis。记录备份时间和恢复命令，确保备份可读；新服务会写入同一数据集。
3. 在测试副本上运行 `python -m app.migrate`。该命令只为缺失的 MySQL 主键导入 Mongo 历史数据，重复运行不会覆盖已存在的行。生产上也须显式运行；API 启动时不执行建表或导入。
4. 在测试副本上用未修改的 Web、管理端和 Android 客户端验收登录、历史分支、临时会话、分享、积分、后台权限、上传，以及聊天/翻译的 SSE、断线重连和 AI 提供方功能。

## 单次停机切换

1. 停止旧版 Go 服务并阻止新请求；完成三种数据存储的最终备份。
2. 用保留的环境变量执行 `python -m app.migrate`，再在同一地址和端口运行 Python 镜像。Compose 开发部署命令见项目 README。
3. 检查 `/health` 的 `status`、`mongodb`、`redis`，并抽查旧 JWT、登录、历史会话、聊天 SSE、翻译 SSE 与后台接口，然后恢复流量。

## 回滚

停止 Python 服务，恢复保留的 Go 容器镜像和原环境变量。若 Python 写入导致旧版无法读取数据，按停机前快照恢复 MySQL、MongoDB、Redis，再恢复流量。先在测试副本演练此步骤；回滚后的新写入会丢失。

## 验证命令

```bash
cd backend
python -m pip install -e '.[test]'
python -m compileall -q app tests   # 构建/语法检查，不需要任何外部服务
python -m pytest -q                 # 用例使用内存假存储与模拟 AI，不连真实 MySQL/MongoDB/Redis 与提供方
python -m app.migrate
uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 1
```

自动化用例的覆盖范围：

- `tests/test_contract.py`：80 条路由注册、旧 bcrypt/JWT/密钥密文格式、SSE 重放与结束事件、422→400 与尾斜杠不重定向、LangChain 适配器保留 `reasoning_content` 与 Hermes 原始事件。
- `tests/test_chat_stream.py`：聊天与画图的 SSE 事件顺序、迟到订阅者的重放、搜索事件与 `<search>` 标签、reasoning、多模态与 `thinking` 参数、自定义模型回退与扣费、临时会话与 promote、Hermes 上下文续接/重建与步骤展示（含脱敏、截断、时间字段类型）。
- `tests/test_api_compat.py`：发送验证码/注册/登录/重置、旧 JWT 续签头、登出黑名单、资料与系统提示词、头像与邀请码升级、管理端权限与全部 CRUD、会话/分享/翻译/公告/反馈/代理/上传/`health`/CORS 的正常与错误响应。

