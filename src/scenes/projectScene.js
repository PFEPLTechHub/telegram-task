// src/scenes/projectScene.js
const { Scenes } = require("telegraf");
const UserModel = require("../models/userModel");
const ProjectModel = require("../models/projectModel");
const logger = require("../utils/logger");

function projectScene() {
  const scene = new Scenes.WizardScene(
    "projectScene",
    
    // Step 1: Show project management options
    async (ctx) => {
      ctx.session.inProjectScene = true;
      ctx.wizard.state.currentStep = 1;
      
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
        
        const message = `🏗️ *Project Management*

What would you like to do?`;
        
        const buttons = [
          [{ text: "➕ Create New Project", callback_data: "create_project" }],
          [{ text: "📋 View All Projects", callback_data: "view_projects" }],
          [{ text: "📊 My Projects", callback_data: "my_projects" }],
          [{ text: "← Back to Main Menu", callback_data: "action_main_menu" }]
        ];
        
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
          const msg = await ctx.reply(message, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: buttons }
          });
          
          ctx.session.originalMessage = {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          };
        }
        
        return ctx.wizard.next();
      } catch (error) {
        logger.error("Error in project scene (step 1):", error);
        if (ctx.session?.originalMessage) {
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
        } else {
          await ctx.reply("Sorry, there was an error. Please try again.");
        }
        return await ctx.scene.leave();
      }
    },
    
    // Step 2: Handle project management actions
    async (ctx) => {
      if (!ctx.callbackQuery) {
        return;
      }
      
      const callbackData = ctx.callbackQuery.data;
      
      if (callbackData === "create_project") {
        await ctx.answerCbQuery();
        ctx.wizard.state.action = "create";
        ctx.wizard.state.currentStep = 2;
        
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          `🏗️ *Create New Project*

Step 1/3: Enter project name

Please send the project name:`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "← Back", callback_data: "back_to_options" }]]
            }
          }
        );
        
        ctx.wizard.state.waitingForProjectName = true;
        return ctx.wizard.next();
      } else if (callbackData === "view_projects") {
        await ctx.answerCbQuery();
        return await showAllProjects(ctx);
      } else if (callbackData === "my_projects") {
        await ctx.answerCbQuery();
        return await showMyProjects(ctx);
      } else if (callbackData === "action_main_menu") {
        await ctx.answerCbQuery();
        await ctx.scene.leave();
        return await showMainMenu(ctx);
      } else if (callbackData === "back_to_options") {
        await ctx.answerCbQuery();
        return ctx.wizard.selectStep(1);
      }
    },
    
    // Step 3: Handle project creation input
    async (ctx) => {
      if (ctx.wizard.state.waitingForProjectName && ctx.message && ctx.message.text) {
        const projectName = ctx.message.text.trim();
        
        if (projectName.length < 3) {
          await ctx.reply("Project name is too short. Please provide a name with at least 3 characters.");
          return;
        }
        
        if (projectName.length > 100) {
          await ctx.reply("Project name is too long. Please keep it under 100 characters.");
          return;
        }
        
        // Check if project name already exists
        const existingProject = await ProjectModel.getProjectByName(projectName);
        if (existingProject) {
          await ctx.reply("A project with this name already exists. Please choose a different name.");
          return;
        }
        
        ctx.wizard.state.projectName = projectName;
        ctx.wizard.state.waitingForProjectName = false;
        ctx.wizard.state.waitingForProjectDescription = true;
        
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          `🏗️ *Create New Project*

Step 2/3: Enter project description

Project Name: ${projectName}

Please send the project description (optional):`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Skip Description", callback_data: "skip_description" }],
                [{ text: "← Back", callback_data: "back_to_name" }]
              ]
            }
          }
        );
        
        return;
      } else if (ctx.wizard.state.waitingForProjectDescription && ctx.message && ctx.message.text) {
        const projectDescription = ctx.message.text.trim();
        
        if (projectDescription.length > 500) {
          await ctx.reply("Project description is too long. Please keep it under 500 characters.");
          return;
        }
        
        ctx.wizard.state.projectDescription = projectDescription;
        ctx.wizard.state.waitingForProjectDescription = false;
        
        // Show confirmation
        await showProjectConfirmation(ctx);
        return;
      }
    },
    
    // Step 4: Handle project confirmation and creation (now handled by action handlers)
    async (ctx) => {
      // This step is now handled by action handlers
      return;
    }
  );

  // Helper function to show project confirmation
  async function showProjectConfirmation(ctx) {
    const projectName = ctx.wizard.state.projectName;
    const projectDescription = ctx.wizard.state.projectDescription || "No description provided";
    
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      `🏗️ *Project Confirmation*

Please review the project details:

📝 *Name:* ${projectName}
📄 *Description:* ${projectDescription}
👤 *Manager:* ${ctx.wizard.state.currentUser.first_name || ctx.wizard.state.currentUser.username}

Do you want to create this project?`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Create Project", callback_data: "confirm_create_project" }],
            [
              { text: "✏️ Edit Name", callback_data: "edit_project_name" },
              { text: "✏️ Edit Description", callback_data: "edit_project_description" }
            ],
            [{ text: "← Back to Options", callback_data: "back_to_options" }]
          ]
        }
      }
    );
  }

  // Helper function to create project
  async function createProject(ctx) {
    try {
      const project = await ProjectModel.createProject(
        ctx.wizard.state.projectName,
        ctx.wizard.state.projectDescription,
        ctx.wizard.state.currentUser.id
      );
      
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        `✅ *Project Created Successfully!*

📝 *Name:* ${project.name}
📄 *Description:* ${project.description || "No description"}
👤 *Manager:* ${ctx.wizard.state.currentUser.first_name || ctx.wizard.state.currentUser.username}
🆔 *Project ID:* ${project.id}

The project has been created and is now active.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🏗️ Manage Projects", callback_data: "back_to_options" }],
              [{ text: "← Back to Main Menu", callback_data: "action_main_menu" }]
            ]
          }
        }
      );
      
      return await ctx.scene.leave();
    } catch (error) {
      logger.error("Error creating project:", error);
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "❌ Sorry, there was an error creating the project. Please try again.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "← Back to Options", callback_data: "back_to_options" }]]
          }
        }
      );
    }
  }

  // Helper function to show all projects
  async function showAllProjects(ctx) {
    try {
      const projects = await ProjectModel.getAllProjects();
      
      if (projects.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "📋 *All Projects*\n\nNo projects found.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "← Back to Options", callback_data: "back_to_options" }]]
            }
          }
        );
        return;
      }
      
      let message = "📋 *All Projects*\n\n";
      projects.forEach((project, index) => {
        const status = project.status === 'active' ? '🟢' : '🔴';
        const managerName = project.manager_name || project.manager_username || 'Unknown';
        message += `${index + 1}. ${status} *${project.name}*\n`;
        message += `   Manager: ${managerName}\n`;
        message += `   Status: ${project.status}\n\n`;
      });
      
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        message,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "← Back to Options", callback_data: "back_to_options" }]]
          }
        }
      );
    } catch (error) {
      logger.error("Error showing all projects:", error);
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "❌ Sorry, there was an error loading projects. Please try again.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "← Back to Options", callback_data: "back_to_options" }]]
          }
        }
      );
    }
  }

  // Helper function to show user's projects
  async function showMyProjects(ctx) {
    try {
      const projects = await ProjectModel.getProjectsByManagerId(ctx.wizard.state.currentUser.id);
      
      if (projects.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.session.originalMessage.chat_id,
          ctx.session.originalMessage.message_id,
          null,
          "📊 *My Projects*\n\nYou don't have any projects yet.",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➕ Create New Project", callback_data: "create_project" }],
                [{ text: "← Back to Options", callback_data: "back_to_options" }]
              ]
            }
          }
        );
        return;
      }
      
      let message = "📊 *My Projects*\n\n";
      projects.forEach((project, index) => {
        const status = project.status === 'active' ? '🟢' : '🔴';
        message += `${index + 1}. ${status} *${project.name}*\n`;
        message += `   Description: ${project.description || "No description"}\n`;
        message += `   Status: ${project.status}\n\n`;
      });
      
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        message,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Create New Project", callback_data: "create_project" }],
              [{ text: "← Back to Options", callback_data: "back_to_options" }]
            ]
          }
        }
      );
    } catch (error) {
      logger.error("Error showing my projects:", error);
      await ctx.telegram.editMessageText(
        ctx.session.originalMessage.chat_id,
        ctx.session.originalMessage.message_id,
        null,
        "❌ Sorry, there was an error loading your projects. Please try again.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "← Back to Options", callback_data: "back_to_options" }]]
          }
        }
      );
    }
  }

  // Helper function to show main menu
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

  // Action handlers
  scene.action("action_main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.leave();
    return await showMainMenu(ctx);
  });

  scene.action("back_to_options", async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.wizard.selectStep(1);
  });

  // Project creation action handlers
  scene.action("skip_description", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.projectDescription = null;
    await showProjectConfirmation(ctx);
  });

  scene.action("confirm_create_project", async (ctx) => {
    await ctx.answerCbQuery();
    return await createProject(ctx);
  });

  scene.action("edit_project_name", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.waitingForProjectName = true;
    ctx.wizard.state.waitingForProjectDescription = false;
    
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      `✏️ *Edit Project Name*

Current name: ${ctx.wizard.state.projectName}

Please send the new project name:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "← Back", callback_data: "back_to_confirmation" }]]
        }
      }
    );
  });

  scene.action("edit_project_description", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.waitingForProjectDescription = true;
    ctx.wizard.state.waitingForProjectName = false;
    
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      `✏️ *Edit Project Description*

Current description: ${ctx.wizard.state.projectDescription || "None"}

Please send the new project description:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Clear Description", callback_data: "clear_description" }],
            [{ text: "← Back", callback_data: "back_to_confirmation" }]
          ]
        }
      }
    );
  });

  scene.action("back_to_confirmation", async (ctx) => {
    await ctx.answerCbQuery();
    await showProjectConfirmation(ctx);
  });

  scene.action("clear_description", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.projectDescription = null;
    await showProjectConfirmation(ctx);
  });

  scene.action("back_to_name", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.waitingForProjectDescription = false;
    ctx.wizard.state.waitingForProjectName = true;
    
    await ctx.telegram.editMessageText(
      ctx.session.originalMessage.chat_id,
      ctx.session.originalMessage.message_id,
      null,
      `🏗️ *Create New Project*

Step 1/3: Enter project name

Please send the project name:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "← Back", callback_data: "back_to_options" }]]
        }
      }
    );
  });

  return scene;
}

module.exports = {
  projectScene
};
