/**
 * 事件系统
 */

import { EventEmitter } from 'events';
import { EventType, EventPayload, EventListener } from './types';
import { getLogger } from './logger';

/**
 * 事件总线
 */
class EventBus extends EventEmitter {
  private static instance: EventBus;

  private constructor() {
    super();
    // 增加监听器上限
    this.setMaxListeners(50);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * 发送事件
   */
  emitEvent(type: EventType, data: unknown): void {
    const payload: EventPayload = {
      type,
      data,
      timestamp: new Date()
    };

    const logger = getLogger();
    logger.debug(`Event emitted: ${type}`, { data });

    this.emit(type, payload);
    // 同时发送通用事件
    this.emit('*', payload);
  }

  /**
   * 订阅事件
   */
  subscribe(type: EventType | '*', listener: EventListener): void {
    this.on(type, listener as (...args: unknown[]) => void);
  }

  /**
   * 取消订阅
   */
  unsubscribe(type: EventType | '*', listener: EventListener): void {
    this.off(type, listener as (...args: unknown[]) => void);
  }

  /**
   * 一次性订阅
   */
  onceEvent(type: EventType, listener: EventListener): void {
    this.once(type, listener as (...args: unknown[]) => void);
  }
}

/**
 * 获取事件总线实例
 */
export function getEventBus(): EventBus {
  return EventBus.getInstance();
}

/**
 * 发送事件
 */
export function emitEvent(type: EventType, data: unknown): void {
  getEventBus().emitEvent(type, data);
}

/**
 * 订阅事件
 */
export function subscribeEvent(type: EventType | '*', listener: EventListener): void {
  getEventBus().subscribe(type, listener);
}

/**
 * 取消订阅事件
 */
export function unsubscribeEvent(type: EventType | '*', listener: EventListener): void {
  getEventBus().unsubscribe(type, listener);
}

// 导出事件类型以便使用
export { EventType };
