// src/utils/validators.js
const logger = require('./logger');

// Validate date in YYYY-MM-DD HH:MM format
function validateDate(dateString) {
  // Simple regex validation for YYYY-MM-DD HH:MM format
  const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
  
  if (!dateRegex.test(dateString)) {
    return false;
  }
  
  // Try parsing the date
  try {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
  } catch (error) {
    logger.error('Date validation error:', error);
    return false;
  }
}

module.exports = {
  validateDate
};

