// memory-server.mjs — Simple HTTP server for memory panel
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3081;
const MEMORIES_FILE = join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'memory', 'memories.json');

function loadMemories() {
  if (!existsSync(MEMORIES_FILE)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(MEMORIES_FILE, 'utf-8'));
  } catch (err) {
    console.error('Failed to load memories:', err);
    return { entries: [] };
  }
}

function saveMemories(data) {
  try {
    writeFileSync(MEMORIES_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save memories:', err);
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve HTML panel
  if ((url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/panel') && req.method === 'GET') {
    const htmlPath = join(__dirname, 'memory-panel.html');
    if (existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(htmlPath, 'utf-8'));
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // API: List memories
  if (url.pathname === '/api/memories' && req.method === 'GET') {
    const data = loadMemories();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // API: Pin/unpin
  if (url.pathname === '/api/memories/pin' && req.method === 'POST') {
    try {
      const { id, pinned } = await readBody(req);
      const data = loadMemories();
      const entry = data.entries.find(e => e.id === id);
      if (!entry) { res.writeHead(404); res.end('Not found'); return; }
      entry.pinned = pinned;
      entry.updatedAt = new Date().toISOString();
      if (saveMemories(data)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, entry }));
      } else {
        res.writeHead(500); res.end('Save failed');
      }
    } catch (err) {
      res.writeHead(400); res.end(err.message);
    }
    return;
  }

  // API: Delete
  if (url.pathname === '/api/memories/delete' && req.method === 'POST') {
    try {
      const { id } = await readBody(req);
      const data = loadMemories();
      data.entries = data.entries.filter(e => e.id !== id);
      if (saveMemories(data)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(500); res.end('Save failed');
      }
    } catch (err) {
      res.writeHead(400); res.end(err.message);
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🧠 记忆管理面板服务器已启动`);
  console.log(`📍 打开浏览器: http://localhost:${PORT}`);
  console.log(`📂 记忆文件: ${MEMORIES_FILE}\n`);
});
