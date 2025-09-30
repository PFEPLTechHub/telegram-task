const TaskModel = require('../models/taskModel');
const UserModel = require('../models/userModel');
const logger = require('./logger');

/**
 * Fetches and filters task data for the report.
 * @param {string} month - The month to filter by (optional, format YYYY-MM).
 * @param {number} employeeId - The employee ID to filter by (optional).
 * @param {string} status - The status to filter by ('pending', 'completed', 'overdue', 'all') (optional).
 * @returns {Array} - An array of task objects.
 */
async function fetchTasksReportData(month, employeeId, status) {
  try {
    // Fetch all tasks.
    // In a real-world app, consider adding filtering to the SQL query for performance.
    const allTasks = await TaskModel.getAllTasks();

    let filteredTasks = allTasks.filter(task => {
      let include = true;
      const now = new Date();
      const dueDateObj = task.due_date ? new Date(task.due_date) : null;

      // Filter by month
      if (month) {
        // Assuming task.created_at is available and in a parseable date format
        const taskMonth = new Date(task.created_at).toISOString().substring(0, 7); // YYYY-MM
        if (taskMonth !== month) {
          include = false;
        }
      }

      // Filter by employee
      if (include && employeeId) {
        // Assuming task.employee_id is available
        if (task.employee_id !== parseInt(employeeId, 10)) {
          include = false;
        }
      }

      // Filter by status
      if (include && status && status !== 'all') {
        if (status === 'overdue') {
           // A task is overdue if its status is 'pending' and due_date is in the past
           if (task.status !== 'pending' || !dueDateObj || dueDateObj >= now) {
              include = false;
           }
        } else if (task.status !== status) {
           include = false;
        }
      }

      return include;
    });

    // Sort tasks: Overdue first, then Pending, then Completed
    filteredTasks.sort((a, b) => {
      const getStatusPriority = (task) => {
        const now = new Date();
        const dueDateObj = task.due_date ? new Date(task.due_date) : null;

        if (task.status === 'pending' && dueDateObj && dueDateObj < now) return 1; // Overdue (highest priority)
        if (task.status === 'pending') return 2; // Pending
        if (task.status === 'completed') return 3; // Completed
        return 4; // Other statuses (lowest priority)
      };

      const priorityA = getStatusPriority(a);
      const priorityB = getStatusPriority(b);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Secondary sort by due date for pending/overdue tasks, or creation date for completed tasks
      if (priorityA === 1 || priorityA === 2) { // Overdue or Pending
         const dateA = a.due_date ? new Date(a.due_date) : new Date(0); // Treat no due date as very old
         const dateB = b.due_date ? new Date(b.due_date) : new Date(0); // Treat no due date as very old
         return dateA.getTime() - dateB.getTime(); // Sort overdue/pending by earliest due date first
      } else if (priorityA === 3) { // Completed
         const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
         const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
         return dateB.getTime() - dateA.getTime(); // Sort completed by newest creation date first
      }

      return 0; // Keep original order for same priority and secondary sort
    });

    return filteredTasks;

  } catch (error) {
    logger.error('Error in fetchTasksReportData:', error);
    throw error; // Re-throw to be caught by the API endpoint handler
  }
}

module.exports = { fetchTasksReportData }; 