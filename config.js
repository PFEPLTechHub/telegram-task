// config.js
require('dotenv').config();

module.exports = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ,
  databaseConfig: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'task_manager',
    port: process.env.DB_PORT ||3306
  },
  port: process.env.PORT || 3000,
  webhookUrl: process.env.WEBHOOK_URL || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  // Base URL used for buttons that open the web UI (e.g., http://localhost:3000 in dev)
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://67ea762b9f35.ngrok-free.app '
};

// require('dotenv').config();

// module.exports = {
//   telegramToken: process.env.TELEGRAM_BOT_TOKEN,  // keep from env for security
//   databaseConfig: {
//     host: process.env.DB_HOST || 'mysql-306abdc2-shaikhazeem4646-0045.b.aivencloud.com',
//     user: process.env.DB_USER || 'avnadmin',
//     password: process.env.DB_PASSWORD || 'AVNS_V0txWx9IOoC7ql6tywX',
//     database: process.env.DB_NAME || 'defaultdb',
//     port: process.env.DB_PORT || 23152,
//     ssl: {
//       rejectUnauthorized: false  // to enable SSL connection required by Aiven
//     }
//   },
//   port: process.env.PORT || 3000,
//   webhookUrl: process.env.WEBHOOK_URL || '',
//   logLevel: process.env.LOG_LEVEL || 'info'
// };

// below deployment config
// config.js
// require('dotenv').config();

// module.exports = {
//   telegramToken: process.env.TELEGRAM_BOT_TOKEN || '7591099212:AAGqHBMDxKAapWq___4yioFqslX-tdXKyMA',
//   databaseConfig: {
//     host: process.env.DB_HOST || 'crossover.proxy.rlwy.net',
//     user: process.env.DB_USER || 'root',
//     password: process.env.DB_PASSWORD || 'ZDQmNSFYxlfclHoIbGBdAGIxgxOjWuFD',
//     database: process.env.DB_NAME || 'railway',
//     port: process.env.DB_PORT || 48512
//   },
//   port: process.env.PORT || 3000,
//   webhookUrl: process.env.WEBHOOK_URL || '',
//   logLevel: process.env.LOG_LEVEL || 'info'
// }