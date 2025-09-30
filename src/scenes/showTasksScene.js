// src/scenes/showTasksScene.js
const { Scenes } = require("telegraf");
const TaskModel = require("../models/taskModel");
const logger = require("../utils/logger");

function showTasksScene() {
  const scene = new Scenes.WizardScene(
    "showTasksScene",
    // Step 1: Initial step to show filter options
    async (ctx) => {
      try {
        // Reset state
        ctx.wizard.state.data = {};
        
        // Initialize message tracking arrays
        ctx.wizard.state.data.navigationMessages = [];
        ctx.wizard.state.data.taskMessages = [];
        
        // If this is a new entry to the scene, not a navigation action, clear any previous messages
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith("back_")) {
          await clearAllMessages(ctx);
        }
        
        // Create inline keyboard for filter selection
        const filterButtons = [
          [{ text: "All Tasks", callback_data: "filter_all" }],
          [{ text: "Pending Tasks", callback_data: "filter_pending" }],
          [{ text: "Completed Tasks", callback_data: "filter_completed" }],
          [{ text: "Overdue Tasks", callback_data: "filter_overdue" }],
          [{ text: "Cancel", callback_data: "cancel_action" }]
        ];
        
        const message = "Select tasks to show:";
        
        // Send new message for filter selection
        const sentMsg = await ctx.reply(message, {
          reply_markup: { inline_keyboard: filterButtons }
        });
        
        // Track this message for later cleanup
        ctx.wizard.state.data.navigationMessages.push({
          chat_id: sentMsg.chat.id,
          message_id: sentMsg.message_id
        });
        
        return ctx.wizard.next();
      } catch (error) {
        logger.error("Error in show tasks scene (step 1):", error);
        await handleError(ctx, "Sorry, there was an error. Please try again.");
        return await ctx.scene.leave();
      }
    },

    // Step 2: Handle filter selection and show month options
    async (ctx) => {
      try {
        // Only process callback queries
        if (!ctx.callbackQuery) {
          await ctx.reply("Please use the provided buttons");
          return; // Stay in the current step
        }

        const callbackData = ctx.callbackQuery.data;
        await ctx.answerCbQuery();
        
        if (callbackData === "cancel_action") {
          await clearAllMessages(ctx);
          await ctx.reply("Operation cancelled.");
          return await ctx.scene.leave();
        }
        
        // Process filter type
        if (callbackData.startsWith("filter_")) {
          const filterType = callbackData.split("_")[1];
          
          // Store and format the filter type
          switch (filterType) {
            case "all":
              ctx.wizard.state.data.filterType = "All Tasks";
              ctx.wizard.state.data.taskFilter = {};
              break;
            case "pending":
              ctx.wizard.state.data.filterType = "Pending Tasks";
              ctx.wizard.state.data.taskFilter = { status: "pending" };
              break;
            case "completed":
              ctx.wizard.state.data.filterType = "Completed Tasks";
              ctx.wizard.state.data.taskFilter = { status: "completed" };
              break;
            case "overdue":
              ctx.wizard.state.data.filterType = "Overdue Tasks";
              ctx.wizard.state.data.taskFilter = { status: "overdue" };
              break;
            default:
              ctx.wizard.state.data.filterType = "All Tasks";
              ctx.wizard.state.data.taskFilter = {};
          }

          // Clear previous navigation messages
          await clearNavigationMessages(ctx);

          // Create month selection keyboard
          const monthButtons = [
            [
              { text: "January", callback_data: "month_January" },
              { text: "February", callback_data: "month_February" },
              { text: "March", callback_data: "month_March" }
            ],
            [
              { text: "April", callback_data: "month_April" },
              { text: "May", callback_data: "month_May" },
              { text: "June", callback_data: "month_June" }
            ],
            [
              { text: "July", callback_data: "month_July" },
              { text: "August", callback_data: "month_August" },
              { text: "September", callback_data: "month_September" }
            ],
            [
              { text: "October", callback_data: "month_October" },
              { text: "November", callback_data: "month_November" },
              { text: "December", callback_data: "month_December" }
            ],
            [{ text: "All Months", callback_data: "month_All" }],
            [
              { text: "← Back", callback_data: "back_to_filters" },
              { text: "Cancel", callback_data: "cancel_action" }
            ]
          ];

          // Send new message for month selection
          const sentMsg = await ctx.reply(
            `Selected: ${ctx.wizard.state.data.filterType}\n\nSelect month:`, 
            { reply_markup: { inline_keyboard: monthButtons } }
          );
          
          // Track this message for later cleanup
          ctx.wizard.state.data.navigationMessages.push({
            chat_id: sentMsg.chat.id,
            message_id: sentMsg.message_id
          });
          
          return ctx.wizard.next();
        }
      } catch (error) {
        logger.error("Error in show tasks scene (step 2):", error);
        await handleError(ctx, "Sorry, there was an error. Please try again.");
        return await ctx.scene.leave();
      }
    },

    // Step 3: Handle month selection and show employee list
    async (ctx) => {
      try {
        // Only process callback queries
        if (!ctx.callbackQuery) {
          await ctx.reply("Please use the provided buttons");
          return; // Stay in the current step
        }

        const callbackData = ctx.callbackQuery.data;
        await ctx.answerCbQuery();
        
        if (callbackData === "cancel_action") {
          await clearAllMessages(ctx);
          await ctx.reply("Operation cancelled.");
          return await ctx.scene.leave();
        }
        
        if (callbackData === "back_to_filters") {
          await clearNavigationMessages(ctx);
          return ctx.wizard.back();
        }
        
        if (callbackData.startsWith("month_")) {
          const selectedMonth = callbackData.split("_")[1];
          ctx.wizard.state.data.selectedMonth = selectedMonth === "All" ? "All Months" : selectedMonth;
          
          // Build date filter for the selected month
          if (selectedMonth !== "All") {
            const monthMap = {
              "January": 0, "February": 1, "March": 2, "April": 3, "May": 4, "June": 5,
              "July": 6, "August": 7, "September": 8, "October": 9, "November": 10, "December": 11
            };
            
            const currentYear = new Date().getFullYear();
            const monthIndex = monthMap[selectedMonth];
            
            if (monthIndex !== undefined) {
              // Store month data for filtering
              ctx.wizard.state.data.monthData = {
                monthIndex: monthIndex,
                year: currentYear
              };
            }
          }
          
          // Clear previous navigation messages
          await clearNavigationMessages(ctx);
          
          // Get employees with tasks for the selected filters
          const employeesWithTasks = await getEmployeesWithTasks(ctx.wizard.state.data.taskFilter);
          
          if (employeesWithTasks.length === 0) {
            const sentMsg = await ctx.reply(
              `No employees have ${ctx.wizard.state.data.filterType.toLowerCase()} for the selected period.`,
              { reply_markup: { inline_keyboard: [[{ text: "← Back", callback_data: "back_to_months" }]] } }
            );
            
            // Track this message for later cleanup
            ctx.wizard.state.data.navigationMessages.push({
              chat_id: sentMsg.chat.id,
              message_id: sentMsg.message_id
            });
            
            return;
          }
          
          // Store employees list
          ctx.wizard.state.data.employeesWithTasks = employeesWithTasks;
          
          // Create employee selection buttons with callback data
          const employeeButtons = [
            [{ text: "All Employees", callback_data: "employee_all" }]
          ];
          
          // Add each employee as a button
          employeesWithTasks.forEach(employee => {
            const name = employee.first_name || employee.username || `Employee ID: ${employee.id}`;
            employeeButtons.push([
              { text: name, callback_data: `employee_${employee.id}` }
            ]);
          });
          
          // Add navigation buttons
          employeeButtons.push([
            { text: "← Back", callback_data: "back_to_months" },
            { text: "Cancel", callback_data: "cancel_action" }
          ]);
          
          // Send new message for employee selection
          const sentMsg = await ctx.reply(
            `Selected: ${ctx.wizard.state.data.filterType} / ${ctx.wizard.state.data.selectedMonth}\n\nSelect employee to view tasks:`,
            { reply_markup: { inline_keyboard: employeeButtons } }
          );
          
          // Track this message for later cleanup
          ctx.wizard.state.data.navigationMessages.push({
            chat_id: sentMsg.chat.id,
            message_id: sentMsg.message_id
          });
          
          return ctx.wizard.next();
        }
      } catch (error) {
        logger.error("Error in show tasks scene (step 3):", error);
        await handleError(ctx, "Sorry, there was an error. Please try again.");
        return await ctx.scene.leave();
      }
    },

    // Step 4: Handle employee selection and show tasks
    async (ctx) => {
      try {
        // Only process callback queries
        if (!ctx.callbackQuery) {
          await ctx.reply("Please use the provided buttons");
          return; // Stay in the current step
        }

        const callbackData = ctx.callbackQuery.data;
        await ctx.answerCbQuery();
        
        if (callbackData === "cancel_action") {
          await clearAllMessages(ctx);
          await ctx.reply("Operation cancelled.");
          return await ctx.scene.leave();
        }
        
        if (callbackData === "back_to_months") {
          await clearTaskMessages(ctx);
          await clearNavigationMessages(ctx);
          return ctx.wizard.back();
        }
        
        if (callbackData === "back_to_employees") {
          await clearTaskMessages(ctx);
          await clearNavigationMessages(ctx);
          return ctx.wizard.back();
        }
        
        if (callbackData === "start_over") {
          // Clear all messages and restart
          await clearAllMessages(ctx);
          ctx.wizard.selectStep(0);
          return ctx.wizard.steps[0](ctx);
        }
        
        if (callbackData.startsWith("employee_")) {
          // Clear all navigation messages - we don't need them while showing tasks
          await clearNavigationMessages(ctx);
          
          const selectedEmployeeId = callbackData.split("_")[1];
          let taskFilter = {...ctx.wizard.state.data.taskFilter};
          let selectedEmployeeName = "All Employees";
          
          // Filter by employee if specific employee selected
          if (selectedEmployeeId !== "all") {
            const employeeId = parseInt(selectedEmployeeId);
            taskFilter.employeeId = employeeId;
            
            // Find employee name for display
            const selectedEmployeeData = ctx.wizard.state.data.employeesWithTasks.find(
              emp => emp.id === employeeId
            );
            
            if (selectedEmployeeData) {
              selectedEmployeeName = selectedEmployeeData.first_name || 
                                    selectedEmployeeData.username || 
                                    `Employee ID: ${selectedEmployeeData.id}`;
              ctx.wizard.state.data.selectedEmployeeId = employeeId;
            } else {
              const sentMsg = await ctx.reply(
                "Could not find the selected employee. Please try again.",
                { reply_markup: { inline_keyboard: [[{ text: "← Back", callback_data: "back_to_employees" }]] } }
              );
              
              // Track this message for later cleanup
              ctx.wizard.state.data.navigationMessages.push({
                chat_id: sentMsg.chat.id,
                message_id: sentMsg.message_id
              });
              
              return;
            }
          }
          
          ctx.wizard.state.data.selectedEmployeeName = selectedEmployeeName;
          
          // Get tasks with the applied filters
          let tasks = await TaskModel.getAllTasks(taskFilter);
          
          // Apply month filtering if a specific month was selected
          if (ctx.wizard.state.data.selectedMonth !== "All Months" && ctx.wizard.state.data.monthData) {
            const { monthIndex, year } = ctx.wizard.state.data.monthData;
            
            tasks = tasks.filter(task => {
              const taskDate = new Date(task.due_date);
              return taskDate.getMonth() === monthIndex && taskDate.getFullYear() === year;
            });
          }
          
          if (tasks.length === 0) {
            const sentMsg = await ctx.reply(
              `No ${ctx.wizard.state.data.filterType.toLowerCase()} found for ${selectedEmployeeName} in ${ctx.wizard.state.data.selectedMonth}.`,
              { reply_markup: { inline_keyboard: [[{ text: "← Back", callback_data: "back_to_employees" }]] } }
            );
            
            // Track this message for later cleanup
            ctx.wizard.state.data.navigationMessages.push({
              chat_id: sentMsg.chat.id,
              message_id: sentMsg.message_id
            });
            
            return;
          }
          
          // If "All Employees" is selected, group by employee
          if (selectedEmployeeName === "All Employees") {
            const tasksByEmployee = {};
            
            tasks.forEach((task) => {
              const employeeName = task.employee_name || task.employee_username || "Unknown";
              
              if (!tasksByEmployee[employeeName]) {
                tasksByEmployee[employeeName] = [];
              }
              
              tasksByEmployee[employeeName].push(task);
            });
            
            // Now display tasks by employee
            await displayTasksGroupedByEmployee(ctx, tasksByEmployee);
          } else {
            // Show tasks for the specific employee
            await displayTasksForSingleEmployee(ctx, tasks, selectedEmployeeName);
          }
          
          // Add a standalone back button at the very end after all tasks are displayed
          const endMessage = await ctx.telegram.sendMessage(ctx.from.id,
            "End of task list.",
            { 
              reply_markup: { 
                inline_keyboard: [
                  [{ text: "Start Over", callback_data: "start_over" }]
                ] 
              }
            }
          );
          
          // Store this message with task messages
          ctx.wizard.state.data.taskMessages.push({
            chat_id: endMessage.chat.id,
            message_id: endMessage.message_id
          });
          
          return;
        }
      } catch (error) {
        logger.error("Error in show tasks scene (step 4):", error);
        await handleError(ctx, "Sorry, there was an error showing tasks. Please try again.");
        return await ctx.scene.leave();
      }
    }
  );

  // Helper function to clear all navigation UI messages
  async function clearNavigationMessages(ctx) {
    try {
      if (ctx.wizard.state.data.navigationMessages && ctx.wizard.state.data.navigationMessages.length > 0) {
        for (const msg of ctx.wizard.state.data.navigationMessages) {
          try {
            await ctx.telegram.deleteMessage(msg.chat_id, msg.message_id);
          } catch (deleteError) {
            logger.warn("Could not delete navigation message:", deleteError.message);
            // Continue with other deletions even if one fails
          }
        }
        ctx.wizard.state.data.navigationMessages = [];
      }
    } catch (error) {
      logger.error("Error clearing navigation messages:", error);
    }
  }

  // Helper function to clear all task content messages
  async function clearTaskMessages(ctx) {
    try {
      if (ctx.wizard.state.data.taskMessages && ctx.wizard.state.data.taskMessages.length > 0) {
        for (const msg of ctx.wizard.state.data.taskMessages) {
          try {
            await ctx.telegram.deleteMessage(msg.chat_id, msg.message_id);
          } catch (deleteError) {
            logger.warn("Could not delete task message:", deleteError.message);
            // Continue with other deletions even if one fails
          }
        }
        ctx.wizard.state.data.taskMessages = [];
      }
    } catch (error) {
      logger.error("Error clearing task messages:", error);
    }
  }

  // Helper function to clear all messages
  async function clearAllMessages(ctx) {
    await clearNavigationMessages(ctx);
    await clearTaskMessages(ctx);
  }

  // Handle error messages consistently
  async function handleError(ctx, errorMessage) {
    try {
      // Clear existing messages to avoid confusion
      await clearAllMessages(ctx);
      
      // Send error message with a restart button
      await ctx.reply(errorMessage, {
        reply_markup: { 
          inline_keyboard: [[{ text: "Start Over", callback_data: "start_over" }]]
        }
      });
    } catch (error) {
      logger.error("Error in handleError function:", error);
      try {
        await ctx.reply("An error occurred. Please try again later.");
      } catch (replyError) {
        logger.error("Critical error - could not send error message:", replyError);
      }
    }
  }

  // Function to display tasks for a single employee
  async function displayTasksForSingleEmployee(ctx, tasks, employeeName) {
    try {
      const header = `*${ctx.wizard.state.data.filterType} for ${escapeMarkdownV2(employeeName)} in ${escapeMarkdownV2(ctx.wizard.state.data.selectedMonth)}:*\n\n`;
      let message = header;
      
      // Collect all tasks and display them together
      let allTasksText = header;
      
      // Format each task
      tasks.forEach((task, index) => {
        const taskEntry = formatTaskEntry(task, index);
        
        // Check if adding this task would exceed message length
        if (allTasksText.length + taskEntry.length > 4000) {
          // Send current message and start a new one
          sendTaskMessage(ctx, allTasksText);
          allTasksText = header; // Start with the header again
        }
        
        allTasksText += taskEntry;
      });
      
      // Send any remaining content
      if (allTasksText.length > header.length) {
        await sendTaskMessage(ctx, allTasksText);
      }
      
    } catch (error) {
      logger.error("Error displaying tasks:", error);
      throw error;
    }
  }

  // Function to display tasks grouped by employee
  async function displayTasksGroupedByEmployee(ctx, tasksByEmployee) {
    try {
      // For each employee, send their tasks
      for (const [employee, employeeTasks] of Object.entries(tasksByEmployee)) {
        const header = `*${ctx.wizard.state.data.filterType} for ${escapeMarkdownV2(employee)} in ${escapeMarkdownV2(ctx.wizard.state.data.selectedMonth)}:*\n\n`;
        let message = header;
        
        // Format each task
        employeeTasks.forEach((task, index) => {
          const taskEntry = formatTaskEntry(task, index);
          
          // Check if adding this task would exceed message length
          if (message.length + taskEntry.length > 4000) {
            // Send current message and start a new one
            sendTaskMessage(ctx, message);
            message = header; // Start with the header again
          }
          
          message += taskEntry;
        });
        
        // Send any remaining content
        if (message.length > header.length) {
          await sendTaskMessage(ctx, message);
        }
      }
    } catch (error) {
      logger.error("Error displaying tasks by employee:", error);
      throw error;
    }
  }

  // Helper function to send a task message and track it
  async function sendTaskMessage(ctx, message) {
    try {
      const sentMsg = await ctx.telegram.sendMessage(ctx.from.id, message, { parse_mode: "MarkdownV2" });
      
      // Initialize the array if not already done
      if (!ctx.wizard.state.data.taskMessages) {
        ctx.wizard.state.data.taskMessages = [];
      }
      
      // Track this message
      ctx.wizard.state.data.taskMessages.push({
        chat_id: sentMsg.chat.id,
        message_id: sentMsg.message_id
      });
      
      return sentMsg;
    } catch (error) {
      logger.error("Error sending task message:", error);
      
      // Try sending without markdown as a fallback
      try {
        const plainText = message.replace(/[\*\_\[\]\(\)\~\`\>\#\+\-\=\|\{\}\.\!]/g, '');
        const fallbackMsg = await ctx.telegram.sendMessage(ctx.from.id, 
          "Error formatting message. Here's the plain text version:\n\n" + plainText
        );
        
        // Track this message too
        if (!ctx.wizard.state.data.taskMessages) {
          ctx.wizard.state.data.taskMessages = [];
        }
        
        ctx.wizard.state.data.taskMessages.push({
          chat_id: fallbackMsg.chat.id,
          message_id: fallbackMsg.message_id
        });
        
        return fallbackMsg;
      } catch (fallbackError) {
        logger.error("Critical error sending task message:", fallbackError);
        return null;
      }
    }
  }

  // Format a single task entry
  function formatTaskEntry(task, index) {
    const dueDate = new Date(task.due_date);
    const formattedDate = escapeMarkdownV2(dueDate.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }));
    
    const statusEmoji =
      task.status === "pending" ? "⏳" :
      task.status === "completed" ? "✅" : 
      task.status === "pending_approval" ? "⌛" : "⚠️";
    
    let entry = `*${index + 1}\\. ${escapeMarkdownV2(task.description)}* ${statusEmoji}\n`;
    entry += `Status: ${escapeMarkdownV2(task.status)}\n`;
    entry += `Due: ${formattedDate}\n`;
    entry += `Assigned by: ${escapeMarkdownV2(task.assigned_by || "Unknown")}\n`;
    
    if (task.completed_at) {
      const completedDate = new Date(task.completed_at);
      const formattedCompletedDate = escapeMarkdownV2(completedDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }));
      entry += `Completed: ${formattedCompletedDate}\n`;
    }
    
    if (task.priority) {
      entry += `Priority: ${escapeMarkdownV2(task.priority)}\n`;
    }
    
    entry += `Description: ${escapeMarkdownV2(task.description || "")}\n\n`;
    return entry;
  }

  // Helper function to escape special characters for MarkdownV2
  function escapeMarkdownV2(text) {
    if (!text) return "";
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  // Function to get employees with tasks for the given filters
  async function getEmployeesWithTasks(filter = {}) {
    try {
      // Create a custom query instead of using TaskModel methods directly
      let sql = `
        SELECT DISTINCT u.id, u.first_name, u.username
        FROM tasks t
        JOIN users u ON t.employee_id = u.id
      `;

      const conditions = [];
      const params = [];
      
      if (filter.status) {
        conditions.push("t.status = ?");
        params.push(filter.status);
      }

      if (filter.employeeId) {
        conditions.push("t.employee_id = ?");
        params.push(filter.employeeId);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }

      sql += " ORDER BY u.first_name ASC";

      // Using the query function from the DB utils
      const { query } = require("../database/db");
      return await query(sql, params);
    } catch (error) {
      logger.error("Error getting employees with tasks:", error);
      return [];
    }
  }

  // Handle scene cancellation via command
  scene.command("cancel", async (ctx) => {
    await clearAllMessages(ctx);
    await ctx.reply("Operation cancelled.");
    return await ctx.scene.leave();
  });

  // Handle global scene actions
  scene.action("start_over", async (ctx) => {
    await ctx.answerCbQuery();
    await clearAllMessages(ctx);
    ctx.wizard.selectStep(0);
    return ctx.wizard.steps[0](ctx);
  });

  scene.action("back_to_filters", async (ctx) => {
    await ctx.answerCbQuery();
    await clearTaskMessages(ctx);
    await clearNavigationMessages(ctx);
    ctx.wizard.selectStep(0);
    return ctx.wizard.steps[0](ctx);
  });
  
  scene.action("back_to_months", async (ctx) => {
    await ctx.answerCbQuery();
    await clearTaskMessages(ctx);
    await clearNavigationMessages(ctx);
    ctx.wizard.selectStep(1);
    return ctx.wizard.steps[1](ctx);
  });
  
  scene.action("back_to_employees", async (ctx) => {
    await ctx.answerCbQuery();
    await clearTaskMessages(ctx);
    await clearNavigationMessages(ctx);
    ctx.wizard.selectStep(2);
    return ctx.wizard.steps[2](ctx);
  });

  scene.action("cancel_action", async (ctx) => {
    await ctx.answerCbQuery("Cancelled");
    await clearAllMessages(ctx);
    // await ctx.reply("Operation cancelled.");
    return await ctx.scene.leave();
  });

  return scene;
}

module.exports = {
  showTasksScene,
};