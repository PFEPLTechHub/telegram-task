// app.js - Main application entry point
const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf, Scenes, session } = require('telegraf');
const { setupWebhook } = require('./src/utils/webhook');
const { initializeDatabase } = require('./src/database/db');
const { registerCommands } = require('./src/commands');
const { setupScenes } = require('./src/scenes');
const { scheduleAllReminders } = require('./src/reminders/scheduler');
const logger = require('./src/utils/logger');
const config = require('./config');
const path = require('path');
const { fetchTasksReportData } = require('./src/utils/taskDataFetcher'); // Assuming this file will be created
const UserModel = require('./src/models/userModel');
const TaskModel = require('./src/models/taskModel');
const { sendNotification } = require('./src/utils/notifications');
const ProjectModel = require('./src/models/projectModel');
const NoteModel = require('./src/models/noteModel');

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to fetch tasks data for the reports (existing)
app.get('/api/tasks-report', async (req, res) => {
  try {
    // Extract filter parameters from query string
    const { month, employeeId } = req.query;
    
    // Fetch and filter tasks using the new utility function
    const tasks = await fetchTasksReportData(month, employeeId);
    
    res.json(tasks);
  } catch (error) {
    logger.error('Error fetching tasks report data:', error);
    res.status(500).json({ error: 'Failed to fetch tasks report data' });
  }
});

// API endpoint for React Task View
// Supports query params: view=employee|status|project, status=pending|completed|overdue
app.get('/api/tasks', async (req, res) => {
  try {
    const { status, tg_id } = req.query;

    const normalizedStatus = status === 'pending' || status === 'completed' || status === 'overdue'
      ? status
      : undefined;

    // Optional scoping by Telegram user id
    let filter = { status: normalizedStatus };
    if (tg_id) {
      try {
        const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
        if (user) {
          // If user is a manager, show their employees' tasks and their own
          if (await UserModel.isManager(user.telegram_id)) {
            filter.managerId = user.id; // users.manager_id = user.id
            filter.excludeOthers = true;
          } else if (await UserModel.isAdmin(user.telegram_id)) {
            // admin: no extra filter
          } else {
            // employee: only own tasks
            filter.employeeId = user.id;
            filter.excludeOthers = true;
          }
        }
      } catch (e) {
        logger.warn('Failed to resolve tg_id for /api/tasks:', e.message);
      }
    }

    const tasks = await TaskModel.getAllTasks(filter);
    
    // Get CC information for each task
    const tasksWithCc = await Promise.all(tasks.map(async (task) => {
      const ccUsers = await TaskModel.getCcUsers(task.id);
      return { ...task, ccUsers };
    }));
    
    // Determine no-person user id for frontend labeling and button state
    let noPersonUserId = 0;
    try {
      const noPersonUser = await UserModel.getUserByName('no_person');
      if (noPersonUser && noPersonUser.id) noPersonUserId = noPersonUser.id;
    } catch (_) {}
    const noPersonCount = Array.isArray(tasksWithCc)
      ? tasksWithCc.filter(t => t.employee_id === noPersonUserId || t.employee_id === 0).length
      : 0;

    res.json({ tasks: tasksWithCc, meta: { noPersonUserId, noPersonCount } });
  } catch (error) {
    logger.error('Error fetching tasks for UI:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Assign/Move task to another employee (drag-and-drop)
app.post('/api/tasks/:id/assign', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    // accept from body or query
    const toEmployeeId = (req.body && req.body.to_employee_id) || req.query.to_employee_id;
    const byTgId = (req.body && req.body.by_tg_id) || req.query.by_tg_id;
    if (!taskId || !toEmployeeId) {
      logger.warn('Assign missing params', { taskId, toEmployeeId, byTgId, body: req.body, query: req.query });
      return res.status(400).json({ error: 'task id and to_employee_id are required' });
    }

    // Get the actor user if provided; otherwise fall back to the current task's assigned_by
    let byUser = null;
    if (byTgId) {
      byUser = await UserModel.getUserByTelegramId(parseInt(byTgId, 10));
    }
    const currentTask = await TaskModel.getTaskById(taskId);
    const actorId = byUser?.id || currentTask?.assigned_by || null;

    // Update in DB
    await TaskModel.updateTaskAssignee(taskId, parseInt(toEmployeeId,10), actorId);

    // Get task with CC info for notifications
    const task = await TaskModel.getTaskWithCcInfo(taskId);
    const actorUser = byUser || (actorId ? await UserModel.getUserById(actorId) : null);

    // Notify the assignee
    const assignee = await UserModel.getUserById(parseInt(toEmployeeId,10));
    if (assignee?.telegram_id) {
      const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : 'N/A';
      const dueText = fmt(task?.due_date);
      const byText = actorUser ? ` • by ${actorUser.first_name || actorUser.username || 'Manager'}` : '';
      const msg = `📌 Task assigned\n\n🗒️ ${task.description}\n📅 Due: ${dueText}${byText}`;
      await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, assignee.telegram_id, msg);
    }

    // Notify CC users about task assignment
    if (task?.ccUsers && task.ccUsers.length > 0) {
      const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : 'N/A';
      const dueText = fmt(task?.due_date);
      const assigneeName = assignee ? `${assignee.first_name || assignee.username || 'Employee'}` : 'Unknown';
      const byText = actorUser ? ` • by ${actorUser.first_name || actorUser.username || 'Manager'}` : '';
      
      for (const ccUser of task.ccUsers) {
        if (ccUser.telegram_id && ccUser.telegram_id !== assignee?.telegram_id) {
          const msg = `📋 Task updated (you're CC'd)\n\n🗒️ ${task.description}\n👤 Assigned to: ${assigneeName}\n📅 Due: ${dueText}${byText}`;
          await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, ccUser.telegram_id, msg);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error assigning task:', error);
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

// Update task fields from modal
app.post('/api/tasks/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const fields = req.body || {};

    // Load current task for diff/notification
    const before = await TaskModel.getTaskWithCcInfo(taskId);
    if (!before) return res.status(404).json({ error: 'task not found' });

    const updated = await TaskModel.updateTaskFields(taskId, fields);
    if (!updated) {
      return res.status(400).json({ error: 'No fields changed' });
    }

    const after = await TaskModel.getTaskWithCcInfo(taskId);

    // Prepare notification in the desired format
    const changes = [];
    const actor = fields.by_tg_id ? await UserModel.getUserByTelegramId(parseInt(fields.by_tg_id,10)) : null;
    function fmt(d){ if(!d) return null; const date = new Date(d); return date.toLocaleDateString('en-GB', { day:'2-digit', month:'short' }); }
    const beforeDue = fmt(before.due_date);
    const afterDue = fmt(after.due_date);
    let message = `✏️ Task updated\n\n🗒️ ${after.description}`;
    if (fields.due_date && beforeDue && afterDue) {
      const deltaDays = Math.round((new Date(after.due_date) - new Date(before.due_date)) / (1000*60*60*24));
      const sign = deltaDays >= 0 ? `+${deltaDays}` : `${deltaDays}`;
      message += `\n📅 Due date: ${beforeDue} → ${afterDue} (${sign} days)`;
    }
    if (fields.status && fields.status !== before.status) {
      message += `\n• Status: ${before.status || 'N/A'} → ${fields.status}`;
    }
    // Priority change summary
    if (Object.prototype.hasOwnProperty.call(fields, 'priority') && (before.priority || '') !== (fields.priority || '')) {
      message += `\n• Priority: ${before.priority || 'None'} → ${fields.priority || 'None'}`;
    }
    // Project change summary
    if (Object.prototype.hasOwnProperty.call(fields, 'project_id') && (before.project_id || null) !== (after.project_id || null)) {
      try {
        const ProjectModel = require('./src/models/projectModel');
        const beforeProject = before.project_id ? await ProjectModel.getProjectById(before.project_id) : null;
        const afterProject = after.project_id ? await ProjectModel.getProjectById(after.project_id) : null;
        const beforeName = beforeProject ? beforeProject.name : 'None';
        const afterName = afterProject ? afterProject.name : 'None';
        message += `\n• Project: ${beforeName} → ${afterName}`;
      } catch (_) {
        // Fallback to ids if names cannot be resolved
        message += `\n• Project: ${before.project_id || 'None'} → ${after.project_id || 'None'}`;
      }
    }
    if (actor) message += ` • by ${actor.first_name || actor.username || 'Manager'}`;

    // Notify assigned employee
    if (message) {
      try {
        const employee = await UserModel.getUserById(after.employee_id);
        if (employee?.telegram_id) {
          await sendNotification(global.__telegramInstance, employee.telegram_id, message);
        }
      } catch (e) {
        logger.warn('Failed to send update notification:', e.message);
      }
    }

    // Special notification for task completion to CC users
    if (fields.status === 'completed' && before.status !== 'completed') {
      try {
        const employee = await UserModel.getUserById(after.employee_id);
        const employeeName = employee ? `${employee.first_name || employee.username || 'Employee'}` : 'Unknown';
        
        // Notify CC users about completion
        if (after.ccUsers && after.ccUsers.length > 0) {
          for (const ccUser of after.ccUsers) {
            if (ccUser.telegram_id && ccUser.telegram_id !== after.employee_id) {
              const completionMsg = `✅ Task completed (you were CC'd)\n\n🗒️ ${after.description}\n👤 Completed by: ${employeeName}\n📅 Due: ${afterDue || 'N/A'}`;
              await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, ccUser.telegram_id, completionMsg);
            }
          }
        }
        
        // Also notify the assignee about completion
        if (employee?.telegram_id) {
          const assigneeMsg = `✅ Task completed\n\n🗒️ ${after.description}\n📅 Due: ${afterDue || 'N/A'}`;
          await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, employee.telegram_id, assigneeMsg);
        }
      } catch (e) {
        logger.warn('Failed to send completion notification:', e.message);
      }
    }

    // Notify CC users about task update
    if (after?.ccUsers && after.ccUsers.length > 0) {
      try {
        for (const ccUser of after.ccUsers) {
          if (ccUser.telegram_id && ccUser.telegram_id !== after.employee_id) {
            const ccMessage = `📋 Task updated (you're CC'd)\n\n🗒️ ${after.description}\n📅 Due: ${afterDue || 'N/A'}\n• Status: ${after.status}`;
            await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, ccUser.telegram_id, ccMessage);
          }
        }
      } catch (e) {
        logger.warn('Failed to send CC update notification:', e.message);
      }
    }

    res.json({ success: true, task: after });
  } catch (error) {
    logger.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// API endpoint to fetch employees for the Mini App filter
app.get('/api/employees', async (req, res) => {
  try {
    // Fetch all users with roles 1 (Manager) or 2 (Employee)
    const employees = await UserModel.getUsersByRoles([1, 2]); // Assuming a method like getUsersByRoles exists or can be created
    res.json(employees);
  } catch (error) {
    logger.error('Error fetching employees data:', error);
    res.status(500).json({ error: 'Failed to fetch employees data' });
  }
});

// API: team members visible to the viewer (scoped by tg_id)
app.get('/api/team', async (req, res) => {
  try {
    const { tg_id } = req.query;
    let team = [];
    if (!tg_id) return res.json(team);

    const viewer = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
    if (!viewer) return res.json(team);

    if (await UserModel.isManager(viewer.telegram_id)) {
      team = await UserModel.getEmployeesByManagerId(viewer.id);
    } else if (await UserModel.isAdmin(viewer.telegram_id)) {
      team = await UserModel.getAllEmployees();
    } else {
      const self = await UserModel.getUserById(viewer.id);
      if (self) team = [self];
    }

    // Normalize to id and displayName
    team = (team || []).map(u => ({ id: u.id, name: u.first_name || u.username || `Employee ${u.id}` }));
    res.json(team);
  } catch (error) {
    logger.error('Error fetching team:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// API: list active projects (for edit modal)
app.get('/api/projects', async (req, res) => {
  try {
    const { tg_id } = req.query;
    let projects = await ProjectModel.getActiveProjects();
    if (tg_id) {
      const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
      if (user) {
        if (await UserModel.isManager(user.telegram_id)) {
          projects = (projects || []).filter(p => p.manager_id === user.id);
        } else if (!(await UserModel.isAdmin(user.telegram_id))) {
          // employees: no explicit project visibility requested; return empty list
          projects = [];
        }
      }
    }
    res.json(projects || []);
  } catch (error) {
    logger.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Auto-assign tasks from "No Person" to employees with least tasks
app.post('/api/automate-tasks', async (req, res) => {
  try {
    const { by_tg_id } = req.body || {};
    
    // Get the user who triggered the automation (for authorization)
    let actorUser = null;
    if (by_tg_id) {
      actorUser = await UserModel.getUserByTelegramId(parseInt(by_tg_id, 10));
      if (!actorUser) {
        return res.status(401).json({ error: 'User not found' });
      }
      
      // Only managers and admins can trigger automation
      if (!(await UserModel.isManager(actorUser.telegram_id))) {
        return res.status(403).json({ error: 'Only managers and admins can automate tasks' });
      }
    }

    // Get employees based on the actor's role and scope
    let employees = [];
    if (actorUser) {
      if (await UserModel.isAdmin(actorUser.telegram_id)) {
        // Admin can see all employees
        employees = await UserModel.getUsersByRole(2);
      } else if (await UserModel.isManager(actorUser.telegram_id)) {
        // Manager can only see their own employees
        employees = await UserModel.getEmployeesByManagerId(actorUser.id);
      } else {
        return res.status(403).json({ error: 'Only managers and admins can automate tasks' });
      }
    } else {
      // Fallback: if no actor, get all employees (for system-level automation)
      employees = await UserModel.getUsersByRole(2);
    }
    
    if (employees.length === 0) {
      return res.status(400).json({ error: 'No employees found under your management' });
    }

    // Get task counts for each employee
    const employeeTaskCounts = {};
    for (const employee of employees) {
      const tasks = await TaskModel.getTasksByEmployeeId(employee.id);
      // Only count pending tasks (not completed or overdue)
      const pendingTasks = tasks.filter(t => t.status === 'pending');
      employeeTaskCounts[employee.id] = {
        employee,
        taskCount: pendingTasks.length,
        tasks: pendingTasks
      };
    }

    // Get "No Person" user and their tasks
    const noPersonUser = await UserModel.getUserByName('no_person');
    if (!noPersonUser) {
      return res.status(400).json({ error: 'No Person user not found' });
    }

    const noPersonTasks = await TaskModel.getTasksByEmployeeId(noPersonUser.id);
    const pendingNoPersonTasks = noPersonTasks.filter(t => t.status === 'pending');

    // Check if automation should run (only if someone has 0 tasks)
    const hasZeroTasks = Object.values(employeeTaskCounts).some(emp => emp.taskCount === 0);
    if (!hasZeroTasks) {
      return res.status(400).json({ 
        error: 'Automation only works when at least one employee has no tasks',
        details: 'All employees currently have tasks assigned'
      });
    }

    if (pendingNoPersonTasks.length === 0) {
      return res.status(400).json({ 
        error: 'No pending tasks to redistribute',
        details: 'No Person has no pending tasks'
      });
    }

    // Find employee with least tasks
    const sortedEmployees = Object.values(employeeTaskCounts)
      .sort((a, b) => a.taskCount - b.taskCount);
    
    const targetEmployee = sortedEmployees[0];
    const actorId = actorUser ? actorUser.id : noPersonUser.id; // Fallback to no_person if no actor

    // Redistribute tasks
    const redistributedTasks = [];
    for (const task of pendingNoPersonTasks) {
      try {
        await TaskModel.updateTaskAssignee(task.id, targetEmployee.employee.id, actorId);
        redistributedTasks.push({
          taskId: task.id,
          description: task.description,
          from: 'No Person',
          to: targetEmployee.employee.first_name || targetEmployee.employee.username || `Employee ${targetEmployee.employee.id}`
        });

        // Send notification to the new assignee
        const assignee = await UserModel.getUserById(targetEmployee.employee.id);
        if (assignee?.telegram_id) {
          const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : 'N/A';
          const dueText = fmt(task.due_date);
          const byText = actorUser ? ` • by ${actorUser.first_name || actorUser.username || 'Manager'}` : '';
          const msg = `🤖 Auto-assigned task\n\n🗒️ ${task.description}\n📅 Due: ${dueText}${byText}`;
          await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, assignee.telegram_id, msg);
        }
      } catch (error) {
        logger.error(`Failed to redistribute task ${task.id}:`, error);
      }
    }

    const managerScope = actorUser ? 
      (await UserModel.isAdmin(actorUser.telegram_id) ? 'all employees' : 'your team') : 
      'all employees';
    
    logger.info(`Automated task redistribution: ${redistributedTasks.length} tasks moved from No Person to ${targetEmployee.employee.first_name || targetEmployee.employee.username} (scope: ${managerScope})`);

    res.json({ 
      success: true, 
      message: `Successfully redistributed ${redistributedTasks.length} tasks within ${managerScope}`,
      details: {
        from: 'No Person',
        to: targetEmployee.employee.first_name || targetEmployee.employee.username || `Employee ${targetEmployee.employee.id}`,
        taskCount: redistributedTasks.length,
        scope: managerScope,
        tasks: redistributedTasks
      }
    });

  } catch (error) {
    logger.error('Error in automate tasks:', error);
    res.status(500).json({ error: 'Failed to automate tasks' });
  }
});

// Update task CC
app.post('/api/tasks/:id/cc', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const { cc_user_ids, tg_id } = req.body;
    
    if (!tg_id) {
      return res.status(400).json({ error: 'Telegram ID is required' });
    }

    const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only managers and admins can update CC
    if (!(await UserModel.isManager(user.telegram_id))) {
      return res.status(403).json({ error: 'Only managers and admins can update CC' });
    }

    // Check if task exists and user has permission
    const task = await TaskModel.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update CC users
    await TaskModel.updateTaskCc(taskId, cc_user_ids || [], user.id);

    // Get updated task with CC info
    const updatedTask = await TaskModel.getTaskWithCcInfo(taskId);

    // Notify newly added CC users
    if (cc_user_ids && cc_user_ids.length > 0) {
      try {
        const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : 'N/A';
        const dueText = fmt(task.due_date);
        const assignee = await UserModel.getUserById(task.employee_id);
        const assigneeName = assignee ? `${assignee.first_name || assignee.username || 'Employee'}` : 'Unknown';
        
        for (const userId of cc_user_ids) {
          const ccUser = await UserModel.getUserById(userId);
          if (ccUser?.telegram_id) {
            const msg = `📋 You've been CC'd on a task\n\n🗒️ ${task.description}\n👤 Assigned to: ${assigneeName}\n📅 Due: ${dueText}`;
            await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, ccUser.telegram_id, msg);
          }
        }
      } catch (e) {
        logger.warn('Failed to send CC notification:', e.message);
      }
    }

    res.json({ success: true, task: updatedTask });
  } catch (error) {
    logger.error('Error updating task CC:', error);
    res.status(500).json({ error: 'Failed to update task CC' });
  }
});

// Notes API endpoints

// Get all notes for a manager
app.get('/api/notes', async (req, res) => {
  try {
    const { tg_id } = req.query;
    
    if (!tg_id) {
      return res.status(400).json({ error: 'Telegram ID is required' });
    }

    const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let managerIdForNotes = null;
    let canCreate = false;
    let canManage = false;

    if (await UserModel.isAdmin(user.telegram_id)) {
      // Admin: allow managing own notes; show their notes by default
      managerIdForNotes = user.id;
      canCreate = true;
      canManage = true;
    } else if (await UserModel.isManager(user.telegram_id)) {
      // Manager: can see and manage their own notes
      managerIdForNotes = user.id;
      canCreate = true;
      canManage = true;
    } else {
      // Employee: can view notes authored by their manager
      managerIdForNotes = user.manager_id || null;
      canCreate = false;
      canManage = false;
      if (!managerIdForNotes) {
        return res.json({ notes: [], meta: { canCreate, canManage } });
      }
    }

    const notes = await NoteModel.getNotesByManagerId(managerIdForNotes);
    res.json({ notes, meta: { canCreate, canManage } });
  } catch (error) {
    logger.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Create a new note
app.post('/api/notes', async (req, res) => {
  try {
    const { title, description, is_pinned, tg_id } = req.body;
    
    if (!tg_id) {
      return res.status(400).json({ error: 'Telegram ID is required' });
    }

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only managers and admins can create notes
    if (!(await UserModel.isManager(user.telegram_id))) {
      return res.status(403).json({ error: 'Only managers and admins can create notes' });
    }

    const note = await NoteModel.createNote(title, description, user.id, is_pinned || false);

    // Notify all employees under this manager
    try {
      const team = await UserModel.getEmployeesByManagerId(user.id);
      const employees = Array.isArray(team) ? team : [];
      const safeTitle = title || 'New note';
      const safeDesc = description || '';
      for (const emp of employees) {
        if (emp && emp.telegram_id) {
          const msg = `📝 New note from your manager\n\n• ${safeTitle}\n\n${safeDesc}`;
          await sendNotification(global.__telegramInstance || { sendMessage: () => {} }, emp.telegram_id, msg);
        }
      }
    } catch (e) {
      logger.warn('Failed to notify team about new note:', e.message);
    }

    res.json(note);
  } catch (error) {
    logger.error('Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update a note
app.put('/api/notes/:id', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    const { title, description, is_pinned, tg_id } = req.body;
    
    if (!tg_id) {
      return res.status(400).json({ error: 'Telegram ID is required' });
    }

    const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only managers and admins can update notes
    if (!(await UserModel.isManager(user.telegram_id))) {
      return res.status(403).json({ error: 'Only managers and admins can update notes' });
    }

    // Check if the note exists and belongs to this manager
    const existingNote = await NoteModel.getNoteById(noteId, user.id);
    if (!existingNote) {
      return res.status(404).json({ error: 'Note not found or access denied' });
    }

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (is_pinned !== undefined) updates.is_pinned = is_pinned;

    const success = await NoteModel.updateNote(noteId, user.id, updates);
    if (!success) {
      return res.status(500).json({ error: 'Failed to update note' });
    }

    const updatedNote = await NoteModel.getNoteById(noteId, user.id);
    res.json(updatedNote);
  } catch (error) {
    logger.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete a note
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    const { tg_id } = req.query;
    
    if (!tg_id) {
      return res.status(400).json({ error: 'Telegram ID is required' });
    }

    const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only managers and admins can delete notes
    if (!(await UserModel.isManager(user.telegram_id))) {
      return res.status(403).json({ error: 'Only managers and admins can delete notes' });
    }

    // Check if the note exists and belongs to this manager
    const note = await NoteModel.getNoteById(noteId, user.id);
    if (!note) {
      return res.status(404).json({ error: 'Note not found or access denied' });
    }

    const success = await NoteModel.deleteNote(noteId, user.id);
    if (!success) {
      return res.status(500).json({ error: 'Failed to delete note' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Toggle pin status of a note
app.patch('/api/notes/:id/toggle-pin', async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    const { tg_id } = req.body;
    
    if (!tg_id) {
      return res.status(400).json({ error: 'Telegram ID is required' });
    }

    const user = await UserModel.getUserByTelegramId(parseInt(tg_id, 10));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only managers and admins can toggle pin status
    if (!(await UserModel.isManager(user.telegram_id))) {
      return res.status(403).json({ error: 'Only managers and admins can toggle pin status' });
    }

    // Check if the note exists and belongs to this manager
    const existingNote = await NoteModel.getNoteById(noteId, user.id);
    if (!existingNote) {
      return res.status(404).json({ error: 'Note not found or access denied' });
    }

    const success = await NoteModel.togglePin(noteId, user.id);
    if (!success) {
      return res.status(500).json({ error: 'Failed to toggle pin status' });
    }

    const updatedNote = await NoteModel.getNoteById(noteId, user.id);
    res.json(updatedNote);
  } catch (error) {
    logger.error('Error toggling pin status:', error);
    res.status(500).json({ error: 'Failed to toggle pin status' });
  }
});

// Initialize the bot
const bot = new Telegraf(config.telegramToken);
global.__telegramInstance = bot.telegram;

// Set up session and scene management
const stage = new Scenes.Stage([]);
bot.use(session());
bot.use(stage.middleware());

async function startServer() {
  try {
    // Initialize database connection
    await initializeDatabase();
    logger.info('Database connection established');
    
    // Set up webhook if in production mode
    if (process.env.NODE_ENV === 'production' && config.webhookUrl) {
      await setupWebhook(bot, app, config.webhookUrl);
      logger.info(`Webhook set up at ${config.webhookUrl}`);
    }
    
    // Register all scenes (workflows)
    setupScenes(stage);
    
    // Register bot commands
    registerCommands(bot);
    
    // Schedule all reminders
    scheduleAllReminders(bot);
    
    // Start Express server
    app.listen(config.port, () => {
      logger.info(`Express server is running on port ${config.port}`);
    });
    
    // Start the bot (polling mode if not using webhooks)
    if (process.env.NODE_ENV !== 'production' || !config.webhookUrl) {
      bot.launch();
      logger.info('Bot started in polling mode');
    }
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    
    logger.info('Task management bot is running');
  } catch (error) {
    logger.error('Failed to start the server:', error);
    process.exit(1);
  }
}
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});
startServer();
