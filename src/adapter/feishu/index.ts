/**
 * 飞书适配器
 * 支持长连接和 Webhook 两种消息接收模式
 */

import * as lark from '@larksuiteoapi/node-sdk';
import * as http from 'http';
import * as url from 'url';
import { BaseAdapter } from '../base';
import {
  IncomingMessage,
  MessageType,
  CardPayload,
  SendOptions,
  FeishuConfig
} from '../../core/types';
import { buildCard, buildConfirmCard } from './card';
import { createLogger } from '../../core/logger';

const logger = createLogger('feishu');

/**
 * 飞书适配器
 */
export class FeishuAdapter extends BaseAdapter {
  private client: lark.Client;
  private config: FeishuConfig;
  private wsClient: lark.WSClient | null = null;
  private httpServer: http.Server | null = null;

  constructor(config: FeishuConfig) {
    super();
    this.config = config;

    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu
    });
  }

  /**
   * 启动适配器
   */
  async start(): Promise<void> {
    logger.info('Starting Feishu adapter...');

    try {
      const mode = this.config.mode || 'longpoll';
      logger.info(`Connection mode: ${mode}`);

      if (mode === 'longpoll') {
        await this.startLongPoll();
      } else {
        await this.startWebhook();
      }

      this.running = true;
      logger.info('Feishu adapter started successfully');
    } catch (error) {
      logger.error(`Failed to start Feishu adapter: ${error}`);
      throw error;
    }
  }

  /**
   * 停止适配器
   */
  async stop(): Promise<void> {
    logger.info('Stopping Feishu adapter...');

    // 停止长连接
    if (this.wsClient) {
      try {
        await this.wsClient.close();
        this.wsClient = null;
        logger.info('WebSocket connection closed');
      } catch (error) {
        logger.error(`Error closing WebSocket: ${error}`);
      }
    }

    // 停止 HTTP 服务器
    if (this.httpServer) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.httpServer!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        this.httpServer = null;
        logger.info('HTTP server stopped');
      } catch (error) {
        logger.error(`Error stopping HTTP server: ${error}`);
      }
    }

    this.running = false;
    logger.info('Feishu adapter stopped');
  }

  /**
   * 启动长连接模式
   */
  private async startLongPoll(): Promise<void> {
    logger.info('Starting long connection (WebSocket) mode...');

    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: lark.Domain.Feishu,
    });

    const eventDispatcher = new lark.EventDispatcher({
      verificationToken: this.config.verificationToken,
      encryptKey: this.config.encryptKey,
    });

    eventDispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        await this.handleIncomingMessage({ event: data });
      }
    });

    await this.wsClient.start({
      eventDispatcher: eventDispatcher,
    });

    logger.info('WebSocket connection established');
  }

  /**
   * 启动 Webhook 模式
   */
  private async startWebhook(): Promise<void> {
    const port = this.config.webhookPort || 3000;

    logger.info(`Starting webhook server on port ${port}...`);

    this.httpServer = http.createServer(async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url || '', true);
        const path = parsedUrl.pathname;

        // 飞书事件订阅会发送到根路径
        if (path === '/' || path === '/webhook') {
          if (req.method === 'POST') {
            await this.handleWebhook(req, res);
          } else {
            res.writeHead(405);
            res.end('Method Not Allowed');
          }
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch (error) {
        logger.error(`Error handling request: ${error}`);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });

    logger.info(`Webhook server listening on port ${port}`);
    logger.info(`Configure your Feishu app event subscription URL to: http://your-domain:${port}/webhook`);
  }

  /**
   * 处理 Webhook 请求
   */
  private async handleWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // 读取请求体
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
      }

      if (!body) {
        res.writeHead(400);
        res.end(JSON.stringify({ code: 1, msg: 'empty body' }));
        return;
      }

      const data = JSON.parse(body);

      // 处理 URL 验证请求
      if (data.type === 'url_verification' && data.challenge) {
        logger.info('Received URL verification request');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: data.challenge }));
        logger.info('URL verification successful');
        return;
      }

      // 处理事件推送请求
      logger.debug('Received webhook event');
      await this.handleIncomingMessage(data);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, msg: 'success' }));
    } catch (error) {
      logger.error(`Error in webhook handler: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 1, msg: 'internal error' }));
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(chatId: string, text: string, options?: SendOptions): Promise<void> {
    logger.debug(`Sending text to ${chatId}: ${text.substring(0, 50)}...`);

    try {
      // 判断是私聊还是群聊
      const isPrivate = chatId.startsWith('ou_');

      await this.client.im.message.create({
        params: {
          receive_id_type: isPrivate ? 'open_id' : 'chat_id'
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text })
        }
      });
    } catch (error) {
      logger.error(`Failed to send text message: ${error}`);
      throw error;
    }
  }

  /**
   * 发送卡片消息
   */
  async sendCard(chatId: string, card: CardPayload, options?: SendOptions): Promise<void> {
    logger.debug(`Sending card to ${chatId}: ${card.title}`);

    try {
      const feishuCard = buildCard(card);
      const isPrivate = chatId.startsWith('ou_');

      await this.client.im.message.create({
        params: {
          receive_id_type: isPrivate ? 'open_id' : 'chat_id'
        },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(feishuCard)
        }
      });
    } catch (error) {
      logger.error(`Failed to send card message: ${error}`);
      throw error;
    }
  }

  /**
   * 发送确认卡片
   */
  async sendConfirmCard(
    chatId: string,
    title: string,
    content: string,
    confirmId: string,
    options: string[]
  ): Promise<void> {
    const card = buildConfirmCard(title, content, confirmId, options);
    const isPrivate = chatId.startsWith('ou_');

    try {
      await this.client.im.message.create({
        params: {
          receive_id_type: isPrivate ? 'open_id' : 'chat_id'
        },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card)
        }
      });
    } catch (error) {
      logger.error(`Failed to send confirm card: ${error}`);
      throw error;
    }
  }

  /**
   * 响应交互回调
   */
  async respondInteraction(token: string, response: unknown): Promise<void> {
    try {
      // 使用token作为message_id进行回复
      await this.client.im.message.reply({
        path: {
          message_id: token
        },
        data: {
          content: typeof response === 'string' ? response : JSON.stringify(response),
          msg_type: 'interactive'
        }
      });
    } catch (error) {
      logger.error(`Failed to respond interaction: ${error}`);
      throw error;
    }
  }

  /**
   * 处理接收到的消息（供外部调用，如 webhook）
   */
  async handleIncomingMessage(event: any): Promise<void> {
    try {
      logger.debug('Raw event received:', JSON.stringify(event, null, 2));

      const message = event?.message || event?.event?.message;
      if (!message) {
        logger.warn('No message found in event');
        return;
      }

      // 忽略机器人自己发送的消息
      if (message.message_type === 'post' || message.message_type === 'file') {
        logger.debug('Ignoring post/file message');
        return;
      }

      // 解析消息内容
      let content = '';
      if (message.message_type === 'text') {
        try {
          const textContent = JSON.parse(message.content || '{}');
          content = textContent.text || '';
        } catch {
          content = message.content || '';
        }
      }

      if (!content.trim()) {
        logger.debug('Empty message content, ignoring');
        return;
      }

      // 构建统一消息格式
      const chatId = message.chat_id || event?.event?.sender?.sender_id?.open_id || '';
      const userId = event?.event?.sender?.sender_id?.open_id || message.sender?.id || '';

      logger.info(`Message details - chatId: ${chatId}, userId: ${userId}, content: ${content.substring(0, 50)}`);

      const incomingMessage: IncomingMessage = {
        chatId,
        userId,
        content: content.trim(),
        type: content.startsWith('/') ? MessageType.COMMAND : MessageType.TEXT,
        messageId: message.message_id,
        timestamp: new Date(parseInt(message.create_time) || Date.now())
      };

      // 分发给处理器
      await this.dispatchMessage(incomingMessage);

    } catch (error) {
      logger.error(`Error handling message: ${error}`);
    }
  }
}

/**
 * 创建飞书适配器
 */
export function createFeishuAdapter(config: FeishuConfig): FeishuAdapter {
  return new FeishuAdapter(config);
}
