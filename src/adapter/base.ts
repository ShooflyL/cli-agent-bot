/**
 * 适配器基类
 */

import { IChatAdapter, MessageHandler, IncomingMessage, CardPayload, SendOptions } from '../core/types';

// 重新导出接口
export { IChatAdapter } from '../core/types';

/**
 * 适配器基类
 * 提供通用的消息处理器管理
 */
export abstract class BaseAdapter implements IChatAdapter {
  protected messageHandlers: MessageHandler[] = [];
  protected running: boolean = false;

  /**
   * 启动适配器
   */
  abstract start(): Promise<void>;

  /**
   * 停止适配器
   */
  abstract stop(): Promise<void>;

  /**
   * 发送文本消息
   */
  abstract sendText(chatId: string, text: string, options?: SendOptions): Promise<void>;

  /**
   * 发送卡片消息
   */
  abstract sendCard(chatId: string, card: CardPayload, options?: SendOptions): Promise<void>;

  /**
   * 响应交互回调
   */
  abstract respondInteraction(token: string, response: unknown): Promise<void>;

  /**
   * 注册消息处理器
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 移除消息处理器
   */
  removeMessageHandler(handler: MessageHandler): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index !== -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  /**
   * 分发消息给所有处理器
   */
  protected async dispatchMessage(message: IncomingMessage): Promise<void> {
    for (const handler of this.messageHandlers) {
      try {
        await handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    }
  }

  /**
   * 检查是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }
}
