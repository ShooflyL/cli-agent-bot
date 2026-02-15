/**
 * IM 适配器注册表
 * 用于注册和管理不同的 IM 适配器（如飞书、Slack、Discord 等）
 */

import { IChatAdapter } from '../core/types';

/**
 * IM 适配器工厂函数类型
 */
export type ChatAdapterFactory = (config: any) => IChatAdapter;

/**
 * IM 适配器注册表
 */
export class ChatAdapterRegistry {
  private adapters: Map<string, ChatAdapterFactory> = new Map();

  /**
   * 注册适配器
   */
  register(name: string, factory: ChatAdapterFactory): void {
    this.adapters.set(name, factory);
    console.log(`[ChatAdapterRegistry] Registered adapter: ${name}`);
  }

  /**
   * 创建适配器
   */
  create(name: string, config: any): IChatAdapter {
    const factory = this.adapters.get(name);
    if (!factory) {
      throw new Error(`ChatAdapter "${name}" not registered. Available: ${Array.from(this.adapters.keys()).join(', ')}`);
    }
    return factory(config);
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
 * 全局 IM 适配器注册表
 */
export const chatAdapterRegistry = new ChatAdapterRegistry();
