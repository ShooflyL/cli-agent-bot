/**
 * 按键指令
 * 向 CLI PTY 发送键盘按键的转义序列
 */

import { CommandDefinition, CommandContext } from '../../core/types';

// 终端转义序列
const KEY_UP = '\x1b[A';
const KEY_DOWN = '\x1b[B';
const KEY_ENTER = '\r';
const KEY_ESC = '\x1b';

/**
 * 通过会话发送原始按键
 */
async function sendKey(ctx: CommandContext, key: string, keyName: string): Promise<void> {
  const app = (global as any).app;
  const session = app.sessionManager.getChatActiveSession(ctx.message.chatId);

  if (!session) {
    await app.adapter.sendText(ctx.message.chatId, '⚠️ 当前没有活跃的会话，请先创建会话');
    return;
  }

  const info = session.getInfo();
  if (info.status === 'error') {
    await app.adapter.sendText(ctx.message.chatId, '⚠️ 当前会话已崩溃，请重新创建会话');
    return;
  }

  await session.sendRawInput(key);
}

/**
 * 向上箭头键指令
 */
export const upCommand: CommandDefinition = {
  name: 'up',
  description: '发送向上箭头键',
  usage: '/up',
  aliases: ['arrow-up', 'keyup'],
  handler: async (ctx: CommandContext): Promise<void> => {
    await sendKey(ctx, KEY_UP, 'Up');
  }
};

/**
 * 向下箭头键指令
 */
export const downCommand: CommandDefinition = {
  name: 'down',
  description: '发送向下箭头键',
  usage: '/down',
  aliases: ['arrow-down', 'keydown'],
  handler: async (ctx: CommandContext): Promise<void> => {
    await sendKey(ctx, KEY_DOWN, 'Down');
  }
};

/**
 * Enter键指令
 */
export const enterCommand: CommandDefinition = {
  name: 'enter',
  description: '发送Enter键',
  usage: '/enter',
  aliases: ['return', 'confirm'],
  handler: async (ctx: CommandContext): Promise<void> => {
    await sendKey(ctx, KEY_ENTER, 'Enter');
  }
};

/**
 * Esc键指令
 */
export const escCommand: CommandDefinition = {
  name: 'esc',
  description: '发送Esc键（取消操作）',
  usage: '/esc',
  aliases: ['escape', 'cancel', 'skip'],
  handler: async (ctx: CommandContext): Promise<void> => {
    await sendKey(ctx, KEY_ESC, 'Esc');
  }
};

/**
 * 所有按键指令
 */
export const keyCommands: CommandDefinition[] = [
  upCommand,
  downCommand,
  enterCommand,
  escCommand
];
