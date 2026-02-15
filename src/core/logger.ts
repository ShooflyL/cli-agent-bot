/**
 * 日志模块
 */

import winston from 'winston';
import { LoggingConfig } from './types';

let logger: winston.Logger | null = null;

/**
 * 初始化日志器
 */
export function initLogger(config: LoggingConfig): winston.Logger {
  const transports: winston.transport[] = [];

  // 控制台输出
  if (config.console) {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}]: ${message}${metaStr}`;
          })
        )
      })
    );
  }

  // 文件输出
  if (config.file) {
    transports.push(
      new winston.transports.File({
        filename: config.file,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.json()
        )
      })
    );
  }

  logger = winston.createLogger({
    level: config.level || 'info',
    transports
  });

  return logger;
}

/**
 * 获取日志器
 */
export function getLogger(): winston.Logger {
  if (!logger) {
    // 默认配置
    logger = winston.createLogger({
      level: 'info',
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }
  return logger;
}

/**
 * 创建带标签的日志器
 * 返回一个包含 label 的子日志器
 */
export function createLogger(label: string): winston.Logger {
  const baseLogger = getLogger();
  return baseLogger.child({ label });
}

/**
 * 创建子日志器
 */
export function createChildLogger(label: string): winston.Logger {
  return createLogger(label);
}
