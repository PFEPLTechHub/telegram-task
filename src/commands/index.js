// src/commands/index.js
const UserModel = require("../models/userModel");
const logger = require("../utils/logger");
const TaskModel = require("../models/taskModel");
const { sendNotification } = require("../utils/notifications");
const { ROLES } = require("../models/userModel");
const { query } = require("../database/db");
const db = require("../database/db"); // ✅ CORRECT

// Register all bot commands
function registerCommands(bot) {

  bot.action(/^quick_(approve|reject)_(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const approvalId = parseInt(ctx.match[2]);

  console.log("Callback action:", action, "approvalId:", approvalId);
  try {
    await ctx.answerCbQuery(); // early answer to avoid timeout

    const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
    console.log("CurrentUser:", currentUser);

    const approval = await PendingApprovalModel.getApprovalById(approvalId);
    console.log("Approval:", approval);

    if (!approval) {
      await ctx.answerCbQuery("❌ Approval not found or processed.");
      return;
    }

    if (approval.status !== 'pending') {
      await ctx.answerCbQuery("❌ Already processed.");
      return;
    }

    // Update approval status
    await PendingApprovalModel.updateApprovalStatus(
      approvalId,
      action === 'approve' ? 'approved' : 'rejected',
      currentUser.id
    );
    console.log("Approval status updated");

    if (action === 'approve') {
      // ✅ CRITICAL: Update user status to 'active' so they can use the bot
      await UserModel.updateUserStatus(approval.user_id, 'active');
      console.log("User status updated to active");

      // Notify user - wrap in try-catch
      try {
        await ctx.telegram.sendMessage(
          approval.telegram_id,
          `🎉 *Registration Approved!*\n\n` +
          `Your registration has been approved by ${currentUser.first_name}.\n\n` +
          `✅ You can now use all bot features. Welcome to the team!`,
          { parse_mode: 'Markdown' }
        );
        console.log("User notified of approval");
      } catch (e) {
        console.error("Error notifying user:", e);
      }

      try {
        await ctx.editMessageText(
          `✅ *APPROVED*\n\n` +
          `User: ${approval.first_name} ${approval.last_name || ''}\n` +
          `Username: @${approval.username || 'N/A'}\n` +
          `Approved by: ${currentUser.first_name}\n` +
          `Status: Now active and can use the bot`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: "📋 View All Pending", callback_data: "action_review_approvals" }
              ]]
            }
          }
        );
        console.log("Message edited");
      } catch (e) {
        console.error("Error editing message:", e);
      }

      await ctx.answerCbQuery(`✅ ${approval.first_name} approved and activated!`);
      
    } else {
      // ❌ REJECTION: Update user status to 'rejected'
      await UserModel.updateUserStatus(approval.user_id, 'rejected');
      console.log("User status updated to rejected");

      // Notify user of rejection
      try {
        await ctx.telegram.sendMessage(
          approval.telegram_id,
          `❌ *Registration Rejected*\n\n` +
          `Your registration has been rejected by ${currentUser.first_name}.\n\n` +
          `Please contact your manager for more information or to request a new invitation.`,
          { parse_mode: 'Markdown' }
        );
        console.log("User notified of rejection");
      } catch (e) {
        console.error("Error notifying user:", e);
      }

      try {
        await ctx.editMessageText(
          `❌ *REJECTED*\n\n` +
          `User: ${approval.first_name} ${approval.last_name || ''}\n` +
          `Username: @${approval.username || 'N/A'}\n` +
          `Rejected by: ${currentUser.first_name}\n` +
          `Status: Registration denied`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: "📋 View All Pending", callback_data: "action_review_approvals" }
              ]]
            }
          }
        );
        console.log("Message edited");
      } catch (e) {
        console.error("Error editing message:", e);
      }

      await ctx.answerCbQuery(`❌ ${approval.first_name} rejected.`);
    }
  } catch (error) {
    console.error("Error in quick approval:", error);
    await ctx.answerCbQuery("❌ Error processing request.");
  }
});
bot.start(async (ctx) => {
  try {
    const telegramUser = ctx.from;
    const payload = ctx.startPayload;
    let role = ROLES.EMPLOYEE;
    let inviterId = null;
    let needsApproval = false;

    // Check if user already exists
    const existingUser = await UserModel.getUserByTelegramId(telegramUser.id);
    if (existingUser) {
      if (existingUser.role === ROLES.ADMIN) {
        return await ctx.reply("✅ You're already an admin and can use all bot features.");
      } else if (existingUser.status === 'pending') {
        return await ctx.reply("⏳ Your registration is pending approval. You'll be notified once approved.\n\nYou cannot use bot features until your registration is approved.");
      } else if (existingUser.status === 'rejected') {
        return await ctx.reply("❌ Your previous registration was rejected. Please contact your manager for a new invitation.");
      } else if (existingUser.status === 'active') {
        return await ctx.reply("✅ You're already registered and can use the bot!");
      }
    }

    // Parse invitation payload
    if (payload) {
      const invitation = await InvitationModel.getInvitation(payload);
      
      if (!invitation) {
        return await ctx.reply("❌ Invalid or expired invitation link. Please contact your manager for a new invitation.");
      }

      // Mark invitation as used
      await InvitationModel.markInvitationAsUsed(payload);
      
      role = invitation.role;
      inviterId = invitation.inviter_id;
      needsApproval = true;
    } else {
      // No invitation payload - user trying to start without invitation
      return await ctx.reply("❌ You need an invitation link to register. Please contact your manager for an invitation.");
    }

    // Create user with pending status - they CANNOT use bot until approved
    const userStatus = needsApproval ? 'pending' : 'active';
    const user = await UserModel.createOrUpdateUser(telegramUser, role, inviterId, userStatus);

    if (needsApproval) {
      // Determine approver based on role
      let approverType, approverId;
      
      if (role === ROLES.MANAGER) {
        // Manager needs admin approval
        approverType = 'admin';
        const admin = await UserModel.getAdmin();
        approverId = admin.id;
        
        // Create pending approval record first to get the ID
        const approvalId = await PendingApprovalModel.createPendingApproval(user.id, role, inviterId, approverType, approverId);
        
        // Notify admin with Accept/Reject buttons
        await ctx.telegram.sendMessage(admin.telegram_id, 
          `🔔 *New Manager Registration Request*\n\n` +
          `Name: ${telegramUser.first_name} ${telegramUser.last_name || ''}\n` +
          `Username: @${telegramUser.username || 'N/A'}\n` +
          `Role: Manager\n\n` +
          `Quick Action:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Accept", callback_data: `quick_approve_${approvalId}` },
                  { text: "❌ Reject", callback_data: `quick_reject_${approvalId}` }
                ],
              ]
            }
          }
        );
      } else {
        // Employee needs manager approval
        approverType = 'manager';
        approverId = inviterId;
        
        // Create pending approval record first to get the ID
        const approvalId = await PendingApprovalModel.createPendingApproval(user.id, role, inviterId, approverType, approverId);
        
        // Notify manager with Accept/Reject buttons
        const manager = await UserModel.getUserById(inviterId);
        if (manager && manager.telegram_id) {
          await ctx.telegram.sendMessage(manager.telegram_id,
            `🔔 *New Employee Registration Request*\n\n` +
            `Name: ${telegramUser.first_name} ${telegramUser.last_name || ''}\n` +
            `Username: @${telegramUser.username || 'N/A'}\n` +
            `Role: Employee\n\n` +
            `Quick Action:`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ Accept", callback_data: `quick_approve_${approvalId}` },
                    { text: "❌ Reject", callback_data: `quick_reject_${approvalId}` }
                  ],
                ]
              }
            }
          );
        }
      }
      
      await ctx.reply(
        "✅ Registration submitted!\n\n" +
        "⏳ Your request is pending approval. You'll be notified once approved.\n\n" +
        "⚠️ *Important:* You cannot use any bot features until your registration is approved."
      );
    } else {
      await ctx.reply("✅ Welcome! You have been registered successfully and can now use the bot.");
    }

  } catch (error) {
    console.error("Error in /start command:", error);
    await ctx.reply("❌ Something went wrong while registering you. Please try again later.");
  }
});

bot.use(async (ctx, next) => {
  // Skip status check ONLY for:
  // - /start command with invitation payload (new registrations)
  // - Approval-related callback queries
  const isStartWithPayload = ctx.message?.text?.startsWith('/start') && ctx.startPayload;
  const isApprovalCallback = ctx.callbackQuery?.data?.includes('quick_approve') || 
                            ctx.callbackQuery?.data?.includes('quick_reject') ||
                            ctx.callbackQuery?.data?.includes('final_approve') ||
                            ctx.callbackQuery?.data?.includes('final_reject');

  if (isStartWithPayload || isApprovalCallback) {
    return next();
  }

  // Block ALL other interactions until user is approved
  if (ctx.message || ctx.callbackQuery) {
    const user = await UserModel.getUserByTelegramId(ctx.from.id);
    
    // User doesn't exist at all
    if (!user) {
      return await ctx.reply("❌ You need to register first. Please use the invitation link provided by your manager.");
    }
    
    // User exists but is pending approval
    if (user.status === 'pending') {
      return await ctx.reply("⏳ Your registration is still pending approval. Please wait for your manager to approve your request.\n\n🚫 You cannot use any bot features until approved.");
    }
    
    // User was rejected
    if (user.status === 'rejected') {
      return await ctx.reply("❌ Your registration was rejected. Please contact your manager for a new invitation.");
    }
    
    // User is inactive or any other non-active status
    if (user.status !== 'active') {
      return await ctx.reply("❌ Your account is not active. Please contact your manager.");
    }
  }

  return next();
});


async function cleanupActiveScenes(ctx) {
  // Exit any active scene
  if (ctx.scene && ctx.scene.current) {
    try {
      await ctx.scene.leave();
    } catch (err) {
      logger.debug("No active scene to leave or error leaving scene:", err);
    }
  }
  
  // Reset all session variables related to scene state
  if (ctx.session) {
    delete ctx.session.currentAction;
    delete ctx.session.taskCreationStep;
    delete ctx.session.newTask;
    delete ctx.session.rejectTaskId;
    delete ctx.session.selectedTaskId;
    delete ctx.session.selectedEmployeeId;
    // Add any other action-specific session variables you use
  }
}
// Handle the case where someone clicks an already handled button
bot.action('task_already_handled', async (ctx) => {
  await ctx.answerCbQuery("This task has already been handled");
});

bot.action('task_being_rejected', async (ctx) => {
  await ctx.answerCbQuery("Please provide the rejection reason in your reply");
});

// Handle any text input to show the main menu
bot.on("text", async (ctx) => {
  try {
    console.log("=== TEXT HANDLER TRIGGERED ===");
    
    // Check if this is a reply to a message from the bot
    if (
      ctx.message.reply_to_message &&
      ctx.message.reply_to_message.from.id === ctx.botInfo.id
    ) {
      // Check if this is a task rejection reply
      const replyText = ctx.message.reply_to_message.text;
      if (replyText && replyText.includes("Please provide a reason for rejecting task") && ctx.session?.rejectTaskId) {
        console.log("Found rejection reply for task:", ctx.session.rejectTaskId);
        
        const taskId = ctx.session.rejectTaskId;
        const reason = ctx.message.text || "No reason provided";
        
        // Clear the task ID from session
        delete ctx.session.rejectTaskId;
        
        // Process the rejection
        await processTaskRejection(ctx, taskId, reason);
        return; // Exit after processing the rejection
      }
      
      // For any other replies to bot messages, exit early as before
      return;
    }

    // The rest of your existing handler for regular text messages
    const user = await UserModel.getUserByTelegramId(ctx.from.id);

    if (!user) {
      return await ctx.reply(
        "You need to register first."
      );
    }

    // Clean up any active scenes before showing main menu
    await cleanupActiveScenes(ctx);
    await showMainMenu(ctx, user);

  } catch (error) {
    logger.error("Error in text handler:", error);
    await ctx.reply("Sorry, there was an error. Please try again.");
  }
});

// Extract common menu generation code into a reusable function
async function showMainMenu(ctx, user = null) {
  if (!user) {
    user = await UserModel.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return await ctx.reply("You need to register first.");
    }
  }

 
  const isManager = await UserModel.isManager(ctx.from.id);
  const isAdmin = await UserModel.isAdmin(ctx.from.id);
  const buttons = [];

 
  // External web app button url
  const config = require('../../config');
  const tgId = ctx.from?.id;
  const viewUrl = `${config.publicBaseUrl}/task-view.html?tg_id=${tgId}`;
  
    buttons.push([{ text: "➕ Create Task", callback_data: "action_create_task" }]);
  buttons.push([{ text: "✅ Complete a Task", callback_data: "action_complete" }]);
  buttons.push([{ text: "📋 My Tasks", callback_data: "action_mytasks" }]);
  // if (isTeamLead) {
  //   buttons.push([{ text: "👁️ Show All Tasks", callback_data: "action_show_tasks" }]);
  // }
  if(isAdmin || isManager )
  buttons.push([{ text: "📊 Generate Reports", callback_data: "action_view_images" }]);
  if (isManager) {
    buttons.push([{ text: "✅ Approve / ❌ Reject Tasks", callback_data: "action_view" }]);
  }
  if (isManager || isAdmin) {
  buttons.push([{ text: "🏗️ Projects", callback_data: "action_projects" }]);
  buttons.push([{ text: "👥 Manage Users", callback_data: "action_manage_users" }]);
  }

  // Add View Tasks button - always use callback to show confirmation
  buttons.push([{ text: "🌐 View Tasks", callback_data: "action_view_tasks_link" }]);

  const message = `Hello ${user.first_name || "there"}! What would you like to do?`;

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(message, {
        reply_markup: {
          inline_keyboard: buttons
        }
      });
    } catch (err) {
      console.error("Failed to edit message:", err.description || err.message);
      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: buttons
        }
      });
    }
  } else {
    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  }
}



// Handler to show confirmation dialog for task view link
bot.action("action_view_tasks_link", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const config = require('../../config');
    const tgId = ctx.from?.id;
    const viewUrl = `${config.publicBaseUrl}/task-view.html?tg_id=${tgId}`;
    
    // Check if URL is HTTPS - if so, use clickable button, otherwise show copyable link
    if (viewUrl.startsWith('https://')) {
      // Show confirmation dialog with clickable URL button
      await ctx.reply(
        "🌐 **Open Task Board**\n\n" +
        "Click the button below to open the task board in your browser:\n\n" +
        "⚠️ This will redirect you to the task management interface.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🌐 Click here to open task board", url: viewUrl }],
              [{ text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }]
            ]
          }
        }
      );
    } else {
      // Show confirmation dialog with copyable link for HTTP/localhost
      await ctx.reply(
        "🌐 **Open Task Board**\n\n" +
        "Copy the link below and paste it in your browser:\n\n" +
        `\`${viewUrl}\`\n\n` +
        "⚠️ This will open the task management interface.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }]
            ]
          }
        }
      );
    }
  } catch (error) {
    logger.error("Error sending view-tasks link:", error);
  }
});

// Add handler for the image generation button
bot.action("action_view_images", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    // Enter the image view scene
    await ctx.scene.enter("imageViewScene");
  } catch (error) {
    logger.error("Error entering image view scene:", error);
    await ctx.reply("Sorry, there was an error. Please try again later.");
  }
});

// Update main menu action to use the common function
bot.action("action_main_menu", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    await showMainMenu(ctx);
  } catch (error) {
    logger.error("Error in main menu action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});




// New Manage Users action
bot.action("action_manage_users", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    // Check if user is admin or manager
    const isManager = await UserModel.isManager(ctx.from.id);
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    
    if (!isManager && !isAdmin) {
      return await ctx.answerCbQuery("Sorry, only managers and admins can use this feature.");
    }
    
    const buttons = [
      [{ text: "👁️ Check Approvals", callback_data: "action_checkusers" }],
      [{ text: "📩 Invite Users", callback_data: "action_invite" }],
      [{ text: "🔄 Manage User Roles", callback_data: "action_role" }],
      [{ text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }]
    ];
    if (isAdmin) {
      buttons.splice(2, 0, [{ text: "🧑‍💼 Invite Manager", callback_data: "action_invite_manager" }]);
    }
if(isAdmin){
      buttons.splice(4,0, [{text: "❌ Delete User", callback_data: "action_delete_user"}]);
    }
    await ctx.editMessageText("👥 *User Management*\n\nPlease select an option:", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    logger.error("Error in manage users action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});
bot.action("action_invite_manager", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    if (!isAdmin) {
      return await ctx.answerCbQuery("🚫 Only admins can invite managers.");
    }

    const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
    if (!currentUser) {
      return await ctx.answerCbQuery("User not found.");
    }

    // Create one-time invitation code
    const inviteCode = await InvitationModel.createInvitation(currentUser.id, ROLES.MANAGER);
    const botUsername = (await ctx.telegram.getMe()).username;
    const managerInviteLink = `https://t.me/${botUsername}?start=${inviteCode}`;

    const rawText = `👤 *Invite a New Manager*\n\n⚠️ *Important:* This link can only be used ONCE and will be deactivated after use.\n\nManagers can create their own teams and assign tasks.\n\n✅ *Share this one-time link with the new manager:*\n${managerInviteLink}\n\n🔔 You'll receive a notification when they register for approval.`;

    const message = escapeMarkdownV2(rawText);

    const backButton = [
      [{ text: "🔙 Back to Admin Menu", callback_data: "action_manage_users" }]
    ];

    await ctx.editMessageText(message, {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: backButton }
    });

  } catch (err) {
    logger.error("Error generating manager invite:", err);
    await ctx.answerCbQuery("❌ Error generating invite link.");
  }
});
// Now implement action handlers for each button
bot.action("action_mytasks", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    const user = await UserModel.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return await ctx.reply("You need to register first.");
    }

    // First, show a loading message
    await ctx.editMessageText("Generating your tasks view...", {
      parse_mode: "Markdown"
    });

    // Get personal tasks for this user
    const personalTasks = await TaskModel.getTasksByEmployee(user.id);
    
    if (personalTasks.length === 0) {
      // No tasks case - just show text message
      const message = "*Your Tasks:*\n\nYou have no tasks at the moment.";
      
      // Add a back button
      const backButton = [
        [{ text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }]
      ];

      return await ctx.editMessageText(message, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: backButton
        }
      });
    }
    
    // Import the personal task image generator
    const personalTaskImageGenerator = require('../utils/personalTaskImageGenerator');
    
    // Default options - removed sorting options
    const options = {
      page: 1,
      itemsPerPage: 30
    };
    
    // Generate image from the tasks data
    const imageResult = await personalTaskImageGenerator.generatePersonalTasksImage(personalTasks, options);
    
    // Create pagination controls if needed
    const keyboard = [];
    
    // Add pagination buttons if more than one page
    if (imageResult.totalPages > 1) {
      const paginationRow = [];
      
      // Previous page button (if not on first page)
      if (imageResult.currentPage > 1) {
        paginationRow.push({
          text: "⬅️ Previous",
          callback_data: `mytasks_page_${imageResult.currentPage - 1}`
        });
      }
      
      // Page indicator
      paginationRow.push({
        text: `Page ${imageResult.currentPage}/${imageResult.totalPages}`,
        callback_data: 'noop' // No operation
      });
      
      // Next page button (if not on last page)
      if (imageResult.currentPage < imageResult.totalPages) {
        paginationRow.push({
          text: "Next ➡️",
          callback_data: `mytasks_page_${imageResult.currentPage + 1}`
        });
      }
      
      keyboard.push(paginationRow);
    }
    
    // Add a back button in the last row - removed sorting buttons
    keyboard.push([
      { text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }
    ]);
    
    // Send the image with caption and buttons
    await ctx.replyWithPhoto(
      { source: imageResult.buffer },
      {
        caption: `Your tasks (${personalTasks.length} total)`,
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
    
    // Delete the original message
    await ctx.deleteMessage();
    
  } catch (error) {
    logger.error("Error in mytasks action:", error);
    await ctx.reply("Sorry, there was an error generating your tasks view. Please try again.");
  }
});
bot.action(/approve_task_creation_(\d+)/, async (ctx) => {
  try {
    // Extract task ID from the callback data
    const taskId = parseInt(ctx.match[1], 10);
    console.log(`Processing task approval for task ID: ${taskId}`);
    
    // Check if user is a manager
    const isManager = await UserModel.isManager(ctx.from.id);

    if (!isManager) {
      return await ctx.answerCbQuery("🚫 Sorry, only managers can approve tasks.");
    }

    // Get task details with employee information
    const task = await TaskModel.getTaskWithManagerInfo(taskId);
    console.log("Task details retrieved:", task);

    // Check if task was found
    if (!task) {
      return await ctx.answerCbQuery(`Task with ID ${taskId} not found.`);
    }

    if (task.status !== "pending_approval") {
      return await ctx.answerCbQuery(`Task "${task.description}" is not pending approval.`);
    }

    // Get the manager's user ID (not Telegram ID)
    const manager = await UserModel.getUserByTelegramId(ctx.from.id);
    if (!manager) {
      return await ctx.answerCbQuery("Error: Manager record not found in database.");
    }

    // Update task status to 'pending' and store the manager ID who approved it
    await TaskModel.updateTaskStatusAndApprover(taskId, "pending", manager.id);
    console.log(`Task ${taskId} status updated to pending`);

    // Update the inline keyboard to show it's been approved
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          {
            text: "✅ Task Approved",
            callback_data: "task_already_handled"
          } 
        ]
      ]
    });

    // Send confirmation to manager
    await ctx.answerCbQuery(`✅ You have approved task "${task.description}"`);

    // Add a message below the original message confirming the approval
    await ctx.reply(`✅ You have approved task "${task.description}". The task is now in the employee's pending tasks list.`);

    // Enhanced employee notification logic
    console.log("Attempting to notify employee...");
    console.log("Task employee details:", {
      employee_telegram_id: task.employee_telegram_id,
      employee_name: task.employee_name,
      employee_id: task.employee_id
    });

    if (task.employee_telegram_id) {
      const notificationMessage = `
✅ *Task Approved*

Your task request has been approved by ${manager.first_name || "your manager"}:

📝 *Task:* ${task.description}
📅 *Due:* ${new Date(task.due_date).toLocaleString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})}

The task has been added to your pending tasks list. You can start working on it now.`;

      try {
        console.log("Sending notification to employee:", task.employee_telegram_id);
        await ctx.telegram.sendMessage(
          task.employee_telegram_id,
          notificationMessage,
          { parse_mode: "Markdown" }
        );
        console.log("Notification sent successfully");
      } catch (notifError) {
        console.error("Error sending notification:", notifError);
        await ctx.reply(
          `⚠️ Task approved, but could not notify employee (ID: ${task.employee_telegram_id}). They may have blocked the bot or not started it.`
        );
      }
    } else {
      console.log("No employee telegram_id found for notification");
      await ctx.reply(
        `⚠️ Task approved, but could not notify employee - no Telegram ID found. Please ensure the employee has started the bot.`
      );
    }
  } catch (error) {
    console.error("Error in approve task creation callback:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});

bot.action(/reject_task_creation_(\d+)/, async (ctx) => {
  try {
    // Extract task ID from the callback data
    const taskId = parseInt(ctx.match[1], 10);
    
    // Check if user is a manager
    const isManager = await UserModel.isManager(ctx.from.id);

    if (!isManager) {
      return await ctx.answerCbQuery("🚫 Sorry, only managers can reject tasks.");
    }

    // Get task details with employee information
    const task = await TaskModel.getTaskWithManagerInfo(taskId);

    // Check if task was found
    if (!task) {
      return await ctx.answerCbQuery(`Task with ID ${taskId} not found.`);
    }

    if (task.status !== "pending_approval") {
      return await ctx.answerCbQuery(`Task "${task.description}" is not pending approval.`);
    }

    // Get the manager's user ID (not Telegram ID)
    const manager = await UserModel.getUserByTelegramId(ctx.from.id);
    if (!manager) {
      return await ctx.answerCbQuery("Error: Manager record not found in database.");
    }

    // Update task status to 'rejected' and store the manager ID who rejected it
    await TaskModel.updateTaskStatusAndApprover(taskId, "rejected", manager.id);

    // Update the inline keyboard to show it's been rejected
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          {
            text: "❌ Task Rejected",
            callback_data: "task_already_handled"
          } 
        ]
      ]
    });

    // Send confirmation to manager
    await ctx.answerCbQuery(`❌ You have rejected task "${task.description}"`);

    // Add a message below the original message confirming the rejection
    await ctx.reply(`❌ You have rejected task "${task.description}".`);

    // Notify employee
    if (task && task.employee_telegram_id) {
      const notificationMessage = `
❌ *Task Rejected*

Your task request has been rejected by ${manager.first_name || "your manager"}:

📝 *Task:* ${task.description}
📅 *Due:* ${new Date(task.due_date).toLocaleString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})}

Please discuss with your manager for more details or create a new task request.`;

      const success = await sendNotification(
        ctx.telegram,
        task.employee_telegram_id,
        notificationMessage
      );

      if (!success) {
        logger.warn(`Notification failed for user ${task.employee_telegram_id}`);
        await ctx.reply(
          `⚠️ Task rejected, but the employee could not be notified. They may have blocked the bot or not started it.`
        );
      }
    }
  } catch (error) {
    logger.error("Error in reject task creation callback:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});
// Handle pagination for my tasks
bot.action(/^mytasks_page_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract page number from the callback data
    const page = parseInt(ctx.match[1]);
    
    const user = await UserModel.getUserByTelegramId(ctx.from.id);
    const personalTasks = await TaskModel.getTasksByEmployee(user.id);
    
    // Import the personal task image generator
    const personalTaskImageGenerator = require('../utils/personalTaskImageGenerator');
    
    // Generate new image for the requested page - removed sorting options
    const options = {
      page,
      itemsPerPage: 30
    };
    
    const imageResult = await personalTaskImageGenerator.generatePersonalTasksImage(personalTasks, options);
    
    // Create pagination controls if needed
    const keyboard = [];
    
    // Add pagination buttons if more than one page
    if (imageResult.totalPages > 1) {
      const paginationRow = [];
      
      // Previous page button (if not on first page)
      if (imageResult.currentPage > 1) {
        paginationRow.push({
          text: "⬅️ Previous",
          callback_data: `mytasks_page_${imageResult.currentPage - 1}`
        });
      }
      
      // Page indicator
      paginationRow.push({
        text: `Page ${imageResult.currentPage}/${imageResult.totalPages}`,
        callback_data: 'noop' // No operation
      });
      
      // Next page button (if not on last page)
      if (imageResult.currentPage < imageResult.totalPages) {
        paginationRow.push({
          text: "Next ➡️",
          callback_data: `mytasks_page_${imageResult.currentPage + 1}`
        });
      }
      
      keyboard.push(paginationRow);
    }
    
    // Add a back button in the last row - removed sorting buttons
    keyboard.push([
      { text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }
    ]);
    
    // Update the image with caption and buttons
    await ctx.editMessageMedia(
      {
        type: 'photo',
        media: { source: imageResult.buffer },
        caption: `Your tasks (${personalTasks.length} total)`
      },
      {
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
    
  } catch (error) {
    logger.error("Error in mytasks pagination:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});

// Handle sorting for my tasks
bot.action(/^mytasks_sort_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract sort field from the callback data
    const sortField = ctx.match[1];
    
    // Toggle direction if sorting by the same field again
    let orderDir = 'asc';
    if (ctx.session.myTasksOrderBy === sortField) {
      orderDir = ctx.session.myTasksOrderDir === 'asc' ? 'desc' : 'asc';
    }
    
    // Store sort preference in session
    ctx.session.myTasksOrderBy = sortField;
    ctx.session.myTasksOrderDir = orderDir;
    
    const user = await UserModel.getUserByTelegramId(ctx.from.id);
    const personalTasks = await TaskModel.getTasksByEmployee(user.id);
    
    // Import the personal task image generator
    const personalTaskImageGenerator = require('../utils/personalTaskImageGenerator');
    
    // Generate new image with the requested sorting
    const options = {
      page: 1, // Reset to first page on sort change
      itemsPerPage: 30,
      orderBy: sortField,
      orderDir
    };
    
    const imageResult = await personalTaskImageGenerator.generatePersonalTasksImage(personalTasks, options);
    
    // Create pagination controls if needed
    const keyboard = [];
    
    // Add pagination buttons if more than one page
    if (imageResult.totalPages > 1) {
      const paginationRow = [];
      
      // Previous page button (if not on first page)
      if (imageResult.currentPage > 1) {
        paginationRow.push({
          text: "⬅️ Previous",
          callback_data: `mytasks_page_${imageResult.currentPage - 1}`
        });
      }
      
      // Page indicator
      paginationRow.push({
        text: `Page ${imageResult.currentPage}/${imageResult.totalPages}`,
        callback_data: 'noop' // No operation
      });
      
      // Next page button (if not on last page)
      if (imageResult.currentPage < imageResult.totalPages) {
        paginationRow.push({
          text: "Next ➡️",
          callback_data: `mytasks_page_${imageResult.currentPage + 1}`
        });
      }
      
      keyboard.push(paginationRow);
    }
    
    // Add sorting options in a row
    keyboard.push([
      { text: "Sort by Status", callback_data: "mytasks_sort_status" },
      { text: "Sort by Due Date", callback_data: "mytasks_sort_due_date" }
    ]);
    
    // Add a back button in the last row
    keyboard.push([
      { text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }
    ]);
    
    // Update the image with caption and buttons
    await ctx.editMessageMedia(
      {
        type: 'photo',
        media: { source: imageResult.buffer },
        caption: `Your tasks (${personalTasks.length} total)`
      },
      {
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
    
  } catch (error) {
    logger.error("Error in mytasks sorting:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});

bot.action("action_complete", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    if (!ctx.session) ctx.session = {};
    ctx.session.currentAction = "action_complete";
    // Start the complete task scene
    await ctx.scene.enter("completeTaskScene");
  } catch (error) {
    logger.error("Error in complete action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});
bot.action("action_create_task", async (ctx) => {
  console.log("✅ Global action_create_task triggered");

  try {
    if (!ctx || !ctx.from) {
      console.error("❌ Context or ctx.from is undefined.");
      return;
    }

    console.log("🔍 Answering callback query...");
    await ctx.answerCbQuery();

    console.log("🧹 Cleaning up active scenes...");
    await cleanupActiveScenes(ctx);

    console.log("🔍 Fetching user info from DB...");
    const user = await UserModel.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      console.warn("❌ User not found in DB for Telegram ID:", ctx.from.id);
      return await ctx.answerCbQuery(
        "❌ User not found. Please restart the bot with /start."
      );
    }

    console.log("👤 User found:", user);

    if (!ctx.session) {
      console.log("⚠️ ctx.session was undefined. Initializing...");
      ctx.session = {};
    }

    ctx.session.currentAction = "action_create_task";
    console.log("📌 Set currentAction in session:", ctx.session.currentAction);

    if (user.role !== 0 && user.role !== 1 && user.role !== 2) {
      console.warn("🚫 User role not allowed to create task:", user.role);
      return await ctx.answerCbQuery(
        "🚫 Sorry, only employees and managers can create tasks."
      );
    }

    console.log("✅ Role check passed (employee or manager)");

    console.log("🚪 Attempting to enter createTaskScene...");
    await ctx.scene.enter("createTaskScene");
    console.log("🎉 Successfully entered createTaskScene!");

  } catch (error) {
    console.error("❌ Error in create task action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});

bot.action("action_projects", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    // Check if user is manager or admin
    const isManager = await UserModel.isManager(ctx.from.id);
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    
    if (!isManager && !isAdmin) {
      return await ctx.answerCbQuery("🚫 Sorry, only managers and admins can manage projects.");
    }
    
    // Enter the project scene
    await ctx.scene.enter("projectScene");
  } catch (error) {
    logger.error("Error in projects action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});


bot.action("action_show_tasks", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    const isTeamLead = await UserModel.isTeamLead(ctx.from.id);

    if (!isTeamLead) {
      return await ctx.answerCbQuery(
        "🚫 Sorry, only team leads, managers, and admins can view all tasks."
      );
    }

    // Start the show tasks scene
    await ctx.scene.enter("showTasksScene");
  } catch (error) {
    logger.error("Error in show tasks action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});
bot.action(/approve_task_(\d+)/, async (ctx) => {
  try {
    // Extract task ID from the callback data
    const taskId = parseInt(ctx.match[1], 10);
    
    // Check if user is a manager
    const isManager = await UserModel.isManager(ctx.from.id);

    if (!isManager) {
      return await ctx.answerCbQuery("🚫 Sorry, only managers can approve tasks.");
    }

    // Get task details with employee information
    const task = await TaskModel.getTaskWithManagerInfo(taskId);

    // Check if task was found
    if (!task) {
      return await ctx.answerCbQuery(`Task with ID ${taskId} not found.`);
    }

    if (task.status !== "pending_approval") {
      return await ctx.answerCbQuery(`Task "${task.description}" is not pending approval.`);
    }

    // Get the manager's user ID (not Telegram ID)
    const manager = await UserModel.getUserByTelegramId(ctx.from.id);
    if (!manager) {
      return await ctx.answerCbQuery("Error: Manager record not found in database.");
    }

    // Mark task as completed and store the manager ID who approved it
    await TaskModel.updateTaskStatusAndApprover(taskId, "completed", manager.id);

    // Update the inline keyboard to show it's been approved
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          {
            text: "✅ Completed",
            callback_data: "task_already_handled"
          } 
        ]
      ]
    });

    // Send confirmation to manager
    await ctx.answerCbQuery(`✅ You have approved task "${task.description}"`);

    // Add a message below the original message confirming the approval
    await ctx.reply(`✅ You have approved and marked task "${task.description}" as complete.`);

    // Notify employee
    if (task && task.employee_telegram_id) {
      logger.info(`Employee Telegram ID found: ${task.employee_telegram_id}`);
      
      const notificationMessage = `
✅ *Task Approved and Completed*

Great job! Your task "${task.description}" has been reviewed and approved by ${ctx.from.first_name || "your manager"}.

The task is now marked as complete.`;

      logger.debug(`Sending notification message: ${notificationMessage}`);

      const success = await sendNotification(
        ctx.telegram,
        task.employee_telegram_id,
        notificationMessage
      );

      if (!success) {
        logger.warn(`Notification failed for user ${task.employee_telegram_id}`);
        await ctx.reply(
          `⚠️ Task "${task.description}" approved, but the employee could not be notified. They may have blocked the bot or not started it.`
        );
      } else {
        logger.info(`Notification sent successfully to ${task.employee_telegram_id}`);
      }
    } else {
      // Fallback logic for notifying the employee (same as in the original code)
      logger.warn(`No employee Telegram ID found for task ID ${taskId}, employee_id: ${task?.employee_id}`);
      
      if (task && task.employee_id) {
        logger.info(`Attempting to fetch employee telegram_id directly using employee_id: ${task.employee_id}`);
        
        try {
          const employee = await UserModel.getUserById(task.employee_id);
          
          if (employee && employee.telegram_id) {
            const employeeTelegramId = employee.telegram_id;
            logger.info(`Found employee Telegram ID through direct query: ${employeeTelegramId}`);
            
            const notificationMessage = `
✅ *Task Approved and Completed*

Great job! Your task "${task.description}" has been reviewed and approved by ${ctx.from.first_name || "your manager"}.

The task is now marked as complete.`;

            const success = await sendNotification(
              ctx.telegram,
              employeeTelegramId,
              notificationMessage
            );
            
            if (success) {
              logger.info(`Notification sent successfully to ${employeeTelegramId} (fallback method)`);
            } else {
              logger.warn(`Notification failed for user ${employeeTelegramId} (fallback method)`);
              await ctx.reply(
                `⚠️ Task "${task.description}" approved, but the employee could not be notified. They may have blocked the bot or not started it.`
              );
            }
          } else {
            logger.warn(`No telegram_id found for employee ID ${task.employee_id}`);
            await ctx.reply(
              `⚠️ Note: Employee for task "${task.description}" has no Telegram ID registered in the system.`
            );
          }
        } catch (err) {
          logger.error(`Error fetching employee data: ${err.message}`);
        }
      }
    }
  } catch (error) {
    logger.error("Error in approve task callback:", error);
    await ctx.answerCbQuery("Sorry, there was an error approving the task. Please try again.");
  }
});

bot.action("action_checkusers", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await cleanupActiveScenes(ctx);

    const isManager = await UserModel.isManager(ctx.from.id);
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    const isTeamLead = await UserModel.isTeamLead(ctx.from.id);

    if (!isManager && !isTeamLead && !isAdmin) {
      return await ctx.answerCbQuery("Sorry, only team leads, managers, and admins can use this feature.");
    }

    // 🔁 Redirect by calling the shared handler
    await handleReviewApprovals(ctx);

  } catch (error) {
    logger.error("Error in checkusers redirecting to review approvals:", error);
    await ctx.answerCbQuery("Error redirecting to review approvals.");
  }
});


async function handleReviewApprovals(ctx) {
  const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
  const isAdmin = await UserModel.isAdmin(ctx.from.id);
  const isManager = await UserModel.isManager(ctx.from.id);

  let pendingApprovals = [];
  if (isAdmin) {
    pendingApprovals = await PendingApprovalModel.getPendingApprovals(currentUser.id, 'admin');
  } else if (isManager) {
    pendingApprovals = await PendingApprovalModel.getPendingApprovals(currentUser.id, 'manager');
  }

  if (pendingApprovals.length === 0) {
    return await ctx.editMessageText("No pending approvals found.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back", callback_data: "action_manage_users" }]]
      }
    });
  }

  const roleMap = {
    0: "Admin",
    1: "Manager",
    2: "Employee"
  };

  const buttons = pendingApprovals.map(approval => {
    const roleName = roleMap[approval.role] || "Unknown Role";
    return [{
      text: `👤 ${approval.first_name} ${approval.last_name || ''} (${roleName})`,
      callback_data: `approve_user_${approval.id}`
    }];
  });

  buttons.push([{ text: "🔙 Back", callback_data: "action_manage_users" }]);

  await ctx.editMessageText("Select a user to approve or reject:", {
    reply_markup: { inline_keyboard: buttons }
  });
}


bot.action(/^approve_task_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const requestId = ctx.match[1];
      
      // Get the pending request data
      if (!global.pendingTaskRequests || !global.pendingTaskRequests.has(requestId)) {
        await ctx.editMessageText(
          "❌ This task request is no longer valid or has already been processed.",
          {
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          }
        );
        return;
      }

      const taskData = global.pendingTaskRequests.get(requestId);
      
      // Create the task
      const task = await TaskModel.createTask(
        taskData.employeeName,
        taskData.taskDescription,
        taskData.dueDate,
        taskData.employeeId  // The employee becomes the creator
      );

      // Format the date for display
      const formattedDate = taskData.dueDate ? 
        formatDate(taskData.dueDate, taskData.hasTimeComponent) : 
        "Not specified";

      // Update manager's message
      await ctx.editMessageText(
        `✅ **Task Request Approved**\n\nYou have approved the task request from ${taskData.employeeName}.\n\n📝 **Task:** ${taskData.taskDescription}\n📅 **Due:** ${formattedDate}\n\nThe task has been created and the employee has been notified.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
          }
        }
      );

      // Notify the employee
      const employee = await UserModel.getUserById(taskData.employeeId);
      if (employee && employee.telegram_id) {
        const employeeNotification = `
✅ **Task Request Approved!**

Your manager has approved your task request:

📝 **Task:** ${taskData.taskDescription}
📅 **Due:** ${formattedDate}

The task has been added to your task list.
        `;

        await sendNotification(
          ctx.telegram,
          employee.telegram_id,
          employeeNotification
        );
      }

      // Clean up the pending request
      global.pendingTaskRequests.delete(requestId);

    } catch (error) {
      logger.error("Error approving task request:", error);
      await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
    }
  });
function formatDate(date, hasTimeComponent = true) {
    // Check if date is undefined or null
    if (!date) {
      return "Not specified";
    }
    
    try {
      // If there's no time component specified, only show the date
      if (!hasTimeComponent) {
        return date.toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
      }
      
      // Format date as "Month DD, YYYY at HH:MM AM/PM"
      return date.toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (error) {
      logger.error("Error formatting date:", error);
      return "Invalid date format";
    }
  }
  // Handler for task rejection

  // Handler for discussing task with employee
  bot.action(/^discuss_task_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const requestId = ctx.match[1];
      
      // Get the pending request data
      if (!global.pendingTaskRequests || !global.pendingTaskRequests.has(requestId)) {
        await ctx.editMessageText(
          "❌ This task request is no longer valid or has already been processed.",
          {
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          }
        );
        return;
      }

      const taskData = global.pendingTaskRequests.get(requestId);

      // Update manager's message
      await ctx.editMessageText(
        `💬 **Task Discussion**\n\nTask request from ${taskData.employeeName} is pending discussion.\n\n📝 **Task:** ${taskData.taskDescription}\n\nPlease discuss this task with the employee directly. You can approve or reject it later.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve Now", callback_data: `approve_task_${requestId}` },
                { text: "❌ Reject Now", callback_data: `reject_task_${requestId}` }
              ],
              [{ text: "Back to Main Menu", callback_data: "action_main_menu" }]
            ]
          }
        }
      );

      // Notify the employee
      const employee = await UserModel.getUserById(taskData.employeeId);
      if (employee && employee.telegram_id) {
        const employeeNotification = `
💬 **Manager wants to discuss your task request**

Your manager wants to discuss your task request with you:

📝 **Task:** ${taskData.taskDescription}

Please reach out to your manager to discuss the details.
        `;

        await sendNotification(
          ctx.telegram,
          employee.telegram_id,
          employeeNotification
        );
      }

    } catch (error) {
      logger.error("Error setting task for discussion:", error);
      await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
    }
  });


// Utility to escape MarkdownV2 special characters
function escapeMarkdownV2(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Action handler
bot.action("action_invite", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await cleanupActiveScenes(ctx);
    
    const isManager = await UserModel.isManager(ctx.from.id);
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    if (!isManager && !isAdmin) {
      return await ctx.answerCbQuery("🚫 Sorry, only managers and admins can invite new employees.");
    }
    
    const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
    if (!currentUser) {
      return await ctx.answerCbQuery("User data not found.");
    }
    
    // Create one-time invitation code
    const inviteCode = await InvitationModel.createInvitation(currentUser.id, ROLES.EMPLOYEE);
    const botUsername = (await ctx.telegram.getMe()).username;
    const startLink = `https://t.me/${botUsername}?start=${inviteCode}`;
    
    const rawText = `📱 *Invite New Employees*

⚠️ *Important:* This link can only be used ONCE and will be deactivated after use.

To receive task notifications, employees must start the bot first.

✅ *Share this one-time link with your team member:*
${startLink}

🔔 You'll receive a notification when they register for approval.`;

    const message = escapeMarkdownV2(rawText);
    
    const backButton = [
      [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
    ];
    
    await ctx.editMessageText(message, {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: backButton
      }
    });
    
  } catch (error) {
    console.error("Error in invite action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});






bot.action("action_role", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    // Check if user is admin
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    const isManager = await UserModel.isManager(ctx.from.id);

    if (!isAdmin && !isManager) {
      return await ctx.answerCbQuery(
        "🚫 Sorry, only managers and administrators can manage roles."
      );
    }

    // Start the role management scene
    await ctx.scene.enter("roleManagementScene");
  } catch (error) {
    logger.error("Error in role action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});


bot.action("action_delete_user", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    // Check if user is admin or manager
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    const isManager = await UserModel.isManager(ctx.from.id);
    
    if (!isAdmin && !isManager) {
      return await ctx.answerCbQuery(
        "🚫 Sorry, only managers and administrators can delete users."
      );
    }

    // Enter the delete user scene
    await ctx.scene.enter("deleteUserScene");
  } catch (error) {
    logger.error("Error in delete user action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
});
// Handler for viewing tasks pending approval
bot.action("action_view", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    // Clean up any active scenes
    await cleanupActiveScenes(ctx);
    
    // Check if user is a manager
    const isManager = await UserModel.isManager(ctx.from.id);
    
    if (!isManager) {
      return await ctx.reply("🚫 Sorry, only managers can access this menu.");
    }
    
    // Get all tasks pending approval
    const pendingTasks = await TaskModel.getTasksByStatus("pending_approval");
    
    if (!pendingTasks || pendingTasks.length === 0) {
      return await ctx.editMessageText("No tasks are currently pending approval.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }]
          ]
        }
      });
    }
    
    // Create a message with all pending tasks
    let message = "📋 *Tasks Pending Approval*\n\n";
    
    // Create an inline keyboard with approve/reject buttons for each task
    const inlineKeyboard = [];
    
    // Add each task to the message and create buttons for each
    for (let i = 0; i < pendingTasks.length; i++) {
      const task = pendingTasks[i];
      
      // Add task details to message
      message += `*Task ${i+1}:* ${task.description}\n` +
        `*Employee:* ${task.employee_first_name || 'Unknown'}\n` +
        `*Due Date:* ${task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}\n\n`;
      
      // Add approve/reject buttons for this task
      inlineKeyboard.push([
        { text: `✅ Approve #${i+1}`, callback_data: `approve_task_${task.id}` },
        { text: `❌ Reject #${i+1}`, callback_data: `reject_task_${task.id}` }
      ]);
    }
    
    // Add back button at the end
    inlineKeyboard.push([
      { text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }
    ]);
    
    // Update the message with all tasks and buttons
    await ctx.editMessageText(message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
    
  } catch (error) {
    logger.error("Error in view tasks action:", error);
    await ctx.reply("Sorry, there was an error loading tasks. Please try again.");
  }
});



bot.action(/reject_task_(\d+)/, async (ctx) => {
  try {
    
    // Extract task ID from the callback data
    console.log("=== REJECT TASK CALLBACK TRIGGERED ===");
    // Extract task ID from the callback data
    const taskId = parseInt(ctx.match[1], 10);
    console.log("Task ID from callback:", taskId);
    
    // Initialize session if it doesn't exist
    ctx.session = ctx.session || {};
    console.log("Current session before update:", JSON.stringify(ctx.session, null, 2));
    
    // Store the task ID in the user's session
    ctx.session.rejectTaskId = taskId;
    console.log("Updated session:", JSON.stringify(ctx.session, null, 2));
    
    // Check if user is a manager
    const isManager = await UserModel.isManager(ctx.from.id);
    
    if (!isManager) {
      return await ctx.answerCbQuery("🚫 Sorry, only managers can reject tasks.");
    }

    // Get task details
    const task = await TaskModel.getTaskById(taskId);
    
    if (!task) {
      return await ctx.answerCbQuery(`Task with ID ${taskId} not found.`);
    }
    
    // Check if task status is pending_approval
    if (task.status !== "pending_approval") {
      return await ctx.answerCbQuery(`Task ${taskId} is not pending approval. Current status: ${task.status}`);
    }

    // Update the message to indicate the task is being rejected
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          {
            text: "❌ Rejection in progress...",
            callback_data: "task_being_rejected"
          }
        ]
      ]
    });

    // Store the task ID in the user's session
    ctx.session = ctx.session || {};
    ctx.session.rejectTaskId = taskId;
    
    // Ask for rejection reason with force reply
    await ctx.reply(
      `Please provide a reason for rejecting task "${task.description}". Reply with your reason.`,
      { reply_markup: { force_reply: true } }
    );
    
    // Answer the callback query
    await ctx.answerCbQuery("Please provide a rejection reason in your next message");
    
  } catch (error) {
    logger.error("Error in reject task callback:", error);
    await ctx.answerCbQuery("Sorry, there was an error processing your request. Please try again.");
  }
});
// New action to review pending approvals
bot.action("action_review_approvals", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await handleReviewApprovals(ctx);
  } catch (error) {
    logger.error("Error in review approvals:", error);
    await ctx.answerCbQuery("Error loading approvals.");
  }
});

 bot.action(/^reject_task_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const requestId = ctx.match[1];
      
      // Get the pending request data
      if (!global.pendingTaskRequests || !global.pendingTaskRequests.has(requestId)) {
        await ctx.editMessageText(
          "❌ This task request is no longer valid or has already been processed.",
          {
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          }
        );
        return;
      }

      const taskData = global.pendingTaskRequests.get(requestId);

      // Update manager's message
      await ctx.editMessageText(
        `❌ **Task Request Rejected**\n\nYou have rejected the task request from ${taskData.employeeName}.\n\n📝 **Task:** ${taskData.taskDescription}\n\nThe employee has been notified of the rejection.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
          }
        }
      );

      // Notify the employee
      const employee = await UserModel.getUserById(taskData.employeeId);
      if (employee && employee.telegram_id) {
        const employeeNotification = `
❌ **Task Request Rejected**

Your manager has rejected your task request:

📝 **Task:** ${taskData.taskDescription}

You can create a new task request or discuss with your manager for more details.
        `;

        await sendNotification(
          ctx.telegram,
          employee.telegram_id,
          employeeNotification
        );
      }

      // Clean up the pending request
      global.pendingTaskRequests.delete(requestId);

    } catch (error) {
      logger.error("Error rejecting task request:", error);
      await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
    }
  });

// Handle individual approval review
bot.action(/^approve_user_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const approvalId = parseInt(ctx.match[1]);
    const approval = await PendingApprovalModel.getApprovalById(approvalId);
    
    if (!approval) {
      return await ctx.answerCbQuery("Approval not found.");
    }

    // Role mapping
    const roleMap = {
      0: "Admin",
      1: "Manager",
      2: "Employee"
    };

    const roleName = roleMap[approval.role] || "Unknown Role";

    const message = `👤 *User Approval Request*\n\n` +
                   `Name: ${approval.first_name} ${approval.last_name || ''}\n` +
                   `Role: ${roleName}\n` +
                   `Requested: ${new Date(approval.created_at).toLocaleDateString()}\n\n` +
                   `What would you like to do?`;

    const buttons = [
      [
        { text: "✅ Approve", callback_data: `final_approve_${approvalId}` },
        { text: "❌ Reject", callback_data: `final_reject_${approvalId}` }
      ],
      [{ text: "🔙 Back", callback_data: "action_review_approvals" }]
    ];

    await ctx.editMessageText(message, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    });

  } catch (error) {
    logger.error("Error in approve user:", error);
    await ctx.answerCbQuery("Error loading user details.");
  }
});


bot.action(/^final_(approve|reject)_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const action = ctx.match[1]; // 'approve' or 'reject'
    const approvalId = parseInt(ctx.match[2]);
    const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
    
    const approval = await PendingApprovalModel.getApprovalById(approvalId);
    if (!approval) {
      return await ctx.answerCbQuery("Approval not found.");
    }

    // Update approval status
    await PendingApprovalModel.updateApprovalStatus(approvalId, action === 'approve' ? 'approved' : 'rejected', currentUser.id);
    
    if (action === 'approve') {
      // Update user status to active
      await UserModel.updateUserStatus(approval.user_id, 'active');
      
      // Notify the user
      await ctx.telegram.sendMessage(approval.telegram_id, 
        `you have been successfully regestired into the system, you can start the bot by typing anything`
      );
      
      await ctx.editMessageText(`✅ User ${approval.first_name} has been approved successfully!`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Approvals", callback_data: "action_review_approvals" }]]
        }
      });
    } else {
      // Notify the user about rejection
      await ctx.telegram.sendMessage(approval.telegram_id,
        `❌ Sorry, your registration request has been rejected. Please contact your administrator for more information.`
      );
      
      await ctx.editMessageText(`❌ User ${approval.first_name} has been rejected.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Approvals", callback_data: "action_review_approvals" }]]
        }
      });
    }

  } catch (error) {
    logger.error("Error in final approval:", error);
    await ctx.answerCbQuery("Error processing approval.");
  }
});
bot.action("action_review_approvals", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    const isManager = await UserModel.isManager(ctx.from.id);
    
    let pendingApprovals = [];
    if (isAdmin) {
      pendingApprovals = await PendingApprovalModel.getPendingApprovals(currentUser.id, 'admin');
    } else if (isManager) {
      pendingApprovals = await PendingApprovalModel.getPendingApprovals(currentUser.id, 'manager');
    }

    if (pendingApprovals.length === 0) {
      return await ctx.editMessageText("No pending approvals found.", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back", callback_data: "action_checkusers" }]]
        }
      });
    }

    const buttons = pendingApprovals.map(approval => [
      { 
        text: `👤 ${approval.first_name} ${approval.last_name || ''} (${approval.role})`, 
        callback_data: `approve_user_${approval.id}` 
      }
    ]);
    
    buttons.push([{ text: "🔙 Back", callback_data: "action_checkusers" }]);

    await ctx.editMessageText("Select a user to approve or reject:", {
      reply_markup: { inline_keyboard: buttons }
    });

  } catch (error) {
    logger.error("Error in review approvals:", error);
    await ctx.answerCbQuery("Error loading approvals.");
  }
});

async function processTaskRejection(ctx, taskId, reason) {
  console.log(`Starting processTaskRejection for task ${taskId}`);
  try {
    // Get task details
    console.log("Fetching task details");
    const task = await TaskModel.getTaskById(taskId);
    
    if (!task) {
      console.log(`Task with ID ${taskId} not found`);
      return await ctx.reply(`Task with ID ${taskId} not found.`);
    }
    
    console.log("Task found:", JSON.stringify(task, null, 2));
    
    // Get employee details
    console.log("Fetching employee details");
    const employee = await UserModel.findById(task.employee_id);
    console.log("Employee found:", employee ? "yes" : "no");

    // Get manager details
    console.log("Fetching manager details");
    const manager = await UserModel.getUserByTelegramId(ctx.from.id);
    console.log("Manager found:", manager ? "yes" : "no");
    
    // Update task status back to pending
    console.log("Updating task status to pending");
    const statusUpdateResult = await TaskModel.updateTaskStatus(taskId, "pending");
    console.log("Status update result:", statusUpdateResult);

    // Notify employee about rejection
    if (employee && employee.telegram_id) {
      console.log(`Sending notification to employee ${employee.telegram_id}`);
      const rejectionMessage = `
❌ *Task Completion Rejected*

Task: ${task.description}
Rejected by: ${manager?.first_name || manager?.username || "Manager"}
Reason: ${reason}

Your task has been returned to "pending" status. Please address the feedback and resubmit when ready.
      `;

      await sendNotification(
        ctx.telegram,
        employee.telegram_id,
        rejectionMessage
      );
      console.log("Employee notification sent");
    } else {
      console.log("Could not notify employee - missing information");
    }

    // Confirmation to manager
    console.log("Sending confirmation to manager");
    await ctx.reply(
      `✅ Task "${task.description}" has been rejected. Employee has been notified.`
    );
    console.log("Confirmation sent to manager");
  } catch (error) {
    console.error("Error processing task rejection:", error);
    await ctx.reply(
      "Sorry, there was an error rejecting the task. Please try again."
    );
  }
}

}
// Database models for invitation links and pending approvals
class InvitationModel {
  static generateUniqueCode() {
    return (
      Math.random().toString(36).substring(2, 10) +
      Math.random().toString(36).substring(2, 10)
    );
  }

  static async createInvitation(inviterId, role, expiresAt = null) {
    const inviteCode = this.generateUniqueCode();
    const query = `
      INSERT INTO invitations (invite_code, inviter_id, role, expires_at, is_used, created_at)
      VALUES (?, ?, ?, ?, false, NOW())
    `;
    await db.query(query, [inviteCode, inviterId, role, expiresAt]);
    return inviteCode;
  }

  static async getInvitation(inviteCode) {
    const query = `
      SELECT * FROM invitations 
      WHERE invite_code = ? AND is_used = false 
      AND (expires_at IS NULL OR expires_at > NOW())
    `;
    const results = await db.query(query, [inviteCode]);
    return results[0] || null;
  }

  static async markInvitationAsUsed(inviteCode) {
    const query = `
      UPDATE invitations 
      SET is_used = true, used_at = NOW() 
      WHERE invite_code = ?
    `;
    await db.query(query, [inviteCode]);
  }
}

class PendingApprovalModel {
  static async createPendingApproval(userId, role, inviterId, approverType, approverId) {
  const sql = `
    INSERT INTO pending_approvals (user_id, role, inviter_id, approver_type, approver_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `;
  const result = await query(sql, [userId, role, inviterId, approverType, approverId]);
  return result.insertId; // No destructuring here
}




  static async getPendingApprovals(approverId, approverType) {
  const sql = `
    SELECT pa.*, u.first_name, u.last_name, u.username, u.telegram_id
    FROM pending_approvals pa
    JOIN users u ON pa.user_id = u.id
    WHERE pa.approver_id = ? AND pa.approver_type = ? AND pa.status = 'pending'
    ORDER BY pa.created_at DESC
  `;
  const results = await query(sql, [approverId, approverType]);
  return results;
}




    static async updateApprovalStatus(approvalId, status, approverId) {
  const sql = `
    UPDATE pending_approvals 
    SET status = ?, approved_by = ?, approved_at = NOW()
    WHERE id = ?
  `;
  await query(sql, [status, approverId, approvalId]);
}


  static async getApprovalById(approvalId) {
  const sql = `
    SELECT pa.*, u.first_name, u.last_name, u.username, u.telegram_id
    FROM pending_approvals pa
    JOIN users u ON pa.user_id = u.id
    WHERE pa.id = ?
  `;
  const results = await query(sql, [approvalId]);
  return results.length ? results[0] : null;
}

}

module.exports = {
  registerCommands,
};

