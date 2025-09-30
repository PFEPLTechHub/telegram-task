// src/scenes/createTaskScene.js
const { Scenes } = require("telegraf");
const UserModel = require("../models/userModel");
const TaskModel = require("../models/taskModel");
const ProjectModel = require("../models/projectModel");
const logger = require("../utils/logger");
const { sendNotification } = require("../utils/notifications");

function createTaskScene() {
  const scene = new Scenes.WizardScene(
    "createTaskScene",
    
    // Step 1: Determine user type and show appropriate options
    async (ctx) => {
      ctx.session.inCreateTaskScene = true;
      ctx.wizard.state.currentStep = 1; // Track current step
      
      try {
        // Save original message context for future edits
        if (ctx.callbackQuery) {
          ctx.session.originalMessage = {
            chat_id: ctx.callbackQuery.message.chat.id,
            message_id: ctx.callbackQuery.message.message_id
          };
        }
        
        // Determine current user role first
        const user = await UserModel.getUserByTelegramId(ctx.from.id);
        console.log("Current user:", user);
        if (!user) {
          // Edit the original message instead of sending a new one
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
        
        // Store user info in scene state
        ctx.wizard.state.currentUser = user;
        
        // Check user role and handle accordingly
        if (user.role === 0) { // Admin role
          // For admins, show all users (managers and employees)
          const allUsers = await UserModel.getAllUsers();
          
          // Create inline keyboard with user names
          const buttons = allUsers.map((user) => {
            const name = user.first_name || user.username || `User ${user.id}`;
            return [{ text: name, callback_data: `select_user_${user.id}` }];
          });
          
          buttons.push([{ text: "Cancel", callback_data: "action_cancel" }]);
          
          if (buttons.length <= 1) {
            // Edit original message if available
            if (ctx.session.originalMessage) {
              await ctx.telegram.editMessageText(
                ctx.session.originalMessage.chat_id,
                ctx.session.originalMessage.message_id,
                null,
                "No users found to assign tasks to.",
                { parse_mode: "Markdown" }
              );
            } else {
              await ctx.reply("No users found to assign tasks to.");
            }
            return await ctx.scene.leave();
          }
          
          // Update original message with user selection
          const messageText = "📝 *Create New Task*\n\nStep 1/3: Who do you want to assign this task to?";
          
          if (ctx.session.originalMessage) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              messageText,
              {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
              }
            );
          } else {
            const msg = await ctx.reply(messageText, {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: buttons }
            });
            
            ctx.session.originalMessage = {
              chat_id: msg.chat.id,
              message_id: msg.message_id
            };
          }
          
          return ctx.wizard.next();
        } else if (user.role === 1) { // Manager role
          // For managers, show their employees and themselves
          const employees = await UserModel.getEmployeesByManagerId(user.id);
          
          // Add manager themselves to the list
          const uniqueUsers = [...employees, user];
          
          // Create inline keyboard with user names
          const buttons = uniqueUsers.map((user) => {
            const name = user.first_name || user.username || `User ${user.id}`;
            return [{ text: name, callback_data: `select_user_${user.id}` }];
          });
          
          // Add "No Person" option at the top
          buttons.unshift([{ text: "No Person", callback_data: "select_user_no_person" }]);
          
          buttons.push([{ text: "Cancel", callback_data: "action_cancel" }]); // Changed to action_cancel
          
          if (buttons.length <= 1) {
            // Edit original message if available
            if (ctx.session.originalMessage) {
              await ctx.telegram.editMessageText(
                ctx.session.originalMessage.chat_id,
                ctx.session.originalMessage.message_id,
                null,
                "No users found to assign tasks to.",
                { parse_mode: "Markdown" }
              );
            } else {
              await ctx.reply("No users found to assign tasks to.");
            }
            return await ctx.scene.leave();
          }
          
          // Update original message with user selection
          const messageText = "📝 *Create New Task*\n\nStep 1/3: Who do you want to assign this task to?";
          
          if (ctx.session.originalMessage) {
            // Edit the original message if we have its reference
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              messageText,
              {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
              }
            );
          } else {
            // Fallback to sending a new message
            const msg = await ctx.reply(messageText, {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: buttons }
            });
            
            // Save this message for future edits
            ctx.session.originalMessage = {
              chat_id: msg.chat.id,
              message_id: msg.message_id
            };
          }
        } else {
          // For employees, auto-assign to themselves and create task directly
          ctx.wizard.state.employeeName = user.first_name || user.username || `User ${user.id}`;
          ctx.wizard.state.employeeId = user.id;
          ctx.wizard.state.isSelfAssign = true;
          ctx.wizard.state.isEmployeeRequest = false;
          ctx.wizard.state.currentStep = 2; // Skip to step 2 for employees
          
          // Skip directly to task details step
          const messageText = `📝 *Create New Task*\n\nStep 1/2: Enter task details for yourself\n\nPlease send your message with:\n1️⃣ Task description\n2️⃣ Due date as day ("10"), day+time (e.g. "10 3:00pm")`;
          
          if (ctx.session.originalMessage) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              messageText,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "Cancel", callback_data: "action_cancel" }]] // Changed to action_cancel
                }
              }
            );
          } else {
            const msg = await ctx.reply(messageText, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Cancel", callback_data: "action_cancel" }]] // Changed to action_cancel
              }
            });
            
            ctx.session.originalMessage = {
              chat_id: msg.chat.id,
              message_id: msg.message_id
            };
          }
          
          ctx.wizard.state.waitingForTaskDetails = true;
          return ctx.wizard.next(); // Move to step 2
        }
        
        // Register action handlers for this scene
        return ctx.wizard.next();
      } catch (error) {
        logger.error("Error in create task scene (step 1):", error);
        // Edit original message if available
        if (ctx.session?.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "❌ Sorry, there was an error. Please try again.",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_cancel" }]]
              }
            }
          );
        } else {
          await ctx.reply("Sorry, there was an error. Please try again.");
        }
        return await ctx.scene.leave();
      }
    },
    
    // Step 2: Handle user selection and ask for task details
    async (ctx) => {
      ctx.wizard.state.currentStep = 2; // Update current step
      
      // If we're showing confirmation, ignore text messages
      if (!ctx.wizard.state.waitingForTaskDetails && !ctx.wizard.state.editingField) {
        return;
      }
      
      // If we receive a message here, process it as task details
      if (ctx.message && ctx.message.text) {
        return await processTaskDetails(ctx);
      }
      return; // Stay on this step otherwise
    },
    
    // Step 3: Process task details
    async (ctx) => {
      ctx.wizard.state.currentStep = 3; // Update current step
      
      // If we're showing confirmation, ignore text messages
      if (!ctx.wizard.state.waitingForTaskDetails && !ctx.wizard.state.editingField) {
        return;
      }
      
      if (ctx.message && ctx.message.text) {
        return await processTaskDetails(ctx);
      }
      return;
    }
  );

  // Handler for user selection (managers only)
  scene.action(/^select_user_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const userId = ctx.match[1];
      
      // Get all users to find the selected one
      const user = ctx.wizard.state.currentUser;
      let allUsers = [];
      
      if (user.role === 0) { // Admin role
        allUsers = await UserModel.getAllUsers();
      } else if (user.role === 1) { // Manager role
        const employees = await UserModel.getAllEmployees();
        const managers = await UserModel.getAllManagers();
        allUsers = [...employees, ...managers];
      } else {
        allUsers = [user];
      }
      
      // Filter out duplicates
      const uniqueUsers = [];
      const seenIds = new Set();
      
      allUsers.forEach(user => {
        if (!seenIds.has(user.id)) {
          seenIds.add(user.id);
          uniqueUsers.push(user);
        }
      });
      
      // Handle "No Person" selection
      if (userId === 'no_person') {
        ctx.wizard.state.employeeName = 'No Person';
        ctx.wizard.state.employeeId = 0;
        ctx.wizard.state.isSelfAssign = false;
        ctx.wizard.state.isEmployeeRequest = false;
        ctx.wizard.state.currentStep = 2;

        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          `📝 *Create New Task*\n\nStep 2/3: Enter task details for No Person\n\nPlease send your message with:\n1️⃣ Task description\n2️⃣ Due date as day/day+time (e.g. "10" or "10 3:00pm") (for time colon is)`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "← Back", callback_data: "action_cancel" }]]
            }
          }
        );
        ctx.wizard.state.waitingForTaskDetails = true;
        return ctx.wizard.next();
      }
      
      const selectedUser = uniqueUsers.find(u => u.id == userId);
      
      if (!selectedUser) {
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "Invalid selection. Please try again.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_cancel" }]]
            }
          }
        );
        return;
      }
      
      // Store selected user info
      ctx.wizard.state.employeeName = selectedUser.first_name || selectedUser.username || `User ${selectedUser.id}`;
      ctx.wizard.state.employeeId = selectedUser.id;
      ctx.wizard.state.isSelfAssign = selectedUser.id == user.id;
      ctx.wizard.state.isEmployeeRequest = false;
      ctx.wizard.state.currentStep = 2;
      
      // Update the message to prompt for task details
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        `📝 *Create New Task*\n\nStep 2/3: Enter task details for ${ctx.wizard.state.employeeName}\n\nPlease send your message with:\n1️⃣ Task description\n2️⃣ Due date as day/day+time (e.g. "10" or "10 3:00pm") (for time colon is)`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "← Back", callback_data: "action_cancel" }]] // Changed to show Back
          }
        }
      );
      
      ctx.wizard.state.waitingForTaskDetails = true;
      return ctx.wizard.next(); // Move to next step
    } catch (error) {
      logger.error("Error selecting user:", error);
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "❌ Sorry, there was an error. Please try again.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_cancel" }]]
          }
        }
      );
    }
  });

  // Enhanced Cancel/Back action handler with step navigation
  scene.action("action_cancel", async (ctx) => {
    await ctx.answerCbQuery();
    
    const currentStep = ctx.wizard.state.currentStep || 1;
    
    if (currentStep === 1) {
      // From step 1, go to main menu
      ctx.scene.leave();
      return showMainMenu(ctx);
    } else if (currentStep === 2) {
      // From step 2, go back to step 1
      return await goBackToStep1(ctx);
    } else if (currentStep === 3) {
      // From step 3, go back to step 2
      return await showMainMenu(ctx);
    } else {
      // Default: go to main menu
      ctx.scene.leave();
      return showMainMenu(ctx);
    }
  });

  // Helper function to go back to step 1 (user selection for managers)
  async function goBackToStep1(ctx) {
    try {
      const user = ctx.wizard.state.currentUser;
      
      if (user.role === 1) { // Manager role
        const employees = await UserModel.getEmployeesByManagerId(user.id);
        const uniqueUsers = [...employees, user];
        
        const buttons = uniqueUsers.map((user) => {
          const name = user.first_name || user.username || `User ${user.id}`;
          return [{ text: name, callback_data: `select_user_${user.id}` }];
        });
        
        buttons.push([{ text: "Cancel", callback_data: "action_cancel" }]);
        
        const messageText = "📝 *Create New Task*\n\nStep 1/3: Who do you want to assign this task to?";
        
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          messageText,
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: buttons }
          }
        );
        
        // Reset state
        ctx.wizard.state.currentStep = 1;
        ctx.wizard.state.waitingForTaskDetails = false;
        ctx.wizard.state.editingField = null;
        ctx.wizard.state.taskDescription = null;
        ctx.wizard.state.dueDate = null;
        
        return ctx.wizard.selectStep(0); // Go to first step
      } else {
        // For employees, step 1 would be main menu
        ctx.scene.leave();
        return showMainMenu(ctx);
      }
    } catch (error) {
      logger.error("Error going back to step 1:", error);
      ctx.scene.leave();
      return showMainMenu(ctx);
    }
  }

  // Helper function to go back to step 2 (task details input)
  async function goBackToStep2(ctx) {
    try {
      const user = ctx.wizard.state.currentUser;
      let messageText;
      
      if (user.role === 1) {
        messageText = `📝 *Create New Task*\n\nStep 2/3: Enter task details for ${ctx.wizard.state.employeeName}\n\nPlease send your message with:\n1️⃣ Task description\n2️⃣ Due date as day(e.g."10") , day+time (e.g."10 3:00pm")`;
      } else {
        messageText = `📝 *Create New Task*\n\nStep 1/2: Enter task details for yourself\n\nPlease send your message with:\n1️⃣ Task description\n2️⃣ Due date as day(e.g."10") , day+time (e.g."10 3:00pm")`;
      }
      
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        messageText,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "← Back", callback_data: "action_cancel" }]]
          }
        }
      );
      
      // Reset step 3 state but keep step 2 info
      ctx.wizard.state.currentStep = 2;
      ctx.wizard.state.waitingForTaskDetails = true;
      ctx.wizard.state.editingField = null;
      
      return ctx.wizard.selectStep(1); // Go to second step
    } catch (error) {
      logger.error("Error going back to step 2:", error);
      return await goBackToStep1(ctx);
    }
  }

  // Keep existing action handlers but update cancel buttons
  scene.action("edit_description", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.editingField = 'taskDescription';
    
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      "✏️ Please send a new task description:",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "← Back", callback_data: "action_cancel" }]]
        }
      }
    );
  });
  
  scene.action("edit_due_date", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.editingField = 'dueDate';
    
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      "📅 Please send a new due date (format: day number or day number + time, e.g. '10' or '10 3:00pm'):",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "← Back", callback_data: "action_cancel" }]]
        }
      }
    );
  });
  
  // Edit priority action
  scene.action("edit_priority", async (ctx) => {
    await ctx.answerCbQuery();
    return await showPrioritySelector(ctx);
  });
  
  scene.action("confirm_am", async (ctx) => {
    await ctx.answerCbQuery();
    
    if (ctx.wizard.state.ambiguousTime) {
      const { hour, date } = ctx.wizard.state.ambiguousTime;
      date.setHours(hour);
      ctx.wizard.state.dueDate = date;
      ctx.wizard.state.ambiguousTime = null;
      
      return await showTaskConfirmation(ctx);
    }
  });
  
  scene.action("confirm_pm", async (ctx) => {
    await ctx.answerCbQuery();
    
    if (ctx.wizard.state.ambiguousTime) {
      const { hour, date } = ctx.wizard.state.ambiguousTime;
      date.setHours(hour + 12);
      ctx.wizard.state.dueDate = date;
      ctx.wizard.state.ambiguousTime = null;
      
      return await showTaskConfirmation(ctx);
    }
  });
  
  scene.action("confirm_create_task", async (ctx) => {
    await ctx.answerCbQuery();
    
    // Check if due date is provided
    if (!ctx.wizard.state.dueDate) {
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "⚠️ Due date is required!\n\nCurrent task details:\nDescription: " + ctx.wizard.state.taskDescription + "\n\nPlease add a due date before creating the task.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📅 Add Due Date", callback_data: "edit_due_date" }],
              [{ text: "← Back", callback_data: "action_cancel" }]
            ]
          }
        }
      );
      return;
    }
    
    return await createTask(ctx);
  });

  // Priority selection handlers
  scene.action("set_priority_high", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.priority = 'High';
    return await showProjectSelector(ctx);
  });
  scene.action("set_priority_medium", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.priority = 'Medium';
    return await showProjectSelector(ctx);
  });
  scene.action("set_priority_low", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.priority = 'Low';
    return await showProjectSelector(ctx);
  });
  scene.action("skip_priority", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.priority = null;
    return await showProjectSelector(ctx);
  });

  // Project selection handlers
  scene.action(/^select_project_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const projectId = ctx.match[1];
    
    try {
      const project = await ProjectModel.getProjectById(projectId);
      if (project) {
        ctx.wizard.state.projectId = projectId;
        ctx.wizard.state.projectName = project.name;
        return await showTaskConfirmation(ctx);
      } else {
        await ctx.reply("Project not found. Please try again.");
        return await showProjectSelector(ctx);
      }
    } catch (error) {
      logger.error("Error selecting project:", error);
      await ctx.reply("Error selecting project. Please try again.");
      return await showProjectSelector(ctx);
    }
  });
  
  scene.action("skip_project", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.projectId = null;
    ctx.wizard.state.projectName = null;
    return await showTaskConfirmation(ctx);
  });
  
  // Edit project action
  scene.action("edit_project", async (ctx) => {
    await ctx.answerCbQuery();
    return await showProjectSelector(ctx);
  });

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
scene.action("action_main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.scene.leave();
    return showMainMenu(ctx);
  });
  // Modified function to fix the input validation issue
async function processTaskDetails(ctx) {
    try {
      // Handle editing specific fields
      if (ctx.wizard.state.editingField) {
        const field = ctx.wizard.state.editingField;
        const value = ctx.message.text;
        
        // Process the edited field - only description and due date remain
        if (field === 'taskDescription') {
          if (!value || value.length < 5) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "⚠️ Task description is too short. It must be at least 5 characters.\nPlease send a valid description:",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
                }
              }
            );
            return;
          }
          ctx.wizard.state.taskDescription = value;
        } else if (field === 'dueDate') {
          const { date, needsClarification, ambiguousHour, hasTimeComponent } = parseDateTime(value);
          
          if (!date) {
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              "⚠️ Invalid date format. Please use format like day '3 3:30pm' time'3:30pm'.\nPlease send a valid date:",
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
                }
              }
            );
            return;
          }
          
          // Store hasTimeComponent in state
          ctx.wizard.state.hasTimeComponent = hasTimeComponent;
          
          if (needsClarification) {
            ctx.wizard.state.ambiguousTime = { hour: ambiguousHour, date };
            await ctx.telegram.editMessageText(
              ctx.session.originalMessage.chat_id,
              ctx.session.originalMessage.message_id,
              null,
              `⏰ You entered "${value}" with time ${ambiguousHour}. Did you mean AM or PM?`,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: ambiguousHour + " AM", callback_data: "confirm_am" }],
                    [{ text: ambiguousHour + " PM", callback_data: "confirm_pm" }],
                    [{ text: "Cancel", callback_data: "action_main_menu" }]
                  ]
                }
              }
            );
            return;
          }
          
          ctx.wizard.state.dueDate = date;
        }
        
        // Clear editing state and show confirmation or priority selector
        ctx.wizard.state.editingField = null;

        // Ensure required fields are present before confirmation
        if (!ctx.wizard.state.taskDescription || ctx.wizard.state.taskDescription.length < 5) {
          ctx.wizard.state.editingField = 'taskDescription';
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "⚠️ Task description is missing or too short. It must be at least 5 characters.\nPlease send a valid description:",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
              }
            }
          );
          return;
        }
        // If priority not chosen yet, ask for it; otherwise show confirmation
        if (!ctx.wizard.state.priority) {
          return await showPrioritySelector(ctx);
        }
        return await showTaskConfirmation(ctx);
      }

      // Process the regular task details input
      const fullText = ctx.message.text;
      
      // Store the input for potential reuse
      ctx.wizard.state.lastInput = fullText;
      
      // Split by newlines and filter empty lines
      const lines = fullText.split("\n").filter(line => line.trim());
      
      // First validation - must have at least one line of text
      if (lines.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "⚠️ Empty message. Please send task description and due date.\n\nExample:\nComplete the project report\n15 3pm",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Cancel", callback_data: "action_main_menu" }]
              ]
            }
          }
        );
        return;
      }
      
      // Check if entire text is shorter than 5 characters
      if (fullText.trim().length < 5) {
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "⚠️ Task description is too short. It must be at least 5 characters.\n\nPlease send a more detailed description followed by a due date.\n\nExample:\nComplete the project report\n15 3pm",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
            }
          }
        );
        return;
      }
      
      // If only one line is provided, treat it as the description and don't require a date
      if (lines.length === 1) {
        const { date } = parseDateTime(lines[0]);
        if (date) {
          // User only sent a date without description
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "⚠️ Missing task description. Please send both task description and due date.\n\nExample:\nComplete the project report\n15 3pm",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Cancel", callback_data: "action_main_menu" }]
                ]
              }
            }
          );
          return;
        } else {
          // User only sent a description without a date - FIXED: Now prompt for due date
          ctx.wizard.state.taskDescription = lines[0].trim();
          ctx.wizard.state.editingField = 'dueDate';
          
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "⚠️ Due date is required. Please send the due date for this task.\n\nExample: 15 3:30pm or 15",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
              }
            }
          );
          return;
        }
      }
      
      // If we have multiple lines, try to parse the last line as a date
      let dateString = lines[lines.length - 1];
      let { date, needsClarification, ambiguousHour, hasTimeComponent } = parseDateTime(dateString);
      
      // If last line can't be parsed as date, assume it's part of the description
      if (!date && lines.length > 1) {
        // All lines are the description - FIXED: Now prompt for due date instead of accepting without date
        ctx.wizard.state.taskDescription = lines.join("\n").trim();
        ctx.wizard.state.editingField = 'dueDate';
        
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "⚠️ Due date is required. Please send the due date for this task.\n\nExample: 15 3pm or 15",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
            }
          }
        );
        return;
      }
      
      // Now that we have a date, the description is all lines except the last one
      ctx.wizard.state.taskDescription = lines.slice(0, -1).join("\n").trim();
      
      // Check if description is too short after separating date
      if (ctx.wizard.state.taskDescription.length < 5) {
        // FIXED: Store the parsed date and time component before asking for description edit
        ctx.wizard.state.dueDate = date;
        ctx.wizard.state.hasTimeComponent = hasTimeComponent;
        
        ctx.wizard.state.editingField = 'taskDescription';
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "⚠️ Task description is too short. It must be at least 5 characters.\nPlease send a valid description:",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
            }
          }
        );
        return;
      }
      
      // Check if date is in the past
      if (date <= new Date()) {
        ctx.wizard.state.editingField = 'dueDate';
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "⚠️ Due date cannot be in the past. Please send a future date and time:",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "Cancel", callback_data: "action_main_menu" }]]
            }
          }
        );
        return;
      }
      
      // Handle ambiguous time (8 or 9 without am/pm)
      if (needsClarification) {
        ctx.wizard.state.ambiguousTime = { hour: ambiguousHour, date };
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          `⏰ You entered "${dateString}" with time ${ambiguousHour}. Did you mean AM or PM?`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: ambiguousHour + " AM", callback_data: "confirm_am" }],
                [{ text: ambiguousHour + " PM", callback_data: "confirm_pm" }],
                [{ text: "Cancel", callback_data: "action_main_menu" }]
              ]
            }
          }
        );
        return;
      }
      
      // Store the due date and whether it had a time component
      ctx.wizard.state.dueDate = date;
      ctx.wizard.state.hasTimeComponent = hasTimeComponent;
      
      // Ask for optional priority first if not selected, else show confirmation
      if (!ctx.wizard.state.priority) {
        return await showPrioritySelector(ctx);
      }
      return await showTaskConfirmation(ctx);
    } catch (error) {
      logger.error("Error processing task details:", error);
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "❌ Sorry, there was an error. Please try again.",
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

  // Parse date and time from user input
function parseDateTime(inputStr) {
  try {
    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const cleanInput = inputStr.toLowerCase().trim();

    // Month name to number mapping
    const monthMap = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11
    };

    // Different date format patterns
    const patterns = [
      // Format: "20 dec 5:30pm", "20 december 5:30pm"
      /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2}):(\d{2})(am|pm)$/i,
      
      // Format: "dec 20 5:30pm", "december 20 5:30pm"
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(am|pm)$/i,
      
      // Format: "20 12 5:30pm" (day month time)
      /^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(am|pm)$/i,
      
      // Original formats
      /^(\d{1,2}):(\d{2})\s*(am|pm)$/i,  // Time only: "6:00pm"
      /^(\d{1,2})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm))?$/i  // Day + optional time: "6" or "6 6:00pm"
    ];

    const resultDate = new Date(currentYear, currentMonth, currentDay);

    // Try each pattern
    for (let pattern of patterns) {
      const match = cleanInput.match(pattern);
      if (!match) continue;

      // Handle different format types
      if (pattern.source.startsWith("^(\\d{1,2})\\s+(jan|feb|")) {
        // Format: "20 dec 5:30pm"
        const [_, day, monthStr, hour, minute, ampm] = match;
        const month = monthMap[monthStr.toLowerCase()];
        
        if (!isValidDate(day, month)) return { date: null, error: "Invalid date" };
        
        resultDate.setMonth(month);
        resultDate.setDate(parseInt(day));
        setTimeWithAmPm(resultDate, parseInt(hour), parseInt(minute), ampm.toLowerCase());
        
        return { date: resultDate, hasTimeComponent: true };
      }
      else if (pattern.source.startsWith("^(jan|feb|")) {
        // Format: "dec 20 5:30pm"
        const [_, monthStr, day, hour, minute, ampm] = match;
        const month = monthMap[monthStr.toLowerCase()];
        
        if (!isValidDate(day, month)) return { date: null, error: "Invalid date" };
        
        resultDate.setMonth(month);
        resultDate.setDate(parseInt(day));
        setTimeWithAmPm(resultDate, parseInt(hour), parseInt(minute), ampm.toLowerCase());
        
        return { date: resultDate, hasTimeComponent: true };
      }
      else if (pattern.source.startsWith("^(\\d{1,2})\\s+(\\d{1,2})\\s+")) {
        // Format: "20 12 5:30pm"
        const [_, day, month, hour, minute, ampm] = match;
        const monthNum = parseInt(month) - 1; // Convert 1-based month to 0-based
        
        if (!isValidDate(day, monthNum)) return { date: null, error: "Invalid date" };
        
        resultDate.setMonth(monthNum);
        resultDate.setDate(parseInt(day));
        setTimeWithAmPm(resultDate, parseInt(hour), parseInt(minute), ampm.toLowerCase());
        
        return { date: resultDate, hasTimeComponent: true };
      }
      else if (pattern.source.startsWith("^(\\d{1,2}):(\\d{2})")) {
        // Time-only format: "6:00pm"
        const [_, hour, minute, ampm] = match;
        setTimeWithAmPm(resultDate, parseInt(hour), parseInt(minute), ampm.toLowerCase());
        return { date: resultDate, hasTimeComponent: true, isToday: true };
      }
      else {
        // Original day + optional time format
        const day = parseInt(match[1]);
        const hasTimeComponent = !!match[2];
        
        if (!isValidDate(day, resultDate.getMonth())) return { date: null, error: "Invalid date" };
        
        resultDate.setDate(day);
        
        // If day is in past, move to next month
        if (day < currentDay) {
          resultDate.setMonth(currentMonth + 1);
          if (resultDate.getMonth() === 0 && currentMonth === 11) {
            resultDate.setFullYear(currentYear + 1);
          }
        }

        if (hasTimeComponent) {
          const hour = parseInt(match[2]);
          const minute = parseInt(match[3]);
          const ampm = match[4].toLowerCase();
          
          if (!isValidTime(hour, minute)) return { date: null, error: "Invalid time" };
          
          setTimeWithAmPm(resultDate, hour, minute, ampm);
          return { date: resultDate, hasTimeComponent: true };
        } else {
          resultDate.setHours(23, 59, 59, 0);
          return { date: resultDate, hasTimeComponent: false };
        }
      }
    }

    return { 
      date: null, 
      error: "Invalid format. Please use formats like:\n- 20 dec 5:30pm\n- dec 20 5:30pm\n- 20 12 5:30pm\n- 5 5:00pm" 
    };
  } catch (error) {
    console.error("Error parsing date time:", error);
    return { 
      date: null, 
      error: "Invalid format. Please use formats like:\n- 20 dec 5:30pm\n- dec 20 5:30pm\n- 20 12 5:30pm\n- 5 5:00pm" 
    };
  }
}

// Helper function to validate date
function isValidDate(day, month) {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  day = parseInt(day);
  
  if (day < 1) return false;
  if (month < 0 || month > 11) return false;
  if (day > daysInMonth[month]) return false;
  
  return true;
}

// Helper function to validate time
function isValidTime(hour, minute) {
  hour = parseInt(hour);
  minute = parseInt(minute);
  
  if (hour < 1 || hour > 12) return false;
  if (minute < 0 || minute > 59) return false;
  
  return true;
}

// Helper function to set time with AM/PM
function setTimeWithAmPm(date, hour, minute, ampm) {
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  date.setHours(hour, minute, 0, 0);
}

// Helper function to format date for display
function formatDate(date, hasTimeComponent = true) {
  if (!date) return "Not specified";
  
  try {
    const options = {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    };
    
    if (hasTimeComponent) {
      options.hour = 'numeric';
      options.minute = '2-digit';
      options.hour12 = true;
    }
    
    return date.toLocaleString('en-US', options);
  } catch (error) {
    logger.error("Error formatting date:", error);
    return "Invalid date format";
  }
}

// Updated showTaskConfirmation function to use the hasTimeComponent flag
// Add this helper function to escape Markdown characters
function escapeMarkdown(text) {
  if (!text) return text;
  return text.replace(/[*_`\[\]()~>#+=|{}.!-]/g, '\\$&');
}

async function showTaskConfirmation(ctx) {
  try {
    const dueDate = ctx.wizard.state.dueDate;
    const hasTimeComponent = ctx.wizard.state.hasTimeComponent;
    const priority = ctx.wizard.state.priority || "Not specified";
    const projectName = ctx.wizard.state.projectName || "No project";
    
    // Format the date for display, with null check and respecting hasTimeComponent flag
    const formattedDate = dueDate ? formatDate(dueDate, hasTimeComponent) : "Not specified";
    
    // Determine assignment type text and button text based on user type
    let assignmentTypeText, confirmButtonText;
    
    if (ctx.wizard.state.isEmployeeRequest) {
      assignmentTypeText = "Self-assigned (Pending Manager Approval)";
      confirmButtonText = "📨 Send Request to Manager";
    } else {
      assignmentTypeText = ctx.wizard.state.isSelfAssign ? "Self-assigned" : "Assigned to";
      confirmButtonText = "✅ Confirm and Create Task";
    }
    
    // Escape special characters in dynamic content
    const escapedEmployeeName = escapeMarkdown(ctx.wizard.state.employeeName);
    const escapedTaskDescription = escapeMarkdown(ctx.wizard.state.taskDescription);
    const escapedFormattedDate = escapeMarkdown(formattedDate);
    const escapedProjectName = escapeMarkdown(projectName);
    
    // Update the original message instead of sending a new one
    const stepText = ctx.wizard.state.isEmployeeRequest ? "Step 2/2" : "Step 4/4";
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      `📋 *Task Details*\n\n${stepText}: Please confirm or edit\n\n${assignmentTypeText}: ${escapedEmployeeName}\nDescription: ${escapedTaskDescription}\nDue Date: ${escapedFormattedDate}\nPriority: ${escapeMarkdown(priority)}\nProject: ${escapedProjectName}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: confirmButtonText, callback_data: "confirm_create_task" }],
            [{ text: "✏️ Edit Description", callback_data: "edit_description" }], 
            [{ text: "📅 Edit Due Date", callback_data: "edit_due_date" }],
            [{ text: "⚙️ Edit Priority", callback_data: "edit_priority" }],
            [{ text: "🏗️ Edit Project", callback_data: "edit_project" }],
            [{ text: "↩️ Cancel", callback_data: "action_main_menu" }] // Fixed: underscore instead of hyphen
          ]
        }
      }
    );
    
    ctx.wizard.state.waitingForTaskDetails = false;
    return;
  } catch (error) {
    logger.error("Error showing task confirmation:", error);
    // Update the original message with error notification
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      "❌ Sorry, there was an error. Please try again.",
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

// Show optional priority selector
async function showPrioritySelector(ctx) {
  const stepText = ctx.wizard.state.isEmployeeRequest ? "Step 2/2" : "Step 3/4";
  await ctx.telegram.editMessageText(
    ctx.session.originalMessage.chat_id,
    ctx.session.originalMessage.message_id,
    null,
    `🏷️ *Select Priority* (optional)\n\n${stepText}: Choose a priority or skip`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "High", callback_data: "set_priority_high" },
            { text: "Medium", callback_data: "set_priority_medium" },
            { text: "Low", callback_data: "set_priority_low" }
          ],
          [{ text: "Skip", callback_data: "skip_priority" }],
          [{ text: "← Back", callback_data: "action_cancel" }]
        ]
      }
    }
  );
  ctx.wizard.state.waitingForTaskDetails = false;
}

// Show optional project selector
async function showProjectSelector(ctx) {
  try {
    const stepText = ctx.wizard.state.isEmployeeRequest ? "Step 2/2" : "Step 4/4";
    
    // Get available projects
    const projects = await ProjectModel.getActiveProjects();
    
    let message = `🏗️ *Select Project* (optional)\n\n${stepText}: Choose a project or skip\n\n`;
    
    if (projects.length === 0) {
      message += "No active projects available.";
    } else {
      message += "Available projects:\n";
      projects.forEach((project, index) => {
        message += `${index + 1}. ${project.name}\n`;
      });
    }
    
    const buttons = [];
    
    // Add project selection buttons (max 8 projects to avoid button limit)
    const displayProjects = projects.slice(0, 8);
    displayProjects.forEach((project, index) => {
      if (index % 2 === 0) {
        buttons.push([]);
      }
      buttons[buttons.length - 1].push({
        text: project.name,
        callback_data: `select_project_${project.id}`
      });
    });
    
    // Add skip and back buttons
    buttons.push([{ text: "Skip Project", callback_data: "skip_project" }]);
    buttons.push([{ text: "← Back", callback_data: "action_cancel" }]);
    
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      message,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );
    
    ctx.wizard.state.waitingForTaskDetails = false;
  } catch (error) {
    logger.error("Error showing project selector:", error);
    // Fallback to skip project
    ctx.wizard.state.projectName = null;
    ctx.wizard.state.projectId = null;
    return await showTaskConfirmation(ctx);
  }
}

 

  // Modified createTask function for manager-created tasks
  async function createTask(ctx) {
    try {
      // Get the current user's information
      const currentUser = ctx.wizard.state.currentUser;
      const userWithManager = await UserModel.getUserWithManagerInfo(currentUser.id);

      // Format the date for display with hasTimeComponent flag
      const formattedDate = formatDate(ctx.wizard.state.dueDate, ctx.wizard.state.hasTimeComponent);

      // Create the task
      const task = await TaskModel.createTask(
        ctx.wizard.state.employeeName,
        ctx.wizard.state.taskDescription,
        ctx.wizard.state.dueDate,
        ctx.wizard.state.currentUser.id,
        ctx.wizard.state.priority || null,
        ctx.wizard.state.projectId || null
      );

      // Get employee details for notification
      const employee = await UserModel.getUserByName(ctx.wizard.state.employeeName);
      
      if (task.status === 'pending_approval') {
        // Task needs manager approval - notify manager
        if (userWithManager?.manager_telegram_id) {
          const approvalMessage = `
📋 *Task Creation Request*

Employee: ${ctx.wizard.state.employeeName}
Task: ${ctx.wizard.state.taskDescription}
Due: ${formattedDate}
Type: Self-Assigned
Status: Awaiting your approval
`;

          const inlineKeyboard = {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Approve",
                    callback_data: `approve_task_creation_${task.id}`
                  },
                  {
                    text: "❌ Reject",
                    callback_data: `reject_task_creation_${task.id}`
                  }
                ]
              ]
            },
            parse_mode: "Markdown"
          };

          await ctx.telegram.sendMessage(
            userWithManager.manager_telegram_id,
            approvalMessage,
            inlineKeyboard
          );
        }

        // Notify employee that task is pending approval
        if (employee?.telegram_id) {
          const employeeMessage = `
📋 *New Task Created - Pending Approval*

Your task has been created and is awaiting manager approval:

Task: ${ctx.wizard.state.taskDescription}
Due: ${formattedDate}

You will be notified once the task is approved.`;

          await ctx.telegram.sendMessage(
            employee.telegram_id,
            employeeMessage,
            { parse_mode: "Markdown" }
          );
        }
      } else {
        // Task was created directly - handle different scenarios
        if (task.isSelfAssigned && (task.assignerRole === 0 || task.assignerRole === 1)) {
          // Admin or Manager self-assigned task
          const selfAssignMessage = `
📋 *New Self-Assigned Task Created*

You have created a task for yourself:

Task: ${ctx.wizard.state.taskDescription}
Due: ${formattedDate}
Status: Active

Note: As an ${task.assignerRole === 0 ? 'admin' : 'manager'}, you will approve your own task completion.`;

          await ctx.telegram.sendMessage(
            ctx.from.id,
            selfAssignMessage,
            { parse_mode: "Markdown" }
          );
        } else if (employee?.telegram_id) {
          // Regular direct assignment (admin to anyone or manager to employee)
          const employeeMessage = `
📋 *New Task Assigned*

You have been assigned a new task:

Task: ${ctx.wizard.state.taskDescription}
Due: ${formattedDate}
Assigned by: ${currentUser.first_name || (task.assignerRole === 0 ? 'Admin' : 'Manager')}

The task has been added to your pending tasks list.`;

          await ctx.telegram.sendMessage(
            employee.telegram_id,
            employeeMessage,
            { parse_mode: "Markdown" }
          );
        }
      }

      // Confirmation message to task creator
      const projectText = ctx.wizard.state.projectName ? `\nProject: ${ctx.wizard.state.projectName}` : '';
      const confirmationMessage = `
✅ Task ${task.status === 'pending_approval' ? 'creation request' : 'created'} successful!

Task: ${ctx.wizard.state.taskDescription}
${task.isSelfAssign ? 'Self-Assigned' : `Assigned to: ${ctx.wizard.state.employeeName}`}
Due: ${formattedDate}
Priority: ${ctx.wizard.state.priority || 'Not specified'}${projectText}
Status: ${task.status === 'pending_approval' ? 'Pending Manager Approval' : 'Active'}`;

      await ctx.reply(confirmationMessage, { parse_mode: "Markdown" });

      // Exit the scene
      return await ctx.scene.leave();

    } catch (error) {
      logger.error("Error in createTask:", error);
      await ctx.reply("Sorry, there was an error creating the task. Please try again.");
      return await ctx.scene.leave();
    }
  }

  return scene;
}

// Global handlers for manager task approval (add these to your main bot file)
function setupTaskApprovalHandlers(bot) {
  // Handler for task approval
  bot.action(/^approve_task_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const taskId = ctx.match[1];
      
      // Get the task data
      const task = await TaskModel.getTaskById(taskId);
      
      if (!task) {
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

      // Update task status to 'completed' and preserve completion reply
      await TaskModel.updateTaskStatusAndApprover(taskId, "completed", ctx.from.id, task.completion_reply);
      
      // Get employee information for notification
      const employee = await UserModel.getUserById(task.employee_id);
      const manager = await UserModel.getUserById(ctx.from.id);
      
      // Format the date for display
      const dueDate = new Date(task.due_date);
      const formattedDate = formatDate(dueDate);

      // Update manager's message
      const replyText = task.completion_reply ? `\n💬 *Employee Reply:* ${task.completion_reply}` : '';
      await ctx.editMessageText(
        `✅ *Task Completed and Approved*\n\nYou have approved the completed task for ${employee.first_name || 'employee'}.\n\n📝 *Task:* ${task.description}\n📅 *Due:* ${formattedDate}${replyText}\n\nThe task is now marked as completed.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
          }
        }
      );

      // Notify the employee
      if (employee && employee.telegram_id) {
        const replyText = task.completion_reply ? `\n💬 *Your Reply:* ${task.completion_reply}` : '';
        const employeeNotification = `
✅ *Task Completed and Approved*

Your task has been completed and approved by ${manager.first_name || 'your manager'}:

📝 *Task:* ${task.description}
📅 *Due:* ${formattedDate}
📋 *Status:* Completed${replyText}

Great job! The task is now marked as completed.
        `;

        await ctx.telegram.sendMessage(
          employee.telegram_id,
          employeeNotification,
          { parse_mode: "Markdown" }
        );
      }

    } catch (error) {
      logger.error("Error approving task:", error);
      await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
    }
  });

  // Handler for task rejection
  bot.action(/^reject_task_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const taskId = ctx.match[1];
      
      // Get the task data
      const task = await TaskModel.getTaskById(taskId);
      
      if (!task) {
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

      // Update task status to 'rejected' and preserve completion reply
      await TaskModel.updateTaskStatusAndApprover(taskId, "rejected", ctx.from.id, task.completion_reply);

      // Get employee and manager information
      const employee = await UserModel.getUserById(task.assigned_to);
      const manager = await UserModel.getUserById(ctx.from.id);

      // Format the date for display
      const dueDate = new Date(task.due_date);
      const formattedDate = formatDate(dueDate);

      // Update manager's message
      const replyText = task.completion_reply ? `\n💬 *Employee Reply:* ${task.completion_reply}` : '';
      await ctx.editMessageText(
        `❌ *Task Rejected*\n\nYou have rejected the task completion for ${employee.first_name || 'employee'}.\n\n📝 *Task:* ${task.description}\n📅 *Due:* ${formattedDate}${replyText}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
          }
        }
      );

      // Notify the employee
      if (employee && employee.telegram_id) {
        const replyText = task.completion_reply ? `\n💬 *Your Reply:* ${task.completion_reply}` : '';
        const employeeNotification = `
❌ *Task Completion Rejected*

Your task completion has been rejected by ${manager.first_name || 'your manager'}:

📝 *Task:* ${task.description}
📅 *Due:* ${formattedDate}${replyText}

Please discuss with your manager for more details or try completing the task again.
        `;

        await ctx.telegram.sendMessage(
          employee.telegram_id,
          employeeNotification,
          { parse_mode: "Markdown" }
        );
      }

    } catch (error) {
      logger.error("Error rejecting task:", error);
      await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
    }
  });

  // Handler for discussing task with employee
  bot.action(/^discuss_task_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const taskId = ctx.match[1];
      
      // Get the task data
      const task = await TaskModel.getTaskById(taskId);
      
      if (!task) {
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

      // Get employee and manager information
      const employee = await UserModel.getUserById(task.assigned_to);
      const manager = await UserModel.getUserById(ctx.from.id);

      // Format the date for display
      const dueDate = new Date(task.due_date);
      const formattedDate = formatDate(dueDate);

      // Update manager's message
      await ctx.editMessageText(
        `💬 *Task Discussion*\n\nTask from ${employee.first_name || 'employee'} is pending discussion.\n\n📝 *Task:* ${task.description}\n📅 *Due:* ${formattedDate}\n\nPlease discuss this task with the employee directly. You can approve or reject it later.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve Now", callback_data: `approve_task_${taskId}` },
                { text: "❌ Reject Now", callback_data: `reject_task_${taskId}` }
              ],
              [{ text: "Back to Main Menu", callback_data: "action_main_menu" }]
            ]
          }
        }
      );

      // Notify the employee
      if (employee && employee.telegram_id) {
        const employeeNotification = `
💬 *Task Discussion Required*

${manager.first_name || 'Your manager'} would like to discuss your task:

📝 *Task:* ${task.description}
📅 *Due:* ${formattedDate}

Please reach out to your manager to discuss the details.
        `;

        await ctx.telegram.sendMessage(
          employee.telegram_id,
          employeeNotification,
          { parse_mode: "Markdown" }
        );
      }

    } catch (error) {
      logger.error("Error setting task for discussion:", error);
      await ctx.answerCbQuery("Sorry, there was an error. Please try again.");
    }
  });
}

module.exports = {
  createTaskScene,
  setupTaskApprovalHandlers
};







      
