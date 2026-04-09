const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.nodeEnv === 'production' ? 'info' : 'http',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level}]: ${message}${metaStr}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;
