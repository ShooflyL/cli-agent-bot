/**
 * 飞书卡片消息构建器
 */

import { CardPayload, CardType, CardButton } from '../../core/types';

/**
 * 卡片元素类型
 */
interface CardElement {
  tag: string;
  [key: string]: unknown;
}

/**
 * 卡片消息结构
 */
interface FeishuCard {
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
  };
  header?: {
    title: {
      tag: string;
      content: string;
    };
    template?: string;
  };
  elements: CardElement[];
}

/**
 * 颜色模板映射
 */
const COLOR_TEMPLATES: Record<CardType, string> = {
  [CardType.DEFAULT]: 'turquoise',
  [CardType.CONFIRM]: 'blue',
  [CardType.ERROR]: 'red',
  [CardType.SUCCESS]: 'green'
};

/**
 * 构建飞书卡片消息
 */
export function buildCard(payload: CardPayload): FeishuCard {
  const card: FeishuCard = {
    config: {
      wide_screen_mode: true,
      enable_forward: true
    },
    header: {
      title: {
        tag: 'plain_text',
        content: payload.title
      },
      template: COLOR_TEMPLATES[payload.type || CardType.DEFAULT]
    },
    elements: []
  };

  // 添加内容
  if (payload.content) {
    card.elements.push({
      tag: 'markdown',
      content: formatContent(payload.content)
    });
  }

  // 添加按钮
  if (payload.buttons && payload.buttons.length > 0) {
    card.elements.push(buildButtonElement(payload.buttons));
  }

  return card;
}

/**
 * 格式化内容
 */
function formatContent(content: string): string {
  // 限制内容长度，避免卡片过长
  const maxLength = 8000;
  if (content.length > maxLength) {
    return content.substring(0, maxLength) + '\n\n... (内容已截断)';
  }
  return content;
}

/**
 * 构建按钮元素
 */
function buildButtonElement(buttons: CardButton[]): CardElement {
  if (buttons.length <= 3) {
    // 少于3个按钮，使用横向排列
    return {
      tag: 'action',
      actions: buttons.map(btn => ({
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: btn.text
        },
        type: 'primary',
        value: btn.value || { action: btn.action }
      }))
    };
  } else {
    // 多于3个按钮，使用交互式选择器
    return {
      tag: 'action',
      actions: [
        {
          tag: 'select_static',
          placeholder: {
            tag: 'plain_text',
            content: '请选择'
          },
          options: buttons.map(btn => ({
            text: {
              tag: 'plain_text',
              content: btn.text
            },
            value: btn.action
          }))
        }
      ]
    };
  }
}

/**
 * 构建确认卡片
 */
export function buildConfirmCard(
  title: string,
  content: string,
  confirmId: string,
  options: string[]
): FeishuCard {
  const buttons: CardButton[] = options.map(opt => ({
    text: opt,
    action: 'confirm',
    value: {
      confirmId,
      response: opt
    }
  }));

  return buildCard({
    title,
    content,
    type: CardType.CONFIRM,
    buttons
  });
}

/**
 * 构建错误卡片
 */
export function buildErrorCard(title: string, error: string | Error): FeishuCard {
  const content = typeof error === 'string' ? error : error.message;
  return buildCard({
    title: `❌ ${title}`,
    content: `\`\`\`\n${content}\n\`\`\``,
    type: CardType.ERROR
  });
}

/**
 * 构建成功卡片
 */
export function buildSuccessCard(title: string, content: string): FeishuCard {
  return buildCard({
    title: `✅ ${title}`,
    content,
    type: CardType.SUCCESS
  });
}

/**
 * 构建会话列表卡片
 */
export function buildSessionListCard(
  sessions: Array<{ name: string; status: string; workDir: string; active?: boolean }>
): FeishuCard {
  let content = '';

  if (sessions.length === 0) {
    content = '暂无活跃会话\n\n使用 `/new <名称> <路径>` 创建新会话';
  } else {
    for (const session of sessions) {
      const statusEmoji = getStatusEmoji(session.status);
      const activeMarker = session.active ? ' **[当前]**' : '';
      content += `${statusEmoji} **${session.name}**${activeMarker}\n`;
      content += `   状态: ${session.status}\n`;
      content += `   目录: \`${session.workDir}\`\n\n`;
    }
  }

  return buildCard({
    title: '📋 会话列表',
    content,
    type: CardType.DEFAULT
  });
}

/**
 * 构建状态卡片
 */
export function buildStatusCard(stats: {
  totalSessions: number;
  maxSessions: number;
  uptime: number;
  version: string;
}): FeishuCard {
  const uptimeStr = formatUptime(stats.uptime);

  const content = `
**系统状态**

- 版本: ${stats.version}
- 运行时间: ${uptimeStr}
- 会话数: ${stats.totalSessions} / ${stats.maxSessions}
`.trim();

  return buildCard({
    title: '📊 系统状态',
    content,
    type: CardType.DEFAULT
  });
}

/**
 * 构建帮助卡片
 */
export function buildHelpCard(commands: Array<{ name: string; usage: string; description: string }>): FeishuCard {
  let content = '**可用指令**\n\n';

  for (const cmd of commands) {
    content += `- **${cmd.usage}**\n  ${cmd.description}\n\n`;
  }

  content += '---\n\n直接发送消息即可与当前会话中的 Claude Code 交互。';

  return buildCard({
    title: '📖 帮助',
    content,
    type: CardType.DEFAULT
  });
}

/**
 * 获取状态表情
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'idle':
      return '🟢';
    case 'processing':
      return '🟡';
    case 'waiting_confirm':
      return '🔵';
    case 'error':
      return '🔴';
    default:
      return '⚪';
  }
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);

  return parts.join(' ') || '刚刚启动';
}
