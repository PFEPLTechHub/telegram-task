const { Scenes } = require("telegraf");
const UserModel = require("../models/userModel");
const TaskModel = require("../models/taskModel");
const logger = require("../utils/logger");

function completeTaskScene() {
  // Create the scene with proper callback handling
  const scene = new Scenes.WizardScene(
    "completeTaskScene",
    // Step 1: Display tasks with inline buttons
    async (ctx) => {
      try {
        // Save original message context for future edits
        if (ctx.callbackQuery) {
          ctx.session.originalMessage = {
            chat_id: ctx.callbackQuery.message.chat.id,
            message_id: ctx.callbackQuery.message.message_id
          };
        }
        
        // Get current user
        const user = await UserModel.getUserByTelegramId(ctx.from.id);

        if (!user) {
          // Use original message if available
          if (ctx.session.originalMessage) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "Error: User not found. Please restart the bot with /start.",
              { parse_mode: "Markdown" }
            );
          } else {
            await ctx.reply("Error: User not found. Please restart the bot with /start.");
          }
          return await ctx.scene.leave();
        }

        // Get user's tasks
        const tasks = await TaskModel.getTasksByEmployee(user.id);

        // Filter only pending and overdue tasks
        const pendingTasks = tasks.filter(
          (task) => task.status === "pending" || task.status === "overdue"
        );

        if (pendingTasks.length === 0) {
          const message = "You have no pending tasks to complete.";
          
          // Edit original message if available, otherwise send new one
          if (ctx.session.originalMessage) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              message,
              { 
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
                }
              }
            );
          } else {
            await ctx.reply(message, {
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
              }
            });
          }
          return await ctx.scene.leave();
        }

        // Store user info in scene state
        ctx.scene.state.employeeId = user.id;
        ctx.scene.state.employeeName = user.first_name || user.username;
        
        // Create a single message with keyboard for all tasks
        const taskButtons = pendingTasks.map(task => {
          const dueDate = new Date(task.due_date);
          const formattedDate = dueDate.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          
          // Add project indicator if task belongs to a project
          const projectIndicator = task.project_id ? "🏗️ " : "";
          const buttonText = `${projectIndicator}${task.description} (Due: ${formattedDate})`;
          
          return [{
            text: buttonText,
            callback_data: `complete_task_${task.id}`
          }];
        });
        
        // Add cancel button at the bottom
        taskButtons.push([{
          text: "Cancel",
          callback_data: "cancel_completion"
        }]);
        
        const message = "Select a task to mark as complete:";
        
        // Edit message if we have an original message, otherwise send new one
        if (ctx.session.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            message,
            {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: taskButtons }
            }
          );
        } else {
          const sentMsg = await ctx.reply(message, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: taskButtons }
          });
          
          // Save the sent message for future editing
          ctx.session.originalMessage = {
            chat_id: sentMsg.chat.id,
            message_id: sentMsg.message_id
          };
        }
        
        return ctx.wizard.next();
      } catch (error) {
        logger.error("Error in complete task scene:", error);
        
        const errorMessage = "Sorry, there was an error. Please try again.";
        
        // Edit original message if available, otherwise send new one
        if (ctx.session.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            errorMessage,
            { 
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
              }
            }
          );
        } else {
          await ctx.reply(errorMessage, {
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          });
        }
        
        return await ctx.scene.leave();
      }
    },
    
    // Step 2: Handle chosen task and confirmation
    async (ctx) => {
      // If it's not a callback, ignore (we only expect button presses)
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons to select a task.");
        return; // Stay in current step
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      // Prevent duplicate callback processing
      if (ctx.session.processedCallbacks?.includes(ctx.callbackQuery.id)) {
        await ctx.answerCbQuery(); // Acknowledge to clear loading state
        return; // Ignore duplicate
      }
      ctx.session.processedCallbacks = ctx.session.processedCallbacks || [];
      ctx.session.processedCallbacks.push(ctx.callbackQuery.id);
      
      logger.info(`Processing callback: ${ctx.callbackQuery.id}, data: ${callbackData}`);
      
      if (callbackData === "cancel_completion") {
        try {
          await ctx.answerCbQuery("Canceled", { show_alert: false });
          await ctx.scene.leave();
          await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay for scene cleanup
          return await showMainMenu(ctx);
        } catch (error) {
          logger.error("Error in cancel_completion callback:", error);
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "❌ Error canceling task. Please try again.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
              }
            }
          );
          return await ctx.scene.leave();
        }
      } else if (callbackData.startsWith("complete_task_")) {
        const taskId = callbackData.split("_")[2];
        
        try {
          await ctx.answerCbQuery("Processing your request...", { show_alert: false });
          
          // Get task information
          const task = await TaskModel.getTaskById(taskId);
          
          if (!task) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "Task not found. Please try again.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "Back", callback_data: "back_to_tasks" }]]
                }
              }
            );
            return; // Stay in current step
          }
          
          ctx.scene.state.taskId = taskId;
          ctx.scene.state.taskName = task.description;
          
          // Format due date
          const dueDate = task.due_date ? new Date(task.due_date).toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }) : null;
          
          // Get project information if exists
          let projectInfo = '';
          if (task.project_id) {
            try {
              const ProjectModel = require('../models/projectModel');
              const project = await ProjectModel.getProjectById(task.project_id);
              if (project) {
                projectInfo = `\n🏗️ Project: ${project.name}`;
              }
            } catch (error) {
              logger.error("Error fetching project info:", error);
            }
          }
          
          // Build task details message
          let taskDetails = `📝 *Task Completion*

Task: "${task.description}"`;

          // Add due date if exists
          if (dueDate) {
            taskDetails += `\n📅 Due Date: ${dueDate}`;
          }
          
          // Add priority if exists
          if (task.priority) {
            taskDetails += `\n⚡ Priority: ${task.priority}`;
          }
          
          // Add project if exists
          if (projectInfo) {
            taskDetails += projectInfo;
          }
          
          taskDetails += `\n\nWould you like to add a reply/comment when completing this task? (Optional)

You can provide details about what was accomplished, any issues encountered, or additional notes.`;
          
          // Show reply option step
          const replyMessage = taskDetails;
          
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            replyMessage,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "💬 Add Reply", callback_data: "add_reply" },
                    { text: "⏭️ Skip Reply", callback_data: "skip_reply" }
                  ],
                  [
                    { text: "❌ Cancel", callback_data: "cancel_completion" }
                  ],
                  [
                    { text: "Back to Task List", callback_data: "back_to_tasks" }
                  ]
                ]
              }
            }
          );
          
          return ctx.wizard.next();
        } catch (error) {
          logger.error("Error processing task selection:", error);
          
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "Sorry, there was an error. Please try again.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
              }
            }
          );
          
          return await ctx.scene.leave();
        }
      } else if (callbackData === "action_main_menu") {
        try {
          await ctx.answerCbQuery();
          await ctx.scene.leave();
          return await ctx.scene.enter("mainMenuScene");
        } catch (error) {
          logger.error("Error in action_main_menu callback:", error);
          return await ctx.scene.leave();
        }
      } else if (callbackData === "back_to_tasks") {
        try {
          await ctx.answerCbQuery();
          return ctx.wizard.back();
        } catch (error) {
          logger.error("Error in back_to_tasks callback:", error);
          return await ctx.scene.leave();
        }
      } else {
        await ctx.answerCbQuery("Invalid action", { show_alert: true });
        return; // Stay in current step
      }
    },
    
    // Step 3: Handle reply input or skip
    async (ctx) => {
      // If it's not a callback, ignore (we only expect button presses)
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons.");
        return; // Stay in current step
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      // Prevent duplicate callback processing
      if (ctx.session.processedCallbacks?.includes(ctx.callbackQuery.id)) {
        await ctx.answerCbQuery(); // Acknowledge to clear loading state
        return; // Ignore duplicate
      }
      ctx.session.processedCallbacks = ctx.session.processedCallbacks || [];
      ctx.session.processedCallbacks.push(ctx.callbackQuery.id);
      
      logger.info(`Processing callback: ${ctx.callbackQuery.id}, data: ${callbackData}`);
      
      if (callbackData === "add_reply") {
        try {
          await ctx.answerCbQuery();
          
          // Set state to wait for reply input
          ctx.scene.state.waitingForReply = true;
          
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            `💬 *Add Reply/Comment*

Please type your reply or comment for task completion:

Task: "${ctx.scene.state.taskName}"

You can mention:
• What was accomplished
• Any issues encountered  
• Additional notes or details

Type your reply below:`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "❌ Cancel", callback_data: "cancel_completion" }]
                ]
              }
            }
          );
          
          return ctx.wizard.next();
        } catch (error) {
          logger.error("Error in add_reply callback:", error);
          return await ctx.scene.leave();
        }
      } else if (callbackData === "skip_reply") {
        try {
          await ctx.answerCbQuery();
          ctx.scene.state.completionReply = null;
          return await handleTaskCompletion(ctx);
        } catch (error) {
          logger.error("Error in skip_reply callback:", error);
          return await ctx.scene.leave();
        }
      } else if (callbackData === "cancel_completion") {
        try {
          await ctx.answerCbQuery("Canceled", { show_alert: false });
          await ctx.scene.leave();
          await new Promise(resolve => setTimeout(resolve, 100));
          return await showMainMenu(ctx);
        } catch (error) {
          logger.error("Error in cancel_completion callback:", error);
          return await ctx.scene.leave();
        }
      } else if (callbackData === "back_to_tasks") {
        try {
          await ctx.answerCbQuery();
          return ctx.wizard.back();
        } catch (error) {
          logger.error("Error in back_to_tasks callback:", error);
          return await ctx.scene.leave();
        }
      } else {
        await ctx.answerCbQuery("Invalid action", { show_alert: true });
        return;
      }
    },
    
    // Step 4: Handle reply text input and final confirmation
    async (ctx) => {
      // Handle text input for reply
      if (ctx.message && ctx.message.text && ctx.scene.state.waitingForReply) {
        const replyText = ctx.message.text.trim();
        
        if (replyText.length < 3) {
          await ctx.reply("Reply is too short. Please provide a meaningful reply (at least 3 characters) or use the cancel button.");
          return;
        }
        
        if (replyText.length > 500) {
          await ctx.reply("Reply is too long. Please keep it under 500 characters or use the cancel button.");
          return;
        }
        
        // Store the reply
        ctx.scene.state.completionReply = replyText;
        ctx.scene.state.waitingForReply = false;
        
        // Show confirmation with reply
        const confirmMessage = `✅ *Final Confirmation*

Task: "${ctx.scene.state.taskName}"
Reply: "${replyText}"

Do you want to complete this task with the above reply?`;
        
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          confirmMessage,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Complete Task", callback_data: "confirm_complete" },
                  { text: "✏️ Edit Reply", callback_data: "edit_reply" }
                ],
                [
                  { text: "❌ Cancel", callback_data: "cancel_completion" }
                ]
              ]
            }
          }
        );
        
        return;
      }
      
      // Handle callback actions
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons or send a text reply.");
        return;
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      // Prevent duplicate callback processing
      if (ctx.session.processedCallbacks?.includes(ctx.callbackQuery.id)) {
        await ctx.answerCbQuery();
        return;
      }
      ctx.session.processedCallbacks = ctx.session.processedCallbacks || [];
      ctx.session.processedCallbacks.push(ctx.callbackQuery.id);
      
      if (callbackData === "edit_reply") {
        try {
          await ctx.answerCbQuery();
          ctx.scene.state.waitingForReply = true;
          
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            `✏️ *Edit Reply*

Current reply: "${ctx.scene.state.completionReply}"

Please type your new reply:`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "❌ Cancel", callback_data: "cancel_completion" }]
                ]
              }
            }
          );
          
          return;
        } catch (error) {
          logger.error("Error in edit_reply callback:", error);
          return await ctx.scene.leave();
        }
      } else if (callbackData === "confirm_complete") {
        try {
          await handleTaskCompletion(ctx);
          return await ctx.scene.leave();
        } catch (error) {
          logger.error("Error in confirm_complete callback:", error);
          return await ctx.scene.leave();
        }
      } else if (callbackData === "cancel_completion") {
        try {
          await ctx.answerCbQuery("Canceled", { show_alert: false });
          await ctx.scene.leave();
          await new Promise(resolve => setTimeout(resolve, 100));
          return await showMainMenu(ctx);
        } catch (error) {
          logger.error("Error in cancel_completion callback:", error);
          return await ctx.scene.leave();
        }
      } else {
        await ctx.answerCbQuery("Invalid action", { show_alert: true });
        return;
      }
    },
    
    // Step 5: Handle final confirmation and task completion (legacy step, now unused)
    async (ctx) => {
      // If it's not a callback, ignore (we only expect button presses)
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons.");
        return; // Stay in current step
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      // Prevent duplicate callback processing
      if (ctx.session.processedCallbacks?.includes(ctx.callbackQuery.id)) {
        await ctx.answerCbQuery(); // Acknowledge to clear loading state
        return; // Ignore duplicate
      }
      ctx.session.processedCallbacks = ctx.session.processedCallbacks || [];
      ctx.session.processedCallbacks.push(ctx.callbackQuery.id);
      
      logger.info(`Processing callback: ${ctx.callbackQuery.id}, data: ${callbackData}`);
      
      if (callbackData === "cancel_completion") {
        try {
          await ctx.answerCbQuery("Canceled", { show_alert: false });
          await ctx.scene.leave();
          await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay for scene cleanup
          return await showMainMenu(ctx);
        } catch (error) {
          logger.error("Error in cancel_completion callback:", error);
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "❌ Error canceling task. Please try again.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
              }
            }
          );
          return await ctx.scene.leave();
        }
      } else if (callbackData === "confirm_complete") {
        try {
          await handleTaskCompletion(ctx);
          return await ctx.scene.leave();
        } catch (error) {
          logger.error("Error in confirm_complete callback:", error);
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "❌ Error processing task completion. Please try again.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
              }
            }
          );
          return await ctx.scene.leave();
        }
      } else if (callbackData === "back_to_tasks") {
        try {
          await ctx.answerCbQuery();
          return ctx.wizard.back();
        } catch (error) {
          logger.error("Error in back_to_tasks callback:", error);
          return await ctx.scene.leave();
        }
      } else if (callbackData === "action_main_menu") {
        try {
          await ctx.answerCbQuery();
          await ctx.scene.leave();
          return await ctx.scene.enter("mainMenuScene");
        } catch (error) {
          logger.error("Error in action_main_menu callback:", error);
          return await ctx.scene.leave();
        }
      } else {
        await ctx.answerCbQuery("Invalid action", { show_alert: true });
        return; // Stay in current step
      }
    }
  );

  // Helper function to handle task completion logic
  async function handleTaskCompletion(ctx) {
    try {
      const taskId = ctx.scene.state.taskId;
      const taskName = ctx.scene.state.taskName;
      
      // Answer the callback query to clear the loading state
      await ctx.answerCbQuery(`Processing completion for: ${taskName}`, { show_alert: false });

      // Get task with manager info first to check if it's a self-assigned manager task
      const taskWithManager = await TaskModel.getTaskWithManagerInfo(taskId);
      
      // Get current user
      const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);

      // Check if this is an admin completing their own task
      const isAdminSelfTask = currentUser?.role === 0 && // Is admin
                             taskWithManager?.employee_id === currentUser.id && // Is their own task
                             taskWithManager?.assigned_by === currentUser.id; // They assigned it

      // Check if this is a manager completing their own task
      const isManagerSelfTask = currentUser?.role === 1 && // Is manager
                               taskWithManager?.employee_id === currentUser.id && // Is their own task
                               taskWithManager?.assigned_by === currentUser.id; // They assigned it

      if (isAdminSelfTask || isManagerSelfTask) {
        // Directly complete the task without approval for both admin and manager self-tasks
        await TaskModel.updateTaskStatusAndApprover(taskId, "completed", currentUser.id, ctx.scene.state.completionReply);
        
        // Update the original message
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          `✅ Task "${taskName}" has been marked as complete!`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          }
        );
        
        return await ctx.scene.leave();
      }

      // For all other cases, continue with the existing approval flow
      // Update task status to "pending_approval"
      await TaskModel.updateTaskStatus(taskId, "pending_approval");

      let managerNotified = false;

      // First try to notify the task's assigned manager
      if (taskWithManager?.manager_telegram_id && taskWithManager.manager_telegram_id !== ctx.from.id) {
        const replyText = ctx.scene.state.completionReply ? `\nReply: ${ctx.scene.state.completionReply}` : '';
        const approvalMessage = `
📋 *Task Completion Request*

Employee: ${ctx.scene.state.employeeName}
Task: ${taskName}${replyText}
Status: Awaiting your approval
`;

        const inlineKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Complete",
                  callback_data: `approve_task_${taskId}`
                },
                {
                  text: "❌ Reject",
                  callback_data: `reject_task_${taskId}`
                }
              ]
            ]
          },
          parse_mode: "Markdown"
        };

        try {
          await ctx.telegram.sendMessage(
            taskWithManager.manager_telegram_id,
            approvalMessage,
            inlineKeyboard
          );
          managerNotified = true;
        } catch (err) {
          logger.error(`Failed to send notification to primary manager: ${err.message}`);
        }
      }

      // If primary manager couldn't be notified, try other managers
      if (!managerNotified) {
        const managers = await UserModel.getAllManagers();

          for (const manager of managers) {
          // Skip if manager is the employee themselves or the same as the failed primary manager
            if (
              manager.telegram_id &&
            manager.telegram_id !== ctx.from.id &&
              manager.telegram_id !== taskWithManager?.manager_telegram_id
            ) {
              const replyText = ctx.scene.state.completionReply ? `\nReply: ${ctx.scene.state.completionReply}` : '';
              const approvalMessage = `
📋 *Task Completion Request* (Backup Notification)

Employee: ${ctx.scene.state.employeeName}
Task: ${taskName}${replyText}
Status: Awaiting your approval
`;

              const inlineKeyboard = {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "✅ Approve",
                        callback_data: `approve_task_${taskId}`
                      },
                      {
                        text: "❌ Reject",
                        callback_data: `reject_task_${taskId}`
                      }
                    ]
                  ]
                },
                parse_mode: "Markdown"
              };

            try {
              await ctx.telegram.sendMessage(
                manager.telegram_id,
                approvalMessage,
                inlineKeyboard
              );
                managerNotified = true;
                break; // Stop after successfully notifying one manager
            } catch (err) {
              logger.error(`Failed to send notification to backup manager: ${err.message}`);
              continue;
            }
          }
        }
      }

      if (managerNotified) {
        // Update the original message to employee
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          `✅ Your completion request for task "${taskName}" has been submitted to your manager for approval. You will be notified once it's approved or rejected.`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          }
        );
      } else {
        // No managers available for notification, auto-approve
        await TaskModel.updateTaskStatusAndApprover(taskId, "completed", -1, ctx.scene.state.completionReply);
        
        // Update the original message
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          `✅ Task "${taskName}" has been marked as complete! (Auto-approved as no managers were available)`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          }
        );
      }
  
      return await ctx.scene.leave();
    } catch (error) {
      logger.error("Error in task completion handler:", error);
      
      // Update the original message with error
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "❌ Sorry, there was an error processing your request. Please try again.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
          }
        }
      );
      
      return await ctx.scene.leave();
    }
  }

  // Clear session state on scene exit
  scene.on("leave", (ctx) => {
    ctx.session.processedCallbacks = [];
    ctx.session.originalMessage = null;
    ctx.scene.state = {};
  });

  // Handle back to tasks action
  scene.action("back_to_tasks", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      ctx.wizard.selectStep(0);
      return ctx.wizard.steps[0].call(ctx, ctx);
    } catch (error) {
      logger.error("Error in back_to_tasks action:", error);
      return await ctx.scene.leave();
    }
  });
  
  // Handle main menu action
  scene.action("action_main_menu", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await ctx.scene.leave();
      return await ctx.scene.enter("mainMenuScene");
    } catch (error) {
      logger.error("Error in action_main_menu action:", error);
      return await ctx.scene.leave();
    }
  });

  // Handle scene cancellation via command
  scene.command("cancel", async (ctx) => {
    try {
      if (ctx.session.originalMessage) {
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "Task completion cancelled.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Main Menu", callback_data: "action_main_menu" }]]
            }
          }
        );
      } else {
        await ctx.reply("Task completion cancelled.", {
          reply_markup: {
            inline_keyboard: [[{ text: "Main Menu", callback_data: "action_main_menu" }]]
          }
        });
      }
      
      return await ctx.scene.leave();
    } catch (error) {
      logger.error("Error in cancel command:", error);
      return await ctx.scene.leave();
    }
  });

  return scene;
}

async function showMainMenu(ctx, user = null) {
  try {
    if (!user) {
      user = await UserModel.getUserByTelegramId(ctx.from.id);
      if (!user) {
        return await ctx.reply("You need to register first. Use /start to register.");
      }
    }

    const isTeamLead = await UserModel.isTeamLead(ctx.from.id);
    const isManager = await UserModel.isManager(ctx.from.id);
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    const buttons = [];

    if (isTeamLead) {
      buttons.push([{ text: "➕ Create Task", callback_data: "action_create_task" }]);
    }
    buttons.push([{ text: "✅ Complete a Task", callback_data: "action_complete" }]);
    buttons.push([{ text: "📋 My Tasks", callback_data: "action_mytasks" }]);
    buttons.push([{ text: "📊 Generate Reports", callback_data: "action_view_images" }]);
    if (isManager || isAdmin) {
      buttons.push([{ text: "🏗️ Projects", callback_data: "action_projects" }]);
    }
    if (isManager) {
      buttons.push([{ text: "✅ Approve / ❌ Reject Tasks", callback_data: "action_view" }]);
    }
    if (isManager || isAdmin) {
      buttons.push([{ text: "👥 Manage Users", callback_data: "action_manage_users" }]);
    }

    const message = `Hello ${user.first_name || "there"}! What would you like to do?`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        reply_markup: {
          inline_keyboard: buttons
        }
      });
    } else {
      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: buttons
        }
      });
    }
  } catch (err) {
    logger.error("Failed to show main menu:", err.message || err.description);
    await ctx.reply("Error displaying main menu. Please try again.");
  }
}

module.exports = {
  completeTaskScene,
};