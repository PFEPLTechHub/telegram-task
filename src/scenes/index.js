// src/scenes/index.js
const { createTaskScene } = require('./createTaskScene');
const { showTasksScene } = require('./showTasksScene');
const { completeTaskScene } = require('./completeTaskScene');
const { projectScene } = require('./projectScene');
const logger = require('../utils/logger');
const { roleManagementScene } = require('./roleManagementScene');
const { deleteUserScene } = require('./deleteUserScene');
const imageViewScene = require('./imageViewScene');
// Set up all scenes
function setupScenes(stage) {
  // Register all scenes
  stage.register(createTaskScene());
  stage.register(showTasksScene());
  stage.register(completeTaskScene());
  stage.register(projectScene());
  stage.register(roleManagementScene());
  stage.register(deleteUserScene());
  stage.register(imageViewScene());
  
  logger.info('Bot scenes registered successfully');
}

module.exports = {
  setupScenes
};






