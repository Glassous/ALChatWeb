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
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f9fafb;padding:40px 0;">
    <tr>
        <td align="center">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                <tr>
                    <td style="padding:32px;background: linear-gradient(135deg, #790604 0%, #D81B60 100%);">
                        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">AL Chat</h1>
                    </td>
                </tr>
                <tr>
                    <td style="padding:40px 32px;">
                        <h2 style="margin:0 0 16px 0;color:#111827;font-size:22px;font-weight:700;text-align:center;">验证您的邮箱</h2>
                        <p style="margin:0 0 32px 0;color:#4b5563;font-size:16px;line-height:1.6;text-align:center;">
                            您好，感谢使用 AL Chat。请使用下方的 6 位验证码完成流程：
                        </p>
                        
                        <div style="background-color:#f3f4f6;border-radius:8px;padding:32px;margin-bottom:32px;text-align:center;">
                            <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:36px;font-weight:700;color:#111827;letter-spacing:12px;margin-left:12px;">
                                {{.Code}}
                            </span>
                        </div>

                        <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;text-align:center;">
                            验证码有效期为 <span style="color:#111827;font-weight:600;">10 分钟</span>。<br>
                            如果这不是您本人操作，请忽略此邮件。
                        </p>
                    </td>
                </tr>
                <tr>
                    <td style="padding:24px;background-color:#f9fafb;text-align:center;border-top:1px solid #f3f4f6;">
                        <p style="margin:0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;">
                            AL Chat Team
                        </p>
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

	return s.SendEmail(to, "AL Chat 验证码", body.String())
}

const feedbackReplyTemplate = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AL Chat 反馈回复通知</title>
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f9fafb;padding:40px 0;">
    <tr>
        <td align="center">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                <tr>
                    <td style="padding:32px;background: linear-gradient(135deg, #790604 0%, #D81B60 100%);">
                        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">AL Chat</h1>
                    </td>
                </tr>
                <tr>
                    <td style="padding:32px;">
                        <h2 style="margin:0 0 20px 0;color:#111827;font-size:20px;font-weight:600;">您好：</h2>
                        <p style="margin:0 0 24px 0;color:#4b5563;font-size:16px;line-height:1.6;">
                            感谢您对 AL Chat 的关注与支持。针对您提交的反馈，管理员已给出回复：
                        </p>
                        
                        <div style="background-color:#f3f4f6;border-radius:8px;padding:20px;margin-bottom:24px;">
                            <p style="margin:0 0 8px 0;color:#6b7280;font-size:14px;font-weight:600;text-transform:uppercase;">您的反馈：</p>
                            <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">{{.UserContent}}</p>
                        </div>

                        <div style="background-color:#fff7ed;border-left:4px solid #f97316;border-radius:4px;padding:20px;">
                            <p style="margin:0 0 8px 0;color:#9a3412;font-size:14px;font-weight:600;text-transform:uppercase;">管理回复：</p>
                            <p style="margin:0;color:#c2410c;font-size:16px;line-height:1.6;font-weight:500;">{{.ReplyContent}}</p>
                        </div>

                        <p style="margin:32px 0 0 0;color:#6b7280;font-size:14px;line-height:1.6;text-align:center;">
                            如果您有更多疑问，欢迎随时再次联系我们。
                        </p>
                    </td>
                </tr>
                <tr>
                    <td style="padding:24px;background-color:#f9fafb;text-align:center;border-top:1px solid #f3f4f6;">
                        <p style="margin:0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;">
                            AL Chat Team
                        </p>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>
`

func (s *EmailService) SendFeedbackReply(to, userContent, replyContent string) error {
	tmpl, err := template.New("feedback").Parse(feedbackReplyTemplate)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	var body bytes.Buffer
	data := struct {
		UserContent  string
		ReplyContent string
	}{
		UserContent:  userContent,
		ReplyContent: replyContent,
	}

	if err := tmpl.Execute(&body, data); err != nil {
		return fmt.Errorf("failed to execute template: %w", err)
	}

	return s.SendEmail(to, "AL Chat 反馈回复通知", body.String())
}

func (s *EmailService) SendEmail(to, subject, body string) error {
	var err error
	header := make(map[string]string)
	header["From"] = s.cfg.SMTPFrom
	header["To"] = to
	header["Subject"] = subject
	header["MIME-Version"] = "1.0"
	header["Content-Type"] = "text/html; charset=\"UTF-8\""

	message := ""
	for k, v := range header {
		message += fmt.Sprintf("%s: %s\r\n", k, v)
	}
	message += "\r\n" + body

	addr := net.JoinHostPort(s.cfg.SMTPHost, fmt.Sprintf("%d", s.cfg.SMTPPort))

	var client *smtp.Client

	if s.cfg.SMTPPort == 465 {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: false,
			ServerName:         s.cfg.SMTPHost,
		}
		dialer := net.Dialer{Timeout: 15 * time.Second}
		var tlsConn *tls.Conn
		tlsConn, err = tls.DialWithDialer(&dialer, "tcp", addr, tlsConfig)
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
		var conn net.Conn
		conn, err = dialer.Dial("tcp", addr)
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
