/**
 * 指令注册表
 * 管理所有可用指令
 */

import { CommandDefinition, CommandHandler, CommandContext } from '../core/types';
import { createLogger } from '../core/logger';

const logger = createLogger('command-registry');

/**
 * 指令注册表
 */
class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private aliases: Map<string, string> = new Map();

  /**
   * 注册指令
   */
  register(definition: CommandDefinition): void {
    const { name, aliases, handler } = definition;

    if (this.commands.has(name)) {
      logger.warn(`Command "${name}" already registered, overwriting`);
    }

    this.commands.set(name, definition);
    logger.debug(`Registered command: ${name}`);

    // 注册别名
    if (aliases) {
      for (const alias of aliases) {
        if (this.aliases.has(alias)) {
          logger.warn(`Alias "${alias}" already registered, overwriting`);
        }
        this.aliases.set(alias, name);
        logger.debug(`Registered alias: ${alias} -> ${name}`);
      }
    }
  }

  /**
   * 批量注册指令
   */
  registerAll(definitions: CommandDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * 获取指令定义
   */
  get(name: string): CommandDefinition | undefined {
    // 先尝试直接获取
    let def = this.commands.get(name);

    // 如果没有，尝试通过别名获取
    if (!def) {
      const realName = this.aliases.get(name);
      if (realName) {
        def = this.commands.get(realName);
      }
    }

    return def;
  }

  /**
   * 检查指令是否存在
   */
  has(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name);
  }

  /**
   * 获取所有指令
   */
  getAll(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * 获取所有指令名
   */
  getNames(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * 移除指令
   */
  remove(name: string): boolean {
    const def = this.commands.get(name);
    if (!def) {
      return false;
    }

    // 移除别名
    if (def.aliases) {
      for (const alias of def.aliases) {
        this.aliases.delete(alias);
      }
    }

    this.commands.delete(name);
    return true;
  }

  /**
   * 清空所有指令
   */
  clear(): void {
    this.commands.clear();
    this.aliases.clear();
  }
}

// 单例实例
let registry: CommandRegistry | null = null;

/**
 * 获取指令注册表实例
 */
export function getCommandRegistry(): CommandRegistry {
  if (!registry) {
    registry = new CommandRegistry();
  }
  return registry;
}

/**
 * 注册指令（便捷方法）
 */
export function registerCommand(definition: CommandDefinition): void {
  getCommandRegistry().register(definition);
}

/**
 * 获取指令（便捷方法）
 */
export function getCommand(name: string): CommandDefinition | undefined {
  return getCommandRegistry().get(name);
}
