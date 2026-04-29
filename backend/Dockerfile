# 1. 构建阶段
FROM golang:1.25-alpine AS builder

# 设置工作目录
WORKDIR /app

# 配置 Go 环境变量，使用代理加速下载（如果在国内服务器部署）
ENV GOPROXY=https://goproxy.cn,direct

# 复制依赖文件并下载依赖
COPY go.mod go.sum ./
RUN go mod download

# 复制所有源代码
COPY . .

# 编译 Go 应用，指定入口为 cmd/server/main.go
# CGO_ENABLED=0 确保编译出静态链接的二进制文件，以便在轻量级 alpine 镜像中运行
RUN CGO_ENABLED=0 GOOS=linux go build -o alchat-server ./cmd/server

# 2. 运行阶段
FROM alpine:latest

WORKDIR /app

# 安装时区数据和证书（防止请求外部 HTTPS 接口时出现证书报错）
RUN apk add --no-cache tzdata ca-certificates

# 从构建阶段复制编译好的二进制文件
COPY --from=builder /app/alchat-server .

# 暴露后端运行的端口（根据 .env.example 默认是 8080）
EXPOSE 8080

# 启动命令
CMD ["./alchat-server"]