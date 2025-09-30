const { Composer } = require('telegraf');
const ReportGenerator = require('../utils/reportGenerator');
const UserModel = require('../models/userModel');
const logger = require('../utils/logger');

const reportHandler = new Composer();

// Command for generating reports
reportHandler.command('report', async (ctx) => {
  try {
    logger.debug(`Received /report command from user ${ctx.from.id}`);
    const user = await UserModel.getUserByTelegramId(ctx.from.id);

    if (!user) {
      logger.debug(`User ${ctx.from.id} not found in DB`);
      return await ctx.reply("You need to register first. Use /start to register.");
    }

    const isAdmin = await UserModel.isAdmin(ctx.from.id);
    const isManager = await UserModel.isManager(ctx.from.id);
    const isTeamLead = await UserModel.isTeamLead(ctx.from.id);

    logger.debug(`Permissions for ${ctx.from.id} — Admin: ${isAdmin}, Manager: ${isManager}, TeamLead: ${isTeamLead}`);

    if (!isAdmin && !isManager && !isTeamLead) {
      return await ctx.reply("You don't have permission to generate reports.");
    }

    await showReportOptions(ctx);
  } catch (error) {
    logger.error("Error handling /report command:", error);
    await ctx.reply("Sorry, there was an error. Please try again.");
  }
});

// Show report generation options
async function showReportOptions(ctx) {
  const buttons = [
    [{ text: "📊 All Tasks", callback_data: "report_all_tasks" }],
    [{ text: "👤 Tasks by Employee", callback_data: "report_by_employee" }],
    [{ text: "🚦 Tasks by Status", callback_data: "report_by_status" }]
  ];

  try {
    await ctx.editMessageText("What kind of report would you like to generate?", {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (e) {
    logger.debug("Fallback to ctx.reply for report options");
    await ctx.reply("What kind of report would you like to generate?", {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  }
}

// Handle report type selection
reportHandler.action(/^report_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const reportType = ctx.match[1];
    logger.debug(`Report type selected: ${reportType}`);

    if (reportType === 'all_tasks') {
      await generateAndSendReport(ctx, { filterBy: 'all' });
    } else if (reportType === 'by_employee') {
      await showEmployeeSelectionForReport(ctx);
    } else if (reportType === 'by_status') {
      await showStatusSelectionForReport(ctx);
    }
  } catch (error) {
    logger.error("Error handling report action:", error);
    await ctx.reply("Sorry, there was an error generating the report. Please try again.");
  }
});

// Show employee selection
async function showEmployeeSelectionForReport(ctx) {
  try {
    const employees = await UserModel.getAllUsers();
    logger.debug(`Fetched ${employees.length} employees`);

    if (!employees || employees.length === 0) {
      return await ctx.reply("No employees found in the system.");
    }

    const buttons = [
      [{ text: "👥 All Employees", callback_data: "report_employee_all" }]
    ];

    employees.forEach(employee => {
      buttons.push([{
        text: `${employee.first_name} ${employee.last_name || ''}`,
        callback_data: `report_employee_${employee.id}`
      }]);
    });

    buttons.push([{ text: "↩️ Back", callback_data: "back_to_report_options" }]);

    await ctx.reply("Select an employee to generate the report:", {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    logger.error("Error showing employee selection:", error);
    await ctx.reply("Sorry, there was an error. Please try again.");
  }
}

// Show status selection
async function showStatusSelectionForReport(ctx) {
  const buttons = [
    [{ text: "⏳ Pending", callback_data: "report_status_pending" }],
    [{ text: "✅ Completed", callback_data: "report_status_completed" }],
    [{ text: "⌛ Overdue", callback_data: "report_status_overdue" }],
    [{ text: "⏱️ Pending Approval", callback_data: "report_status_pending_approval" }],
    [{ text: "↩️ Back", callback_data: "back_to_report_options" }]
  ];

  await ctx.reply("Select a status to generate the report:", {
    reply_markup: {
      inline_keyboard: buttons
    }
  });
}

// Back to report options
reportHandler.action('back_to_report_options', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    logger.debug("User selected back to report options");
    await showReportOptions(ctx);
  } catch (error) {
    logger.error("Error handling back to report options:", error);
    await ctx.reply("Sorry, there was an error. Please try again.");
  }
});

// Handle employee report
reportHandler.action(/^report_employee_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const employeeId = ctx.match[1];
    logger.debug(`Employee report selected for ID: ${employeeId}`);

    if (employeeId === 'all') {
      logger.debug("Generating report for ALL employees");
      await generateAndSendReport(ctx, { filterBy: 'all_employees' });
    } else {
      logger.debug(`Generating report for specific employee: ${employeeId}`);
      await generateAndSendReport(ctx, { filterBy: 'employee', filterValue: employeeId });
    }
  } catch (error) {
    logger.error("Error handling employee report selection:", error);
    await ctx.reply("Sorry, there was an error generating the employee report. Please try again.");
  }
});

// Handle status report
reportHandler.action(/^report_status_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const status = ctx.match[1];
    logger.debug(`Status report selected: ${status}`);
    await generateAndSendReport(ctx, { filterBy: 'status', filterValue: status });
  } catch (error) {
    logger.error("Error handling status report selection:", error);
    await ctx.reply("Sorry, there was an error. Please try again.");
  }
});

// Generate and send report
async function generateAndSendReport(ctx, options) {
  try {
    logger.debug("Generating report with options:", options);
    await ctx.reply("Generating report... Please wait.");

    const reportPath = await ReportGenerator.generateTaskReport(options);
    logger.debug("Generated report path:", reportPath);

    let reportTitle = "📊 Task Report";

    if (options.filterBy === 'employee') {
      try {
        const user = await UserModel.getUserById(options.filterValue);
        reportTitle += user
          ? ` for ${user.first_name} ${user.last_name || ''}`
          : " for Employee";
        logger.debug("Employee found for report title:", user);
      } catch (err) {
        logger.error("Error getting user info for report title:", err);
        reportTitle += " for Employee";
      }
    } else if (options.filterBy === 'all_employees') {
      reportTitle += " - All Employees";
    } else if (options.filterBy === 'status') {
      reportTitle += ` - ${options.filterValue.charAt(0).toUpperCase() + options.filterValue.slice(1).replace(/_/g, ' ')}`;
    }

    await ctx.replyWithPhoto({ source: reportPath }, { caption: reportTitle });
    logger.debug("Report sent to user");

    await ctx.reply("Report generated successfully.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 Back to Main Menu", callback_data: "action_main_menu" }]]
      }
    });
  } catch (error) {
    logger.error("Error generating report:", error);
    await ctx.reply("Sorry, there was an error generating the report. Please try again.");
  }
}

module.exports = reportHandler;
