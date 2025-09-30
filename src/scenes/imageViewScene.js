// src/scenes/imageViewScene.js
const { Scenes } = require("telegraf");
const UserModel = require("../models/userModel");
const TaskModel = require("../models/taskModel");
const imageGenerator = require("../utils/imageGenerator");
const logger = require("../utils/logger");

function imageViewScene() {
  const scene = new Scenes.WizardScene(
    "imageViewScene",
    
    // Step 1: Skip menu and directly generate reports
    async (ctx) => {
      try {
        ctx.session.inImageViewScene = true;
        
        // Initialize pagination and order state
        ctx.session.imageView = {
          currentPage: 1,
          totalPages: 1,
          itemsPerPage: 30,
          orderBy: 'status', // Default ordering by status (overdue first, then pending, then completed)
          orderDir: 'asc', // Default direction (ascending for status custom order)
          imagesPerRequest: 5, // Show 5 images at a time
          previousImages: [] // Store previous image messages
        };
        
        // Save original message context for future edits
        if (ctx.callbackQuery) {
          ctx.session.originalMessage = {
            chat_id: ctx.callbackQuery.message.chat.id,
            message_id: ctx.callbackQuery.message.message_id
          };
        }
        
        // Show loading message
        if (ctx.session.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            "task_report",
            { parse_mode: "HTML" }
          );
        } else {
          const sentMsg = await ctx.reply("Generating task reports for the last 30 days...", { parse_mode: "HTML" });
          
          // Save the sent message for future editing
          ctx.session.originalMessage = {
            chat_id: sentMsg.chat.id,
            message_id: sentMsg.message_id
          };
        }
        
        // Directly generate report for all tasks
        await handleTasksImage(ctx);
        
        return ctx.wizard.next();
      } catch (error) {
        logger.error("Error in image view scene step 1:", error);
        await ctx.reply("Sorry, there was an error. Please try again later.");
        return ctx.scene.leave();
      }
    },
    
    // Step 2: Handle image pagination and ordering
    async (ctx) => {
      try {
        // If this is not a callback query, repeat the last step
        if (!ctx.callbackQuery) {
          return;
        }
        
        await ctx.answerCbQuery();
        const action = ctx.callbackQuery.data;
        
        // Handle back to main menu
        if (action === "back_to_main") {
          ctx.session.inImageViewScene = false;
          await ctx.scene.leave();
          return showMainMenu(ctx);
        }
        
        // Handle pagination actions
        if (action.startsWith("img_page_")) {
          const pageNum = parseInt(action.split("_")[2]);
          ctx.session.imageView.currentPage = pageNum;
          return await handleTasksImage(ctx, true); // true means keep previous images
        }
        
        // Handle order by menu
        if (action === "img_order_by") {
          return await showOrderByMenu(ctx);
        }
        
        // Handle order selection
        if (action.startsWith("order_by_")) {
          const orderField = action.split("_")[2];
          
          // Toggle direction if same field is selected
          if (ctx.session.imageView.orderBy === orderField) {
            ctx.session.imageView.orderDir = ctx.session.imageView.orderDir === 'asc' ? 'desc' : 'asc';
          } else {
            ctx.session.imageView.orderBy = orderField;
            // Default directions for different fields
            if (orderField === 'due_date') {
              ctx.session.imageView.orderDir = 'asc'; // Closest due dates first
            } else if (orderField === 'status') {
              ctx.session.imageView.orderDir = 'asc'; // Custom status order (overdue, pending, completed)
            } else {
              ctx.session.imageView.orderDir = 'desc'; // Newest/alphabetical from Z-A by default
            }
          }
          
          // Clear previous image cache when changing order
          ctx.session.imageView.previousImages = [];
          
          // Refresh current view with new ordering
          ctx.session.imageView.currentPage = 1; // Reset to first page
          return await handleTasksImage(ctx);
        }
        
        // Handle main menu action
        if (action === "action_main_menu") {
          ctx.session.inImageViewScene = false;
          ctx.scene.leave();
          return showMainMenu(ctx);
        }
        
        return;
      } catch (error) {
        logger.error("Error in image view scene step 2:", error);
        
        const errorMessage = "Sorry, there was an error processing your request.";
        
        // Edit original message if available, otherwise send new one
        if (ctx.session.originalMessage) {
          await ctx.telegram.editMessageText(
            ctx.session.originalMessage.chat_id,
            ctx.session.originalMessage.message_id,
            null,
            errorMessage,
            { 
              reply_markup: {
                inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "back_to_main" }]]
              }
            }
          );
        } else {
          await ctx.reply(errorMessage, {
            reply_markup: {
              inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "back_to_main" }]]
            }
          });
        }
        
        ctx.session.inImageViewScene = false;
        return ctx.scene.leave();
      }
    }
  );
  
  // Add action handlers
  scene.action(/^img_.*$/, async (ctx) => {
    await ctx.wizard.steps[1](ctx);
  });
  
  scene.action(/^order_by_.*$/, async (ctx) => {
    await ctx.wizard.steps[1](ctx);
  });
  
  scene.action("back_to_main", async (ctx) => {
    await ctx.wizard.steps[1](ctx);
  });
  
  // Handle main menu action
  scene.action("action_main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.inImageViewScene = false;
    ctx.scene.leave();
    return showMainMenu(ctx);
  });
  
  return scene;
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


// Helper functions
async function handleTasksImage(ctx, keepPreviousImages = false) {
  try {
    // Show loading message
    let loadingMsg;
    if (!keepPreviousImages) {
      loadingMsg = await ctx.reply("Generating task reports for the last 30 days...");
    }
    
    // Get tasks data
    const isTeamLead = await UserModel.isTeamLead(ctx.from.id);
    const isManager = await UserModel.isManager(ctx.from.id);
    
    let tasks = [];
    
    if (isTeamLead) {
      if (isManager) {
        // Get the manager's ID
        const manager = await UserModel.getUserByTelegramId(ctx.from.id);
        
        // Get all employees under this manager
        const managedEmployees = await UserModel.getEmployeesByManagerId(manager.id);
        
        // Get tasks for the manager and all employees under their management
        const employeeIds = [...managedEmployees.map(emp => emp.telegram_id), ctx.from.id];
        tasks = await TaskModel.getTasksByMultipleEmployeeIds(employeeIds);
      } else {
        // Regular team lead sees only their team's tasks
        tasks = await TaskModel.getAllTasks();
      }
    } else {
      // Regular employee sees only their tasks
      tasks = await TaskModel.getTasksByEmployeeId(ctx.from.id);
    }
    
    // Filter tasks for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    tasks = tasks.filter(task => {
      const taskDate = new Date(task.created_at);
      return taskDate >= thirtyDaysAgo;
    });
    
    logger.info(`Filtered tasks for last 30 days: ${tasks.length}`);
    
    // Generate image with pagination and ordering
    const options = {
      page: ctx.session.imageView.currentPage,
      itemsPerPage: ctx.session.imageView.itemsPerPage || 30,
      orderBy: ctx.session.imageView.orderBy || 'status',
      orderDir: ctx.session.imageView.orderDir || 'asc',
      imagesPerRequest: ctx.session.imageView.imagesPerRequest || 5
    };
    
    const result = await imageGenerator.generateTasksImage(tasks, options);
    
    // Save pagination info in session
    ctx.session.imageView.currentPage = result.currentPage;
    ctx.session.imageView.totalPages = result.totalPages;
    
    // Delete loading message if it exists
    if (loadingMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    }
    
    // Build pagination buttons (simplified - only showing page indicator)
    const paginationButtons = buildPaginationButtons(result.currentPage, result.totalPages);
    
    // Get order indicator for the caption
    const orderLabel = getOrderLabel(ctx.session.imageView.orderBy, ctx.session.imageView.orderDir);
    
    // If we need to clear previous images
    if (!keepPreviousImages && ctx.session.imageView.previousImages && ctx.session.imageView.previousImages.length > 0) {
      for (const prevImg of ctx.session.imageView.previousImages) {
        try {
          await ctx.telegram.deleteMessage(prevImg.chat_id, prevImg.message_id);
        } catch (error) {
          logger.error("Error deleting previous image:", error);
        }
      }
      ctx.session.imageView.previousImages = [];
    }
    
    // Send multiple images (up to imagesPerRequest)
    const imagesPerRequest = ctx.session.imageView.imagesPerRequest || 5;
    const startPage = ctx.session.imageView.currentPage;
    
    for (let i = 0; i < Math.min(imagesPerRequest, result.totalPages - startPage + 1); i++) {
      const pageNum = startPage + i;
      
      // Only show pagination controls on last image
      const isLastImage = i === Math.min(imagesPerRequest, result.totalPages - startPage + 1) - 1;
      const keyboard = isLastImage ? [
        ...paginationButtons,
        [
          // { text: "🔠 Order by", callback_data: "img_order_by" },
          { text: "🔙 Back to Main Menu", callback_data: "back_to_main" }
        ]
      ] : [];
      
      // Generate image for this specific page if we need more than one page
      let pageResult = result;
      if (i > 0) {
        pageResult = await imageGenerator.generateTasksImage(tasks, { 
          ...options, 
          page: pageNum 
        });
      }
      
      // Create caption text
      const caption = `Overall Task Report - Page ${pageNum} of ${result.totalPages}`;
      
      // Send the image
      const sentMsg = await ctx.telegram.sendPhoto(
        ctx.chat.id, 
        { source: pageResult.buffer },
        {
          caption: caption,
          reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : {}
        }
      );
      
      // Save the message reference
      if (!ctx.session.imageView.previousImages) {
        ctx.session.imageView.previousImages = [];
      }
      
      ctx.session.imageView.previousImages.push({
        chat_id: sentMsg.chat.id,
        message_id: sentMsg.message_id
      });
    }
    
  } catch (error) {
    logger.error("Error generating tasks image:", error);
    
    if (ctx.session.originalMessage) {
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "Sorry, there was an error generating the tasks report.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Back to Main Menu", callback_data: "action_main_menu" }]
            ]
          }
        }
      );
    } else {
      await ctx.reply("Sorry, there was an error generating the tasks report.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Back to Main Menu", callback_data: "action_main_menu" }]
          ]
        }
      });
    }
  }
}

// Helper function to build pagination buttons - SIMPLIFIED VERSION
function buildPaginationButtons(currentPage, totalPages) {
  // Don't show pagination if only one page
  if (totalPages <= 1) return [];
  
  const buttons = [];
  
  // Add simplified page navigation row - ONLY SHOW CURRENT PAGE INDICATOR
  const pageNav = [];
  
  // Current page indicator
  pageNav.push({ text: `${currentPage}/${totalPages}`, callback_data: "no_action" });
  
  // Next page button (if not on the last page)
  if (currentPage < totalPages) {
    pageNav.push({ text: ">", callback_data: `img_page_${currentPage + 1}` });
  }
  
  buttons.push(pageNav);
  return buttons;
}

// New helper function to show order by menu
async function showOrderByMenu(ctx) {
  try {
    await ctx.answerCbQuery();

    const currentOrderBy = ctx.session.imageView?.orderBy || 'status';
    const currentOrderDir = ctx.session.imageView?.orderDir || 'asc';

    // Create indicators for current sort field and direction
    const getIndicator = (field) => {
      if (field === currentOrderBy) {
        return currentOrderDir === 'asc' ? ' ↑' : ' ↓';
      }
      return '';
    };

    const buttons = [
      [{ text: "Sort tasks by:", callback_data: "no_action" }],
      [{ text: `Status (Overdue/Pending/Done)${getIndicator('status')}`, callback_data: "order_by_status" }],
      [{ text: `Created Date${getIndicator('created_at')}`, callback_data: "order_by_created_at" }],
      [{ text: `Person${getIndicator('employee_name')}`, callback_data: "order_by_employee_name" }],
      [{ text: `Due Date${getIndicator('due_date')}`, callback_data: "order_by_due_date" }],
      [{ text: "🔙 Back", callback_data: "img_page_1" }]
    ];

    // Edit original message if available
    if (ctx.session.originalMessage) {
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "Choose how to sort your tasks:",
        { reply_markup: { inline_keyboard: buttons } }
      );
    } else {
      // If no original message, send a new one
      const sentMsg = await ctx.reply("Choose how to sort your tasks:", {
        reply_markup: { inline_keyboard: buttons }
      });

      ctx.session.originalMessage = {
        chat_id: sentMsg.chat.id,
        message_id: sentMsg.message_id
      };
    }
  } catch (error) {
    logger.error("Error showing order by menu:", error);
    await ctx.reply("Sorry, there was an error loading the ordering options. Please try again.", {
      reply_markup: {
        inline_keyboard: [[{ text: "Back to Main Menu", callback_data: "action_main_menu" }]]
      }
    });
  }
}

// Helper function to get readable label for current ordering
function getOrderLabel(orderBy, orderDir) {
  const dirLabel = orderDir === 'asc' ? '(ascending)' : '(descending)';
  
  switch (orderBy) {
    case 'created_at':
      return `Creation Date ${dirLabel}`;
    case 'status':
      return `Status (Overdue/Pending/Completed)`;
    case 'employee_name':
      return `Person ${dirLabel}`;
    case 'due_date':
      return `Due Date ${dirLabel}`;
    default:
      return `Default ${dirLabel}`;
  }
}

module.exports = imageViewScene;