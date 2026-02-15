/**
 * 消息历史存储模块
 * 记录用户与Claude之间的通讯历史
 */

import { createLogger } from '../core/logger';
import { IncomingMessage, OutputBlock } from '../core/types';

const logger = createLogger('message-history');

/**
 * 通讯记录类型
 */
export enum CommunicationType {
  USER_MESSAGE = 'user_message',      // 用户发送的消息
  CLAUDE_OUTPUT = 'claude_output',    // Claude的输出
  SYSTEM_MESSAGE = 'system_message'   // 系统消息（错误、提示等）
}

/**
 * 通讯记录
 */
export interface CommunicationRecord {
  id: string;
  type: CommunicationType;
  chatId: string;
  userId: string;
  sessionName?: string;
  content: string;
  timestamp: Date;
  metadata?: {
    messageId?: string;
    outputType?: string;
    confirmOptions?: string[];
    confirmId?: string;
  };
}

/**
 * 聊天会话的通讯历史
 */
export interface ChatHistory {
  chatId: string;
  records: CommunicationRecord[];
  lastUpdated: Date;
}

/**
 * 消息历史管理器配置
 */
export interface MessageHistoryConfig {
  maxRecordsPerChat: number;  // 每个聊天最大记录数
  maxTotalRecords: number;    // 总最大记录数
}

/**
 * 消息历史管理器
 */
export class MessageHistoryManager {
  private histories: Map<string, ChatHistory> = new Map();
  private config: MessageHistoryConfig;
  private recordIdCounter: number = 0;

  constructor(config?: Partial<MessageHistoryConfig>) {
    this.config = {
      maxRecordsPerChat: config?.maxRecordsPerChat || 500,
      maxTotalRecords: config?.maxTotalRecords || 5000
    };
  }

  /**
   * 生成唯一记录ID
   */
  private generateRecordId(): string {
    return `record_${Date.now()}_${++this.recordIdCounter}`;
  }

  /**
   * 记录用户消息
   */
  recordUserMessage(message: IncomingMessage): CommunicationRecord {
    const record: CommunicationRecord = {
      id: this.generateRecordId(),
      type: CommunicationType.USER_MESSAGE,
      chatId: message.chatId,
      userId: message.userId,
      content: message.content,
      timestamp: message.timestamp,
      metadata: {
        messageId: message.messageId
      }
    };

    this.addRecord(message.chatId, record);
    logger.debug(`Recorded user message from ${message.userId} in chat ${message.chatId}`);
    return record;
  }

  /**
   * 记录Claude输出
   */
  recordClaudeOutput(
    chatId: string,
    sessionName: string,
    block: OutputBlock
  ): CommunicationRecord {
    const record: CommunicationRecord = {
      id: this.generateRecordId(),
      type: CommunicationType.CLAUDE_OUTPUT,
      chatId,
      userId: '', // Claude输出没有用户ID
      sessionName,
      content: block.content,
      timestamp: block.timestamp,
      metadata: {
        outputType: block.type,
        confirmOptions: block.confirmOptions,
        confirmId: block.confirmId
      }
    };

    this.addRecord(chatId, record);
    logger.debug(`Recorded Claude output for session ${sessionName} in chat ${chatId}`);
    return record;
  }

  /**
   * 记录系统消息
   */
  recordSystemMessage(chatId: string, content: string): CommunicationRecord {
    const record: CommunicationRecord = {
      id: this.generateRecordId(),
      type: CommunicationType.SYSTEM_MESSAGE,
      chatId,
      userId: '',
      content,
      timestamp: new Date()
    };

    this.addRecord(chatId, record);
    logger.debug(`Recorded system message in chat ${chatId}`);
    return record;
  }

  /**
   * 添加记录到历史
   */
  private addRecord(chatId: string, record: CommunicationRecord): void {
    let history = this.histories.get(chatId);

    if (!history) {
      history = {
        chatId,
        records: [],
        lastUpdated: new Date()
      };
      this.histories.set(chatId, history);
    }

    history.records.push(record);
    history.lastUpdated = new Date();

    // 限制每个聊天的记录数
    if (history.records.length > this.config.maxRecordsPerChat) {
      history.records = history.records.slice(-this.config.maxRecordsPerChat);
    }

    // 检查总记录数限制
    this.enforceTotalLimit();
  }

  /**
   * 强制总记录数限制
   */
  private enforceTotalLimit(): void {
    const totalRecords = this.getTotalRecordCount();

    if (totalRecords > this.config.maxTotalRecords) {
      // 按最后更新时间排序，删除最旧的聊天的记录
      const sortedHistories = Array.from(this.histories.values())
        .sort((a, b) => a.lastUpdated.getTime() - b.lastUpdated.getTime());

      let recordsToRemove = totalRecords - this.config.maxTotalRecords;

      for (const history of sortedHistories) {
        if (recordsToRemove <= 0) break;

        const removeCount = Math.min(recordsToRemove, history.records.length);
        history.records = history.records.slice(removeCount);
        recordsToRemove -= removeCount;

        if (history.records.length === 0) {
          this.histories.delete(history.chatId);
        }
      }

      logger.info(`Cleaned up ${totalRecords - this.getTotalRecordCount()} old records`);
    }
  }

  /**
   * 获取聊天的通讯历史
   */
  getChatHistory(chatId: string, limit?: number): CommunicationRecord[] {
    const history = this.histories.get(chatId);
    if (!history) return [];

    const records = history.records;
    return limit ? records.slice(-limit) : [...records];
  }

  /**
   * 获取所有聊天ID列表
   */
  getAllChatIds(): string[] {
    return Array.from(this.histories.keys());
  }

  /**
   * 获取所有聊天历史概览
   */
  getAllChatsOverview(): Array<{
    chatId: string;
    recordCount: number;
    lastUpdated: Date;
    lastMessage?: CommunicationRecord;
  }> {
    const result: Array<{
      chatId: string;
      recordCount: number;
      lastUpdated: Date;
      lastMessage?: CommunicationRecord;
    }> = [];

    for (const [chatId, history] of this.histories) {
      result.push({
        chatId,
        recordCount: history.records.length,
        lastUpdated: history.lastUpdated,
        lastMessage: history.records[history.records.length - 1]
      });
    }

    // 按最后更新时间降序排序
    return result.sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());
  }

  /**
   * 获取总记录数
   */
  getTotalRecordCount(): number {
    let total = 0;
    for (const history of this.histories.values()) {
      total += history.records.length;
    }
    return total;
  }

  /**
   * 清除指定聊天的历史
   */
  clearChatHistory(chatId: string): boolean {
    return this.histories.delete(chatId);
  }

  /**
   * 清除所有历史
   */
  clearAllHistory(): void {
    this.histories.clear();
    logger.info('All message history cleared');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalChats: number;
    totalRecords: number;
    config: MessageHistoryConfig;
  } {
    return {
      totalChats: this.histories.size,
      totalRecords: this.getTotalRecordCount(),
      config: { ...this.config }
    };
  }
}

/**
 * 全局消息历史管理器实例
 */
let globalHistoryManager: MessageHistoryManager | null = null;

/**
 * 初始化消息历史管理器
 */
export function initMessageHistory(config?: Partial<MessageHistoryConfig>): MessageHistoryManager {
  if (!globalHistoryManager) {
    globalHistoryManager = new MessageHistoryManager(config);
    logger.info('Message history manager initialized');
  }
  return globalHistoryManager;
}

/**
 * 获取消息历史管理器
 */
export function getMessageHistory(): MessageHistoryManager {
  if (!globalHistoryManager) {
    return initMessageHistory();
  }
  return globalHistoryManager;
}
