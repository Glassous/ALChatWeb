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
<html>
<head>
    <meta charset="UTF-8">
    <style>
        .container { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; }
        .header { text-align: center; padding-bottom: 20px; }
        .code { font-size: 32px; font-weight: bold; color: #0078d4; text-align: center; letter-spacing: 5px; margin: 20px 0; }
        .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><h2>AL Chat 验证码</h2></div>
        <p>您好，</p>
        <p>您正在进行身份验证，请在验证码输入框中输入以下代码：</p>
        <div class="code">{{.Code}}</div>
        <p>该验证码在 10 分钟内有效。如果这不是您本人的操作，请忽略此邮件。</p>
        <div class="footer">© 2026 AL Chat. All rights reserved.</div>
    </div>
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

	addr := fmt.Sprintf("%s:%d", s.cfg.SMTPHost, s.cfg.SMTPPort)

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
