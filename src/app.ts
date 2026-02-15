/**
 * 应用主类
 * 整合所有模块，协调运行
 */

import { AppConfig, IncomingMessage, MessageType, IChatAdapter, OutputType, OutputBlock } from './core/types';
import { initLogger, getLogger, createLogger } from './core/logger';
import { loadConfig, validateConfig } from './core/config';
import { subscribeEvent, EventType } from './core/events';
import { SessionManager, createSessionManager } from './session/manager';
import { createFeishuAdapter } from './adapter/feishu';
import { chatAdapterRegistry } from './adapter/chat-adapter';
import { getCommandRegistry } from './command/registry';
import { executeCommand, isCommandMessage } from './command/parser';
import { builtinCommands } from './command/commands';
import { WhitelistVerifier, createWhitelistVerifier } from './security/whitelist';
import { initMessageHistory, getMessageHistory } from './core/message-history';
import { createWebUIServer, WebUIServer } from './webui';
import { convertToInteractiveResponse } from './adapter/claude/output-parser';

const logger = createLogger('app');

/**
 * 应用主类
 */
export class Application {
  config: AppConfig;
  readonly sessionManager: SessionManager;
  readonly adapter: IChatAdapter;
  readonly whitelist: WhitelistVerifier;

  private running: boolean = false;
  private startTime: number = 0;
  private webUIServer: WebUIServer | null = null;
  private configPath: string;

  // 自动推送配置
  private autoPushEnabled: boolean = true;
  private pushDebounceMap: Map<string, NodeJS.Timeout> = new Map();
  private pushDebounceDelay: number = 500; // 防抖延迟（毫秒）

  constructor(config: AppConfig, configPath?: string) {
    // 初始化日志
    initLogger(config.logging);

    logger.info('Initializing cli-agent-bot...');

    // 验证配置
    validateConfig(config);
    this.config = config;
    this.configPath = configPath || 'config.yaml';

    // 初始化消息历史记录
    initMessageHistory({
      maxRecordsPerChat: 500,
      maxTotalRecords: 5000
    });

    // 初始化各模块
    this.sessionManager = createSessionManager(config);
    
    // 根据配置创建 IM 适配器
    const adapterType = config.im?.default || 'feishu';
    if (adapterType === 'feishu' && config.im?.feishu) {
      this.adapter = createFeishuAdapter(config.im.feishu) as unknown as IChatAdapter;
    } else {
      throw new Error(`Unsupported IM adapter: ${adapterType}`);
    }
    
    this.whitelist = createWhitelistVerifier(config.security);

    // 注册内置指令
    const registry = getCommandRegistry();
    registry.registerAll(builtinCommands);

    // 订阅事件
    this.setupEventListeners();

    // 设置全局引用（供指令使用）
    (global as any).app = this;

    logger.info('Application initialized');
  }

  /**
   * 启动应用
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Application is already running');
    }

    logger.info('Starting application...');

    this.running = true;
    this.startTime = Date.now();

    // 注册消息处理器
    this.adapter.onMessage(this.handleMessage.bind(this));

    // 启动适配器
    await this.adapter.start();

    // 启动 Web UI
    if (this.config.webUI?.enabled) {
      this.webUIServer = createWebUIServer(
        this.config.webUI,
        this.sessionManager,
        this.config,
        this.configPath,
        this
      );
      if (this.webUIServer) {
        await this.webUIServer.start();
      }
    }

    logger.info('Application started successfully');

    // 打印启动信息
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║       cli-agent-bot is running       ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log('Max sessions:', this.config.session.maxSessions);
    console.log('Security mode:', this.config.security.mode);
    console.log('Auto push:', this.autoPushEnabled ? 'enabled' : 'disabled');
    if (this.config.webUI?.enabled) {
      console.log('Web UI: http://localhost:' + (this.config.webUI.port || 8080));
    }
    console.log('');
  }

  /**
   * 停止应用
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping application...');

    this.running = false;

    // 清理所有防抖定时器
    for (const timer of this.pushDebounceMap.values()) {
      clearTimeout(timer);
    }
    this.pushDebounceMap.clear();

    // 关闭所有会话
    await this.sessionManager.closeAll();

    // 停止 Web UI
    if (this.webUIServer) {
      await this.webUIServer.stop();
    }

    // 停止适配器
    await this.adapter.stop();

    logger.info('Application stopped');
  }

  /**
   * 重新加载配置文件
   */
  async reloadConfig(): Promise<void> {
    logger.info('Reloading configuration...');
    
    const newConfig = loadConfig(this.configPath);
    validateConfig(newConfig);
    
    this.config = newConfig;
    this.sessionManager.updateConfig(newConfig);
    this.whitelist.updateConfig(newConfig.security);
    
    logger.info('Configuration reloaded successfully');
  }

  /**
   * 检查是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 获取运行时间（秒）
   */
  getUptime(): number {
    if (!this.running) return 0;
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * 处理消息
   */
  private async handleMessage(message: IncomingMessage): Promise<void> {
    logger.info(`Processing message - userId: ${message.userId}, chatId: ${message.chatId}, content: ${message.content.substring(0, 50)}`);

    // 白名单验证
    if (!this.whitelist.verify(message)) {
      logger.warn(`Message from ${message.userId} in chat ${message.chatId} rejected by whitelist`);
      return;
    }

    logger.debug(`Message from ${message.userId} passed whitelist check`);

    // 记录用户消息
    const history = getMessageHistory();
    history.recordUserMessage(message);

    try {
      // 检查是否为指令
      if (isCommandMessage(message)) {
        await this.handleCommand(message);
        return;
      }

      // 普通消息，转发到当前会话
      await this.handleChatMessage(message);

    } catch (error) {
      logger.error(`Error handling message: ${error}`);

      // 记录系统错误消息
      history.recordSystemMessage(message.chatId, `处理消息时发生错误：${error}`);

      // 发送错误提示
      await this.adapter.sendCard(message.chatId, {
        title: '❌ 处理错误',
        content: `处理消息时发生错误：\n\`\`\`\n${error}\n\`\`\``,
        type: 'error' as any
      });
    }
  }

  /**
   * 处理指令
   */
  private async handleCommand(message: IncomingMessage): Promise<void> {
    const session = this.sessionManager.getChatActiveSession(message.chatId);
    const sessionInfo = session ? {
      name: session.getInfo().name,
      workDir: session.getInfo().workDir,
      status: session.getInfo().status
    } : undefined;

    const executed = await executeCommand(message, sessionInfo);

    // 如果指令未被识别，且有活跃会话，转发给 Claude Code
    if (!executed && session) {
      logger.info(`Unknown command "${message.content}", forwarding to Claude Code`);
      await session.sendInput(message.content);
    } else if (!executed) {
      // 未识别的指令且没有活跃会话，提示用户
      await this.adapter.sendText(message.chatId,
        '❓ 未知指令，且当前没有活跃会话\n' +
        '使用 /help 查看可用指令，或使用 /new 创建新会话'
      );
    }
  }

  /**
   * 处理普通聊天消息
   */
  private async handleChatMessage(message: IncomingMessage): Promise<void> {
    logger.info(`handleChatMessage called - chatId: ${message.chatId}, content: ${message.content.substring(0, 50)}`);

    const session = this.sessionManager.getChatActiveSession(message.chatId);

    if (!session) {
      logger.warn(`No active session found for chatId: ${message.chatId}`);
      await this.adapter.sendText(message.chatId,
        '当前没有活跃会话，请先创建会话\n' +
        '使用 /new <名称> [目录] 创建新会话'
      );
      return;
    }

    // 获取会话信息
    const info = session.getInfo();
    const pendingConfirm = session.getPendingConfirm();

    logger.info(`Session found - name: ${info.name}, status: ${info.status}`);

    // 检查会话状态
    if (info.status === 'waiting_confirm' && pendingConfirm) {
      // 处理交互式选择响应
      const response = convertToInteractiveResponse(message.content, pendingConfirm.options);
      logger.info(`Converting user input "${message.content}" to "${response}" for interactive select`);

      if (!response) {
        // 无法匹配选项，提示用户
        await this.adapter.sendText(message.chatId,
          '⚠️ 无法识别您的选择\n\n' +
          '请使用以下方式之一：\n' +
          '• 发送数字编号（如 "1" 或 "2"）\n' +
          '• 发送选项内容的关键词\n' +
          '• 使用按键命令：/up /down /enter /esc'
        );
        return;
      }

      session.sendConfirmResponse(response);

      // 发送确认反馈
      await this.adapter.sendText(message.chatId, `✅ 已选择: ${response}`);
      return;
    }

    // 检查会话是否处于错误状态
    if (info.status === 'error') {
      logger.info(`Session "${info.name}" is in error state, attempting restart`);
      try {
        await this.sessionManager.restartSession(info.name);
        await this.adapter.sendText(message.chatId, `🔄 会话 "${info.name}" 已自动重启，正在重新发送消息...`);
        // 重启后重新获取会话并发送输入
        const restartedSession = this.sessionManager.getChatActiveSession(message.chatId);
        if (restartedSession) {
          await restartedSession.sendInput(message.content);
          logger.debug('Input sent successfully after restart');
        }
      } catch (restartError) {
        logger.error(`Failed to restart session: ${restartError}`);
        await this.adapter.sendText(message.chatId,
          `❌ 会话 "${info.name}" 已崩溃且无法自动重启\n` +
          '请使用 /close ' + info.name + ' 关闭后重新创建'
        );
      }
      return;
    }

    // 发送输入到会话
    logger.info(`Sending input to session "${info.name}": ${message.content}`);
    await session.sendInput(message.content);
    logger.debug(`Input sent successfully`);
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    const history = getMessageHistory();

    // 监听输出事件 - 自动推送到飞书
    subscribeEvent(EventType.OUTPUT_RECEIVED, async (payload) => {
      const { session: sessionName, block } = payload.data as any;
      logger.debug(`OUTPUT_RECEIVED event - session: ${sessionName}, block type: ${block.type}, content length: ${block.content?.length || 0}`);

      // 获取会话关联的聊天ID
      const chatId = this.sessionManager.getSessionChatId(sessionName);
      if (chatId) {
        // 记录历史
        history.recordClaudeOutput(chatId, sessionName, block);

        // 自动推送（带防抖）
        if (this.autoPushEnabled && block.type !== OutputType.CONFIRM) {
          logger.debug(`Scheduling push to Feishu for chat ${chatId}`);
          this.schedulePushToFeishu(chatId, sessionName, block);
        }
      } else {
        logger.warn(`No chatId found for session ${sessionName}, skipping push`);
      }
    });

    // 监听需要确认的事件 - 立即推送到飞书
    subscribeEvent(EventType.CONFIRM_REQUIRED, async (payload) => {
      const { session: sessionName, block } = payload.data as any;
      logger.info(`Confirm required for session ${sessionName}`);

      // 获取会话关联的聊天ID
      const chatId = this.sessionManager.getSessionChatId(sessionName);
      if (chatId) {
        // 立即推送确认请求
        await this.pushConfirmToFeishu(chatId, sessionName, block);
      }
    });

    // 监听错误事件
    subscribeEvent(EventType.ERROR, async (payload) => {
      const { session: sessionName, block } = payload.data as any;
      logger.error('Error event:', payload.data);

      // 获取会话关联的聊天ID
      const chatId = this.sessionManager.getSessionChatId(sessionName);
      if (chatId) {
        // 推送错误消息
        await this.pushErrorToFeishu(chatId, sessionName, block);
      }
    });
  }

  /**
   * 调度推送到飞书（带防抖）
   */
  private schedulePushToFeishu(chatId: string, sessionName: string, block: OutputBlock): void {
    // 清除之前的定时器
    const existingTimer = this.pushDebounceMap.get(chatId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 设置新的定时器
    const timer = setTimeout(async () => {
      this.pushDebounceMap.delete(chatId);
      await this.pushOutputToFeishu(chatId, sessionName);
    }, this.pushDebounceDelay);

    this.pushDebounceMap.set(chatId, timer);
  }

  /**
   * 推送输出到飞书
   */
  private async pushOutputToFeishu(chatId: string, sessionName: string): Promise<void> {
    logger.info(`pushOutputToFeishu called - chatId: ${chatId}, session: ${sessionName}`);

    try {
      const session = this.sessionManager.getSession(sessionName);
      if (!session) {
        logger.warn(`Session ${sessionName} not found for push`);
        return;
      }

      const blocks = session.getBufferedOutput();
      logger.debug(`Got ${blocks.length} blocks from buffer`);

      if (blocks.length === 0) {
        logger.debug('No blocks to push');
        return;
      }

      // 合并输出内容
      const content = blocks
        .map(block => {
          const prefix = block.type === OutputType.ERROR ? '❌ ' : '';
          return prefix + block.content;
        })
        .join('\n\n---\n\n');

      // 限制消息长度
      const maxLength = 30000;
      const truncatedContent = content.length > maxLength
        ? content.substring(0, maxLength) + '\n\n... (内容过长，已截断)'
        : content;

      logger.debug(`Sending card to Feishu, content length: ${truncatedContent.length}`);

      await this.adapter.sendCard(chatId, {
        title: `📤 ${sessionName}`,
        content: truncatedContent,
        type: 'default' as any
      });

      logger.info(`Successfully pushed ${blocks.length} output blocks to chat ${chatId}`);
    } catch (error) {
      logger.error(`Failed to push output to Feishu: ${error}`);
    }
  }

  /**
   * 推送确认请求到飞书
   */
  private async pushConfirmToFeishu(chatId: string, sessionName: string, block: OutputBlock): Promise<void> {
    try {
      // 不使用按钮，只发送文本提示
      // 因为飞书按钮交互需要额外的回调处理
      await this.adapter.sendCard(chatId, {
        title: `⏳ 需要确认 - ${sessionName}`,
        content: block.content,
        type: 'confirm' as any
      });

      logger.info(`Pushed confirm request to chat ${chatId}`);
    } catch (error) {
      logger.error(`Failed to push confirm to Feishu: ${error}`);
    }
  }

  /**
   * 推送错误消息到飞书
   */
  private async pushErrorToFeishu(chatId: string, sessionName: string, block: OutputBlock): Promise<void> {
    try {
      await this.adapter.sendCard(chatId, {
        title: `❌ 错误 - ${sessionName}`,
        content: block.content,
        type: 'error' as any
      });

      logger.info(`Pushed error to chat ${chatId}`);
    } catch (error) {
      logger.error(`Failed to push error to Feishu: ${error}`);
    }
  }
}

/**
 * 创建应用实例
 */
export async function createApplication(configPath?: string): Promise<Application> {
  const config = loadConfig(configPath);
  return new Application(config, configPath);
}
