// src/constants/reminderTypes.js
/**
 * Constants for reminder types
 */
module.exports = {
    // Reminder type numeric values
    REMINDER_TOMORROW: 0,
    REMINDER_TODAY_1H: 1,
    REMINDER_TODAY_4H: 2,
    REMINDER_OVERDUE_1: 3,
    REMINDER_OVERDUE_2: 4,
    
    // Mapping for logging and display purposes
    REMINDER_TYPE_NAMES: {
      0: 'tomorrow',
      1: 'today1h',
      2: 'today4h',
      3: 'overdue1',
      4: 'overdue2'
    }
  };