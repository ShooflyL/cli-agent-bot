/**
 * 模型指令
 * 设置 Claude 使用的模型
 */

import { CommandDefinition, CommandContext } from '../../core/types';

export const modelCommand: CommandDefinition = {
  name: 'model',
  description: '设置 Claude 使用的模型',
  usage: '/model <模型名称>',
  aliases: ['m'],
  handler: async (ctx: CommandContext): Promise<void> => {
    const app = (global as any).app;
    if (!app) {
      throw new Error('Application not initialized');
    }

    const model = ctx.args[0];
    if (!model) {
      await app.adapter.sendText(ctx.message.chatId,
        '📋 可用模型：\n\n' +
        '• sonnet (默认)\n' +
        '• opus\n' +
        '• haiku\n\n' +
        '用法：/model sonnet'
      );
      return;
    }

    const session = app.sessionManager.getChatActiveSession(ctx.message.chatId);
    if (!session) {
      await app.adapter.sendText(ctx.message.chatId, '当前没有活跃会话');
      return;
    }

    // 向 CLI 发送 /model 指令
    await session.sendInput(`/model ${model}`);
    await app.adapter.sendText(ctx.message.chatId, `✅ 已发送模型切换指令: ${model}`);
  }
};
