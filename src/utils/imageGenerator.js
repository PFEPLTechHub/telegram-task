// src/utils/imageGenerator.js
const puppeteer = require('puppeteer');
const logger = require('./logger');

/**
 * Utility class for generating task and employee images with pagination
 * Updated to support multiple images per request, prioritize overdue tasks,
 * and display unlimited lines for task descriptions
 */
class ImageGenerator {
  constructor() {
    this.colors = {
      background: '#F0F2F5',
      primary: '#2B5278',
      secondary: '#4A76A8',
      completed: '#4CAF50',  // Green for completed tasks
      pending: '#FF9800',    // Yellow for pending tasks
      overdue: '#FF0000',    // Pure red for overdue tasks
      text: '#333333',
      lightText: '#757575',
      header: '#FFFFFF',
      border: '#E0E0E0',
      tableHeader: '#E8EAF6',
      tableRowEven: '#FFFFFF',
      tableRowOdd: '#F5F5F5'
    };
  }

  /**
   * Generate an image showing tasks in table format with pagination
   * @param {Array} tasks - List of tasks
   * @param {Object} options - Options for image generation
   * @param {Number} options.page - Current page number (1-based)
   * @param {Number} options.itemsPerPage - Number of items per page
   * @param {String} options.orderBy - Field to order by (created_at, status, employee_name, due_date)
   * @param {String} options.orderDir - Order direction (asc, desc)
   * @returns {Object} - Object containing image buffer, totalPages, and currentPage
   */
  async generateTasksImage(tasks, options = {}) {
    logger.info('Generating tasks image with options:', options);

    // Default options
    const pageNum = options.page || 1;
    const itemsPerPage = options.itemsPerPage || 15;
    const orderBy = options.orderBy || 'status';
    const orderDir = options.orderDir || 'asc';

    // No filtering by status as we'll show all tasks
    let filteredTasks = tasks;

    // Mark overdue tasks
    const currentDate = new Date();
    filteredTasks = filteredTasks.map(task => {
      const updatedTask = { ...task };
      if (task.due_date && new Date(task.due_date) < currentDate && task.status === 'pending') {
        updatedTask.isOverdue = true;
      } else {
        updatedTask.isOverdue = false;
      }
      return updatedTask;
    });



    // Sort tasks based on orderBy and orderDir
    filteredTasks = this._sortTasks(filteredTasks, orderBy, orderDir);

    // Calculate pagination
    const totalPages = Math.max(1, Math.ceil(filteredTasks.length / itemsPerPage));
    const startIndex = (pageNum - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredTasks.length);
    const pageItems = filteredTasks.slice(startIndex, endIndex);

    // Define the base line height (x) for row height calculation
    const baseLineHeight = 20; // This is 'x' in the nx approach (e.g., 1x, 2x, 3x, etc.)

    // Preprocess tasks to determine the number of lines and row heights
    const processedItems = pageItems.map((task, index) => {
      const desc = task.description || 'No description';
      // Split description into lines (we'll rely on CSS for wrapping, but need line count for height)
      const descLines = desc.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      const numLines = descLines.length;

      // Calculate row height using the nested conditional approach (1x, 2x, ..., 10x)
      let rowHeight;
      if (numLines === 1) {
        rowHeight = baseLineHeight * 1; // 1x
      } else if (numLines === 2) {
        rowHeight = baseLineHeight * 2; // 2x
      } else if (numLines === 3) {
        rowHeight = baseLineHeight * 3; // 3x
      } else if (numLines === 4) {
        rowHeight = baseLineHeight * 4; // 4x
      } else if (numLines === 5) {
        rowHeight = baseLineHeight * 5; // 5x
      } else if (numLines === 6) {
        rowHeight = baseLineHeight * 6; // 6x
      } else if (numLines === 7) {
        rowHeight = baseLineHeight * 7; // 7x
      } else if (numLines === 8) {
        rowHeight = baseLineHeight * 8; // 8x
      } else if (numLines === 9) {
        rowHeight = baseLineHeight * 9; // 9x
      } else {
        rowHeight = baseLineHeight * 10; // 10x (cap for 10 or more lines)
      }

      // Ensure a minimum height
      rowHeight = Math.max(26, rowHeight);


      return {
        ...task,
        descLines,
        numLines,
        rowHeight
      };
    });

    // Launch Puppeteer
    const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

    const page = await browser.newPage();

    // Set the viewport size
    const width = 800;
    await page.setViewport({ width, height: 500, deviceScaleFactor: 2 });

    // Generate the HTML content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
          body {
            font-family: 'Roboto', Arial, sans-serif;
            background-color: ${this.colors.background};
            margin: 0;
            padding: 0;
            width: ${width}px;
            box-sizing: border-box;
          }
          .container {
            padding: 20px;
            width: 100%;
            box-sizing: border-box;
          }
          .title {
            color: ${this.colors.primary};
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 10px;
          }
          .no-tasks {
            color: ${this.colors.text};
            font-size: 20px;
            text-align: center;
            margin-top: 50px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            background-color: #fff;
          }
          th, td {
            border: 1px solid ${this.colors.border};
            padding: 5px 10px;
            text-align: left;
            vertical-align: middle;
            box-sizing: border-box;
          }
          th {
            background-color: ${this.colors.tableHeader};
            color: ${this.colors.text};
            font-size: 14px;
            font-weight: bold;
            height: 30px;
          }
          td {
            color: ${this.colors.text};
            font-size: 13px;
          }
          .status-indicator {
            display: inline-block;
            width: 4px;
            height: 100%;
            position: absolute;
            left: 0;
            top: 0;
          }
          .description {
            white-space: pre-wrap;
            line-height: ${baseLineHeight}px;
            margin-left: 8px;
          }
          .status-overdue {
            color: ${this.colors.overdue};
            font-weight: bold;
          }
          .status-completed {
            color: ${this.colors.completed};
          }
          .status-pending {
            color: ${this.colors.pending};
          }
          .due-date-overdue {
            color: ${this.colors.overdue};
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="title">Overall Tasks Report - ${pageNum}/${totalPages}</div>
          ${
            processedItems.length === 0
              ? '<div class="no-tasks">No tasks available</div>'
              : `
                <table>
                  <thead>
                    <tr>
                      <th style="width: 40px;">#</th>
                      <th style="width: 55%;">Description</th>
                      <th style="width: 12%;">Status</th>
                      <th style="width: 17%;">Assigned To</th>
                      <th style="width: 16%;">Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${processedItems.map((task, index) => {
                      const absoluteIndex = startIndex + index + 1;

                      // Determine status color and text
                      let statusColor, statusText;
                      if (task.isOverdue) {
                        statusColor = this.colors.overdue;
                        statusText = 'OVERDUE';
                      } else {
                        switch (task.status) {
                          case 'completed':
                            statusColor = this.colors.completed;
                            statusText = 'Done';
                            break;
                          default:
                            statusColor = this.colors.pending;
                            statusText = 'Pending';
                        }
                      }

                      // Determine due date
                      let dueDate = 'N/A';
                      if (task.due_date) {
                        const date = new Date(task.due_date);
                        const today = new Date();
                        const tomorrow = new Date(today);
                        tomorrow.setDate(tomorrow.getDate() + 1);

                        if (date.toDateString() === today.toDateString()) {
                          dueDate = 'Today';
                        } else if (date.toDateString() === tomorrow.toDateString()) {
                          dueDate = 'Tomorrow';
                        } else {
                          const month = date.toLocaleString('default', { month: 'short' });
                          const day = date.getDate();
                          dueDate = `${month} ${day}`;
                        }
                      }

                      // Truncate assigned to name
                      const assignedTo = task.employee_name || 'Unassigned';
                      const truncatedName = this._truncateText(assignedTo, 15);

                      return `
                        <tr style="height: ${task.rowHeight}px; position: relative;">
                          <td>${absoluteIndex}</td>
                          <td>
                            <div class="status-indicator" style="background-color: ${statusColor};"></div>
                            <div class="description">${task.description || 'No description'}</div>
                          </td>
                          <td class="${task.isOverdue ? 'status-overdue' : task.status === 'completed' ? 'status-completed' : 'status-pending'}">
                            ${statusText}
                          </td>
                          <td>${truncatedName}</td>
                          <td class="${task.isOverdue && task.due_date ? 'due-date-overdue' : ''}">
                            ${dueDate}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `
          }
        </div>
      </body>
      </html>
    `;

    // Set the HTML content
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Take a screenshot of the container
    const container = await page.$('.container');
    const buffer = await container.screenshot({ type: 'png' });

    // Close the browser
    await browser.close();

    return {
      buffer,
      totalPages,
      currentPage: pageNum
    };
  }

  /**
   * Helper method to sort tasks based on orderBy and orderDir
   * @param {Array} tasks - Tasks to sort
   * @param {String} orderBy - Field to order by
   * @param {String} orderDir - Order direction (asc, desc)
   * @returns {Array} - Sorted tasks
   */
  _sortTasks(tasks, orderBy, orderDir) {
    if (!tasks || !tasks.length) return [];

    const sortedTasks = [...tasks];

    sortedTasks.sort((a, b) => {
      let comparison = 0;

      if (orderBy === 'status') {
        const getStatusPriority = (task) => {
          if (task.isOverdue) return 1;
          if (task.status === 'pending') return 2;
          if (task.status === 'completed') return 3;
          return 4;
        };

        const priorityA = getStatusPriority(a);
        const priorityB = getStatusPriority(b);

        comparison = priorityA - priorityB;
      } else {
        switch (orderBy) {
          case 'employee_name':
            comparison = this._compareValues(a.employee_name || '', b.employee_name || '');
            break;

          case 'due_date':
            const dateA = a.due_date ? new Date(a.due_date) : new Date(0);
            const dateB = b.due_date ? new Date(b.due_date) : new Date(0);
            comparison = this._compareValues(dateA, dateB);
            break;

          case 'created_at':
          default:
            const createdA = a.created_at ? new Date(a.created_at) : new Date(0);
            const createdB = b.created_at ? new Date(b.created_at) : new Date(0);
            comparison = this._compareValues(createdA, createdB);
            break;
        }
      }

      return orderBy === 'status' ? comparison : (orderDir === 'desc' ? -comparison : comparison);
    });

    return sortedTasks;
  }

  /**
   * Generic comparison function for sorting
   * @param {*} a - First value
   * @param {*} b - Second value
   * @returns {Number} - Comparison result (-1, 0, 1)
   */
  _compareValues(a, b) {
    if (a instanceof Date && b instanceof Date) {
      return a - b;
    }

    if (typeof a === 'string' && typeof b === 'string') {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    }

    if (a > b) return 1;
    if (a < b) return -1;
    return 0;
  }

  /**
   * Get readable label for current sorting
   * @param {String} orderBy - Field being sorted
   * @param {String} orderDir - Sort direction
   * @returns {String} - Human-readable label
   */
  _getSortingLabel(orderBy, orderDir) {
    if (orderBy === 'status') {
      return 'Status (Overdue first, then Pending, then Completed)';
    }

    const dirLabel = orderDir === 'asc' ? '(Oldest first)' : '(Newest first)';
    const nameLabel = orderDir === 'asc' ? '(A to Z)' : '(Z to A)';
    const dateLabel = orderDir === 'asc' ? '(Earliest first)' : '(Latest first)';

    switch (orderBy) {
      case 'created_at':
        return `Creation Date ${dirLabel}`;
      case 'employee_name':
        return `Person Name ${nameLabel}`;
      case 'due_date':
        return `Due Date ${dateLabel}`;
      default:
        return `Default order`;
    }
  }

  /**
   * Helper method to truncate text
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length before truncating
   * @returns {string} - Truncated text
   */
  _truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) {
      return text || '';
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}

module.exports = new ImageGenerator();
