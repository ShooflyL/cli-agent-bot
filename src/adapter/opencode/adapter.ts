/**
 * OpenCode CLI 适配器
 */

import { EventEmitter } from 'events';
import { CliAdapter, CliAdapterOptions, adapterRegistry } from '../cli-adapter';
import { spawnPty, PtyInstance } from '../claude/pty-process';
import { OutputParser } from '../claude/output-parser';
import { OutputType } from '../../core/types';
import { createLogger } from '../../core/logger';

const logger = createLogger('opencode-adapter');

/**
 * OpenCode 适配器
 */
export class OpenCodeAdapter implements CliAdapter {
  readonly name = 'opencode';
  readonly events = new EventEmitter();

  private pty: PtyInstance | null = null;
  private parser: OutputParser;
  private options: CliAdapterOptions;
  private isRunningFlag = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT = 3000;
  private lastOutputContent = '';

  constructor(options: CliAdapterOptions) {
    this.options = options;
    this.parser = new OutputParser();
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.isRunningFlag;
  }

  /**
   * 启动 CLI 会话
   */
  async start(): Promise<void> {
    logger.info(`Starting OpenCode adapter in ${this.options.cwd}`);

    // OpenCode 参数
    const args: string[] = [];
    // 添加工作目录
    args.push('--dir', this.options.cwd);
    
    if (this.options.extraArgs) {
      args.push(...this.options.extraArgs);
    }

    this.pty = spawnPty({
      executable: this.options.executable,
      cwd: this.options.cwd,
      env: this.options.env,
      skipPermissions: this.options.skipPermissions,
      args
    });

    this.pty.onData((data) => {
      this.handleOutput(data);
    });

    this.pty.onExit((code, signal) => {
      logger.info(`OpenCode PTY exited: code=${code}, signal=${signal}`);
      this.isRunningFlag = false;
      this.events.emit('exit', { code, signal });
    });

    this.pty.init();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.isRunningFlag = true;
    logger.info('OpenCode adapter started');
  }

  /**
   * 发送输入
   */
  sendInput(input: string): void {
    if (!this.pty) {
      throw new Error('Adapter not started');
    }

    logger.debug(`OpenCode sending input: ${input}`);
    this.pty.write(input);
    this.pty.write('\r');
  }

  /**
   * 发送原始数据（不追加回车）
   */
  sendRawInput(data: string): void {
    if (!this.pty) {
      throw new Error('Adapter not started');
    }

    logger.debug(`OpenCode sending raw input: ${JSON.stringify(data)}`);
    this.pty.write(data);
  }

  /**
   * 发送确认响应
   */
  sendConfirmResponse(response: string): void {
    if (!this.pty) {
      throw new Error('Adapter not started');
    }

    this.pty.write(response);
    this.pty.write('\r');
  }

  /**
   * 关闭会话
   */
  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    if (this.pty) {
      try {
        this.pty.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.pty.kill('SIGKILL');
      } catch (e) {
        logger.error('Error closing PTY:', e);
      }
      this.pty = null;
    }

    this.isRunningFlag = false;
    logger.info('OpenCode adapter closed');
  }

  /**
   * 处理输出
   */
  private handleOutput(data: string): void {
    const blocks = this.parser.parse(data);

    for (const block of blocks) {
      // 应用过滤
      if (block.type === OutputType.NORMAL && this.shouldFilter(block.content)) {
        continue;
      }

      this.events.emit('output', block);
    }

    this.resetIdleTimer();
  }

  /**
   * 过滤短输出
   */
  private shouldFilter(content: string): boolean {
    // 消息过滤表检查
    if (this.options.messageFilters) {
      for (const filter of this.options.messageFilters) {
        if (content.startsWith(filter)) {
          return true;
        }
      }
    }

    // 短消息过滤
    if (this.options.messageFilterEnabled !== false) {
      const minLength = this.options.messageFilterMinLength || 5;
      const cleaned = content.replace(/\s/g, '');
      
      if (cleaned.length < minLength) {
        return true;
      }

      // 相同内容过滤
      if (content === this.lastOutputContent) {
        return true;
      }

      // 进度状态过滤
      if (/processing|loading|thinking|Tinkering|Meandering/i.test(cleaned)) {
        if (cleaned.length > 50) {
          return false;
        }
        return true;
      }

      this.lastOutputContent = content;
    }

    return false;
  }

  /**
   * 重置空闲定时器
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.events.emit('idle');
    }, this.IDLE_TIMEOUT);
  }
}

/**
 * 注册 OpenCode 适配器
 */
export function registerOpenCodeAdapter(): void {
  adapterRegistry.register('opencode', (options) => new OpenCodeAdapter(options));
}
