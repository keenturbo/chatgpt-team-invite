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

// ==================== 安全检查 ====================
if (!ADMIN_USER || !ADMIN_PASS || ADMIN_PASS === 'admin123') {
  console.error('❌ 安全错误: 请在 .env 中设置强密码（不能使用 admin123）');
  process.exit(1);
}

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
app.use(express.json({ limit: '10kb' })); // 限制请求体大小防止内存溢出
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 频率限制 ====================
const rateLimitMap = new Map();

function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const record = rateLimitMap.get(key) || { count: 0, resetTime: now + windowMs };
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + windowMs;
  }
  record.count++;
  rateLimitMap.set(key, record);
  return record.count <= maxRequests;
}

// 清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);

// 获取客户端 IP
function getClientIP(req) {
  return req.headers['cf-connecting-ip'] ||
         req.headers['x-forwarded-for']?.split(',')[0] ||
         req.socket.remoteAddress ||
         'unknown';
}

// ==================== 数据管理 ====================
function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      const json = JSON.parse(data);
      accountPool = json.accounts || [];
      console.log(`✓ Loaded ${accountPool.length} accounts`);
    } else {
      accountPool = [];
      saveAccounts();
    }
  } catch (error) {
    console.error('Error loading accounts');
    accountPool = [];
  }
}

function saveAccounts() {
  try {
    const data = JSON.stringify({ accounts: accountPool }, null, 2);
    fs.writeFileSync(ACCOUNTS_FILE, data, 'utf8');
  } catch (error) {
    console.error('Error saving accounts');
  }
}

function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const data = fs.readFileSync(ORDERS_FILE, 'utf8');
      const json = JSON.parse(data);
      orderList = json.orders || [];
      console.log(`✓ Loaded ${orderList.length} orders`);
    } else {
      orderList = [];
      saveOrders();
    }
  } catch (error) {
    console.error('Error loading orders');
    orderList = [];
  }
}

function saveOrders() {
  try {
    const data = JSON.stringify({ orders: orderList }, null, 2);
    fs.writeFileSync(ORDERS_FILE, data, 'utf8');
  } catch (error) {
    console.error('Error saving orders');
  }
}

function getAvailableAccount() {
  return accountPool.find(acc => acc.enabled && (acc.quota - acc.used) > 0);
}

function generateId() {
  return crypto.randomUUID();
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 生成唯一订单号（后端生成，避免重复）
function generateOrderCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const existingOrder = orderList.find(o => o.remark && o.remark === code);
  if (existingOrder) return generateOrderCode();
  return code;
}

// ==================== Bark 推送 ====================
async function sendBarkNotification(title, body) {
  if (!BARK_KEY) {
    console.log('Bark key not configured');
    return;
  }
  try {
    const url = `https://api.day.app/${BARK_KEY}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?url=${encodeURIComponent(SITE_URL + '/admin.html')}&group=ChatGPT-Team&sound=minuet`;
    const response = await fetch(url);
    const result = await response.json();
    if (result.code === 200) {
      console.log('✓ Bark notification sent');
    }
  } catch (error) {
    console.error('Bark notification error');
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
app.post('/api/admin/login', (req, res) => {
  const ip = getClientIP(req);
  if (!rateLimit(`login:${ip}`, 5, 60000)) {
    return res.status(429).json({ success: false, error: '登录尝试过于频繁' });
  }
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = generateToken();
    adminTokens.add(token);
    setTimeout(() => adminTokens.delete(token), 60 * 60 * 1000);
    console.log(`✓ Admin login from ${ip}`);
    res.json({ success: true, token });
  } else {
    console.log(`✗ Failed login from ${ip}`);
    res.status(401).json({ success: false, error: '用户名或密码错误' });
  }
});

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

app.post('/api/admin/accounts', authMiddleware, (req, res) => {
  const { name, accountId, token, quota } = req.body;
  if (!name || !accountId || !token) {
    return res.status(400).json({ success: false, error: '请填写完整信息' });
  }
  if (name.length > 50 || accountId.length > 100 || token.length > 5000) {
    return res.status(400).json({ success: false, error: '输入内容过长' });
  }
  if (accountPool.some(acc => acc.accountId === accountId)) {
    return res.status(400).json({ success: false, error: '该账号已存在' });
  }
  const newAccount = {
    id: generateId(),
    name: name.trim().substring(0, 50),
    accountId: accountId.trim(),
    token: token.trim(),
    quota: Math.min(Math.max(parseInt(quota) || 4, 1), 10),
    used: 0,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  accountPool.push(newAccount);
  saveAccounts();
  res.json({ success: true, message: '账号添加成功' });
});

app.delete('/api/admin/accounts/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const index = accountPool.findIndex(acc => acc.id === id);
  if (index === -1) return res.status(404).json({ success: false, error: '账号不存在' });
  accountPool.splice(index, 1);
  saveAccounts();
  res.json({ success: true, message: '账号已删除' });
});

app.post('/api/admin/accounts/:id/reset', authMiddleware, (req, res) => {
  const { id } = req.params;
  const account = accountPool.find(acc => acc.id === id);
  if (!account) return res.status(404).json({ success: false, error: '账号不存在' });
  account.used = 0;
  account.enabled = true;
  saveAccounts();
  res.json({ success: true, message: '已重置使用次数' });
});

// ==================== 订单 API ====================
app.post('/api/generate-order', (req, res) => {
  const ip = getClientIP(req);
  if (!rateLimit(`generate:${ip}`, 10, 60000)) {
    return res.status(429).json({ success: false, error: '请求过于频繁' });
  }
  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, error: '无效邮箱' });
  }
  const orderCode = generateOrderCode();
  res.json({ success: true, orderCode });
});

app.post('/api/order', async (req, res) => {
  const ip = getClientIP(req);
  if (!rateLimit(`order:${ip}`, 3, 60000)) {
    return res.status(429).json({ success: false, message: '提交过于频繁，请稍后再试' });
  }
  const { email, remark, payMethod } = req.body;
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
  }
  if (email.length > 100) {
    return res.status(400).json({ success: false, message: '邮箱地址过长' });
  }
  const availableAccount = getAvailableAccount();
  if (!availableAccount) {
    return res.status(503).json({ success: false, message: '暂无可用名额，请稍后再试' });
  }
  const existingOrder = orderList.find(o => o.email === email && o.status === 'pending');
  if (existingOrder) {
    return res.status(400).json({ success: false, message: '您已有待处理的订单，请等待确认' });
  }
  let finalRemark = (remark || '').trim().substring(0, 50);
  const newOrder = {
    id: generateId(),
    email: email.trim().toLowerCase(),
    remark: finalRemark,
    payMethod: payMethod || 'wechat',
    status: 'pending',
    ip: ip,
    createdAt: new Date().toISOString()
  };
  orderList.unshift(newOrder);
  saveOrders();
  const pendingCount = orderList.filter(o => o.status === 'pending').length;
  sendBarkNotification('新订单待确认', `邮箱: ${email}\n备注: ${finalRemark || '无'}\n待处理: ${pendingCount}单`);
  res.json({ success: true, message: '订单已提交，请等待管理员确认付款' });
});

app.get('/api/admin/orders', authMiddleware, (req, res) => {
  res.json({ success: true, orders: orderList });
});

app.post('/api/admin/orders/:id/confirm', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const order = orderList.find(o => o.id === id);
  if (!order) return res.status(404).json({ success: false, error: '订单不存在' });
  if (order.status !== 'pending') return res.status(400).json({ success: false, error: '订单状态不正确' });
  const account = getAvailableAccount();
  if (!account) return res.status(503).json({ success: false, error: '暂无可用名额' });
  try {
    const result = await sendInvite(order.email, account);
    if (result.success) {
      account.used += 1;
      if (account.used >= account.quota) account.enabled = false;
      saveAccounts();
      order.status = 'confirmed';
      order.confirmedAt = new Date().toISOString();
      order.accountName = account.name;
      saveOrders();
      res.json({ success: true, message: '订单已确认，邀请已发送' });
    } else {
      res.status(500).json({ success: false, error: result.message || '邀请发送失败' });
    }
  } catch (error) {
    console.error('Confirm order error');
    res.status(500).json({ success: false, error: '处理订单时出错' });
  }
});

app.post('/api/admin/orders/:id/reject', authMiddleware, (req, res) => {
  const { id } = req.params;
  const order = orderList.find(o => o.id === id);
  if (!order) return res.status(404).json({ success: false, error: '订单不存在' });
  if (order.status !== 'pending') return res.status(400).json({ success: false, error: '订单状态不正确' });
  order.status = 'rejected';
  order.rejectedAt = new Date().toISOString();
  saveOrders();
  res.json({ success: true, message: '订单已拒绝' });
});

// ==================== 邀请功能 ====================
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
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const responseText = await response.text();
  console.log(`Invite: ${email} -> ${response.status}`);
  if (response.ok) return { success: true, message: '邀请已发送' };
  let errorMessage = '邀请发送失败';
  try {
    const errorData = JSON.parse(responseText);
    if (errorData.detail) errorMessage = errorData.detail;
  } catch {
    if (responseText.includes('blocked') || responseText.includes('Cloudflare')) errorMessage = '请求被拦截';
  }
  return { success: false, message: errorMessage };
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 100;
}

// 查询可用名额 + 统计数据（公开接口）
app.get('/api/quota', (req, res) => {
  const ip = getClientIP(req);
  if (!rateLimit(`quota:${ip}`, 30, 60000)) {
    return res.status(429).json({ success: false, error: '请求过于频繁' });
  }
  const availableQuota = accountPool.reduce((sum, acc) => {
    return sum + (acc.enabled ? Math.max(0, acc.quota - acc.used) : 0);
  }, 0);

  // 已完成订单和最早时间
  const confirmedOrders = orderList.filter(o => o.status === 'confirmed');
  const soldCount = confirmedOrders.length;
  let startTime = null;
  if (confirmedOrders.length > 0) {
    startTime = confirmedOrders.reduce((min, cur) => {
      return new Date(cur.createdAt) < new Date(min) ? cur.createdAt : min;
    }, confirmedOrders[0].createdAt);
  }

  res.json({
    success: true,
    availableQuota,
    soldCount,
    startTime
  });
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 启动服务器
loadAccounts();
loadOrders();
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`✓ Admin: ${ADMIN_USER}`);
  console.log(`✓ Accounts: ${accountPool.length}`);
  console.log(`✓ Orders: ${orderList.length}`);
  console.log(`✓ Bark: ${BARK_KEY ? 'enabled' : 'disabled'}\n`);
});
