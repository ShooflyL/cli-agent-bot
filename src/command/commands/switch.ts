/**
 * /switch 指令 - 切换会话
 */

import { CommandDefinition, CommandContext } from '../../core/types';

export const switchCommand: CommandDefinition = {
  name: 'switch',
  description: '切换到指定会话',
  usage: '/switch <名称>',
  aliases: ['use', 's'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const { message, args } = ctx;
    const app = (global as any).app;

    if (!app) {
      throw new Error('Application not initialized');
    }

    if (args.length < 1) {
      await app.adapter.sendText(message.chatId,
        '用法: /switch <名称>\n' +
        '使用 /list 查看所有可用会话'
      );
      return;
    }

    const name = args[0];

    try {
      app.sessionManager.setChatActiveSession(message.chatId, name);

      const session = app.sessionManager.getSession(name);
      await app.adapter.sendCard(message.chatId, {
        title: '✅ 已切换会话',
        content: `**当前会话:** ${name}\n**目录:** \`${session?.workDir || 'unknown'}\``,
        type: 'success' as any
      });

    } catch (error: any) {
      await app.adapter.sendCard(message.chatId, {
        title: '❌ 切换失败',
        content: `错误: ${error.message}\n\n使用 /list 查看所有可用会话`,
        type: 'error' as any
      });
    }
  }
};
