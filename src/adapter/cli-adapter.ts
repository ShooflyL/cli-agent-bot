/**
 * CLI 适配器接口
 * 定义所有 CLI 工具适配器需要实现的接口
 */

import { EventEmitter } from 'events';

export interface CliAdapterOptions {
  /** 可执行文件路径 */
  executable: string;
  /** 工作目录 */
  cwd: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 跳过权限确认 */
  skipPermissions?: boolean;
  /** 额外参数 */
  extraArgs?: string[];
  /** 消息过滤表 */
  messageFilters?: string[];
  /** 消息过滤配置 */
  messageFilterEnabled?: boolean;
  messageFilterMinLength?: number;
}

/**
 * CLI 适配器接口
 */
export interface CliAdapter {
  /** 适配器名称 */
  readonly name: string;
  
  /** 事件发射器 */
  readonly events: EventEmitter;

  /**
   * 启动 CLI 会话
   */
  start(): Promise<void>;

  /**
   * 发送输入
   */
  sendInput(input: string): void;

  /**
   * 发送原始数据（不追加回车）
   */
  sendRawInput(data: string): void;

  /**
   * 发送确认响应
   */
  sendConfirmResponse(response: string): void;

  /**
   * 关闭会话
   */
  close(): Promise<void>;

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean;
}

/**
 * CLI 适配器工厂函数类型
 */
export type CliAdapterFactory = (options: CliAdapterOptions) => CliAdapter;

/**
 * 适配器注册表
 */
export class AdapterRegistry {
  private adapters: Map<string, CliAdapterFactory> = new Map();

  /**
   * 注册适配器
   */
  register(name: string, factory: CliAdapterFactory): void {
    this.adapters.set(name, factory);
    console.log(`[AdapterRegistry] Registered adapter: ${name}`);
  }

  /**
   * 创建适配器
   */
  create(name: string, options: CliAdapterOptions): CliAdapter {
    const factory = this.adapters.get(name);
    if (!factory) {
      throw new Error(`Adapter "${name}" not registered. Available: ${Array.from(this.adapters.keys()).join(', ')}`);
    }
    return factory(options);
  }

  /**
   * 获取所有已注册的适配器名称
   */
  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * 检查适配器是否已注册
   */
  has(name: string): boolean {
    return this.adapters.has(name);
  }
}

/**
 * 全局适配器注册表
 */
export const adapterRegistry = new AdapterRegistry();
