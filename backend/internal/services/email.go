package services

import (
	"alchat-backend/internal/config"
	"bytes"
	"crypto/tls"
	"fmt"
	"html/template"
	"net"
	"net/smtp"
	"time"
)

type EmailService struct {
	cfg *config.Config
}

func NewEmailService(cfg *config.Config) *EmailService {
	return &EmailService{cfg: cfg}
}

type loginAuth struct {
	username, password string
}

func LoginAuth(username, password string) smtp.Auth {
	return &loginAuth{username, password}
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	return "LOGIN", []byte{}, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if more {
		switch string(fromServer) {
		case "Username:", "username:", "USER:", "Username":
			return []byte(a.username), nil
		case "Password:", "password:", "PASS:", "Password":
			return []byte(a.password), nil
		default:
			return []byte(a.username), nil
		}
	}
	return nil, nil
}

const emailTemplate = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AL Chat 验证码</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<!-- 外层容器 -->
<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#ffffff;padding:60px 0;">
    <tr>
        <td align="center">
            
            <!-- 主体区域：极简风 -->
            <table width="400" border="0" cellspacing="0" cellpadding="0" style="max-width:400px;background-color:#ffffff;">
                
                <!-- 1. Logo & Brand 区域 -->
                <tr>
                    <td align="center" style="padding-bottom:32px;">
                        <table border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td style="vertical-align: middle;">
                                    <!-- 内嵌 SVG Logo -->
                                    <div style="width:40px;height:40px;">
                                        <svg viewBox="0 0 300 300" width="40" height="40" xmlns="http://www.w3.org/2000/svg">
                                            <defs>
                                                <linearGradient id="cherryPinkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                    <stop offset="0%" stop-color="#790604"/>
                                                    <stop offset="100%" stop-color="#D81B60"/>
                                                </linearGradient>
                                            </defs>
                                            <g transform="translate(150, 150) scale(0.85)">
                                                <circle cx="0" cy="-55" r="60" fill="url(#cherryPinkGradient)"/>
                                                <circle cx="0" cy="55" r="60" fill="url(#cherryPinkGradient)"/>
                                                <circle cx="-55" cy="0" r="60" fill="url(#cherryPinkGradient)"/>
                                                <circle cx="55" cy="0" r="60" fill="url(#cherryPinkGradient)"/>
                                                <circle cx="-39" cy="-39" r="60" fill="url(#cherryPinkGradient)"/>
                                                <circle cx="39" cy="-39" r="60" fill="url(#cherryPinkGradient)"/>
                                                <circle cx="-39" cy="39" r="60" fill="url(#cherryPinkGradient)"/>
                                                <circle cx="39" cy="39" r="60" fill="url(#cherryPinkGradient)"/>
                                            </g>
                                        </svg>
                                    </div>
                                </td>
                                <td style="vertical-align: middle; padding-left: 12px;">
                                    <span style="font-size: 22px; font-weight: 700; color: #0b0b0f; letter-spacing: -0.5px;">AL Chat</span>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- 2. 标题 -->
                <tr>
                    <td align="center" style="padding-bottom:24px;">
                        <h1 style="margin:0;font-size:20px;font-weight:600;color:#0b0b0f;letter-spacing:-0.5px;">
                            验证您的邮箱
                        </h1>
                    </td>
                </tr>

                <!-- 3. 正文内容 -->
                <tr>
                    <td align="left" style="padding-bottom:32px;">
                        <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;text-align:center;">
                            您好，感谢使用 AL Chat。请使用下方的 6 位验证码完成登录或注册流程。
                        </p>
                    </td>
                </tr>

                <!-- 4. 验证码展示 -->
                <tr>
                    <td align="center" style="padding:24px 0;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;">
                        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:36px;font-weight:700;color:#0b0b0f;letter-spacing:12px;margin-left:12px;">
                            {{.Code}}
                        </span>
                    </td>
                </tr>

                <!-- 5. 补充信息 -->
                <tr>
                    <td align="center" style="padding-top:32px;">
                        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.8;">
                            验证码有效期为 <span style="color:#0b0b0f;font-weight:500;">10 分钟</span>。<br>
                            如果这不是您本人操作，请忽略此邮件。
                        </p>
                    </td>
                </tr>

                <!-- 6. 页脚 -->
                <tr>
                    <td align="center" style="padding-top:64px;">
                        <table border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td style="border-top:1px solid #f3f4f6;padding-top:16px;width:200px;">
                                    <p style="margin:0;font-size:11px;color:#d1d5db;letter-spacing:1px;text-transform:uppercase;">
                                        AL Chat Team
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

            </table>

        </td>
    </tr>
</table>

</body>
</html>
`

func (s *EmailService) SendVerificationCode(to, code string) error {
	tmpl, err := template.New("email").Parse(emailTemplate)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	var body bytes.Buffer
	if err := tmpl.Execute(&body, struct{ Code string }{Code: code}); err != nil {
		return fmt.Errorf("failed to execute template: %w", err)
	}

	header := make(map[string]string)
	header["From"] = s.cfg.SMTPFrom
	header["To"] = to
	header["Subject"] = "AL Chat 验证码"
	header["MIME-Version"] = "1.0"
	header["Content-Type"] = "text/html; charset=\"UTF-8\""

	message := ""
	for k, v := range header {
		message += fmt.Sprintf("%s: %s\r\n", k, v)
	}
	message += "\r\n" + body.String()

	addr := net.JoinHostPort(s.cfg.SMTPHost, fmt.Sprintf("%d", s.cfg.SMTPPort))

	var client *smtp.Client

	if s.cfg.SMTPPort == 465 {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: false,
			ServerName:         s.cfg.SMTPHost,
		}
		dialer := net.Dialer{Timeout: 15 * time.Second}
		tlsConn, err := tls.DialWithDialer(&dialer, "tcp", addr, tlsConfig)
		if err != nil {
			return fmt.Errorf("failed to dial SMTP server (SSL): %w", err)
		}
		client, err = smtp.NewClient(tlsConn, s.cfg.SMTPHost)
		if err != nil {
			tlsConn.Close()
			return fmt.Errorf("failed to create SMTP client: %w", err)
		}
		defer func() {
			client.Quit()
			tlsConn.Close()
		}()
	} else {
		dialer := net.Dialer{Timeout: 15 * time.Second}
		conn, err := dialer.Dial("tcp", addr)
		if err != nil {
			return fmt.Errorf("failed to dial SMTP server: %w", err)
		}
		client, err = smtp.NewClient(conn, s.cfg.SMTPHost)
		if err != nil {
			conn.Close()
			return fmt.Errorf("failed to create SMTP client: %w", err)
		}
		defer func() {
			client.Quit()
			conn.Close()
		}()

		tlsConfig := &tls.Config{
			InsecureSkipVerify: false,
			ServerName:         s.cfg.SMTPHost,
		}
		if err = client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("failed to start TLS: %w", err)
		}
	}

	auth := LoginAuth(s.cfg.SMTPUser, s.cfg.SMTPPass)
	if err = client.Auth(auth); err != nil {
		return fmt.Errorf("failed to authenticate: %w", err)
	}

	if err = client.Mail(s.cfg.SMTPUser); err != nil {
		return fmt.Errorf("failed to set sender: %w", err)
	}
	if err = client.Rcpt(to); err != nil {
		return fmt.Errorf("failed to set recipient: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("failed to get data writer: %w", err)
	}
	_, err = w.Write([]byte(message))
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}
	err = w.Close()
	if err != nil {
		return fmt.Errorf("failed to close data writer: %w", err)
	}

	return nil
}
