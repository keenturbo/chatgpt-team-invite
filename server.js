const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 管理员配置
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// Bark 推送配置
const BARK_KEY = process.env.BARK_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://team.lorry.pp.ua';

// 数据文件路径
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// 内存中的数据
let accountPool = [];
let orderList = [];

// 活跃的管理员 token
let adminTokens = new Set();

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 数据管理 ====================

// 加载账号数据
function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      const json = JSON.parse(data);
      accountPool = json.accounts || [];
      console.log(`Loaded ${accountPool.length} accounts from file`);
    } else {
      accountPool = [];
      saveAccounts();
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
    accountPool = [];
  }
}

// 保存账号数据
function saveAccounts() {
  try {
    const data = JSON.stringify({ accounts: accountPool }, null, 2);
    fs.writeFileSync(ACCOUNTS_FILE, data, 'utf8');
  } catch (error) {
    console.error('Error saving accounts:', error);
  }
}

// 加载订单数据
function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const data = fs.readFileSync(ORDERS_FILE, 'utf8');
      const json = JSON.parse(data);
      orderList = json.orders || [];
      console.log(`Loaded ${orderList.length} orders from file`);
    } else {
      orderList = [];
      saveOrders();
    }
  } catch (error) {
    console.error('Error loading orders:', error);
    orderList = [];
  }
}

// 保存订单数据
function saveOrders() {
  try {
    const data = JSON.stringify({ orders: orderList }, null, 2);
    fs.writeFileSync(ORDERS_FILE, data, 'utf8');
  } catch (error) {
    console.error('Error saving orders:', error);
  }
}

// 获取可用账号（有剩余名额的）
function getAvailableAccount() {
  return accountPool.find(acc => acc.enabled && (acc.quota - acc.used) > 0);
}

// 生成唯一 ID
function generateId() {
  return crypto.randomUUID();
}

// 生成管理员 token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ==================== Bark 推送 ====================

async function sendBarkNotification(title, body) {
  if (!BARK_KEY) {
    console.log('Bark key not configured, skipping notification');
    return;
  }
  
  try {
    const url = `https://api.day.app/${BARK_KEY}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?url=${encodeURIComponent(SITE_URL + '/admin.html')}&group=ChatGPT-Team&sound=minuet`;
    
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.code === 200) {
      console.log('Bark notification sent successfully');
    } else {
      console.error('Bark notification failed:', result);
    }
  } catch (error) {
    console.error('Error sending Bark notification:', error);
  }
}

// ==================== 认证中间件 ====================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未授权' });
  }
  
  const token = authHeader.substring(7);
  if (!adminTokens.has(token)) {
    return res.status(401).json({ success: false, error: '无效的 token' });
  }
  
  next();
}

// ==================== 管理员 API ====================

// 登录
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = generateToken();
    adminTokens.add(token);
    
    // 1小时后自动过期
    setTimeout(() => {
      adminTokens.delete(token);
    }, 60 * 60 * 1000);
    
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: '用户名或密码错误' });
  }
});

// 获取账号列表
app.get('/api/admin/accounts', authMiddleware, (req, res) => {
  const safeAccounts = accountPool.map(acc => ({
    id: acc.id,
    name: acc.name,
    accountId: acc.accountId,
    quota: acc.quota,
    used: acc.used,
    enabled: acc.enabled,
    createdAt: acc.createdAt
  }));
  
  res.json({ success: true, accounts: safeAccounts });
});

// 添加账号
app.post('/api/admin/accounts', authMiddleware, (req, res) => {
  const { name, accountId, token, quota } = req.body;
  
  if (!name || !accountId || !token) {
    return res.status(400).json({ success: false, error: '请填写完整信息' });
  }
  
  if (accountPool.some(acc => acc.accountId === accountId)) {
    return res.status(400).json({ success: false, error: '该账号已存在' });
  }
  
  const newAccount = {
    id: generateId(),
    name: name.trim(),
    accountId: accountId.trim(),
    token: token.trim(),
    quota: parseInt(quota) || 4,
    used: 0,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  
  accountPool.push(newAccount);
  saveAccounts();
  
  res.json({ success: true, message: '账号添加成功' });
});

// 删除账号
app.delete('/api/admin/accounts/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  const index = accountPool.findIndex(acc => acc.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }
  
  accountPool.splice(index, 1);
  saveAccounts();
  
  res.json({ success: true, message: '账号已删除' });
});

// 重置账号使用次数
app.post('/api/admin/accounts/:id/reset', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  const account = accountPool.find(acc => acc.id === id);
  if (!account) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }
  
  account.used = 0;
  account.enabled = true;
  saveAccounts();
  
  res.json({ success: true, message: '已重置使用次数' });
});

// ==================== 订单 API ====================

// 创建订单（用户提交）
app.post('/api/order', async (req, res) => {
  const { email, remark } = req.body;
  
  // 验证邮箱
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: '请输入有效的邮箱地址'
    });
  }
  
  // 检查是否有可用名额
  const availableAccount = getAvailableAccount();
  if (!availableAccount) {
    return res.status(503).json({
      success: false,
      message: '暂无可用名额，请稍后再试'
    });
  }
  
  // 检查是否已有相同邮箱的待处理订单
  const existingOrder = orderList.find(o => o.email === email && o.status === 'pending');
  if (existingOrder) {
    return res.status(400).json({
      success: false,
      message: '您已有待处理的订单，请等待确认'
    });
  }
  
  // 创建订单
  const newOrder = {
    id: generateId(),
    email: email.trim(),
    remark: (remark || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  orderList.unshift(newOrder); // 新订单放在最前面
  saveOrders();
  
  // 发送 Bark 通知
  const pendingCount = orderList.filter(o => o.status === 'pending').length;
  sendBarkNotification(
    '新订单待确认',
    `邮箱: ${email}\n备注: ${remark || '无'}\n待处理: ${pendingCount}单`
  );
  
  res.json({
    success: true,
    message: '订单已提交，请等待管理员确认付款'
  });
});

// 获取订单列表（管理员）
app.get('/api/admin/orders', authMiddleware, (req, res) => {
  res.json({ success: true, orders: orderList });
});

// 确认订单（管理员）
app.post('/api/admin/orders/:id/confirm', authMiddleware, async (req, res) => {
  const { id } = req.params;
  
  const order = orderList.find(o => o.id === id);
  if (!order) {
    return res.status(404).json({ success: false, error: '订单不存在' });
  }
  
  if (order.status !== 'pending') {
    return res.status(400).json({ success: false, error: '订单状态不正确' });
  }
  
  // 获取可用账号
  const account = getAvailableAccount();
  if (!account) {
    return res.status(503).json({ success: false, error: '暂无可用名额' });
  }
  
  try {
    // 发送邀请
    const result = await sendInvite(order.email, account);
    
    if (result.success) {
      // 更新账号使用次数
      account.used += 1;
      if (account.used >= account.quota) {
        account.enabled = false;
      }
      saveAccounts();
      
      // 更新订单状态
      order.status = 'confirmed';
      order.confirmedAt = new Date().toISOString();
      order.accountName = account.name;
      saveOrders();
      
      res.json({ success: true, message: '订单已确认，邀请已发送' });
    } else {
      res.status(500).json({ success: false, error: result.message || '邀请发送失败' });
    }
  } catch (error) {
    console.error('Confirm order error:', error);
    res.status(500).json({ success: false, error: '处理订单时出错' });
  }
});

// 拒绝订单（管理员）
app.post('/api/admin/orders/:id/reject', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  const order = orderList.find(o => o.id === id);
  if (!order) {
    return res.status(404).json({ success: false, error: '订单不存在' });
  }
  
  if (order.status !== 'pending') {
    return res.status(400).json({ success: false, error: '订单状态不正确' });
  }
  
  order.status = 'rejected';
  order.rejectedAt = new Date().toISOString();
  saveOrders();
  
  res.json({ success: true, message: '订单已拒绝' });
});

// ==================== 邀请 API（保留直接邀请，可选） ====================

app.post('/api/invite', async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: '请输入有效的邮箱地址'
    });
  }

  const account = getAvailableAccount();
  if (!account) {
    return res.status(503).json({
      success: false,
      message: '暂无可用名额，请稍后再试'
    });
  }

  try {
    const result = await sendInvite(email, account);
    
    if (result.success) {
      account.used += 1;
      if (account.used >= account.quota) {
        account.enabled = false;
      }
      saveAccounts();
    }
    
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
async function sendInvite(email, account) {
  const url = `https://chatgpt.com/backend-api/accounts/${account.accountId}/invites`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://chatgpt.com/admin/members',
    'Authorization': `Bearer ${account.token}`,
    'ChatGPT-Account-ID': account.accountId,
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
  console.log(`Invite response for ${email} (account: ${account.name}): ${response.status} - ${responseText}`);

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
    let errorMessage = '邀请发送失败';
    try {
      const errorData = JSON.parse(responseText);
      if (errorData.detail) {
        errorMessage = errorData.detail;
      }
    } catch {
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
// 查询可用名额（公开接口）
app.get('/api/quota', (req, res) => {
  const availableQuota = accountPool.reduce((sum, acc) => {
    return sum + (acc.enabled ? Math.max(0, acc.quota - acc.used) : 0);
  }, 0);
  
  res.json({
    success: true,
    availableQuota: availableQuota
  });
});
// 健康检查
app.get('/health', (req, res) => {
  const availableQuota = accountPool.reduce((sum, acc) => {
    return sum + (acc.enabled ? Math.max(0, acc.quota - acc.used) : 0);
  }, 0);
  const pendingOrders = orderList.filter(o => o.status === 'pending').length;
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    accounts: accountPool.length,
    availableQuota: availableQuota,
    pendingOrders: pendingOrders
  });
});

// 启动服务器
loadAccounts();
loadOrders();
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin user: ${ADMIN_USER}`);
  console.log(`Accounts loaded: ${accountPool.length}`);
  console.log(`Orders loaded: ${orderList.length}`);
  console.log(`Bark notifications: ${BARK_KEY ? 'enabled' : 'disabled'}`);
});