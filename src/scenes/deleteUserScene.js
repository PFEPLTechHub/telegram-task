const { Scenes } = require("telegraf");
const UserModel = require("../models/userModel");
const logger = require("../utils/logger");

function deleteUserScene() {
  const scene = new Scenes.WizardScene(
    "deleteUserScene",
    // Step 1: Check admin permissions and show manager selection
    async (ctx) => {
      try {
        // Save original message context for future edits
        if (ctx.callbackQuery) {
          ctx.session.originalMessage = {
            chat_id: ctx.callbackQuery.message.chat.id,
            message_id: ctx.callbackQuery.message.message_id
          };
        }

        // Check if user is admin ONLY (managers can no longer delete users)
        const isAdmin = await UserModel.isAdmin(ctx.from.id);
        
        if (!isAdmin) {
          // Use original message if available for editing
          if (ctx.session.originalMessage) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "🚫 Sorry, only administrators can delete users.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }]
                  ]
                }
              }
            );
          } else {
            await ctx.reply(
              "🚫 Sorry, only administrators can delete users.",
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Back to Main Menu", callback_data: "action_main_menu" }]
                  ]
                }
              }
            );
          }
          return ctx.scene.leave();
        }

        // Get all managers
        const managers = await UserModel.getAllManagers();
        
        if (managers.length === 0) {
          const message = "No managers found in the system.";
          
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
                  inline_keyboard: [
                    [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                  ]
                }
              }
            );
          } else {
            const sentMsg = await ctx.reply(message, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                ]
              }
            });
            
            // Save the sent message for future editing
            ctx.session.originalMessage = {
              chat_id: sentMsg.chat.id,
              message_id: sentMsg.message_id
            };
          }
          return ctx.scene.leave();
        }

        // Create buttons for each manager
        const buttons = managers.map(manager => {
          const name = manager.first_name || manager.username || `Manager ${manager.id}`;
          return [{ 
            text: `👤 ${name}`, 
            callback_data: `select_manager_${manager.id}` 
          }];
        });

        // Add cancel button
        buttons.push([{ 
          text: "❌ Cancel", 
          callback_data: "cancel_delete_user" 
        }]);

        const message = "👥 Select a manager to view their employees:";
        
        // Edit message if we have an original message, otherwise send new one
        if (ctx.session.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            message,
            {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: buttons }
            }
          );
        } else {
          const sentMsg = await ctx.reply(message, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: buttons }
          });
          
          // Save the sent message for future editing
          ctx.session.originalMessage = {
            chat_id: sentMsg.chat.id,
            message_id: sentMsg.message_id
          };
        }

        // Store managers in context for future use
        ctx.scene.state.managers = managers;
        
        // Move to next step
        return ctx.wizard.next();
      } catch (error) {
        logger.error("Error in delete user scene step 1:", error);
        
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
        
        return ctx.scene.leave();
      }
    },
    
    // Step 2: Show employees of selected manager
    async (ctx) => {
      try {
        // If it's not a callback, ignore (we only expect button presses)
        if (!ctx.callbackQuery) {
          await ctx.reply("Please use the provided buttons to select a manager.");
          return; // Stay in current step
        }
        
        const callbackData = ctx.callbackQuery.data;
        
        // Handle cancel action
        if (callbackData === "cancel_delete_user") {
          await ctx.answerCbQuery("Operation cancelled");
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "User deletion cancelled.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                ]
              }
            }
          );
          return ctx.scene.leave();
        } 
        // Handle main menu action
        else if (callbackData === "action_main_menu") {
          await ctx.answerCbQuery();
          ctx.scene.leave();
          return ctx.scene.enter("mainMenuScene");
        }
        // Handle user management action
        else if (callbackData === "action_manage_users") {
          await ctx.answerCbQuery();
          ctx.scene.leave();
          return ctx.scene.enter("userManagementScene");
        }
        // Check if this is a manager selection callback
        else if (callbackData && callbackData.startsWith("select_manager_")) {
          const managerId = callbackData.split("_").pop();
          const manager = ctx.scene.state.managers.find(m => m.id.toString() === managerId);
          
          if (!manager) {
            await ctx.answerCbQuery("Manager not found");
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "Selected manager not found. Please try again.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                  ]
                }
              }
            );
            return ctx.scene.leave();
          }

          // Get employees for this manager
          const employees = await UserModel.getEmployeesByManagerId(managerId);
          
          if (employees.length === 0) {
            await ctx.answerCbQuery();
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              `No employees found under ${manager.first_name || manager.username || 'this manager'}.`,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                  ]
                }
              }
            );
            return; // Stay in current step
          }

          // Store selected manager and employees
          ctx.scene.state.selectedManager = manager;
          ctx.scene.state.employees = employees;

          // Create buttons for each employee
          const buttons = employees.map(employee => {
            const name = employee.first_name || employee.username || `User ${employee.id}`;
            return [{ 
              text: `👤 ${name}`, 
              callback_data: `select_user_to_delete_${employee.id}` 
            }];
          });

          // Add navigation buttons
          buttons.push([
            { text: "🔙 Back to Manager Selection", callback_data: "back_to_managers" },
            { text: "❌ Cancel", callback_data: "cancel_delete_user" }
          ]);

          const managerName = manager.first_name || manager.username || 'Manager';
          const message = `👥 Employees under ${managerName}:\n\nSelect an employee to delete:`;
          
          await ctx.answerCbQuery();
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            message,
            {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: buttons }
            }
          );
          
          // Move to next step for employee selection
          return ctx.wizard.next();
        }

        // If we reached here, it's an invalid callback
        await ctx.answerCbQuery("Invalid selection");
        
        // Edit original message if available
        if (ctx.session.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "Invalid selection. Please try again.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                ]
              }
            }
          );
        } else {
          await ctx.reply("Invalid selection. Please try again.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
              ]
            }
          });
        }
        
        return ctx.scene.leave();
        
      } catch (error) {
        logger.error("Error in delete user scene step 2:", error);
        
        // Edit original message if available, otherwise send new one
        if (ctx.session.originalMessage) {
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
        } else {
          await ctx.reply("Sorry, there was an error. Please try again.", {
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          });
        }
        
        return ctx.scene.leave();
      }
    },
    
    // Step 3: Confirm deletion
    async (ctx) => {
      try {
        // If it's not a callback, ignore (we only expect button presses)
        if (!ctx.callbackQuery) {
          await ctx.reply("Please use the provided buttons to select a user.");
          return; // Stay in current step
        }
        
        const callbackData = ctx.callbackQuery.data;
        
        // Handle cancel action
        if (callbackData === "cancel_delete_user") {
          await ctx.answerCbQuery("Operation cancelled");
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "User deletion cancelled.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                ]
              }
            }
          );
          return ctx.scene.leave();
        }
        // Handle back to managers action
        else if (callbackData === "back_to_managers") {
          await ctx.answerCbQuery();
          return ctx.wizard.selectStep(0); // Go back to manager selection
        }
        // Handle main menu action
        else if (callbackData === "action_main_menu") {
          await ctx.answerCbQuery();
          ctx.scene.leave();
          return ctx.scene.enter("mainMenuScene");
        }
        // Handle user management action
        else if (callbackData === "action_manage_users") {
          await ctx.answerCbQuery();
          ctx.scene.leave();
          return ctx.scene.enter("userManagementScene");
        }
        // Check if this is a user selection callback
        else if (callbackData && callbackData.startsWith("select_user_to_delete_")) {
          const userId = callbackData.split("_").pop();
          const user = ctx.scene.state.employees.find(e => e.id.toString() === userId);
          
          if (!user) {
            await ctx.answerCbQuery("User not found");
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "Selected user not found. Please try again.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                  ]
                }
              }
            );
            return ctx.scene.leave();
          }

          // Store the selected user ID and user object in scene state
          ctx.scene.state.selectedUserId = userId;
          ctx.scene.state.selectedUser = user;
          const userName = user.first_name || user.username || `User ${user.id}`;
          const managerName = ctx.scene.state.selectedManager.first_name || 
                            ctx.scene.state.selectedManager.username || 'Manager';
          
          // Ask for confirmation
          await ctx.answerCbQuery();
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            `⚠️ **Deletion Confirmation**\n\n` +
            `**Employee:** ${userName}\n` +
            `**Manager:** ${managerName}\n\n` +
            `Are you sure you want to delete this user?\n\n` +
            `⚠️ **This action cannot be undone!**`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ Yes, Delete", callback_data: "confirm_delete_user" },
                    { text: "❌ Cancel", callback_data: "cancel_delete_user" }
                  ],
                  [
                    { text: "🔙 Back to Employee List", callback_data: "back_to_employees" }
                  ]
                ]
              }
            }
          );
          
          // Move to next step for confirmation
          return ctx.wizard.next();
        }

        // If we reached here, it's an invalid callback
        await ctx.answerCbQuery("Invalid selection");
        
        // Edit original message if available
        if (ctx.session.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "Invalid selection. Please try again.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                ]
              }
            }
          );
        } else {
          await ctx.reply("Invalid selection. Please try again.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
              ]
            }
          });
        }
        
        return ctx.scene.leave();
        
      } catch (error) {
        logger.error("Error in delete user scene step 3:", error);
        
        // Edit original message if available, otherwise send new one
        if (ctx.session.originalMessage) {
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
        } else {
          await ctx.reply("Sorry, there was an error. Please try again.", {
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
            }
          });
        }
        
        return ctx.scene.leave();
      }
    },
    
    // Step 4: Process deletion
    async (ctx) => {
      try {
        // If it's not a callback, ignore (we only expect button presses)
        if (!ctx.callbackQuery) {
          await ctx.reply("Please use the provided buttons.");
          return; // Stay in current step
        }
        
        const callbackData = ctx.callbackQuery.data;
        
        // Handle cancel action
        if (callbackData === "cancel_delete_user") {
          await ctx.answerCbQuery("Operation cancelled");
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "User deletion cancelled.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                ]
              }
            }
          );
          return ctx.scene.leave();
        }
        // Handle back to employees action
        else if (callbackData === "back_to_employees") {
          await ctx.answerCbQuery();
          return ctx.wizard.back();
        }
        // Handle main menu action
        else if (callbackData === "action_main_menu") {
          await ctx.answerCbQuery();
          ctx.scene.leave();
          return ctx.scene.enter("mainMenuScene");
        }
        // Process confirmation
        else if (callbackData === "confirm_delete_user") {
          const userId = ctx.scene.state.selectedUserId;
          const userToDelete = ctx.scene.state.selectedUser;
          
          await ctx.answerCbQuery("Processing deletion...");
          
          try {
            // Send notification to the user being deleted BEFORE deleting them
            const notificationMessage = `🚨 **Account Removal Notice**\n\n` +
              `Your account has been removed from the system by an administrator. ` +
              `The bot is no longer accessible to you.\n\n` +
              `If you think this is a mistake, kindly contact your manager.`;
              
            // Send notification to the user being deleted
            if (userToDelete && userToDelete.telegram_id) {
              try {
                await ctx.telegram.sendMessage(userToDelete.telegram_id, notificationMessage, {
                  parse_mode: "Markdown"
                });
                logger.info(`Notification sent to user ${userToDelete.telegram_id} about account deletion`);
              } catch (notificationError) {
                logger.warn(`Failed to send notification to user ${userToDelete.telegram_id}:`, notificationError);
                // Continue with deletion even if notification fails
              }
            }
            
            // Actually delete the user from the database
            const success = await UserModel.deleteUser(userId);
            
            if (success) {
              const userName = userToDelete.first_name || userToDelete.username || `User ${userToDelete.id}`;
              const managerName = ctx.scene.state.selectedManager.first_name || 
                                ctx.scene.state.selectedManager.username || 'Manager';
              
              await ctx.telegram.editMessageText(
                ctx.session.originalMessage.chat_id,
                ctx.session.originalMessage.message_id,
                null,
                `✅ **User Successfully Deleted**\n\n` +
                `**Employee:** ${userName}\n` +
                `**Manager:** ${managerName}\n\n` +
                `📤 Notification has been sent to the user.`,
                {
                  parse_mode: "Markdown",
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                    ]
                  }
                }
              );
            } else {
              await ctx.telegram.editMessageText(
                ctx.session.originalMessage.chat_id,
                ctx.session.originalMessage.message_id,
                null,
                "❌ Failed to delete the user. Please try again later.",
                {
                  parse_mode: "Markdown",
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                    ]
                  }
                }
              );
            }
          } catch (deletionError) {
            logger.error("Error during user deletion process:", deletionError);
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "❌ An error occurred during the deletion process. Please try again later.",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
                  ]
                }
              }
            );
          }
          
          return ctx.scene.leave();
        }

        // If we reached here, it's an invalid callback
        await ctx.answerCbQuery("Invalid selection");
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "Invalid selection. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]
              ]
            }
          }
        );
        return ctx.scene.leave();
        
      } catch (error) {
        logger.error("Error in delete user scene step 4:", error);
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
        return ctx.scene.leave();
      }
    }
  );

  // Handle back to managers list
  scene.action("back_to_managers", async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.wizard.selectStep(0); // Go back to first step (manager selection)
  });

  // Handle back to employees list  
  scene.action("back_to_employees", async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.wizard.selectStep(1); // Go back to second step (employee selection)
  });
  
  // Handle main menu action
  scene.action("action_main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.scene.leave();
    return showMainMenu(ctx);
  });
  
  // Handle user management action
  scene.action("action_manage_users", async (ctx) => {
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
        "User deletion cancelled.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]]
          }
        }
      );
    } else {
      await ctx.reply("User deletion cancelled.", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to User Management", callback_data: "action_manage_users" }]]
        }
      });
    }
    
    return ctx.scene.leave();
  });

  // Handle scene leave event
  scene.leave((ctx) => {
    logger.info(`User ${ctx.from.id} left the delete user scene`);
  });

  return scene;

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
}

module.exports = { deleteUserScene };