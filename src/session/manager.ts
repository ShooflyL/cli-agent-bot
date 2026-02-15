/**
 * 会话管理器
 * 管理所有Claude会话的创建、切换、关闭
 */

import { SessionStatus, SessionInfo, AppConfig } from '../core/types';
import { ClaudeSession, createSession } from './session';
import { emitEvent, EventType } from '../core/events';
import { createLogger } from '../core/logger';

const logger = createLogger('session-manager');

/**
 * 会话管理器
 */
export class SessionManager {
  private sessions: Map<string, ClaudeSession> = new Map();
  private activeSession: string | null = null;
  private config: AppConfig;

  // 聊天ID到会话的映射（每个聊天可以有多个会话，但只有一个当前活跃）
  private chatSessions: Map<string, Set<string>> = new Map();
  private chatActiveSession: Map<string, string> = new Map();

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * 更新配置
   */
  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  /**
   * 创建新会话
   */
  async createSession(
    name: string,
    workDir: string,
    chatId: string,
    cliTool?: string
  ): Promise<ClaudeSession> {
    // 检查会话数量限制
    if (this.sessions.size >= this.config.session.maxSessions) {
      throw new Error(`Maximum sessions (${this.config.session.maxSessions}) reached`);
    }

    // 检查会话名是否已存在
    if (this.sessions.has(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    logger.info(`Creating session "${name}" for chat ${chatId}`);

    // 获取 CLI 配置
    const cliConfig = this.config.cli;
    const defaultCliTool = cliTool || cliConfig?.default || 'claude';
    const currentCliConfig = defaultCliTool === 'opencode' 
      ? cliConfig?.opencode 
      : cliConfig?.claude;
    
    // 获取环境变量 (从 cli.env 根级别获取)
    const cliEnv = cliConfig?.env || {};
    
    // 获取跳过权限和额外参数配置 (仅 Claude 支持)
    const skipPermissions = defaultCliTool === 'claude' ? (currentCliConfig as any)?.skipPermissions || cliConfig?.skipPermissions || false : false;
    const extraArgs = currentCliConfig?.extraArgs || [];

    if (skipPermissions) {
      logger.info(`Session "${name}" will skip permission checks`);
    }

    const session = createSession({
      name,
      workDir,
      bufferSize: this.config.session.bufferSize,
      skipPermissions,
      extraArgs,
      messageFilters: cliConfig?.messageFilters,
      messageFilterEnabled: this.config.session.messageFilter?.enabled,
      messageFilterMinLength: this.config.session.messageFilter?.minLength,
      cliTool: defaultCliTool as 'claude' | 'opencode',
      executable: currentCliConfig?.executable || defaultCliTool
    });

    // 先注册到管理器并关联聊天，再启动会话
    // 避免启动期间输出事件找不到 chatId 的竞态问题
    this.sessions.set(name, session);

    if (!this.chatSessions.has(chatId)) {
      this.chatSessions.set(chatId, new Set());
    }
    this.chatSessions.get(chatId)!.add(name);
    this.chatActiveSession.set(chatId, name);
    this.activeSession = name;

    // 启动会话
    await session.start(defaultCliTool, currentCliConfig?.executable || defaultCliTool, cliEnv);

    emitEvent(EventType.SESSION_CREATED, { name, chatId });

    return session;
  }

  /**
   * 获取会话
   */
  getSession(name: string): ClaudeSession | undefined {
    return this.sessions.get(name);
  }

  /**
   * 获取聊天的活跃会话
   */
  getChatActiveSession(chatId: string): ClaudeSession | undefined {
    const sessionName = this.chatActiveSession.get(chatId);
    if (!sessionName) {
      return undefined;
    }
    return this.sessions.get(sessionName);
  }

  /**
   * 设置聊天的活跃会话
   */
  setChatActiveSession(chatId: string, name: string): void {
    if (!this.sessions.has(name)) {
      throw new Error(`Session "${name}" not found`);
    }

    const chatSessionSet = this.chatSessions.get(chatId);
    if (!chatSessionSet || !chatSessionSet.has(name)) {
      throw new Error(`Session "${name}" not found in chat ${chatId}`);
    }

    this.chatActiveSession.set(chatId, name);
    this.activeSession = name;

    emitEvent(EventType.SESSION_SWITCHED, { name, chatId });
    logger.info(`Switched to session "${name}" for chat ${chatId}`);
  }

  /**
   * 添加会话到聊天的关联
   */
  addSessionToChat(name: string, chatId: string): void {
    if (!this.sessions.has(name)) {
      throw new Error(`Session "${name}" not found`);
    }

    if (!this.chatSessions.has(chatId)) {
      this.chatSessions.set(chatId, new Set());
    }
    this.chatSessions.get(chatId)!.add(name);
  }

  /**
   * 重启已崩溃的会话
   */
  async restartSession(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session) {
      throw new Error(`Session "${name}" not found`);
    }

    const info = session.getInfo();
    if (info.status !== 'error') {
      throw new Error(`Session "${name}" is not in error state`);
    }

    logger.info(`Restarting session "${name}"`);

    // 获取 CLI 配置
    const cliConfig = this.config.cli;
    const defaultCliTool = (cliConfig?.default || 'claude') as string;
    const currentCliConfig = defaultCliTool === 'opencode'
      ? cliConfig?.opencode
      : cliConfig?.claude;
    const cliEnv = cliConfig?.env || {};

    // 重新启动会话
    await session.start(defaultCliTool, currentCliConfig?.executable || defaultCliTool, cliEnv);
  }

  /**
   * 关闭会话
   */
  async closeSession(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session) {
      throw new Error(`Session "${name}" not found`);
    }

    logger.info(`Closing session "${name}"`);

    await session.close();
    this.sessions.delete(name);

    // 从所有聊天中移除
    for (const [chatId, sessionSet] of this.chatSessions) {
      sessionSet.delete(name);
      if (this.chatActiveSession.get(chatId) === name) {
        // 如果关闭的是活跃会话，切换到该聊天的其他会话
        const remaining = Array.from(sessionSet);
        if (remaining.length > 0) {
          this.chatActiveSession.set(chatId, remaining[0]);
        } else {
          this.chatActiveSession.delete(chatId);
        }
      }
    }

    // 更新全局活跃会话
    if (this.activeSession === name) {
      this.activeSession = this.findAnyActiveSession();
    }

    emitEvent(EventType.SESSION_CLOSED, { name });
  }

  /**
   * 关闭聊天的所有会话
   */
  async closeChatSessions(chatId: string): Promise<void> {
    const sessionSet = this.chatSessions.get(chatId);
    if (!sessionSet) {
      return;
    }

    for (const name of sessionSet) {
      await this.closeSession(name);
    }

    this.chatSessions.delete(chatId);
    this.chatActiveSession.delete(chatId);
  }

  /**
   * 获取所有会话列表
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => s.getInfo());
  }

  /**
   * 获取聊天的会话列表
   */
  listChatSessions(chatId: string): SessionInfo[] {
    const sessionSet = this.chatSessions.get(chatId);
    if (!sessionSet) {
      return [];
    }

    return Array.from(sessionSet)
      .map(name => this.sessions.get(name))
      .filter((s): s is ClaudeSession => s !== undefined)
      .map(s => s.getInfo());
  }

  /**
   * 获取活跃会话
   */
  getActiveSession(): ClaudeSession | undefined {
    if (!this.activeSession) {
      return undefined;
    }
    return this.sessions.get(this.activeSession);
  }

  /**
   * 检查会话是否存在
   */
  hasSession(name: string): boolean {
    return this.sessions.has(name);
  }

  /**
   * 获取会话数量
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取会话关联的聊天ID
   */
  getSessionChatId(sessionName: string): string | undefined {
    for (const [chatId, sessionSet] of this.chatSessions) {
      if (sessionSet.has(sessionName)) {
        logger.debug(`Found chatId "${chatId}" for session "${sessionName}"`);
        return chatId;
      }
    }
    logger.warn(`No chatId found for session "${sessionName}"`);
    return undefined;
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): ClaudeSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 关闭所有会话
   */
  async closeAll(): Promise<void> {
    logger.info('Closing all sessions');

    const closePromises = Array.from(this.sessions.keys()).map(name =>
      this.closeSession(name).catch(err =>
        logger.error(`Failed to close session "${name}": ${err}`)
      )
    );

    await Promise.all(closePromises);
    this.sessions.clear();
    this.chatSessions.clear();
    this.chatActiveSession.clear();
    this.activeSession = null;
  }

  /**
   * 查找任意活跃会话
   */
  private findAnyActiveSession(): string | null {
    for (const [, name] of this.chatActiveSession) {
      return name;
    }
    return null;
  }
}

/**
 * 创建会话管理器
 */
export function createSessionManager(config: AppConfig): SessionManager {
  return new SessionManager(config);
}
