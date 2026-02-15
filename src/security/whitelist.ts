/**
 * 白名单验证模块
 */

import { SecurityConfig, IncomingMessage } from '../core/types';
import { createLogger } from '../core/logger';

const logger = createLogger('whitelist');

/**
 * 白名单验证器
 */
export class WhitelistVerifier {
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  /**
   * 验证消息发送者是否有权限
   */
  verify(message: IncomingMessage): boolean {
    const { mode, userWhitelist, chatWhitelist } = this.config;

    // 无验证模式
    if (mode === 'none') {
      logger.debug('Whitelist mode is none, allowing all');
      return true;
    }

    const isUserAllowed = this.checkUser(message.userId, userWhitelist);
    const isChatAllowed = this.checkChat(message.chatId, chatWhitelist);

    // 根据模式决定验证逻辑
    switch (mode) {
      case 'user':
        return isUserAllowed;

      case 'chat':
        return isChatAllowed;

      case 'both':
        return isUserAllowed || isChatAllowed;

      default:
        logger.warn(`Unknown whitelist mode: ${mode}`);
        return false;
    }
  }

  /**
   * 检查用户白名单
   */
  private checkUser(userId: string, whitelist: string[]): boolean {
    if (whitelist.length === 0) {
      return false;
    }

    const allowed = whitelist.includes(userId);
    if (!allowed) {
      logger.debug(`User ${userId} not in whitelist`);
    }
    return allowed;
  }

  /**
   * 检查群聊白名单
   */
  private checkChat(chatId: string, whitelist: string[]): boolean {
    if (whitelist.length === 0) {
      return false;
    }

    const allowed = whitelist.includes(chatId);
    if (!allowed) {
      logger.debug(`Chat ${chatId} not in whitelist`);
    }
    return allowed;
  }

  /**
   * 更新配置
   */
  updateConfig(config: SecurityConfig): void {
    this.config = config;
    logger.info('Whitelist configuration updated');
  }

  /**
   * 获取当前配置
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  /**
   * 添加用户到白名单
   */
  addUser(userId: string): void {
    if (!this.config.userWhitelist.includes(userId)) {
      this.config.userWhitelist.push(userId);
      logger.info(`Added user ${userId} to whitelist`);
    }
  }

  /**
   * 移除用户
   */
  removeUser(userId: string): boolean {
    const index = this.config.userWhitelist.indexOf(userId);
    if (index !== -1) {
      this.config.userWhitelist.splice(index, 1);
      logger.info(`Removed user ${userId} from whitelist`);
      return true;
    }
    return false;
  }

  /**
   * 添加群聊到白名单
   */
  addChat(chatId: string): void {
    if (!this.config.chatWhitelist.includes(chatId)) {
      this.config.chatWhitelist.push(chatId);
      logger.info(`Added chat ${chatId} to whitelist`);
    }
  }

  /**
   * 移除群聊
   */
  removeChat(chatId: string): boolean {
    const index = this.config.chatWhitelist.indexOf(chatId);
    if (index !== -1) {
      this.config.chatWhitelist.splice(index, 1);
      logger.info(`Removed chat ${chatId} from whitelist`);
      return true;
    }
    return false;
  }
}

/**
 * 创建白名单验证器
 */
export function createWhitelistVerifier(config: SecurityConfig): WhitelistVerifier {
  return new WhitelistVerifier(config);
}
