
# ChatGPT Team 邀请系统 - VPS 部署指南

本分支为 VPS 部署版本，使用 Node.js + Express 实现，可部署在任何 VPS 服务器上。

---

## 环境要求

- Node.js 18+ 
- npm 或 yarn
- PM2（可选，用于进程管理）

---

## 部署步骤

### 1. 克隆仓库

```bash
git clone -b vps https://github.com/keenturbo/chatgpt-team-invite.git
cd chatgpt-team-invite
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制环境变量模板

```bash
cp .env.example .env
```

编辑 `.env` 文件

```bash
nano .env
```

填入你的 ChatGPT 凭据：

```env
CHATGPT_TOKEN=你的Bearer_Token
CHATGPT_ACCOUNT_ID=你的Account_ID
PORT=3000
```

**获取这两个值的方法**：

打开 ChatGPT Team 管理页面

```
https://chatgpt.com/admin/members
```

打开浏览器开发者工具（F12） -> Network 面板

随便点击一个 API 请求，查看请求头：
- `Authorization: Bearer xxx` 中的 `xxx` 就是 `CHATGPT_TOKEN`
- `ChatGPT-Account-ID: xxx` 就是 `CHATGPT_ACCOUNT_ID`

### 4. 启动服务

#### 方式一：直接启动（测试用）

```bash
npm start
```

#### 方式二：使用 PM2（推荐生产环境）

安装 PM2

```bash
npm install -g pm2
```

启动服务

```bash
pm2 start ecosystem.config.js
```

查看状态

```bash
pm2 status
```

查看日志

```bash
pm2 logs chatgpt-team-invite
```

设置开机自启

```bash
pm2 startup
pm2 save
```

### 5. 配置反向代理（可选）

使用 Nginx 配置域名和 HTTPS：

创建 Nginx 配置文件

```bash
sudo nano /etc/nginx/sites-available/chatgpt-invite
```

添加配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

启用配置

```bash
sudo ln -s /etc/nginx/sites-available/chatgpt-invite /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

配置 HTTPS（使用 Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 访问服务

**本地访问**

```
http://localhost:3000
```

**通过域名访问**

```
http://your-domain.com
```

---

## 管理命令

### PM2 常用命令

**重启服务**

```bash
pm2 restart chatgpt-team-invite
```

**停止服务**

```bash
pm2 stop chatgpt-team-invite
```

**删除服务**

```bash
pm2 delete chatgpt-team-invite
```

**查看日志**

```bash
pm2 logs chatgpt-team-invite
```

**监控**

```bash
pm2 monit
```

### 更新代码

拉取最新代码

```bash
git pull origin vps
```

重启服务

```bash
pm2 restart chatgpt-team-invite
```

---

## 常见问题

### 1. 端口被占用

修改 `.env` 中的 `PORT` 值，改为其他端口（如 3001）

### 2. 邀请失败

检查环境变量是否正确配置：

```bash
cat .env
```

检查 ChatGPT Token 是否过期：

```bash
curl -X GET "https://chatgpt.com/backend-api/accounts/你的ACCOUNT_ID/invites" \
  -H "Authorization: Bearer 你的TOKEN" \
  -H "ChatGPT-Account-ID: 你的ACCOUNT_ID"
```

### 3. PM2 启动失败

查看错误日志：

```bash
pm2 logs chatgpt-team-invite --err
```

检查 Node.js 版本：

```bash
node -v
```

确保是 18+ 版本

---

## 安全建议

1. **防火墙配置**：只开放必要端口（80、443、22）
2. **定期更新 Token**：ChatGPT Token 有有效期，定期更换
3. **使用 HTTPS**：通过 Nginx + Let's Encrypt 配置 SSL
4. **限流保护**：可在 Nginx 配置请求频率限制
5. **.env 不要提交**：确保 `.env` 在 `.gitignore` 中

---

## VPS 推荐

| 服务商 | 起步价 | 特点 |
|--------|--------|------|
| Vultr | $5/月 | 简单易用，IP 质量好 |
| DigitalOcean | $6/月 | 文档完善，稳定性高 |
| Linode | $5/月 | 性能优秀 |
| 阿里云 | ¥99/年 | 国内访问快 |

最低配置：1核 1GB 内存即可

---

## 与 Cloudflare Workers 版本的区别

| 特性 | Cloudflare Workers | VPS |
|------|-------------------|-----|
| 部署难度 | 简单 | 中等 |
| 成本 | 免费（有限额） | $5/月起 |
| IP 限制 | 容易被 ChatGPT 拦截 | 较少被拦截 |
| 扩展性 | 自动扩展 | 需手动配置 |
| 适用场景 | 小流量测试 | 生产环境 |

---

## 支持

如有问题，请提交 Issue：[https://github.com/keenturbo/chatgpt-team-invite/issues](https://github.com/keenturbo/chatgpt-team-invite/issues)
```
