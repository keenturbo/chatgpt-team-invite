const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 环境变量
const CHATGPT_TOKEN = process.env.CHATGPT_TOKEN;
const CHATGPT_ACCOUNT_ID = process.env.CHATGPT_ACCOUNT_ID;

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 邀请 API
app.post('/api/invite', async (req, res) => {
  const { email } = req.body;

  // 验证邮箱
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: '请输入有效的邮箱地址'
    });
  }

  // 检查环境变量
  if (!CHATGPT_TOKEN || !CHATGPT_ACCOUNT_ID) {
    console.error('Missing CHATGPT_TOKEN or CHATGPT_ACCOUNT_ID');
    return res.status(500).json({
      success: false,
      message: '服务配置错误，请联系管理员'
    });
  }

  try {
    const result = await sendInvite(email);
    res.json(result);
  } catch (error) {
    console.error('Invite error:', error);
    res.status(500).json({
      success: false,
      message: '邀请发送失败，请稍后重试'
    });
  }
});

// 发送邀请
async function sendInvite(email) {
  const url = `https://chatgpt.com/backend-api/accounts/${CHATGPT_ACCOUNT_ID}/invites`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://chatgpt.com/admin/members',
    'Authorization': `Bearer ${CHATGPT_TOKEN}`,
    'ChatGPT-Account-ID': CHATGPT_ACCOUNT_ID,
    'Content-Type': 'application/json',
  };

  const payload = {
    email_addresses: [email],
    role: 'standard-user',
    resend_emails: false,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  console.log(`Invite response for ${email}: ${response.status} - ${responseText}`);

  if (response.ok) {
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
    return {
      success: true,
      message: '邀请已发送，请查收邮件',
      data: data
    };
  } else {
    // 解析错误信息
    let errorMessage = '邀请发送失败';
    try {
      const errorData = JSON.parse(responseText);
      if (errorData.detail) {
        errorMessage = errorData.detail;
      }
    } catch {
      // 检查是否被 Cloudflare 拦截
      if (responseText.includes('blocked') || responseText.includes('Cloudflare')) {
        errorMessage = '请求被拦截，请稍后重试';
      }
    }
    return {
      success: false,
      message: errorMessage,
      status: response.status
    };
  }
}

// 邮箱验证
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CHATGPT_ACCOUNT_ID: ${CHATGPT_ACCOUNT_ID ? 'configured' : 'NOT SET'}`);
  console.log(`CHATGPT_TOKEN: ${CHATGPT_TOKEN ? 'configured' : 'NOT SET'}`);
});
