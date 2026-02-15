/**
 * 指令解析器
 * 解析消息中的指令
 */

import { IncomingMessage, MessageType, CommandContext } from '../core/types';
import { getCommandRegistry } from './registry';
import { createLogger } from '../core/logger';

const logger = createLogger('command-parser');

/**
 * 解析结果
 */
export interface ParseResult {
  isCommand: boolean;
  commandName: string | null;
  args: string[];
  rawArgs: string;
}

/**
 * 解析消息中的指令
 */
export function parseCommand(message: IncomingMessage): ParseResult {
  const content = message.content.trim();

  // 检查是否是指令
  if (!content.startsWith('/')) {
    return {
      isCommand: false,
      commandName: null,
      args: [],
      rawArgs: ''
    };
  }

  // 移除前导斜杠
  const withoutSlash = content.slice(1);

  // 分割指令名和参数
  const parts = withoutSlash.split(/\s+/);
  const commandName = parts[0].toLowerCase();
  const args = parts.slice(1);
  const rawArgs = args.join(' ');

  logger.debug(`Parsed command: ${commandName}, args: ${rawArgs}`);

  return {
    isCommand: true,
    commandName,
    args,
    rawArgs
  };
}

/**
 * 执行指令
 */
export async function executeCommand(
  message: IncomingMessage,
  session?: { name: string; workDir: string; status: string }
): Promise<boolean> {
  const parseResult = parseCommand(message);

  if (!parseResult.isCommand || !parseResult.commandName) {
    return false;
  }

  const registry = getCommandRegistry();
  const command = registry.get(parseResult.commandName);

  if (!command) {
    logger.warn(`Unknown command: ${parseResult.commandName}`);
    return false;
  }

  // 构建指令上下文
  const context: CommandContext = {
    message,
    session: session ? {
      name: session.name,
      workDir: session.workDir,
      status: session.status as any,
      createdAt: new Date(),
      lastActiveAt: new Date()
    } : undefined,
    args: parseResult.args,
    rawArgs: parseResult.rawArgs
  };

  try {
    logger.info(`Executing command: ${parseResult.commandName}`);
    await command.handler(context);
    return true;
  } catch (error) {
    logger.error(`Error executing command ${parseResult.commandName}: ${error}`);
    throw error;
  }
}

/**
 * 检查消息是否为指令
 */
export function isCommandMessage(message: IncomingMessage): boolean {
  return message.content.trim().startsWith('/');
}

/**
 * 获取指令名
 */
export function extractCommandName(message: IncomingMessage): string | null {
  const content = message.content.trim();
  if (!content.startsWith('/')) {
    return null;
  }

  const withoutSlash = content.slice(1);
  const parts = withoutSlash.split(/\s+/);
  return parts[0].toLowerCase() || null;
}
