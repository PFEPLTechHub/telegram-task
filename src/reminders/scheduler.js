// src/reminders/scheduler.js
const cron = require('node-cron');
const TaskModel = require('../models/taskModel');
const logger = require('../utils/logger');

// Mapping of reminder type numbers to readable names for logging
const REMINDER_TYPES = {
  0: "tomorrow",
  1: "today1h",
  2: "today4h", 
  3: "overdue1",
  4: "overdue2"
};

// Reminder schedule configuration with numeric reminder types
const reminderSchedules = {
  0: '0 9 * * *',      // tomorrow: Every day at 9:00 AM
  1: '0 8 * * *',      // today1h: Every day at 8:00 AM
  2: '0 5 * * *',      // today4h: Every day at 5:00 AM
  3: '0 0 * * *',    // overdue1: Every day at 12:00 AM
  4: '30 10 * * *'     // overdue2: Every day at 4:30 PM
};

// Schedule a single reminder type
function scheduleReminder(bot, reminderTypeNum, cronExpression) {
  const reminderTypeName = REMINDER_TYPES[reminderTypeNum];
  logger.info(`Scheduling ${reminderTypeName} (type ${reminderTypeNum}) reminders with cron expression: ${cronExpression}`);
  
  cron.schedule(cronExpression, async () => {
    try {
      logger.info(`Running ${reminderTypeName} (type ${reminderTypeNum}) reminder check`);
      
      // Update overdue tasks first
      await TaskModel.updateOverdueTasks();
      
      // Get tasks for this reminder type
      const tasks = await TaskModel.getTasksForReminder(reminderTypeNum);
      
      if (tasks.length === 0) {
        logger.info(`No ${reminderTypeName} (type ${reminderTypeNum}) reminders to send`);
        return;
      }
      
      logger.info(`Found ${tasks.length} tasks for ${reminderTypeName} (type ${reminderTypeNum}) reminders`);
      
      // Send reminder for each task
      for (const task of tasks) {
        await sendTaskReminder(bot, task, reminderTypeNum);
        await TaskModel.markReminderSent(task.reminder_id);
      }
    } catch (error) {
      logger.error(`Error processing ${reminderTypeName} (type ${reminderTypeNum}) reminders:`, error);
    }
  });
}

// Send a reminder for a specific task
async function sendTaskReminder(bot, task, reminderTypeNum) {
  try {
    const dueDate = new Date(task.due_date);
    const formattedDate = dueDate.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    let reminderMessage;
    
    switch (reminderTypeNum) {
      case 0: // tomorrow
        reminderMessage = `⏰ *TASK REMINDER*\n\nHi ${task.employee_name}! You have a task due tomorrow:\n\n*${task.description}*\n\nDue: ${formattedDate}`;
        break;
      case 1: // today1h
        reminderMessage = `⏰ *URGENT TASK REMINDER*\n\nHi ${task.employee_name}! You have a task due TODAY in the next few hours:\n\n*${task.description}*\n\nDue: ${formattedDate}`;
        break;
      case 2: // today4h
        reminderMessage = `⏰ *TASK REMINDER*\n\nHi ${task.employee_name}! You have a task due TODAY:\n\n*${task.description}*\n\nDue: ${formattedDate}`;
        break;
      case 3: // overdue1
      case 4: // overdue2
        reminderMessage = `⚠️ *OVERDUE TASK ALERT*\n\nHi ${task.employee_name}! You have an OVERDUE task that needs immediate attention:\n\n*${task.description}*\n\nWas due: ${formattedDate}\n\nPlease complete this task as soon as possible.`;
        break;
    }
    
    await bot.telegram.sendMessage(task.telegram_id, reminderMessage, {
      parse_mode: 'Markdown'
    });
    
    const reminderTypeName = REMINDER_TYPES[reminderTypeNum];
    logger.info(`Sent ${reminderTypeName} (type ${reminderTypeNum}) reminder to user ${task.telegram_id} for task ${task.id}`);
  } catch (error) {
    logger.error(`Error sending reminder for task ${task.id}:`, error);
  }
}

// Schedule all reminders
function scheduleAllReminders(bot) {
  Object.entries(reminderSchedules).forEach(([reminderTypeNum, cronExpression]) => {
    scheduleReminder(bot, parseInt(reminderTypeNum), cronExpression);
  });
  
  // Also schedule a daily job to update overdue tasks
  cron.schedule('0 0 * * *', async () => {
    try {
      await TaskModel.updateOverdueTasks();
      logger.info('Updated overdue tasks status');
    } catch (error) {
      logger.error('Error updating overdue tasks status:', error);
    }
  });
  
  logger.info('All reminders scheduled successfully');
}

module.exports = {
  scheduleAllReminders,
  REMINDER_TYPES
};