/**
 * 输出缓冲区
 * 用于缓存会话的普通输出，支持轮询获取
 */

import { OutputBlock, OutputType } from '../core/types';

/**
 * 输出缓冲区配置
 */
export interface OutputBufferOptions {
  maxSize: number;
}

/**
 * 输出缓冲区类
 */
export class OutputBuffer {
  private buffer: OutputBlock[] = [];
  private totalSize: number = 0;
  private readonly maxSize: number;

  constructor(options: OutputBufferOptions) {
    this.maxSize = options.maxSize;
  }

  /**
   * 添加输出块
   */
  append(block: OutputBlock): void {
    const blockSize = this.estimateSize(block);

    // 如果超过最大大小，移除旧数据
    while (this.totalSize + blockSize > this.maxSize && this.buffer.length > 0) {
      const removed = this.buffer.shift();
      if (removed) {
        this.totalSize -= this.estimateSize(removed);
      }
    }

    this.buffer.push(block);
    this.totalSize += blockSize;
  }

  /**
   * 获取所有缓存输出
   */
  getAll(): OutputBlock[] {
    return [...this.buffer];
  }

  /**
   * 获取并清除所有缓存输出
   */
  fetchAndClear(): OutputBlock[] {
    const result = this.buffer;
    this.buffer = [];
    this.totalSize = 0;
    return result;
  }

  /**
   * 获取最新N条输出
   */
  getLast(n: number): OutputBlock[] {
    if (n >= this.buffer.length) {
      return [...this.buffer];
    }
    return this.buffer.slice(-n);
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.buffer = [];
    this.totalSize = 0;
  }

  /**
   * 获取当前缓冲区大小
   */
  getSize(): number {
    return this.totalSize;
  }

  /**
   * 获取缓冲区块数
   */
  getLength(): number {
    return this.buffer.length;
  }

  /**
   * 检查是否为空
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * 估算输出块大小
   */
  private estimateSize(block: OutputBlock): number {
    // 简单估算：内容长度 + 元数据开销
    return (block.content?.length || 0) + 100;
  }
}

/**
 * 创建输出块
 */
export function createOutputBlock(
  type: OutputType,
  content: string,
  options?: Partial<OutputBlock>
): OutputBlock {
  return {
    type,
    content,
    timestamp: new Date(),
    ...options
  };
}
