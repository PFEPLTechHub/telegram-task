// src/models/taskModel.js
const { query } = require("../database/db");
const logger = require("../utils/logger");

class TaskModel {
  // Create a new task
  static async createTask(
    employeeName,
    taskDescription,
    dueDate,
    assignedBy,
    priority = null,
    projectId = null,
    ccUserIds = []
  ) {
    try {
      // Handle "No Person" case
      let employee = null;
      if (employeeName === 'No Person') {
        // Ensure a special user exists to satisfy FK constraint
        const existing = await query(
          "SELECT id FROM users WHERE id = 0 LIMIT 1"
        );
        if (!existing || existing.length === 0) {
          // Insert a placeholder user with id=0 if allowed by schema; otherwise create a distinct user and use its id
          try {
            await query("INSERT IGNORE INTO users (id, telegram_id, username, first_name, last_name, role, status) VALUES (0, NULL, 'no_person', 'No', 'Person', 2, 'active')");
          } catch (e) {
            // Fallback: create a row without setting id explicitly
            const res = await query(
              "INSERT INTO users (telegram_id, username, first_name, last_name, role, status) VALUES (NULL, 'no_person', 'No', 'Person', 2, 'active')"
            );
            employee = [{ id: res.insertId, role: 2 }];
          }
        }
        if (!employee) {
          employee = await query("SELECT id, role FROM users WHERE username = 'no_person' LIMIT 1");
        }
        if (!employee || employee.length === 0) {
          // ultimate fallback
          employee = [{ id: 0, role: 2 }];
        }
      } else {
        // First get employee ID by name
        employee = await query(
          "SELECT id, role FROM users WHERE first_name = ? OR username = ? LIMIT 1",
          [employeeName, employeeName]
        );

        if (!employee || employee.length === 0) {
          throw new Error(`Employee "${employeeName}" not found`);
        }
      }

      // Get the assigner's role and ID
      const assigner = await query(
        "SELECT id, role FROM users WHERE id = ?",
        [assignedBy]
      );

      if (!assigner || assigner.length === 0) {
        throw new Error("Assigner not found");
      }

      // Determine initial status based on roles
      let initialStatus = 'pending_approval';  // Default for employee self-assigned tasks

      // Cases where task should be created directly with 'pending' status:
      if (
        // Admin can assign directly to anyone
        assigner[0].role === 0 || 
        // Manager can assign directly to employees
        (assigner[0].role === 1 && employee[0].role === 2) ||
        // Manager self-assigning task
        (assigner[0].role === 1 && assigner[0].id === employee[0].id)
      ) {
        initialStatus = 'pending';  // Direct assignment, no approval needed
      }

      // Insert the task with determined status
      const result = await query(
        `INSERT INTO tasks (description, employee_id, assigned_by, due_date, status, priority, project_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [taskDescription, employee[0].id, assignedBy, dueDate, initialStatus, priority, projectId]
      );

      // Create reminders for the new task
      const taskId = result.insertId;
      await this.createReminders(taskId);

      // Add CC users if provided
      if (ccUserIds && ccUserIds.length > 0) {
        await this.addCcUsers(taskId, ccUserIds, assignedBy);
      }

      return {
        id: taskId,
        description: taskDescription,
        employeeId: employee[0].id,
        employeeName: employeeName,
        dueDate: dueDate,
        status: initialStatus,
        employeeRole: employee[0].role,
        assignerRole: assigner[0].role,
        isSelfAssigned: assigner[0].id === employee[0].id,
        priority,
        ccUserIds
      };
    } catch (error) {
      logger.error("Error creating task:", error);
      throw error;
    }
  }

  static async getTasksByMultipleEmployeeIds(employeeIds) {
    try {
      if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
        return [];
      }

      // Get the user IDs from telegram_ids
      const placeholders = employeeIds.map(() => '?').join(',');
      const userQuery = `
        SELECT id FROM users 
        WHERE telegram_id IN (${placeholders})
      `;
      
      const userResults = await query(userQuery, employeeIds);
      
      if (!userResults || userResults.length === 0) {
        return [];
      }
      
      // Extract user IDs
      const userIds = userResults.map(user => user.id);
      
      // Now get tasks for these user IDs
      const taskPlaceholders = userIds.map(() => '?').join(',');
      const taskQuery = `
        SELECT tasks.*, 
               u1.first_name AS employee_name,
               u1.last_name AS employee_last_name,
               u2.first_name AS assigned_by_name,
               u2.last_name AS assigned_by_last_name
        FROM tasks
        LEFT JOIN users u1 ON tasks.employee_id = u1.id
        LEFT JOIN users u2 ON tasks.assigned_by = u2.id
        WHERE tasks.employee_id IN (${taskPlaceholders})
        ORDER BY tasks.created_at DESC
      `;
      
      const tasks = await query(taskQuery, userIds);
      
      return tasks.map(task => ({
        ...task,
        employee_name: `${task.employee_name || ''} ${task.employee_last_name || ''}`.trim(),
        assigned_by_name: `${task.assigned_by_name || ''} ${task.assigned_by_last_name || ''}`.trim()
      }));
    } catch (error) {
      logger.error("Error in getTasksByMultipleEmployeeIds:", error);
      throw error;
    }
  }
static async getTasksByDateRange(dateFrom, dateTo, options = {}) {
  try {
    const { employeeId, status, dateField = 'created_at' } = options;
    
    // Build the base query with JOINs to get employee information
    let sql = `
      SELECT 
        t.id,
        t.description,
        t.employee_id,
        t.assigned_by,
        t.due_date,
        t.status,
        t.created_at,
        t.updated_at,
        COALESCE(u.first_name, u.username, 'Unknown') as employee_name,
        COALESCE(assigner.first_name, assigner.username, 'System') as assigned_by_name
      FROM tasks t
      LEFT JOIN users u ON t.employee_id = u.id
      LEFT JOIN users assigner ON t.assigned_by = assigner.telegram_id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add date range filtering
    if (dateFrom) {
      sql += ` AND DATE(t.${dateField}) >= DATE(?)`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      sql += ` AND DATE(t.${dateField}) <= DATE(?)`;
      params.push(dateTo);
    }
    
    // Add employee filtering
    if (employeeId) {
      sql += ` AND t.employee_id = ?`;
      params.push(employeeId);
    }
    
    // Add status filtering
    if (status && status !== 'all') {
      if (status === 'overdue') {
        // Special handling for overdue tasks
        sql += ` AND t.status = 'pending' AND t.due_date < NOW()`;
      } else {
        sql += ` AND t.status = ?`;
        params.push(status);
      }
    }
    
    // Order by creation date (newest first) by default
    sql += ` ORDER BY t.created_at DESC`;
    
    logger.info(`Executing getTasksByDateRange query: ${sql}`, { params });
    
    const tasks = await query(sql, params);
    
    logger.info(`Found ${tasks.length} tasks in date range`, {
      dateFrom,
      dateTo,
      dateField,
      employeeId,
      status
    });
    
    return tasks;
    
  } catch (error) {
    logger.error("Error getting tasks by date range:", error);
    throw error;
  }
}
  static async getEmployeesByManagerId(managerId) {
    try {
      const employees = await query(
        `SELECT * FROM users WHERE manager_id = ?`,
        [managerId]
      );
      return employees;
    } catch (error) {
      logger.error("Error in getEmployeesByManagerId:", error);
      throw error;
    }
  }

static async getTasksByEmployeeId(employeeId) {
  try {
    const tasks = await query(
      `SELECT 
         id, 
         description, 
         employee_id, 
         assigned_by, 
         due_date, 
         status, 
         completed_at, 
         created_at, 
         updated_at, 
         approved_by 
       FROM tasks 
       WHERE employee_id = ? 
       ORDER BY due_date ASC`,
      [employeeId]
    );

    return tasks;
  } catch (error) {
    logger.error("Error fetching tasks by employee ID:", error);
    throw error;
  }
}
  // Create reminders for a task
  static async createReminders(taskId) {
    const reminderTypes = [
      "0",
      "1",
      "2",
      "3",
      "4",
    ];

    const values = reminderTypes.map((type) => [taskId, type]);

    const placeholders = values.map(() => "(?, ?)").join(", ");
    const flattened = values.flat();

    const sql = `INSERT INTO reminders (task_id, reminder_type) VALUES ${placeholders}`;
    await query(sql, flattened);

    return true;
  }
  static async getTasksByStatus(status) {
    try {
      const rows = await query(
        `SELECT 
  t.*, 
  u.first_name AS employee_first_name, 
  u.last_name AS employee_last_name, 
  u.username AS employee_username
FROM tasks t
JOIN users u ON t.employee_id = u.id
WHERE t.status = 'pending_approval'
ORDER BY t.due_date ASC;
`,
        [status]
      );
      return rows;
    } catch (error) {
      logger.error("Error in getTasksByStatus:", error);
      throw error;
    }
  }
  // Get all tasks (for managers)
  static async getAllTasks(filter = {}) {
    let sql = `
      SELECT t.id, t.description, t.due_date, t.status, t.completed_at, 
             u.first_name AS employee_name, u.username AS employee_username,
             a.first_name AS assigned_by_name
      FROM tasks t
      JOIN users u ON t.employee_id = u.id
      JOIN users a ON t.assigned_by = a.id
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

    sql += " ORDER BY t.due_date ASC";

    return await query(sql, params);
  }


  
  // Get tasks by employee
  static async getTasksByEmployee(employeeId) {
    return await query(
      `SELECT t.id, t.description, t.due_date, t.status
       FROM tasks t
       WHERE t.employee_id = ?
       ORDER BY t.due_date ASC`,
      [employeeId]
    );
  }
  
  // Mark task as complete
  static async completeTask(employeeName, taskName) {
  try {
    // First get employee ID by name
    const employee = await query(
      "SELECT id FROM users WHERE first_name = ? OR username = ? LIMIT 1",
      [employeeName, employeeName]
    );

    if (!employee || employee.length === 0) {
      throw new Error(`Employee "${employeeName}" not found`);
    }

    // Find the task
    const tasks = await query(
      'SELECT id, is_active FROM tasks WHERE description = ? AND employee_id = ? AND status != "completed" LIMIT 1',
      [taskName, employee[0].id]
    );

    if (!tasks || tasks.length === 0) {
      throw new Error(
        `Task "${taskName}" not found for employee "${employeeName}" or already completed`
      );
    }

    // Update the task status to "completed" and set is_active to 0
    await query(
      'UPDATE tasks SET status = "completed", completed_at = NOW(), is_active = 0 WHERE id = ?',
      [tasks[0].id]
    );

    return true;
  } catch (error) {
    logger.error("Error completing task:", error);
    throw error;
  }
}

// Get tasks for reminders
static async getTasksForReminder(reminderType) {
  let sql,
    params = [];
  const now = new Date();

  switch (reminderType) {
    case 0: // tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStart = new Date(tomorrow.setHours(0, 0, 0, 0));
      const tomorrowEnd = new Date(tomorrow.setHours(23, 59, 59, 999));

      sql = `
        SELECT t.id, t.description, t.due_date, u.telegram_id, 
               u.first_name AS employee_name, r.id AS reminder_id
        FROM tasks t
        JOIN users u ON t.employee_id = u.id
        JOIN reminders r ON r.task_id = t.id
        WHERE t.status = 'pending'
        AND t.due_date BETWEEN ? AND ?
        AND r.reminder_type = ?
        AND r.is_sent = FALSE
      `;
      params = [tomorrowStart, tomorrowEnd, reminderType];
      break;

    case 1: // today1h
    case 2: // today4h
      const todayStart = new Date(now.setHours(0, 0, 0, 0));
      const todayEnd = new Date(now.setHours(23, 59, 59, 999));

      sql = `
        SELECT t.id, t.description, t.due_date, u.telegram_id, 
               u.first_name AS employee_name, r.id AS reminder_id
        FROM tasks t
        JOIN users u ON t.employee_id = u.id
        JOIN reminders r ON r.task_id = t.id
        WHERE t.status = 'pending'
        AND t.due_date BETWEEN ? AND ?
        AND r.reminder_type = ?
        AND r.is_sent = FALSE
      `;
      params = [todayStart, todayEnd, reminderType];
      break;

    case 3: // overdue1
    case 4: // overdue2
      sql = `
        SELECT t.id, t.description, t.due_date, u.telegram_id, 
               u.first_name AS employee_name, r.id AS reminder_id
        FROM tasks t
        JOIN users u ON t.employee_id = u.id
        JOIN reminders r ON r.task_id = t.id
        WHERE (t.status = 'pending' OR t.status = 'overdue')
        AND t.due_date < NOW()
        AND r.reminder_type = ?
        AND r.is_sent = FALSE
      `;
      params = [reminderType];
      break;

    default:
      throw new Error(`Unknown reminder type: ${reminderType}`);
  }

  return await query(sql, params);
}

// Mark reminder as sent
static async markReminderSent(reminderId) {
  await query(
    "UPDATE reminders SET is_sent = TRUE, sent_at = NOW() WHERE id = ?",
    [reminderId]
  );
  return true;
}

// Update overdue tasks status
static async updateOverdueTasks() {
  await query(
    `UPDATE tasks 
     SET status = 'overdue' 
     WHERE due_date < NOW() 
     AND status = 'pending'`
  );
  return true;
}

// Update task status
  static async updateTaskStatus(taskId, status) {
    try {
  let sql, params;

      switch (status) {
        case "completed":
          // When task is completed, set completed_at and make inactive
          sql = "UPDATE tasks SET status = ?, completed_at = NOW(), is_active = 0, updated_at = NOW() WHERE id = ?";
          params = [status, taskId];
          break;

        case "pending":
          // When task is approved, set to pending and keep active
          sql = "UPDATE tasks SET status = ?, is_active = 1, updated_at = NOW() WHERE id = ?";
          params = [status, taskId];
          break;

        case "rejected":
          // When task is rejected, set to rejected and make inactive
          sql = "UPDATE tasks SET status = ?, is_active = 0, updated_at = NOW() WHERE id = ?";
          params = [status, taskId];
          break;

        default:
          // For any other status updates
          sql = "UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?";
    params = [status, taskId];
  }

  await query(sql, params);
      logger.info(`Updated task ${taskId} status to ${status}`);
  return true;
    } catch (error) {
      logger.error(`Error updating task status: ${error.message}`);
      throw error;
    }
}

// Get task by ID
  static async getTaskById(taskId) {
    const tasks = await query(
      `SELECT 
          t.id, t.description, t.due_date, t.status, t.employee_id, t.project_id,
          u.first_name AS employee_name, u.telegram_id AS employee_telegram_id,
          a.first_name AS assigned_by_name,
          p.name AS project_name
       FROM tasks t
       JOIN users u ON t.employee_id = u.id
       JOIN users a ON t.assigned_by = a.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.id = ?
       LIMIT 1`,
      [taskId]
    );

    return tasks.length > 0 ? tasks[0] : null;
  }

  static async updateTaskAssignee(taskId, newEmployeeId, assignedByUserId) {
    try {
      await query(
        `UPDATE tasks 
         SET employee_id = ?, assigned_by = ?, status = 'pending', updated_at = NOW()
         WHERE id = ?`,
        [newEmployeeId, assignedByUserId, taskId]
      );
      return true;
    } catch (error) {
      logger.error(`Error updating task assignee: ${error.message}`);
      throw error;
    }
  }

  static async updateTaskFields(taskId, fields) {
    try {
      const allowed = ['description', 'status', 'due_date', 'priority', 'project_id'];
      const sets = [];
      const params = [];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          sets.push(`${key} = ?`);
          params.push(fields[key]);
        }
      }
      if (sets.length === 0) return false;
      const sql = `UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`;
      params.push(taskId);
      const result = await query(sql, params);
      return result && (result.affectedRows > 0 || result.changedRows > 0);
    } catch (error) {
      logger.error(`Error updating task fields: ${error.message}`);
      throw error;
    }
  }

  static async getTaskWithManagerInfo(taskId) {
    try {
      const queryStr = `
        SELECT 
          t.*,
          e.telegram_id AS employee_telegram_id,
          e.first_name AS employee_first_name,
          e.last_name AS employee_last_name,
          e.username AS employee_username,
          m.telegram_id AS manager_telegram_id,
          m.first_name AS manager_first_name,
          m.last_name AS manager_last_name
        FROM tasks t
        JOIN users e ON t.employee_id = e.id
        LEFT JOIN users m ON e.manager_id = m.id
        WHERE t.id = ?
      `;

      const tasks = await query(queryStr, [taskId]);
      
      if (tasks.length === 0) {
        logger.warn(`No task found with ID: ${taskId}`);
        return null;
      }

      // Format the result
      const task = tasks[0];
      task.employee_name = `${task.employee_first_name || ''} ${task.employee_last_name || ''}`.trim() || task.employee_username;
      task.manager_name = `${task.manager_first_name || ''} ${task.manager_last_name || ''}`.trim();

      // Log for debugging
      logger.debug(`Task data retrieved: ${JSON.stringify(task, null, 2)}`);
      
      return task;
    } catch (error) {
      logger.error(`Error in getTaskWithManagerInfo: ${error.message}`);
      throw error;
    }
  }
// Get pending approval tasks
  static async getTasksAwaitingApproval() {
    return await query(
      `SELECT t.id, t.description, t.due_date, t.status, t.employee_id,
            u.first_name AS employee_name, u.telegram_id AS employee_telegram_id
     FROM tasks t
     JOIN users u ON t.employee_id = u.id
     WHERE t.status = 'pending_approval'
     ORDER BY t.due_date ASC`
    );
  }

  // Update getTaskWithManagerInfo to include project information
  static async getTaskWithManagerInfo(taskId) {
    logger.debug(`Getting task with manager info for task ID: ${taskId}`);
    
    try {
      const tasks = await query(
        `SELECT t.id, t.description, t.due_date, t.status, t.employee_id, t.project_id,
            u.first_name AS employee_name, u.telegram_id AS employee_telegram_id,
            a.first_name AS assigned_by_name, a.telegram_id AS manager_telegram_id,
            p.name AS project_name
        FROM tasks t
        JOIN users u ON t.employee_id = u.id
        JOIN users a ON t.assigned_by = a.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE t.id = ?
        LIMIT 1`,
        [taskId]
      );
  
      if (tasks.length === 0) {
        logger.warn(`No task found with ID: ${taskId}`);
        return null;
      }
      
      // Log the result for debugging
      logger.debug(`Task data retrieved: ${JSON.stringify(tasks[0], null, 2)}`);
      
      // Specific check for employee telegram ID
      if (!tasks[0].employee_telegram_id) {
        logger.warn(`Task ${taskId} has no employee_telegram_id despite having employee_id: ${tasks[0].employee_id}`);
      }
      
      return tasks[0];
    } catch (error) {
      logger.error(`Error in getTaskWithManagerInfo: ${error.message}`);
      throw error;
    }
  }

  static async getAllTasks(filter = {}) {
    try {
      let queryStr = `
      SELECT 
        t.*,
        u.username AS employee_username,
        CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
        p.name AS project_name
      FROM tasks t
      LEFT JOIN users u ON t.employee_id = u.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE 1=1
    `;

      const params = [];

      if (filter.status) {
        queryStr += " AND t.status = ?";
        params.push(filter.status);
      }

      if (filter.employeeId) {
        queryStr += " AND t.employee_id = ?";
        params.push(filter.employeeId);
      }

      if (filter.managerId) {
        // Only tasks for employees under this manager
        queryStr += " AND u.manager_id = ?";
        params.push(filter.managerId);
      }

      if (filter.hasProject) {
        queryStr += " AND t.project_id IS NOT NULL";
      }

      queryStr += " ORDER BY t.due_date ASC";

      const tasks = await query(queryStr, params);
      return tasks;
    } catch (error) {
      logger.error("Error retrieving all tasks:", error);
      throw error;
    }
  }
  static async getTaskById(taskId) {
    try {
      const queryStr = `
        SELECT *, completion_reply FROM tasks
        WHERE id = ?
      `;
  
      const task = await query(queryStr, [taskId]);
      return task && task.length > 0 ? task[0] : null;
    } catch (error) {
      logger.error("Error getting task by ID:", error);
      throw error;
    }
  }
  static async getTaskWithManagerInfo(taskId) {
    try {
      const queryStr = `
        SELECT 
          t.*,
          e.telegram_id AS employee_telegram_id,
          e.first_name AS employee_first_name,
          e.last_name AS employee_last_name,
          e.username AS employee_username,
          m.telegram_id AS manager_telegram_id,
          m.first_name AS manager_first_name,
          m.last_name AS manager_last_name
        FROM tasks t
        JOIN users e ON t.employee_id = e.id
        LEFT JOIN users m ON e.manager_id = m.id
        WHERE t.id = ?
      `;

      const tasks = await query(queryStr, [taskId]);
      
      if (tasks.length === 0) {
        logger.warn(`No task found with ID: ${taskId}`);
        return null;
      }

      // Format the result
      const task = tasks[0];
      task.employee_name = `${task.employee_first_name || ''} ${task.employee_last_name || ''}`.trim() || task.employee_username;
      task.manager_name = `${task.manager_first_name || ''} ${task.manager_last_name || ''}`.trim();

      // Log for debugging
      logger.debug(`Task data retrieved: ${JSON.stringify(task, null, 2)}`);
      
      return task;
    } catch (error) {
      logger.error(`Error in getTaskWithManagerInfo: ${error.message}`);
      throw error;
    }
  }
  static async addTaskComment(taskId, comment, userId) {
    try {
      const queryStr = `
        INSERT INTO task_comments (task_id, comment, user_id, created_at)
        VALUES (?, ?, ?, NOW())
      `;
  
      await query(queryStr, [taskId, comment, userId]);
      return true;
    } catch (error) {
      logger.error("Error adding task comment:", error);
      throw error;
    }
  }
  static async updateTaskStatusAndApprover(taskId, status, approverId, completionReply = null) {
    try {
      // Map 'rejected' status to 'pending_approval' but set is_active to 0
      const dbStatus = status === 'rejected' ? 'pending_approval' : status;
      const completedAt = status === 'completed' ? new Date() : null;
      const isActive = (status === 'completed' || status === 'rejected') ? 0 : 1;
      
      const queryStr = `
        UPDATE tasks 
        SET status = ?, approved_by = ?, completed_at = ?, is_active = ?, completion_reply = ?, updated_at = NOW()
        WHERE id = ?
      `;
    
      const result = await query(queryStr, [dbStatus, approverId, completedAt, isActive, completionReply, taskId]);
      return result;
    } catch (error) {
      logger.error("Error updating task status and approver:", error);
      throw error;
    }
  }
static async getAllTasksLast30Days() {
  try {
    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Format as YYYY-MM-DD HH:MM:SS for MySQL (or just date part is also fine)
    const formattedDate = thirtyDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

    // Use CONCAT for MySQL string concatenation
    const sql = `
      SELECT 
        t.*,
        CONCAT(u.first_name, ' ', u.last_name) AS employee_name
      FROM 
        tasks t
      LEFT JOIN 
        users u ON t.employee_id = u.id
      WHERE 
        t.created_at >= ?
      ORDER BY 
        t.created_at DESC
    `;

    const rows = await query(sql, [formattedDate]);
    return rows;
  } catch (error) {
    logger.error("Error fetching tasks from last 30 days:", error);
    throw error;
  }
  }

  static async getTasksSince(date) {
    try {
      // Ensure date is formatted properly
      const formattedDate = new Date(date).toISOString().slice(0, 19).replace('T', ' ');

      const sql = `
        SELECT 
          t.*, 
          CONCAT(u.first_name, ' ', u.last_name) AS employee_name
        FROM 
          tasks t
        LEFT JOIN 
          users u ON t.employee_id = u.id
        WHERE 
          t.created_at >= ?
        ORDER BY 
          t.due_date ASC
      `;

      const rows = await query(sql, [formattedDate]);
      return rows;
    } catch (error) {
      logger.error("Error fetching tasks since date:", error);
      throw error;
    }
  }

  static async getEmployeeTasksSince(employeeId, date) {
    try {
      const formattedDate = new Date(date).toISOString().slice(0, 19).replace('T', ' ');

      const sql = `
        SELECT 
          t.*, 
          CONCAT(u.first_name, ' ', u.last_name) AS employee_name
        FROM 
          tasks t
        LEFT JOIN 
          users u ON t.employee_id = u.id
        WHERE 
          t.employee_id = ? AND t.created_at >= ?
        ORDER BY 
          t.due_date ASC
      `;

      const rows = await query(sql, [employeeId, formattedDate]);
      return rows;
    } catch (error) {
      logger.error("Error fetching employee tasks since date:", error);
      throw error;
    }
  }

  // CC (Carbon Copy) related methods
  static async addCcUsers(taskId, userIds, addedBy) {
    try {
      if (!userIds || userIds.length === 0) return;
      
      const values = userIds.map(userId => [taskId, userId, addedBy]);
      const placeholders = values.map(() => '(?, ?, ?)').join(', ');
      const flattened = values.flat();
      
      const sql = `INSERT IGNORE INTO task_cc (task_id, user_id, added_by) VALUES ${placeholders}`;
      await query(sql, flattened);
      
      return true;
    } catch (error) {
      logger.error("Error adding CC users:", error);
      throw error;
    }
  }

  static async getCcUsers(taskId) {
    try {
      const ccUsers = await query(
        `SELECT tc.user_id, u.first_name, u.last_name, u.username, u.telegram_id
         FROM task_cc tc
         JOIN users u ON tc.user_id = u.id
         WHERE tc.task_id = ?`,
        [taskId]
      );
      
      return ccUsers;
    } catch (error) {
      logger.error("Error getting CC users:", error);
      throw error;
    }
  }

  static async removeCcUser(taskId, userId) {
    try {
      const result = await query(
        `DELETE FROM task_cc WHERE task_id = ? AND user_id = ?`,
        [taskId, userId]
      );
      
      return result.affectedRows > 0;
    } catch (error) {
      logger.error("Error removing CC user:", error);
      throw error;
    }
  }

  static async updateTaskCc(taskId, ccUserIds, updatedBy) {
    try {
      // Remove existing CC users
      await query(`DELETE FROM task_cc WHERE task_id = ?`, [taskId]);
      
      // Add new CC users
      if (ccUserIds && ccUserIds.length > 0) {
        await this.addCcUsers(taskId, ccUserIds, updatedBy);
      }
      
      return true;
    } catch (error) {
      logger.error("Error updating task CC:", error);
      throw error;
    }
  }

  static async getTaskWithCcInfo(taskId) {
    try {
      const task = await this.getTaskById(taskId);
      if (!task) return null;
      
      const ccUsers = await this.getCcUsers(taskId);
      task.ccUsers = ccUsers;
      
      return task;
    } catch (error) {
      logger.error("Error getting task with CC info:", error);
      throw error;
    }
  }
}

module.exports = TaskModel;
