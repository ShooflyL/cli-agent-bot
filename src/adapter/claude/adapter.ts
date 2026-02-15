/**
 * Claude Code CLI 适配器
 */

import { EventEmitter } from 'events';
import { CliAdapter, CliAdapterOptions, adapterRegistry } from '../cli-adapter';
import { spawnPty, PtyInstance } from './pty-process';
import { OutputParser } from './output-parser';
import { OutputBlock, OutputType } from '../../core/types';
import { createLogger } from '../../core/logger';

const logger = createLogger('claude-adapter');

/**
 * Claude Code 适配器
 */
export class ClaudeAdapter implements CliAdapter {
  readonly name = 'claude';
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
    logger.info(`Starting Claude adapter in ${this.options.cwd}`);

    // 额外参数（skipPermissions 由 PTY 层处理，避免重复）
    const args: string[] = [];
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

    // 用 Promise 竞争检测启动期间的早退：
    // 要么等待 2 秒正常启动，要么进程提前退出则立即报错
    let earlyExitReject: (err: Error) => void;
    const earlyExitPromise = new Promise<never>((_, reject) => {
      earlyExitReject = reject;
    });
    // 防止启动成功后的正常退出触发 unhandled rejection
    earlyExitPromise.catch(() => {});

    this.pty.onData((data) => {
      this.handleOutput(data);
    });

    this.pty.onExit((code, signal) => {
      logger.info(`Claude PTY exited: code=${code}, signal=${signal}`);
      this.isRunningFlag = false;
      this.events.emit('exit', { code, signal });
      earlyExitReject(new Error(`Process exited during startup with code ${code}`));
    });

    this.pty.init();

    try {
      await Promise.race([
        new Promise(resolve => setTimeout(resolve, 2000)),
        earlyExitPromise
      ]);
    } catch (error) {
      // 进程在 2 秒内退出了，抛出错误
      logger.error(`Claude adapter failed to start: ${error}`);
      this.pty = null;
      throw error;
    }

    this.isRunningFlag = true;
    logger.info('Claude adapter started');
  }

  /**
   * 发送输入
   */
  sendInput(input: string): void {
    if (!this.pty) {
      throw new Error('Adapter not started');
    }

    logger.debug(`Claude sending input: ${input}`);
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

    logger.debug(`Claude sending raw input: ${JSON.stringify(data)}`);
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
    logger.info('Claude adapter closed');
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
      if (/Crunch|processing|loading|thinking|Tinkering|Meandering/i.test(cleaned)) {
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
 * 注册 Claude 适配器
 */
export function registerClaudeAdapter(): void {
  adapterRegistry.register('claude', (options) => new ClaudeAdapter(options));
}
