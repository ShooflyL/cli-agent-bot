/**
 * Claude会话类
 * 使用适配器模式支持不同的 CLI 工具
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import { SessionStatus, SessionInfo, OutputBlock, OutputType } from '../core/types';
import { CliAdapter, CliAdapterOptions, adapterRegistry, CliAdapterFactory } from '../adapter/cli-adapter';
import { OutputBuffer, createOutputBlock } from './output-buffer';
import { emitEvent, EventType } from '../core/events';
import { createLogger } from '../core/logger';

const logger = createLogger('session');

/**
 * 会话配置
 */
interface SessionOptions {
  name: string;
  workDir: string;
  bufferSize: number;
  skipPermissions?: boolean;
  extraArgs?: string[];
  messageFilters?: string[];
  messageFilterEnabled?: boolean;
  messageFilterMinLength?: number;
  cliTool?: 'claude' | 'opencode';
  executable?: string;
}

/**
 * Claude会话类 - 使用适配器模式
 */
export class ClaudeSession extends EventEmitter {
  readonly name: string;
  readonly workDir: string;

  private status: SessionStatus = SessionStatus.IDLE;
  private adapter: CliAdapter | null = null;
  private buffer: OutputBuffer;
  private createdAt: Date;
  private lastActiveAt: Date;
  private pendingConfirm: {
    id: string;
    options: string[];
  } | null = null;
  private skipPermissions: boolean;
  private extraArgs: string[];
  private messageFilters?: string[];
  private messageFilterEnabled?: boolean;
  private messageFilterMinLength?: number;
  private inputQueue: string[] = [];
  private isProcessingInput = false;

  constructor(options: SessionOptions) {
    super();
    this.name = options.name;
    this.workDir = options.workDir;
    this.skipPermissions = options.skipPermissions || false;
    this.extraArgs = options.extraArgs || [];
    this.messageFilters = options.messageFilters;
    this.messageFilterEnabled = options.messageFilterEnabled;
    this.messageFilterMinLength = options.messageFilterMinLength;
    this.buffer = new OutputBuffer({ maxSize: options.bufferSize });
    this.createdAt = new Date();
    this.lastActiveAt = new Date();
  }

  /**
   * 启动会话
   */
  async start(cliTool: string, executable: string, env?: Record<string, string>): Promise<void> {
    if (this.adapter) {
      throw new Error('Session already started');
    }

    logger.info(`Starting session "${this.name}" in ${this.workDir} with ${cliTool}`);

    try {
      if (!fs.existsSync(this.workDir)) {
        logger.info(`Creating work directory: ${this.workDir}`);
        fs.mkdirSync(this.workDir, { recursive: true });
      }

      // 从配置中获取消息过滤设置
      const config = this.getFilterConfig();

      // 创建适配器选项
      const adapterOptions: CliAdapterOptions = {
        executable,
        cwd: this.workDir,
        env,
        skipPermissions: this.skipPermissions,
        extraArgs: this.extraArgs,
        messageFilters: config.messageFilters,
        messageFilterEnabled: config.messageFilterEnabled,
        messageFilterMinLength: config.messageFilterMinLength
      };

      // 创建适配器
      this.adapter = adapterRegistry.create(cliTool, adapterOptions);

      // 监听适配器事件
      this.adapter.events.on('output', (block: OutputBlock) => {
        this.handleOutput(block);
      });

      this.adapter.events.on('exit', (data: { code: number; signal: number }) => {
        this.handleExit(data.code, data.signal);
      });

      this.adapter.events.on('idle', () => {
        if (this.status === SessionStatus.PROCESSING) {
          this.status = SessionStatus.IDLE;
        }
      });

      // 启动适配器
      await this.adapter.start();

      this.status = SessionStatus.IDLE;
      this.updateActiveTime();

      emitEvent(EventType.SESSION_CREATED, {
        name: this.name,
        workDir: this.workDir
      });

    } catch (error) {
      this.status = SessionStatus.ERROR;
      logger.error(`Failed to start session: ${error}`);
      throw error;
    }
  }

  /**
   * 获取过滤配置
   */
  private getFilterConfig(): { messageFilters?: string[]; messageFilterEnabled?: boolean; messageFilterMinLength?: number } {
    return {
      messageFilters: this.messageFilters,
      messageFilterEnabled: this.messageFilterEnabled,
      messageFilterMinLength: this.messageFilterMinLength
    };
  }

  /**
   * 发送输入
   */
  async sendInput(input: string): Promise<void> {
    if (!this.adapter) {
      throw new Error('Session not started');
    }

    logger.info(`Session "${this.name}" sending input: ${input}`);

    this.inputQueue.push(input);
    this.processInputQueue();
  }

  /**
   * 处理输入队列
   */
  private async processInputQueue(): Promise<void> {
    if (this.isProcessingInput || this.inputQueue.length === 0) {
      return;
    }

    this.isProcessingInput = true;
    this.status = SessionStatus.PROCESSING;
    this.updateActiveTime();

    while (this.inputQueue.length > 0) {
      const input = this.inputQueue.shift()!;
      this.adapter!.sendInput(input);
    }

    this.isProcessingInput = false;
  }

  /**
   * 发送原始输入（不追加回车，用于按键模拟）
   */
  async sendRawInput(data: string): Promise<void> {
    if (!this.adapter) {
      throw new Error('Session not started');
    }

    logger.info(`Session "${this.name}" sending raw input: ${JSON.stringify(data)}`);
    this.adapter.sendRawInput(data);
    this.updateActiveTime();
  }

  /**
   * 发送确认响应
   */
  async sendConfirmResponse(response: string): Promise<void> {
    if (!this.pendingConfirm) {
      logger.warn(`Session "${this.name}" has no pending confirm`);
      return;
    }

    this.adapter?.sendConfirmResponse(response);
    this.pendingConfirm = null;
    this.status = SessionStatus.PROCESSING;
    this.updateActiveTime();

    emitEvent(EventType.CONFIRM_RESPONSE, {
      session: this.name,
      response
    });
  }

  /**
   * 获取缓存输出
   */
  getBufferedOutput(): OutputBlock[] {
    return this.buffer.fetchAndClear();
  }

  /**
   * 获取会话信息
   */
  getInfo(): SessionInfo {
    return {
      name: this.name,
      workDir: this.workDir,
      status: this.status,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt
    };
  }

  /**
   * 获取当前状态
   */
  getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * 获取待确认信息
   */
  getPendingConfirm(): { id: string; options: string[] } | null {
    return this.pendingConfirm;
  }

  /**
   * 关闭会话
   */
  async close(): Promise<void> {
    logger.info(`Closing session "${this.name}"`);

    if (this.adapter) {
      try {
        await this.adapter.close();
      } catch (error) {
        logger.error(`Error closing adapter: ${error}`);
      }
      this.adapter = null;
    }

    this.status = SessionStatus.IDLE;

    emitEvent(EventType.SESSION_CLOSED, { name: this.name });
  }

  /**
   * 处理输出块
   */
  private handleOutput(block: OutputBlock): void {
    switch (block.type) {
      case OutputType.NORMAL:
        this.buffer.append(block);
        break;

      case OutputType.CONFIRM:
        this.status = SessionStatus.WAITING_CONFIRM;
        this.pendingConfirm = {
          id: block.confirmId || `confirm_${Date.now()}`,
          options: block.confirmOptions || []
        };

        emitEvent(EventType.CONFIRM_REQUIRED, {
          session: this.name,
          block
        });

        this.emit('confirm', block);
        break;

      case OutputType.ERROR:
        this.buffer.append(block);
        emitEvent(EventType.ERROR, {
          session: this.name,
          block
        });
        break;
    }

    emitEvent(EventType.OUTPUT_RECEIVED, {
      session: this.name,
      block
    });
  }

  /**
   * 处理进程退出
   */
  private handleExit(code: number, signal: number): void {
    logger.info(`Session "${this.name}" exited: code=${code}, signal=${signal}`);

    if (code !== 0) {
      this.status = SessionStatus.ERROR;
      const errorBlock = createOutputBlock(
        OutputType.ERROR,
        `Process exited with code ${code}`
      );
      this.buffer.append(errorBlock);
    } else {
      this.status = SessionStatus.IDLE;
    }

    this.adapter = null;
    this.emit('exit', { code, signal });
  }

  /**
   * 更新活跃时间
   */
  private updateActiveTime(): void {
    this.lastActiveAt = new Date();
  }
}

/**
 * 创建会话
 */
export function createSession(options: SessionOptions): ClaudeSession {
  return new ClaudeSession(options);
}
