/**
 * /poll 指令 - 获取缓存输出
 */

import { CommandDefinition, CommandContext, OutputBlock } from '../../core/types';

export const pollCommand: CommandDefinition = {
  name: 'poll',
  description: '获取当前会话的缓存输出',
  usage: '/poll',
  aliases: ['output', 'get'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const { message } = ctx;
    const app = (global as any).app;

    if (!app) {
      throw new Error('Application not initialized');
    }

    const session = app.sessionManager.getChatActiveSession(message.chatId);

    if (!session) {
      await app.adapter.sendText(message.chatId,
        '当前没有活跃会话\n' +
        '使用 /new <名称> [目录] 创建新会话'
      );
      return;
    }

    const output: OutputBlock[] = session.getBufferedOutput();

    if (output.length === 0) {
      await app.adapter.sendText(message.chatId,
        `会话 **${session.name}** 当前没有缓存输出`
      );
      return;
    }

    // 合并输出内容
    const content = output
      .map((block: OutputBlock) => {
        const prefix = block.type === 'error' ? '❌ ' : '';
        return prefix + block.content;
      })
      .join('\n\n---\n\n');

    await app.adapter.sendCard(message.chatId, {
      title: `📤 缓存输出 (${output.length} 条)`,
      content,
      type: 'default' as any
    });
  }
};
