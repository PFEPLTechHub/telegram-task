// src/scenes/roleManagementScene.js
const { Scenes } = require("telegraf");
const UserModel = require("../models/userModel");
const logger = require("../utils/logger");
const { query } = require("../database/db");

// Helper function to safely edit message text
async function safeEditMessage(ctx, chatId, messageId, text, options = {}) {
  try {
    await ctx.telegram.editMessageText(chatId, messageId, null, text, options);
  } catch (error) {
    // If message is not modified, just ignore the error
    if (error.description && error.description.includes('message is not modified')) {
      logger.debug('Message not modified, ignoring error');
      return;
    }
    // If message to edit not found, send a new message
    if (error.description && error.description.includes('message to edit not found')) {
      logger.debug('Message to edit not found, sending new message');
      const sentMsg = await ctx.reply(text, options);
      // Update session with new message info
      if (ctx.session) {
        ctx.session.originalMessage = {
          chat_id: sentMsg.chat.id,
          message_id: sentMsg.message_id
        };
      }
      return;
    }
    // Re-throw other errors
    throw error;
  }
}

function roleManagementScene() {
  const scene = new Scenes.WizardScene(
    "roleManagementScene",
    // Step 0: Show role management options
    async (ctx) => {
      try {
        // Save original message context for future edits
        if (ctx.callbackQuery) {
          ctx.session.originalMessage = {
            chat_id: ctx.callbackQuery.message.chat.id,
            message_id: ctx.callbackQuery.message.message_id
          };
        }

        // Check if user is admin
        const isAdmin = await UserModel.isAdmin(ctx.from.id);
        const isManager = await UserModel.isManager(ctx.from.id);
        if (!isAdmin && !isManager) {
          const message = "🚫 Sorry, only administrators can manage roles.";
          
          if (ctx.session.originalMessage) {
            await safeEditMessage(
              ctx,
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              message,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
                }
              }
            );
          } else {
            const sentMsg = await ctx.reply(message, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
              }
            });
            
            // Save the sent message for future editing
            ctx.session.originalMessage = {
              chat_id: sentMsg.chat.id,
              message_id: sentMsg.message_id
            };
          }
          
          return await ctx.scene.leave();
        }

        const message = "👥 *Role Management Panel*\n\nPlease select an option:";
        const inlineKeyboard = {
          inline_keyboard: [
            [{ text: "View All Users", callback_data: "view_all_users" }],
            [{ text: "Change User Role", callback_data: "change_user_role" }],
            [{ text: "Back to User Management", callback_data: "action_manage_users" }]
          ]
        };
        
        // Edit message if we have an original message, otherwise send new one
        if (ctx.session.originalMessage) {
          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            message,
            {
              parse_mode: "Markdown",
              reply_markup: inlineKeyboard
            }
          );
        } else {
          const sentMsg = await ctx.reply(message, {
            parse_mode: "Markdown",
            reply_markup: inlineKeyboard
          });
          
          // Save the sent message for future editing
          ctx.session.originalMessage = {
            chat_id: sentMsg.chat.id,
            message_id: sentMsg.message_id
          };
        }
        
        return ctx.wizard.next();
      } catch (error) {
        logger.error("Error in role management scene (step 0):", error);
        
        const errorMessage = "Sorry, there was an error. Please try again.";
        
        if (ctx.session.originalMessage) {
          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
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

    // Step 1: Handle selected option
    async (ctx) => {
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons.");
        return;
      }

      const callbackData = ctx.callbackQuery.data;

      try {
        await ctx.answerCbQuery();

        if (callbackData === "action_manage_users") {
          ctx.scene.leave();
          return ctx.scene.enter("userManagementScene");
        }

        if (callbackData === "view_all_users") {
          const isAdmin = ctx.session.userRole === UserModel.ROLES.ADMIN;
          const user = await UserModel.getUserByTelegramId(ctx.from.id);

          if (!user) {
            if (ctx.session.originalMessage) {
              await safeEditMessage(
                ctx,
                ctx.session.originalMessage.chat_id,
                ctx.session.originalMessage.message_id,
                "Error: User not found. Please restart the bot with /start.",
                { parse_mode: "Markdown" }
              );
            } else {
              await ctx.reply("Error: User not found. Please restart the bot with /start.");
            }
            return ctx.scene.leave();
          }

          ctx.wizard.state.currentUser = user;

          let users = [];
          if (isAdmin) {
            // Admin sees all users
            users = await query("SELECT * FROM users ORDER BY role, first_name");
          } else if (user.role === UserModel.ROLES.MANAGER) {
            // Manager sees only direct reports (employees and managers who report directly to this manager)
            users = await UserModel.getEmployeesByManagerId(user.id);
          }

          if (!users || users.length === 0) {
            await safeEditMessage(
              ctx,
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              "No users found in the system.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
                  ]
                }
              }
            );
            // Don't change step, stay in current step so the back button works
            return;
          }

          // For non-admin, separate users into managers and employees under current user
          if (!isAdmin) {
            const managersUnderYou = [];
            const employeesUnderYou = [];

            users.forEach(u => {
              if (u.role === UserModel.ROLES.MANAGER) {
                managersUnderYou.push(u);
              } else if (u.role === UserModel.ROLES.EMPLOYEE) {
                employeesUnderYou.push(u);
              }
            });

            const managerName = user.first_name || user.username || "You";
            const escapedManagerName = managerName.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
            let message = `👤 *Manager (You):* ${escapedManagerName}\n\n`;

            if (managersUnderYou.length > 0) {
              message += "📂 *Managers under you:*\n";
              managersUnderYou.forEach((m, i) => {
                const name = m.first_name || m.username || `User ${m.id}`;
                // Escape underscores and other special Markdown characters
                const escapedName = name.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
                message += `  ${i + 1}. 👤 ${escapedName}\n`;
              });
              message += "\n";
            }

            if (employeesUnderYou.length > 0) {
              message += "📂 *Employees under you:*\n";
              employeesUnderYou.forEach((e, i) => {
                const name = e.first_name || e.username || `User ${e.id}`;
                // Escape underscores and other special Markdown characters
                const escapedName = name.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
                message += `  ${i + 1}. 👤 ${escapedName}\n`;
              });
              message += "\n";
            }

            await safeEditMessage(
              ctx,
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              message,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
                  ]
                }
              }
            );

            // Don't change step, stay in current step so the back button works
            return;
          }

          // For admin, show all users grouped by role (your existing logic)
          const groupedUsers = {};
          users.forEach((user) => {
            const roleName = UserModel.getRoleName(user.role);
            if (!groupedUsers[roleName]) groupedUsers[roleName] = [];

            const name = user.first_name || user.username || `User ${user.id}`;
            // Escape underscores and other special Markdown characters
            const escapedName = name.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
            groupedUsers[roleName].push(escapedName);
          });

          let message = "👥 *All Users by Role*\n\n";
          const roleOrder = ["admin", "manager", "employee"];
          for (const roleName of roleOrder) {
            if (groupedUsers[roleName]?.length > 0) {
              const roleEmoji =
                roleName === "admin" ? "🛡️ " :
                roleName === "manager" ? "👨‍💼 " : "🧑‍💼 ";
              message += `${roleEmoji}*${roleName.toUpperCase()}*\n`;
              groupedUsers[roleName].forEach((name, index) => {
                message += `  ${index + 1}. ${name}\n`;
              });
              message += "\n";
            }
          }

          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            message,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
                ]
              }
            }
          );

          // Don't change step, stay in current step so the back button works
          return;
        }

        if (callbackData === "back_to_role_menu") {
          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            "👥 *Role Management Panel*\n\nPlease select an option:",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "View All Users", callback_data: "view_all_users" }],
                  [{ text: "Change User Role", callback_data: "change_user_role" }],
                  [{ text: "Back to User Management", callback_data: "action_manage_users" }]
                ]
              }
            }
          );
          return; // Stay in the same step
        }

        if (callbackData === "change_user_role") {
          const isAdmin = ctx.session.userRole === UserModel.ROLES.ADMIN;

          let users = [];
          if (isAdmin) {
            users = await query("SELECT * FROM users ORDER BY first_name");
          } else {
            const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
            users = await query(
              "SELECT * FROM users WHERE manager_id = ? OR id = ? ORDER BY first_name",
              [currentUser.id, currentUser.id]
            );
          }

          if (users.length === 0) {
            await safeEditMessage(
              ctx,
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              "No users found in the system.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
                  ]
                }
              }
            );
            return;
          }

          const userButtons = users.map((user) => {
            const name = user.first_name || user.username || `User ${user.id}`;
            const roleEmoji =
              user.role === UserModel.ROLES.ADMIN ? "🛡️ " :
              user.role === UserModel.ROLES.MANAGER ? "👨‍💼 " : "🧑‍💼 ";
            return [{
              text: `${roleEmoji}${name}`,
              callback_data: `select_user_${user.id}_${user.telegram_id}`
            }];
          });

          userButtons.push([{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]);

          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            isAdmin ? "Select a user to change their role:" : "Select a team member to change their role:",
            {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: userButtons }
            }
          );

          return ctx.wizard.next(); // Move to step 2
        }

        // Fallback for unexpected callback
        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Invalid option. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
              ]
            }
          }
        );
      } catch (error) {
        logger.error("Error in role management scene (step 1):", error);

        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Sorry, there was an error. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
              ]
            }
          }
        );
      }
    },

    // Step 2: Select new role for user
    async (ctx) => {
      // If it's not a callback, ignore (we only expect button presses)
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons.");
        return; // Stay in current step
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      try {
        await ctx.answerCbQuery();
        
        if (callbackData === "back_to_role_menu") {
          // Go back to main role management menu (step 1)
          return ctx.wizard.selectStep(0);
        }
        
        if (callbackData === "action_manage_users") {
          ctx.scene.leave();
          return ctx.scene.enter("userManagementScene");
        }
        
        if (callbackData.startsWith("select_user_")) {
          // Parse user ID from callback data
          const parts = callbackData.split("_");
          const userId = parts[2];
          const telegramId = parts[3];
          
          // Get user details
          const user = await UserModel.getUserById(userId);
          
          if (!user) {
            await safeEditMessage(
              ctx,
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              "User not found. Please try again.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "Back to User Selection", callback_data: "change_user_role" }]
                  ]
                }
              }
            );
            return ctx.wizard.back();
          }
          
          // Store user info in state
          ctx.scene.state.userName = user.first_name || user.username || `User ${userId}`;
          ctx.scene.state.userId = userId;
          ctx.scene.state.telegramId = telegramId;
          ctx.scene.state.currentRole = user.role;
          ctx.scene.state.currentRoleName = UserModel.getRoleName(user.role);
          
          // Create role selection buttons
          const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
          let roles;

          if (currentUser.role === UserModel.ROLES.ADMIN) {
            // Admin can assign all roles
            roles = [UserModel.ROLES.EMPLOYEE, UserModel.ROLES.MANAGER, UserModel.ROLES.ADMIN];
          } else if (currentUser.role === UserModel.ROLES.MANAGER) {
            // Manager can only assign Employee or Manager roles
            roles = [UserModel.ROLES.EMPLOYEE, UserModel.ROLES.MANAGER];
          } else {
            // In case a lower role accesses it (shouldn't happen), restrict further
            roles = [UserModel.ROLES.EMPLOYEE];
          }

          const roleButtons = [];
          
          for (const roleValue of roles) {
            const roleName = UserModel.getRoleName(roleValue);
            const isCurrentRole = roleValue === user.role;
            
            const roleEmoji =
              roleValue === UserModel.ROLES.ADMIN ? "🛡️ " :
              roleValue === UserModel.ROLES.MANAGER ? "👨‍💼 " : "🧑‍💼 ";

            // Add a marker to the current role
            const buttonText = isCurrentRole
              ? `${roleEmoji}${roleName.toUpperCase()} (current)`
              : `${roleEmoji}${roleName.toUpperCase()}`;

            roleButtons.push([{
              text: buttonText,
              callback_data: `select_role_${roleValue}`
            }]);
          }
          
          // Add back button
          roleButtons.push([{
            text: "Back to User Selection",
            callback_data: "change_user_role"
          }]);
          
          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            `Select new role for ${ctx.scene.state.userName} (current role: ${ctx.scene.state.currentRoleName}):`,
            {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: roleButtons }
            }
          );
          
          return ctx.wizard.next();
        }
        
        // Handle unexpected callback data
        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Invalid selection. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Back to User Selection", callback_data: "change_user_role" }]
              ]
            }
          }
        );
        return;
      } catch (error) {
        logger.error("Error in role management scene (step 2):", error);
        
        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Sorry, there was an error. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
              ]
            }
          }
        );
        return ctx.wizard.selectStep(0);
      }
    },

    // Step 3: Confirm and update user role
    async (ctx) => {
      // If it's not a callback, ignore (we only expect button presses)
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons.");
        return; // Stay in current step
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      try {
        await ctx.answerCbQuery();
        
        if (callbackData === "change_user_role") {
          // Go back to user selection (step 1)
          return ctx.wizard.selectStep(1);
        }
        
        if (callbackData === "action_manage_users") {
          ctx.scene.leave();
          return ctx.scene.enter("userManagementScene");
        }
        
        if (callbackData.startsWith("select_role_")) {
          // Parse role value from callback data
          const newRoleValue = parseInt(callbackData.split("_")[2]);
          
          // Get role name
          let newRoleName = UserModel.getRoleName(newRoleValue);
          
          // Check if role is the same
          if (newRoleValue === ctx.scene.state.currentRole) {
            await safeEditMessage(
              ctx,
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              `No change needed. ${ctx.scene.state.userName} already has the role of ${newRoleName}.`,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "Back to User Selection", callback_data: "change_user_role" }],
                    [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
                  ]
                }
              }
            );
            return ctx.wizard.selectStep(1);
          }
          
          // Store new role in state
          ctx.scene.state.newRole = newRoleValue;
          ctx.scene.state.newRoleName = newRoleName;
          
          // Ask for confirmation
          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            `⚠️ Are you sure you want to change the role of ${ctx.scene.state.userName} from ${ctx.scene.state.currentRoleName} to ${newRoleName}?`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ Yes, change role", callback_data: "confirm_role_change" },
                    { text: "❌ Cancel", callback_data: "cancel_role_change" }
                  ]
                ]
              }
            }
          );
          
          return ctx.wizard.next();
        }
        
        // Handle unexpected callback data
        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Invalid selection. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Back to User Selection", callback_data: "change_user_role" }]
              ]
            }
          }
        );
        return;
      } catch (error) {
        logger.error("Error in role management scene (step 3):", error);
        
        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Sorry, there was an error. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
              ]
            }
          }
        );
        return ctx.wizard.selectStep(0);
      }
    },

    // Step 4: Process confirmation and update role
    async (ctx) => {
      // If it's not a callback, ignore (we only expect button presses)
      if (!ctx.callbackQuery) {
        await ctx.reply("Please use the provided buttons.");
        return; // Stay in current step
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      try {
        await ctx.answerCbQuery();
        
        if (callbackData === "cancel_role_change") {
          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            "Operation cancelled.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Back to User Selection", callback_data: "change_user_role" }],
                  [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
                ]
              }
            }
          );
          return ctx.wizard.selectStep(1);
        }
        
        if (callbackData === "confirm_role_change") {
          // Update user role with numeric value
          await UserModel.setUserRole(
            ctx.scene.state.telegramId,
            ctx.scene.state.newRole
          );

          const roleEmoji =
            ctx.scene.state.newRole === UserModel.ROLES.ADMIN ? "🛡️" :
            ctx.scene.state.newRole === UserModel.ROLES.MANAGER ? "👨‍💼" : "🧑‍💼";

          await safeEditMessage(
            ctx,
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            `✅ User ${ctx.scene.state.userName} has been assigned the role of ${roleEmoji} ${ctx.scene.state.newRoleName}.`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Back to User Selection", callback_data: "change_user_role" }],
                  [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
                ]
              }
            }
          );

          // Notify the user about role change
          try {
            await ctx.telegram.sendMessage(
              ctx.scene.state.telegramId,
              `Your role in the Task Management system has been updated to: *${ctx.scene.state.newRoleName}*\n\nThis changes which commands and features you have access to.`,
              { parse_mode: "Markdown" }
            );
          } catch (notifyError) {
            logger.error(
              "Error notifying user about role change:",
              notifyError
            );
            
            // Add notification about failed user notification
            await ctx.telegram.sendMessage(
              ctx.session.originalMessage.chat_id,
              "⚠️ Note: The user could not be notified about this change. They may have blocked the bot or not started it."
            );
          }

          return ctx.wizard.selectStep(1);
        }
        
        // Handle unexpected callback data
        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Invalid option. Please confirm or cancel the role change.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Yes, change role", callback_data: "confirm_role_change" },
                  { text: "❌ Cancel", callback_data: "cancel_role_change" }
                ]
              ]
            }
          }
        );
        return;
      } catch (error) {
        logger.error("Error in role management scene (step 4):", error);
        
        await safeEditMessage(
          ctx,
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          "Sorry, there was an error updating the role. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
              ]
            }
          }
        );
        return ctx.wizard.selectStep(0);
      }
    }
  );

  // Handle actions that should work across all steps
  scene.action("back_to_role_menu", async (ctx) => {
    try {
      await ctx.answerCbQuery();
      
      // Always go back to the main role management menu
      const message = "👥 *Role Management Panel*\n\nPlease select an option:";
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: "View All Users", callback_data: "view_all_users" }],
          [{ text: "Change User Role", callback_data: "change_user_role" }],
          [{ text: "Back to User Management", callback_data: "action_manage_users" }]
        ]
      };
      
      await safeEditMessage(
        ctx,
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        message,
        {
          parse_mode: "Markdown",
          reply_markup: inlineKeyboard
        }
      );
      
      // Reset to step 1 (the main role menu step) - this is the key fix
      return ctx.wizard.selectStep(1);
    } catch (error) {
      logger.error("Error in back_to_role_menu action:", error);
    }
  });

scene.action("change_user_role", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Re-trigger the user selection logic from Step 2
    const isAdmin = ctx.session.userRole === UserModel.ROLES.ADMIN;

    let users = [];
    if (isAdmin) {
      users = await query("SELECT * FROM users ORDER BY first_name");
    } else {
      const currentUser = await UserModel.getUserByTelegramId(ctx.from.id);
      users = await query(
        "SELECT * FROM users WHERE manager_id = ? OR id = ? ORDER BY first_name",
        [currentUser.id, currentUser.id]
      );
    }

    if (users.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "No users found in the system.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]
            ]
          }
        }
      );
      return;
    }

    const userButtons = users.map((user) => {
      const name = user.first_name || user.username || `User ${user.id}`;
      const roleEmoji =
        user.role === UserModel.ROLES.ADMIN ? "🛡️ " :
        user.role === UserModel.ROLES.MANAGER ? "👨‍💼 " : "🧑‍💼 ";
      return [{
        text: `${roleEmoji}${name}`,
        callback_data: `select_user_${user.id}_${user.telegram_id}`
      }];
    });

    userButtons.push([{ text: "Back to Role Management", callback_data: "back_to_role_menu" }]);

    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      isAdmin ? "Select a user to change their role:" : "Select a team member to change their role:",
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: userButtons }
      }
    );

    return ctx.wizard.selectStep(2); // Go to step 2 (user selection step)
  } catch (error) {
    logger.error("Error in change_user_role action:", error);
  }
});
  scene.action("action_manage_users", async (ctx) => {
  await handleManageUsers(ctx);
});


  scene.action("action_main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.scene.leave();
    return showMainMenu(ctx);
  });

  // Handle scene cancellation via command
  scene.command("cancel", async (ctx) => {
    if (ctx.session.originalMessage) {
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "Role management cancelled.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Main Menu", callback_data: "action_main_menu" }]]
          }
        }
      );
    } else {
      await ctx.reply("Role management cancelled.", {
        reply_markup: {
          inline_keyboard: [[{ text: "Main Menu", callback_data: "action_main_menu" }]]
        }
      });
    }
    
    return await ctx.scene.leave();
  });

  return scene;
}
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
async function handleManageUsers(ctx) {
  try {
    await ctx.answerCbQuery();
    await cleanupActiveScenes(ctx);

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
      buttons.splice(2, 0, [{ text: "👨‍💼 Invite Manager", callback_data: "action_invite_manager" }]);
      buttons.splice(4, 0, [{ text: "❌ Delete User", callback_data: "action_delete_user" }]);
    }

    await ctx.editMessageText("👥 *User Management*\n\nPlease select an option:", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    });

  } catch (error) {
    logger.error("Error in manage users action:", error);
    await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
  }
}

async function showMainMenu(ctx, user = null) {
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
  // if (isTeamLead) {
  //   buttons.push([{ text: "👁️ Show All Tasks", callback_data: "action_show_tasks" }]);
  // }
  buttons.push([{ text: "📊 Generate Reports", callback_data: "action_view_images" }]);
  if (isManager) {
    buttons.push([{ text: "✅ Approve / ❌ Reject Tasks", callback_data: "action_view" }]);
  }
  if (isManager || isAdmin) {
    buttons.push([{ text: "👥 Manage Users", callback_data: "action_manage_users" }]);
  }
  

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
module.exports = {
  roleManagementScene,
};