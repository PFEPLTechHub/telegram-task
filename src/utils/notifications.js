// src/utils/notifications.js
const logger = require('./logger');

/**
 * Send a notification to a user via Telegram
 * This handles the limitations of non-user-initiated messages
 * 
 * @param {Object} telegram - Telegram instance
 * @param {Number} telegramId - Telegram user ID to notify
 * @param {String} message - Message to send
 * @param {Object} options - Additional options (parse_mode, etc.)
 * @returns {Promise} - Promise that resolves when message is sent
 */

// sendNotification function with retry logic
async function sendNotification(telegram, telegramId, message, options = {}) {
  try {
    // Set default options
    const messageOptions = {
      parse_mode: 'Markdown',
      disable_notification: false,
      ...options
    };
    
    // Send the message
    await telegram.sendMessage(telegramId, message, messageOptions);
    return true;
  } catch (error) {
    if (error.response && error.response.error_code === 403) {
      // User has blocked the bot
      logger.warn(`User ${telegramId} has blocked the bot`);
    } else if ((error.response && error.response.error_code === 400 && 
               error.response.description.includes('chat not found')) ||
              (error.response && error.response.error_code === 403 && 
               error.response.description.includes('bot was blocked'))) {
      // User hasn't started the bot yet
      logger.warn(`User ${telegramId} has never started a conversation with the bot`);
    } else {
      logger.error('Error sending notification:', error);
    }
    return false;
  }
}


module.exports = {
  sendNotification
};