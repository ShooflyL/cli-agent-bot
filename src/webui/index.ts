/**
 * Web界面模块
 * 提供实时查看会话输出、通讯历史和配置管理的Web界面
 */

import * as http from 'http';
import express from 'express';
import * as WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { createLogger } from '../core/logger';
import { subscribeEvent, EventType } from '../core/events';
import { SessionManager } from '../session/manager';
import { getMessageHistory, CommunicationType } from '../core/message-history';
import { AppConfig } from '../core/types';

const logger = createLogger('web-ui');

/**
 * Web界面配置
 */
export interface WebUIConfig {
  enabled: boolean;
  port: number;
}

/**
 * 移除ANSI转义序列
 */
function stripAnsi(text: string): string {
  if (!text) return '';

  // 使用更健壮的ANSI移除正则
  const ansiRegex = [
    /\x1b\[[0-9;?]*[a-zA-Z]/g,
    /\x1b\][^\x07]*\x07/g,
    /\x1b\][^\x1b]*(?:\x1b\\)?/g,
    /\x1b[()][A-Za-z0-9]/g,
    /\x1b[)[\]A-Za-z]/g,
    /\x1b]8;;[^\x1b]*\x1b\\/g,
    /\x1b\[[\d;]*m/g,
  ];

  let result = text;
  for (const regex of ansiRegex) {
    result = result.replace(regex, '');
  }

  // 移除控制字符（但保留换行、制表符、回车和空格）
  result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  return result;
}

/**
 * Web界面服务器
 */
export class WebUIServer {
  private serverApp: express.Express;
  private server: http.Server | null = null;
  private wss: WebSocket.Server | null = null;
  private port: number;
  private sessionManager: SessionManager;
  private config: AppConfig;
  private configPath: string;
  private application: any = null;

  constructor(port: number, sessionManager: SessionManager, config: AppConfig, configPath: string = 'config.yaml', application?: any) {
    this.port = port;
    this.sessionManager = sessionManager;
    this.config = config;
    this.configPath = configPath;
    this.application = application;
    this.serverApp = express();

    // 解析JSON请求体
    this.serverApp.use(express.json());

    this.setupRoutes();
    this.setupWebSocket();
    this.subscribeToEvents();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 主页
    this.serverApp.get('/', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(this.getHomePage());
    });

    // API: 获取所有会话
    this.serverApp.get('/api/sessions', (req, res) => {
      const sessions = this.sessionManager.getAllSessions().map(session => {
        const info = session.getInfo();
        return {
          name: info.name,
          workDir: info.workDir,
          status: info.status,
          createdAt: info.createdAt,
          lastActiveAt: info.lastActiveAt
        };
      });
      res.json(sessions);
    });

    // API: 获取会话输出
    this.serverApp.get('/api/sessions/:name/output', (req, res) => {
      const session = this.sessionManager.getSession(req.params.name);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const output = session.getBufferedOutput();
      res.json(output);
    });

    // API: 获取所有聊天历史概览
    this.serverApp.get('/api/history', (req, res) => {
      const history = getMessageHistory();
      const overview = history.getAllChatsOverview();
      res.json(overview);
    });

    // API: 获取指定聊天的通讯历史
    this.serverApp.get('/api/history/:chatId', (req, res) => {
      const history = getMessageHistory();
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const records = history.getChatHistory(req.params.chatId, limit);
      // 清理ANSI序列
      const cleanRecords = records.map(r => ({
        ...r,
        content: stripAnsi(r.content)
      }));
      res.json(cleanRecords);
    });

    // API: 获取历史统计
    this.serverApp.get('/api/history/stats', (req, res) => {
      const history = getMessageHistory();
      res.json(history.getStats());
    });

    // API: 清除指定聊天的历史
    this.serverApp.delete('/api/history/:chatId', (req, res) => {
      const history = getMessageHistory();
      const success = history.clearChatHistory(req.params.chatId);
      res.json({ success });
    });

    // API: 获取当前配置
    this.serverApp.get('/api/config', (req, res) => {
      res.json(this.getSafeConfig());
    });

    // API: 更新配置
    this.serverApp.post('/api/config', (req, res) => {
      try {
        const newConfig = req.body;
        this.saveConfig(newConfig);
        res.json({ success: true, message: '配置已保存，部分配置需要重启生效' });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    });

    // API: 重新加载配置（热重载）
    this.serverApp.post('/api/config/reload', async (req, res) => {
      try {
        // 如果有 application 实例，调用其 reloadConfig 方法
        if (this.application && typeof this.application.reloadConfig === 'function') {
          await this.application.reloadConfig();
          // 更新本地 config 引用
          this.config = this.application.config;
          res.json({ success: true, message: '配置已热重载' });
        } else {
          // 否则只重新读取配置文件
          const configContent = fs.readFileSync(this.configPath, 'utf-8');
          const parsed = yaml.parse(configContent);
          res.json({ success: true, config: parsed });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    });
  }

  /**
   * 获取安全的配置（隐藏敏感信息）
   */
  private getSafeConfig(): any {
    const feishuConfig = (this.config.im?.feishu as any) || {};
    const cliConfig = (this.config.cli as any) || {};
    return {
      im: {
        default: this.config.im?.default || 'feishu',
        feishu: {
          appId: feishuConfig.appId || '',
          appSecret: feishuConfig.appSecret || '',
          encryptKey: feishuConfig.encryptKey || '',
          verificationToken: feishuConfig.verificationToken || '',
          mode: feishuConfig.mode || 'longpoll',
          webhookPort: feishuConfig.webhookPort || 3000
        }
      },
      cli: {
        default: cliConfig.default || 'claude',
        defaultWorkdir: cliConfig.defaultWorkdir || '',
        claude: {
          executable: cliConfig.claude?.executable || 'claude'
        },
        opencode: {
          executable: cliConfig.opencode?.executable || 'opencode'
        },
        env: cliConfig.env || {},
        skipPermissions: cliConfig.skipPermissions ?? false,
        messageFilters: cliConfig.messageFilters || []
      },
      security: {
        mode: this.config.security.mode,
        userWhitelist: this.config.security.userWhitelist,
        chatWhitelist: this.config.security.chatWhitelist
      },
      logging: {
        level: this.config.logging.level,
        file: this.config.logging.file,
        console: this.config.logging.console
      },
      session: {
        maxSessions: this.config.session.maxSessions,
        bufferSize: this.config.session.bufferSize,
        pollInterval: this.config.session.pollInterval,
        messageFilter: this.config.session.messageFilter || { enabled: true, minLength: 5 }
      },
      webUI: this.config.webUI
    };
  }

  /**
   * 保存配置到文件
   */
  private saveConfig(newConfig: any): void {
    // 读取当前配置
    let currentConfig: any = {};
    if (fs.existsSync(this.configPath)) {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      currentConfig = yaml.parse(content) || {};
    }

    // 深度合并配置
    const mergedConfig = this.deepMerge(currentConfig, newConfig);

    // 写入配置文件（字符串值使用双引号）
    const yamlContent = yaml.stringify(mergedConfig, { defaultStringType: 'QUOTE_DOUBLE' });
    fs.writeFileSync(this.configPath, yamlContent, 'utf-8');

    logger.info('Configuration saved to ' + this.configPath);
  }

  /**
   * 深度合并对象
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else if (source[key] !== undefined) {
        result[key] = source[key];
      }
    }
    return result;
  }

  /**
   * 设置WebSocket
   */
  private setupWebSocket(): void {
    this.wss = new WebSocket.Server({ noServer: true });

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('WebSocket client connected');

      // 发送当前所有会话状态
      const sessions = this.sessionManager.getAllSessions();
      ws.send(JSON.stringify({
        type: 'init',
        data: sessions.map(s => s.getInfo())
      }));

      // 发送聊天历史概览
      const history = getMessageHistory();
      ws.send(JSON.stringify({
        type: 'history_overview',
        data: history.getAllChatsOverview()
      }));

      ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error}`);
      });
    });
  }

  /**
   * 订阅事件
   */
  private subscribeToEvents(): void {
    // 订阅输出事件
    subscribeEvent(EventType.OUTPUT_RECEIVED, (payload) => {
      this.broadcast({
        type: 'output',
        data: payload.data
      });
    });

    // 订阅会话创建事件
    subscribeEvent(EventType.SESSION_CREATED, (payload) => {
      this.broadcast({
        type: 'session_created',
        data: payload.data
      });
    });

    // 订阅会话关闭事件
    subscribeEvent(EventType.SESSION_CLOSED, (payload) => {
      this.broadcast({
        type: 'session_closed',
        data: payload.data
      });
    });
  }

  /**
   * 广播消息到所有客户端
   */
  private broadcast(message: any): void {
    if (!this.wss) return;

    const data = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.serverApp.listen(this.port, (err?: Error) => {
        if (err) {
          logger.error(`Failed to start Web UI server: ${err}`);
          reject(err);
        } else {
          logger.info(`Web UI server listening on port ${this.port}`);
          logger.info(`Open http://localhost:${this.port} in your browser`);
          resolve();
        }
      });

      // 升级HTTP服务器以支持WebSocket
      this.server!.on('upgrade', (request, socket, head) => {
        if (request.url === '/ws') {
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          logger.info('WebSocket server closed');
        });
      }

      if (this.server) {
        this.server.close(() => {
          logger.info('Web UI server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取主页HTML
   */
  private getHomePage(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CLI Code Bot - 控制面板</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #1a1a2e;
            color: #eee;
            height: 100vh;
            overflow: hidden;
        }

        .app-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        /* 顶部导航栏 */
        .navbar {
            background: linear-gradient(135deg, #16213e 0%, #0f3460 100%);
            border-bottom: 1px solid #0f3460;
            padding: 0 20px;
            display: flex;
            align-items: center;
            height: 50px;
            flex-shrink: 0;
        }

        .navbar-brand {
            font-size: 18px;
            font-weight: bold;
            color: #00d9ff;
            margin-right: 30px;
        }

        .navbar-tabs {
            display: flex;
            gap: 5px;
        }

        .nav-tab {
            padding: 10px 20px;
            background: transparent;
            border: none;
            color: #8892b0;
            cursor: pointer;
            font-size: 14px;
            border-radius: 4px 4px 0 0;
            transition: all 0.2s;
        }

        .nav-tab:hover {
            color: #ccd6f6;
            background: rgba(255,255,255,0.05);
        }

        .nav-tab.active {
            color: #00d9ff;
            background: #1a1a2e;
            border-bottom: 2px solid #00d9ff;
        }

        .connection-status {
            margin-left: auto;
            padding: 5px 12px;
            border-radius: 12px;
            font-size: 12px;
        }

        .connection-status.connected {
            background: #0f3460;
            color: #00d9ff;
        }

        .connection-status.disconnected {
            background: #5a1d1d;
            color: #f48771;
        }

        /* 主内容区 */
        .main-content {
            flex: 1;
            display: none;
            overflow: hidden;
        }

        .main-content.active {
            display: flex;
        }

        /* 会话监控页面 */
        .sessions-page {
            display: flex;
            width: 100%;
            height: 100%;
        }

        .sidebar {
            width: 280px;
            background: #16213e;
            border-right: 1px solid #0f3460;
            display: flex;
            flex-direction: column;
        }

        .sidebar-header {
            padding: 15px 20px;
            border-bottom: 1px solid #0f3460;
            font-size: 14px;
            font-weight: bold;
            color: #8892b0;
            text-transform: uppercase;
        }

        .session-list {
            flex: 1;
            overflow-y: auto;
        }

        .session-item {
            padding: 12px 20px;
            border-bottom: 1px solid #0f3460;
            cursor: pointer;
            transition: background 0.2s;
        }

        .session-item:hover {
            background: #0f3460;
        }

        .session-item.active {
            background: #0f3460;
            border-left: 3px solid #00d9ff;
        }

        .session-name {
            font-weight: bold;
            margin-bottom: 5px;
            font-size: 14px;
        }

        .session-status {
            font-size: 12px;
            color: #8892b0;
        }

        .session-status.idle { color: #64ffda; }
        .session-status.processing { color: #ffd93d; }
        .session-status.waiting_confirm { color: #ff9f43; }
        .session-status.error { color: #ff6b6b; }

        .session-output {
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .toolbar {
            padding: 12px 20px;
            background: #16213e;
            border-bottom: 1px solid #0f3460;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .toolbar-title {
            font-size: 14px;
            font-weight: bold;
        }

        .toolbar-actions {
            display: flex;
            gap: 10px;
        }

        .btn {
            padding: 6px 14px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
        }

        .btn:hover {
            opacity: 0.8;
            transform: translateY(-1px);
        }

        .btn-primary {
            background: linear-gradient(135deg, #00d9ff 0%, #0099cc 100%);
            color: #1a1a2e;
        }

        .btn-secondary {
            background: #0f3460;
            color: #ccd6f6;
        }

        .btn-danger {
            background: #e74c3c;
            color: white;
        }

        .output-container {
            flex: 1;
            overflow-y: auto;
            padding: 15px 20px;
            background: #1a1a2e;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.6;
        }

        .output-line {
            white-space: pre-wrap;
            word-wrap: break-word;
            margin-bottom: 4px;
            padding: 4px 8px;
            border-radius: 4px;
        }

        .output-line.normal { color: #ccd6f6; }
        .output-line.error { color: #ff6b6b; background: rgba(255,107,107,0.1); }
        .output-line.warning { color: #ffd93d; }
        .output-line.system { color: #64ffda; }

        .no-content {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #8892b0;
            font-size: 14px;
        }

        /* 通讯历史页面 */
        .history-page {
            display: flex;
            width: 100%;
            height: 100%;
        }

        .chat-list {
            width: 300px;
            background: #16213e;
            border-right: 1px solid #0f3460;
            display: flex;
            flex-direction: column;
        }

        .chat-item {
            padding: 12px 20px;
            border-bottom: 1px solid #0f3460;
            cursor: pointer;
            transition: background 0.2s;
        }

        .chat-item:hover {
            background: #0f3460;
        }

        .chat-item.active {
            background: #0f3460;
            border-left: 3px solid #00d9ff;
        }

        .chat-id {
            font-size: 13px;
            font-weight: bold;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .chat-meta {
            font-size: 11px;
            color: #8892b0;
            display: flex;
            justify-content: space-between;
        }

        .chat-preview {
            font-size: 12px;
            color: #8892b0;
            margin-top: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .message-list {
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #1a1a2e;
        }

        .message-item {
            margin-bottom: 20px;
            max-width: 85%;
            clear: both;
        }

        .message-item.user {
            float: right;
        }

        .message-item.claude {
            float: left;
        }

        .message-item.system {
            float: none;
            max-width: 100%;
            text-align: center;
            margin: 20px auto;
        }

        .message-bubble {
            padding: 12px 16px;
            border-radius: 16px;
            position: relative;
        }

        .message-item.user .message-bubble {
            background: linear-gradient(135deg, #0f3460 0%, #16213e 100%);
            border-bottom-right-radius: 4px;
        }

        .message-item.claude .message-bubble {
            background: linear-gradient(135deg, #1e3a5f 0%, #16213e 100%);
            border-bottom-left-radius: 4px;
        }

        .message-item.system .message-bubble {
            background: #0f3460;
            font-size: 12px;
            color: #8892b0;
            display: inline-block;
        }

        .message-header {
            font-size: 11px;
            color: #8892b0;
            margin-bottom: 6px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .message-sender {
            font-weight: bold;
            color: #00d9ff;
        }

        .message-content {
            font-size: 13px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            color: #ccd6f6;
        }

        .message-time {
            font-size: 10px;
            color: #64748b;
            margin-top: 6px;
            text-align: right;
        }

        .message-divider {
            clear: both;
            height: 1px;
            background: #0f3460;
            margin: 10px 0;
        }

        /* 配置页面 */
        .config-page {
            padding: 20px;
            overflow-y: auto;
            height: 100%;
        }

        .config-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            max-width: 1400px;
            margin: 0 auto;
        }

        .config-section {
            background: #16213e;
            border-radius: 8px;
            margin-bottom: 0;
            overflow: hidden;
            border: 1px solid #0f3460;
            align-self: start;
        }

        .config-section-header {
            background: #0f3460;
            padding: 15px 20px;
            font-weight: bold;
            font-size: 15px;
            color: #00d9ff;
        }

        .config-section-content {
            padding: 20px;
        }

        .config-row {
            display: flex;
            align-items: flex-start;
            margin-bottom: 15px;
        }

        .config-row:last-child {
            margin-bottom: 0;
        }

        .config-label {
            width: 180px;
            font-size: 13px;
            color: #8892b0;
            flex-shrink: 0;
            padding-top: 8px;
        }

        .config-input {
            flex: 1;
        }

        .config-input input,
        .config-input select,
        .config-input textarea {
            width: 100%;
            padding: 8px 12px;
            background: #1a1a2e;
            border: 1px solid #0f3460;
            border-radius: 4px;
            color: #ccd6f6;
            font-size: 13px;
        }

        .config-input input:focus,
        .config-input select:focus,
        .config-input textarea:focus {
            outline: none;
            border-color: #00d9ff;
        }

        .config-input textarea {
            min-height: 80px;
            resize: vertical;
            font-family: 'Consolas', monospace;
        }

        .config-input input[type="checkbox"] {
            width: auto;
            transform: scale(1.2);
        }

        .config-input input[type="number"] {
            width: 120px;
        }

        .config-hint {
            font-size: 11px;
            color: #64748b;
            margin-top: 4px;
        }

        @media (max-width: 960px) {
            .config-container {
                grid-template-columns: 1fr;
            }
        }

        .config-actions {
            display: flex;
            gap: 10px;
            padding: 20px;
            background: #16213e;
            border-radius: 8px;
            position: sticky;
            bottom: 20px;
            border: 1px solid #0f3460;
            grid-column: 1 / -1;
        }

        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: #0f3460;
            color: #00d9ff;
            border-radius: 8px;
            font-size: 13px;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s;
            z-index: 1000;
            border: 1px solid #00d9ff;
        }

        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }

        .toast.error {
            background: #5a1d1d;
            color: #ff6b6b;
            border-color: #ff6b6b;
        }

        /* 统计卡片 */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 0;
            grid-column: 1 / -1;
        }

        .stat-card {
            background: #16213e;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            border: 1px solid #0f3460;
        }

        .stat-value {
            font-size: 32px;
            font-weight: bold;
            color: #00d9ff;
        }

        .stat-label {
            font-size: 12px;
            color: #8892b0;
            margin-top: 8px;
        }

        /* 滚动条样式 */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        ::-webkit-scrollbar-track {
            background: #1a1a2e;
        }

        ::-webkit-scrollbar-thumb {
            background: #0f3460;
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #16213e;
        }
    </style>
</head>
<body>
    <div class="app-container">
        <!-- 顶部导航栏 -->
        <nav class="navbar">
            <div class="navbar-brand">CLI Code Bot</div>
            <div class="navbar-tabs">
                <button class="nav-tab active" onclick="switchTab('sessions', this)">会话监控</button>
                <button class="nav-tab" onclick="switchTab('history', this)">通讯历史</button>
                <button class="nav-tab" onclick="switchTab('config', this)">系统配置</button>
            </div>
            <div class="connection-status" id="connectionStatus">未连接</div>
        </nav>

        <!-- 会话监控页面 -->
        <div class="main-content active" id="sessions-tab">
            <div class="sessions-page">
                <div class="sidebar">
                    <div class="sidebar-header">会话列表</div>
                    <div class="session-list" id="sessionList"></div>
                </div>
                <div class="session-output">
                    <div class="toolbar">
                        <div class="toolbar-title" id="toolbarTitle">请选择会话</div>
                        <div class="toolbar-actions">
                            <button class="btn btn-secondary" onclick="clearOutput()">清空输出</button>
                            <button class="btn btn-primary" onclick="scrollToBottom()">滚动到底部</button>
                        </div>
                    </div>
                    <div class="output-container" id="outputContainer">
                        <div class="no-content">请从左侧选择一个会话查看输出</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 通讯历史页面 -->
        <div class="main-content" id="history-tab">
            <div class="history-page">
                <div class="chat-list">
                    <div class="sidebar-header">聊天列表</div>
                    <div class="session-list" id="chatList"></div>
                </div>
                <div class="message-list">
                    <div class="toolbar">
                        <div class="toolbar-title" id="chatTitle">请选择聊天</div>
                        <div class="toolbar-actions">
                            <button class="btn btn-danger" onclick="clearChatHistory()">清空历史</button>
                        </div>
                    </div>
                    <div class="messages-container" id="messagesContainer">
                        <div class="no-content">请从左侧选择一个聊天查看通讯历史</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 系统配置页面 -->
        <div class="main-content" id="config-tab">
            <div class="config-page">
                <div class="config-container">
                    <!-- 统计信息 -->
                    <div class="stats-grid" id="statsGrid">
                        <div class="stat-card">
                            <div class="stat-value" id="statSessions">0</div>
                            <div class="stat-label">活跃会话</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" id="statChats">0</div>
                            <div class="stat-label">聊天数量</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value" id="statMessages">0</div>
                            <div class="stat-label">消息记录</div>
                        </div>
                    </div>

                    <!-- IM 适配器配置 -->
                    <div class="config-section">
                        <div class="config-section-header">IM 适配器配置</div>
                        <div class="config-section-content">
                            <div class="config-row">
                                <label class="config-label">默认 IM 应用</label>
                                <div class="config-input">
                                    <select id="im-default">
                                        <option value="feishu">飞书</option>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="slack">Slack</option>
                                        <option value="telegram">Telegram</option>
                                    </select>
                                    <div class="config-hint">选择默认使用的即时通讯应用</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">App ID</label>
                                <div class="config-input">
                                    <input type="text" id="feishu-appId" placeholder="cli_xxxxxxxxxxxx">
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">App Secret</label>
                                <div class="config-input">
                                    <input type="password" id="feishu-appSecret" placeholder="应用密钥">
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">Encrypt Key</label>
                                <div class="config-input">
                                    <input type="password" id="feishu-encryptKey" placeholder="加密密钥（可选）">
                                    <div class="config-hint">用于事件回调的加密验证</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">Verification Token</label>
                                <div class="config-input">
                                    <input type="password" id="feishu-verificationToken" placeholder="验证令牌（可选）">
                                    <div class="config-hint">用于验证请求来源</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">连接模式</label>
                                <div class="config-input">
                                    <select id="feishu-mode">
                                        <option value="longpoll">长连接 (推荐)</option>
                                        <option value="webhook">Webhook</option>
                                    </select>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">Webhook 端口</label>
                                <div class="config-input">
                                    <input type="number" id="feishu-webhookPort" value="3000">
                                    <div class="config-hint">仅在 Webhook 模式下使用</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- CLI 工具配置 -->
                    <div class="config-section">
                        <div class="config-section-header">CLI 工具配置</div>
                        <div class="config-section-content">
                            <div class="config-row">
                                <label class="config-label">默认 CLI 工具</label>
                                <div class="config-input">
                                    <select id="cli-default">
                                        <option value="claude">Claude Code</option>
                                        <option value="opencode">OpenCode</option>
                                    </select>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">默认工作目录</label>
                                <div class="config-input">
                                    <input type="text" id="cli-defaultWorkdir" placeholder="D:\\Projects">
                                    <div class="config-hint">会话工作目录限制在此路径内，防止 AI 越权操作</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">Claude 可执行文件</label>
                                <div class="config-input">
                                    <input type="text" id="claude-executable" placeholder="claude">
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">OpenCode 可执行文件</label>
                                <div class="config-input">
                                    <input type="text" id="opencode-executable" placeholder="opencode">
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">跳过权限确认</label>
                                <div class="config-input">
                                    <select id="cli-skipPermissions">
                                        <option value="false">否</option>
                                        <option value="true">是</option>
                                    </select>
                                    <div class="config-hint">推荐在受信任的环境中启用</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">消息过滤</label>
                                <div class="config-input">
                                    <textarea id="cli-messageFilters" placeholder="每行一个过滤规则"></textarea>
                                    <div class="config-hint">以这些字符串开头的消息不会推送到 IM</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 安全配置 -->
                    <div class="config-section">
                        <div class="config-section-header">安全配置</div>
                        <div class="config-section-content">
                            <div class="config-row">
                                <label class="config-label">白名单模式</label>
                                <div class="config-input">
                                    <select id="security-mode">
                                        <option value="none">无限制</option>
                                        <option value="user">用户白名单</option>
                                        <option value="chat">群聊白名单</option>
                                        <option value="both">双重白名单</option>
                                    </select>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">用户白名单</label>
                                <div class="config-input">
                                    <textarea id="security-userWhitelist" placeholder="每行一个用户ID"></textarea>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">群聊白名单</label>
                                <div class="config-input">
                                    <textarea id="security-chatWhitelist" placeholder="每行一个群聊ID"></textarea>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 会话配置 -->
                    <div class="config-section">
                        <div class="config-section-header">会话配置</div>
                        <div class="config-section-content">
                            <div class="config-row">
                                <label class="config-label">最大会话数</label>
                                <div class="config-input">
                                    <input type="number" id="session-maxSessions" min="1" max="100">
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">缓冲区大小</label>
                                <div class="config-input">
                                    <input type="number" id="session-bufferSize" min="1024">
                                    <div class="config-hint">字节数，建议 65536</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">轮询间隔</label>
                                <div class="config-input">
                                    <input type="number" id="session-pollInterval" min="100">
                                    <div class="config-hint">毫秒，建议 500</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">启用消息过滤</label>
                                <div class="config-input">
                                    <select id="session-messageFilter-enabled">
                                        <option value="true">启用</option>
                                        <option value="false">禁用</option>
                                    </select>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">过滤最小长度</label>
                                <div class="config-input">
                                    <input type="number" id="session-messageFilter-minLength" min="1" max="50">
                                    <div class="config-hint">去掉空格后的字符数，建议 5</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- WebUI 配置 -->
                    <div class="config-section">
                        <div class="config-section-header">WebUI 配置</div>
                        <div class="config-section-content">
                            <div class="config-row">
                                <label class="config-label">启用 WebUI</label>
                                <div class="config-input">
                                    <select id="webui-enabled">
                                        <option value="true">启用</option>
                                        <option value="false">禁用</option>
                                    </select>
                                    <div class="config-hint">修改后需要重启生效</div>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">端口</label>
                                <div class="config-input">
                                    <input type="number" id="webui-port" min="1024" max="65535">
                                    <div class="config-hint">WebUI 监听端口，修改后需要重启生效</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 日志配置 -->
                    <div class="config-section">
                        <div class="config-section-header">日志配置</div>
                        <div class="config-section-content">
                            <div class="config-row">
                                <label class="config-label">日志级别</label>
                                <div class="config-input">
                                    <select id="logging-level">
                                        <option value="debug">Debug</option>
                                        <option value="info">Info</option>
                                        <option value="warn">Warn</option>
                                        <option value="error">Error</option>
                                    </select>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">输出到控制台</label>
                                <div class="config-input">
                                    <input type="checkbox" id="logging-console" checked>
                                </div>
                            </div>
                            <div class="config-row">
                                <label class="config-label">日志文件路径</label>
                                <div class="config-input">
                                    <input type="text" id="logging-file" placeholder="留空则不写入文件">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 操作按钮 -->
                    <div class="config-actions">
                        <button class="btn btn-primary" onclick="saveConfig()">保存配置</button>
                        <button class="btn btn-secondary" onclick="reloadConfig()">重新加载</button>
                        <button class="btn btn-secondary" onclick="loadConfig()">刷新显示</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="toast" id="toast"></div>

    <script>
        // ============ 全局状态 ============
        let ws = null;
        let currentTab = 'sessions';
        let currentSession = null;
        let currentChat = null;
        let sessions = {};
        let outputs = {};
        let chatHistories = {};
        let config = {};

        // ============ ANSI转义序列清理 ============
        function stripAnsi(text) {
            if (!text) return '';

            // 使用更健壮的ANSI移除正则
            const ansiPatterns = [
                /\\x1b\\[[0-9;?]*[a-zA-Z]/g,
                /\\x1b\\][^\\x07]*\\x07/g,
                /\\x1b[()][A-Za-z0-9]/g,
                /\\x1b\\[[\\d;]*m/g
            ];

            let result = text;
            for (const pattern of ansiPatterns) {
                result = result.replace(pattern, '');
            }

            return result;
        }

        // ============ 标签页切换 ============
        function switchTab(tab, element) {
            currentTab = tab;

            // 更新标签按钮状态
            document.querySelectorAll('.nav-tab').forEach(btn => {
                btn.classList.remove('active');
            });
            element.classList.add('active');

            // 更新内容显示
            document.querySelectorAll('.main-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tab + '-tab').classList.add('active');

            // 根据标签页加载数据
            if (tab === 'history') {
                loadChatList();
            } else if (tab === 'config') {
                loadConfig();
                loadStats();
            }
        }

        // ============ WebSocket 连接 ============
        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host + '/ws');

            ws.onopen = () => {
                document.getElementById('connectionStatus').textContent = '已连接';
                document.getElementById('connectionStatus').className = 'connection-status connected';
            };

            ws.onclose = () => {
                document.getElementById('connectionStatus').textContent = '未连接';
                document.getElementById('connectionStatus').className = 'connection-status disconnected';
                setTimeout(connect, 3000);
            };

            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                handleMessage(message);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        function handleMessage(message) {
            switch (message.type) {
                case 'init':
                    message.data.forEach(session => {
                        sessions[session.name] = session;
                    });
                    updateSessionList();
                    break;

                case 'session_created':
                    sessions[message.data.name] = message.data;
                    updateSessionList();
                    break;

                case 'session_closed':
                    delete sessions[message.data.name];
                    updateSessionList();
                    break;

                case 'output':
                    handleOutput(message.data);
                    break;

                case 'history_overview':
                    chatHistories = {};
                    message.data.forEach(chat => {
                        chatHistories[chat.chatId] = chat;
                    });
                    if (currentTab === 'history') {
                        updateChatList();
                    }
                    break;
            }
        }

        // ============ 会话监控 ============
        function handleOutput(data) {
            const { session, block } = data;

            if (!outputs[session]) {
                outputs[session] = [];
            }

            outputs[session].push(block);

            if (outputs[session].length > 1000) {
                outputs[session] = outputs[session].slice(-1000);
            }

            if (currentSession === session) {
                appendOutput(block);
            }
        }

        function updateSessionList() {
            const listElement = document.getElementById('sessionList');
            listElement.innerHTML = '';

            if (Object.keys(sessions).length === 0) {
                listElement.innerHTML = '<div class="no-content" style="padding: 20px; text-align: center;">暂无会话</div>';
                return;
            }

            Object.values(sessions).forEach((session) => {
                const item = document.createElement('div');
                item.className = 'session-item' + (currentSession === session.name ? ' active' : '');
                item.innerHTML = \`
                    <div class="session-name">\${escapeHtml(session.name)}</div>
                    <div class="session-status \${session.status}">● \${getStatusText(session.status)}</div>
                \`;
                item.onclick = () => selectSession(session.name);
                listElement.appendChild(item);
            });

            document.getElementById('statSessions').textContent = Object.keys(sessions).length;
        }

        function getStatusText(status) {
            const statusMap = {
                'idle': '空闲',
                'processing': '处理中',
                'waiting_confirm': '等待确认',
                'error': '错误'
            };
            return statusMap[status] || status;
        }

        function selectSession(name) {
            currentSession = name;
            updateSessionList();

            const session = sessions[name];
            document.getElementById('toolbarTitle').textContent = \`\${name} - \${session.workDir}\`;

            const container = document.getElementById('outputContainer');
            container.innerHTML = '';

            if (outputs[name] && outputs[name].length > 0) {
                outputs[name].forEach(block => appendOutput(block));
            } else {
                container.innerHTML = '<div class="no-content">暂无输出</div>';
            }

            scrollToBottom();
        }

        function appendOutput(block) {
            const container = document.getElementById('outputContainer');

            const noContent = container.querySelector('.no-content');
            if (noContent) {
                noContent.remove();
            }

            const line = document.createElement('div');
            line.className = 'output-line ' + (block.type || 'normal');

            // 清理ANSI序列
            let content = stripAnsi(block.content || '');

            line.textContent = content;
            container.appendChild(line);

            const shouldScroll = container.scrollHeight - container.scrollTop < container.clientHeight + 100;
            if (shouldScroll) {
                scrollToBottom();
            }
        }

        function clearOutput() {
            if (currentSession) {
                outputs[currentSession] = [];
                document.getElementById('outputContainer').innerHTML = '<div class="no-content">输出已清空</div>';
            }
        }

        function scrollToBottom() {
            const container = document.getElementById('outputContainer');
            container.scrollTop = container.scrollHeight;
        }

        // ============ 通讯历史 ============
        async function loadChatList() {
            try {
                const response = await fetch('/api/history');
                const chats = await response.json();
                chatHistories = {};
                chats.forEach(chat => {
                    chatHistories[chat.chatId] = chat;
                });
                updateChatList();
            } catch (error) {
                console.error('Failed to load chat list:', error);
            }
        }

        function updateChatList() {
            const listElement = document.getElementById('chatList');
            listElement.innerHTML = '';

            const chats = Object.values(chatHistories);

            if (chats.length === 0) {
                listElement.innerHTML = '<div class="no-content" style="padding: 20px; text-align: center;">暂无聊天记录</div>';
                return;
            }

            chats.forEach((chat) => {
                const item = document.createElement('div');
                item.className = 'chat-item' + (currentChat === chat.chatId ? ' active' : '');

                const lastMsg = chat.lastMessage;
                const preview = lastMsg ? stripAnsi(lastMsg.content).substring(0, 50) : '';

                item.innerHTML = \`
                    <div class="chat-id">\${escapeHtml(chat.chatId)}</div>
                    <div class="chat-meta">
                        <span>\${chat.recordCount} 条记录</span>
                        <span>\${formatTime(chat.lastUpdated)}</span>
                    </div>
                    <div class="chat-preview">\${escapeHtml(preview)}</div>
                \`;
                item.onclick = () => selectChat(chat.chatId);
                listElement.appendChild(item);
            });

            document.getElementById('statChats').textContent = chats.length;
        }

        async function selectChat(chatId) {
            currentChat = chatId;
            updateChatList();

            document.getElementById('chatTitle').textContent = chatId;

            try {
                const response = await fetch(\`/api/history/\${encodeURIComponent(chatId)}?limit=200\`);
                const records = await response.json();

                const container = document.getElementById('messagesContainer');
                container.innerHTML = '';

                if (records.length === 0) {
                    container.innerHTML = '<div class="no-content">暂无通讯记录</div>';
                    return;
                }

                records.forEach((record, index) => {
                    appendMessage(record, index > 0);
                });

                container.scrollTop = container.scrollHeight;
            } catch (error) {
                console.error('Failed to load chat history:', error);
            }
        }

        function appendMessage(record, showDivider) {
            const container = document.getElementById('messagesContainer');

            const noContent = container.querySelector('.no-content');
            if (noContent) {
                noContent.remove();
            }

            // 添加分隔线
            if (showDivider) {
                const divider = document.createElement('div');
                divider.className = 'message-divider';
                container.appendChild(divider);
            }

            const item = document.createElement('div');

            let typeClass = 'system';
            let sender = '系统';

            if (record.type === 'user_message') {
                typeClass = 'user';
                sender = '用户';
            } else if (record.type === 'claude_output') {
                typeClass = 'claude';
                sender = record.sessionName || 'Claude';
            }

            item.className = \`message-item \${typeClass}\`;

            const content = stripAnsi(record.content || '');

            item.innerHTML = \`
                <div class="message-bubble">
                    <div class="message-header">
                        <span class="message-sender">\${escapeHtml(sender)}</span>
                    </div>
                    <div class="message-content">\${escapeHtml(content)}</div>
                    <div class="message-time">\${formatTime(record.timestamp)}</div>
                </div>
            \`;
            container.appendChild(item);
        }

        async function clearChatHistory() {
            if (!currentChat) return;

            if (!confirm('确定要清空此聊天的历史记录吗？')) return;

            try {
                await fetch(\`/api/history/\${encodeURIComponent(currentChat)}\`, { method: 'DELETE' });
                showToast('历史记录已清空');
                loadChatList();
                document.getElementById('messagesContainer').innerHTML = '<div class="no-content">暂无通讯记录</div>';
            } catch (error) {
                showToast('清空失败: ' + error, true);
            }
        }

        // ============ 配置管理 ============

        function parseTextareaArray(id) {
            return document.getElementById(id).value.split(String.fromCharCode(10)).filter(function(s) { return s.trim(); });
        }
        async function loadConfig() {
            try {
                const response = await fetch('/api/config');
                config = await response.json();

                // 填充表单 - IM 配置
                const feishuConfig = config.im?.feishu || {};
                document.getElementById('im-default').value = config.im?.default || 'feishu';
                document.getElementById('feishu-appId').value = feishuConfig.appId || '';
                document.getElementById('feishu-appSecret').value = feishuConfig.appSecret || '';
                document.getElementById('feishu-encryptKey').value = feishuConfig.encryptKey || '';
                document.getElementById('feishu-verificationToken').value = feishuConfig.verificationToken || '';
                document.getElementById('feishu-mode').value = feishuConfig.mode || 'longpoll';
                document.getElementById('feishu-webhookPort').value = feishuConfig.webhookPort || 3000;

                // CLI 配置
                const cliConfig = config.cli || {};
                document.getElementById('cli-default').value = cliConfig.default || 'claude';
                document.getElementById('cli-defaultWorkdir').value = cliConfig.defaultWorkdir || '';
                document.getElementById('claude-executable').value = cliConfig.claude?.executable || '';
                document.getElementById('opencode-executable').value = cliConfig.opencode?.executable || '';
                document.getElementById('cli-skipPermissions').value = String(cliConfig.skipPermissions ?? false);
                document.getElementById('cli-messageFilters').value = (cliConfig.messageFilters || []).join(String.fromCharCode(10));

                // 安全配置
                document.getElementById('security-mode').value = config.security?.mode || 'none';
                document.getElementById('security-userWhitelist').value = (config.security?.userWhitelist || []).join(String.fromCharCode(10));
                document.getElementById('security-chatWhitelist').value = (config.security?.chatWhitelist || []).join(String.fromCharCode(10));

                // 会话配置
                document.getElementById('session-maxSessions').value = config.session?.maxSessions || 10;
                document.getElementById('session-bufferSize').value = config.session?.bufferSize || 65536;
                document.getElementById('session-pollInterval').value = config.session?.pollInterval || 500;
                document.getElementById('session-messageFilter-enabled').value = String(config.session?.messageFilter?.enabled ?? true);
                document.getElementById('session-messageFilter-minLength').value = config.session?.messageFilter?.minLength || 5;

                // WebUI 配置
                document.getElementById('webui-enabled').value = String(config.webUI?.enabled ?? false);
                document.getElementById('webui-port').value = config.webUI?.port || 9998;

                // 日志配置
                document.getElementById('logging-level').value = config.logging?.level || 'info';
                document.getElementById('logging-console').checked = config.logging?.console !== false;
                document.getElementById('logging-file').value = config.logging?.file || '';

            } catch (error) {
                console.error('Failed to load config:', error);
                showToast('加载配置失败', true);
            }
        }

        async function saveConfig() {
            const feishuConfig = {
                appId: document.getElementById('feishu-appId').value,
                appSecret: document.getElementById('feishu-appSecret').value,
                encryptKey: document.getElementById('feishu-encryptKey').value,
                verificationToken: document.getElementById('feishu-verificationToken').value,
                mode: document.getElementById('feishu-mode').value,
                webhookPort: parseInt(document.getElementById('feishu-webhookPort').value, 10)
            };

            const cliFilters = parseTextareaArray('cli-messageFilters');

            const cliObj = {
                default: document.getElementById('cli-default').value,
                defaultWorkdir: document.getElementById('cli-defaultWorkdir').value || undefined,
                claude: { executable: document.getElementById('claude-executable').value },
                opencode: { executable: document.getElementById('opencode-executable').value },
                skipPermissions: document.getElementById('cli-skipPermissions').value === 'true'
            };
            if (cliFilters.length) cliObj.messageFilters = cliFilters;

            const newConfig = {
                im: {
                    default: document.getElementById('im-default').value,
                    feishu: feishuConfig
                },
                cli: cliObj,
                security: {
                    mode: document.getElementById('security-mode').value,
                    userWhitelist: parseTextareaArray('security-userWhitelist'),
                    chatWhitelist: parseTextareaArray('security-chatWhitelist')
                },
                session: {
                    maxSessions: parseInt(document.getElementById('session-maxSessions').value, 10),
                    bufferSize: parseInt(document.getElementById('session-bufferSize').value, 10),
                    pollInterval: parseInt(document.getElementById('session-pollInterval').value, 10),
                    messageFilter: {
                        enabled: document.getElementById('session-messageFilter-enabled').value === 'true',
                        minLength: parseInt(document.getElementById('session-messageFilter-minLength').value, 10)
                    }
                },
                logging: {
                    level: document.getElementById('logging-level').value,
                    console: document.getElementById('logging-console').checked,
                    file: document.getElementById('logging-file').value || undefined
                },
                webUI: {
                    enabled: document.getElementById('webui-enabled').value === 'true',
                    port: parseInt(document.getElementById('webui-port').value, 10)
                }
            };

            try {
                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newConfig)
                });

                const result = await response.json();
                if (result.success) {
                    showToast(result.message || '配置已保存');
                    // 自动热重载配置
                    try {
                        const reloadResponse = await fetch('/api/config/reload', { method: 'POST' });
                        const reloadResult = await reloadResponse.json();
                        if (reloadResult.success) {
                            showToast('配置已热重载');
                        }
                    } catch (e) {
                        console.error('Failed to reload config:', e);
                    }
                } else {
                    showToast(result.error || '保存失败', true);
                }
            } catch (error) {
                showToast('保存配置失败: ' + error, true);
            }
        }

        async function reloadConfig() {
            try {
                const response = await fetch('/api/config/reload', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    config = result.config;
                    showToast('配置已重新加载');
                    loadConfig();
                } else {
                    showToast(result.error || '重新加载失败', true);
                }
            } catch (error) {
                showToast('重新加载失败: ' + error, true);
            }
        }

        async function loadStats() {
            try {
                const historyResponse = await fetch('/api/history/stats');
                const historyStats = await historyResponse.json();
                document.getElementById('statChats').textContent = historyStats.totalChats;
                document.getElementById('statMessages').textContent = historyStats.totalRecords;
            } catch (error) {
                console.error('Failed to load stats:', error);
            }
        }

        // ============ 工具函数 ============
        function formatTime(timestamp) {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;

            if (diff < 60000) return '刚刚';
            if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
            if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';

            return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showToast(message, isError = false) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast' + (isError ? ' error' : '');

            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // ============ 初始化 ============
        connect();

        // 定期刷新数据
        setInterval(() => {
            if (currentTab === 'history') {
                loadChatList();
            }
        }, 10000);

        setInterval(() => {
            fetch('/api/sessions')
                .then(res => res.json())
                .then(data => {
                    data.forEach(session => {
                        if (!sessions[session.name]) {
                            sessions[session.name] = session;
                        } else {
                            Object.assign(sessions[session.name], session);
                        }
                    });
                    updateSessionList();
                })
                .catch(err => console.error('Failed to fetch sessions:', err));
        }, 5000);
    </script>
</body>
</html>`;
  }
}

/**
 * 创建Web UI服务器
 */
export function createWebUIServer(config: WebUIConfig, sessionManager: SessionManager, appConfig?: AppConfig, configPath?: string, application?: any): WebUIServer | null {
  if (!config.enabled) {
    logger.info('Web UI is disabled');
    return null;
  }

  return new WebUIServer(config.port, sessionManager, appConfig || {} as AppConfig, configPath, application);
}
