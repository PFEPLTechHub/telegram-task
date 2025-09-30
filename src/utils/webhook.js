
// src/utils/webhook.js
const logger = require('./logger');

// Set up webhook for production environment
async function setupWebhook(bot, app, webhookUrl) {
  try {
    // Set webhook
    await bot.telegram.setWebhook(webhookUrl);
    
    // Handle webhook requests
    app.use(bot.webhookCallback('/'));
    
    logger.info(`Webhook set up at ${webhookUrl}`);
    return true;
  } catch (error) {
    logger.error('Error setting up webhook:', error);
    throw error;
  }
}

module.exports = {
  setupWebhook
};