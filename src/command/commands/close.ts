/**
 * /close 指令 - 关闭会话
 */

import { CommandDefinition, CommandContext } from '../../core/types';

export const closeCommand: CommandDefinition = {
  name: 'close',
  description: '关闭指定会话',
  usage: '/close <名称>',
  aliases: ['exit', 'kill'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const { message, args } = ctx;
    const app = (global as any).app;

    if (!app) {
      throw new Error('Application not initialized');
    }

    if (args.length < 1) {
      await app.adapter.sendText(message.chatId,
        '用法: /close <名称>\n' +
        '使用 /list 查看所有可用会话'
      );
      return;
    }

    const name = args[0];

    try {
      const session = app.sessionManager.getSession(name);
      const workDir = session?.workDir || 'unknown';

      await app.sessionManager.closeSession(name);

      await app.adapter.sendCard(message.chatId, {
        title: '✅ 会话已关闭',
        content: `**名称:** ${name}\n**目录:** \`${workDir}\``,
        type: 'success' as any
      });

    } catch (error: any) {
      await app.adapter.sendCard(message.chatId, {
        title: '❌ 关闭失败',
        content: `错误: ${error.message}`,
        type: 'error' as any
      });
    }
  }
};
