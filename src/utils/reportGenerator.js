// src/utils/reportGenerator.js
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { query } = require('../database/db');
const logger = require('../utils/logger');

/**
 * Generates a visual report of tasks in a table format
 */
class ReportGenerator {
  /**
   * Generate a task report image showing all tasks in a table format
   * @param {Object} options - Configuration options
   * @param {string} options.filterBy - Filter type (all, employee, status)
   * @param {number|string} options.filterValue - Value to filter by (optional)
   * @returns {Promise<string>} - Path to the generated image
   */
  static async generateTaskReport(options = { filterBy: 'all' }) {
    try {
      // Build the SQL query based on filter options
      let sql = `
        SELECT 
          t.id, 
          t.description, 
          t.due_date, 
          t.status,
          t.priority,
          t.created_at,
          t.completed_at,
          e.first_name AS employee_name,
          a.first_name AS assigned_by_name
        FROM tasks t
        LEFT JOIN users e ON t.employee_id = e.id
        LEFT JOIN users a ON t.assigned_by = a.id
      `;
      
      const params = [];
      
      // Apply filters
      if (options.filterBy === 'employee' && options.filterValue) {
        sql += ' WHERE t.employee_id = ?';
        params.push(options.filterValue);
      } else if (options.filterBy === 'status' && options.filterValue) {
        sql += ' WHERE t.status = ?';
        params.push(options.filterValue);
      }
      
      sql += ' ORDER BY t.due_date ASC';
      
      // Get task data
      const tasks = await query(sql, params);
      
      // Generate the image
      const imagePath = await this.createTaskTableImage(tasks);
      return imagePath;
    } catch (error) {
      logger.error('Error generating task report:', error);
      throw error;
    }
  }
  
  /**
   * Creates an image with task data in table format
   * @param {Array} tasks - Array of task objects
   * @returns {Promise<string>} - Path to the generated image
   */
  static async createTaskTableImage(tasks) {
  const styles = {
    fontSize: 14,
    headerFontSize: 16,
    padding: 10,
    rowHeight: 40,
    headerHeight: 50,
    headerBgColor: '#4A6FA5',
    headerTextColor: '#FFFFFF',
    alternateRowColor: '#F5F5F5',
    primaryRowColor: '#FFFFFF',
    borderColor: '#CCCCCC',
    textColor: '#333333',
    statusColors: {
      pending: '#FFB74D',
      completed: '#81C784',
      overdue: '#E57373',
      pending_approval: '#64B5F6'
    },
    priorityColors: {
      High: '#E57373',
      Medium: '#FFB74D',
      Low: '#81C784'
    }
  };

  const columns = [
    { key: 'id', title: 'ID', width: 50 },
    { key: 'description', title: 'Task', width: 240 },
    { key: 'employee_name', title: 'Employee', width: 120 },
    { key: 'due_date', title: 'Due Date', width: 120 },
    { key: 'status', title: 'Status', width: 120 },
    { key: 'priority', title: 'Priority', width: 90 },
    { key: 'created_at', title: 'Created', width: 120 }
  ];

  const tableWidth = columns.reduce((w, col) => w + col.width, 0) + styles.padding * 2;
  const tableHeight = styles.headerHeight + (tasks.length * styles.rowHeight) + styles.padding * 2;

  // ↓↓↓ SCALE DOWN TO REDUCE IMAGE SIZE ↓↓↓
  const scaleFactor = 0.65;
  const canvas = createCanvas(tableWidth * scaleFactor, tableHeight * scaleFactor);
  const ctx = canvas.getContext('2d');
  ctx.scale(scaleFactor, scaleFactor);

  ctx.textRendering = 'optimizeLegibility';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, tableWidth, tableHeight);

  // Draw header
  let xPos = styles.padding;
  ctx.fillStyle = styles.headerBgColor;
  ctx.fillRect(0, 0, tableWidth, styles.headerHeight);

  ctx.fillStyle = styles.headerTextColor;
  ctx.font = `bold ${styles.headerFontSize}px Arial`;
  ctx.textBaseline = 'middle';

  columns.forEach(col => {
    ctx.fillText(col.title, xPos + 5, styles.headerHeight / 2);
    xPos += col.width;
  });

  tasks.forEach((task, index) => {
    const yPos = styles.headerHeight + (index * styles.rowHeight);
    ctx.fillStyle = index % 2 === 0 ? styles.primaryRowColor : styles.alternateRowColor;
    ctx.fillRect(0, yPos, tableWidth, styles.rowHeight);

    const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString() : 'N/A';
    const createdAt = task.created_at ? new Date(task.created_at).toLocaleDateString() : 'N/A';

    ctx.fillStyle = styles.textColor;
    ctx.font = `${styles.fontSize}px Arial`;
    xPos = styles.padding;

    // ID
    ctx.fillText(task.id.toString(), xPos + 5, yPos + styles.rowHeight / 2);
    xPos += columns[0].width;

    // Description
    const desc = task.description.length > 30 ? task.description.substring(0, 30) + '...' : task.description;
    ctx.fillText(desc, xPos + 5, yPos + styles.rowHeight / 2);
    xPos += columns[1].width;

    // Employee
    ctx.fillText(task.employee_name || 'Unassigned', xPos + 5, yPos + styles.rowHeight / 2);
    xPos += columns[2].width;

    // Due Date
    ctx.fillText(dueDate, xPos + 5, yPos + styles.rowHeight / 2);
    xPos += columns[3].width;

    // Status
    ctx.fillStyle = styles.statusColors[task.status] || '#CCCCCC';
    ctx.fillRect(xPos + 5, yPos + 10, columns[4].width - 10, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(task.status.replace('_', ' '), xPos + 10, yPos + styles.rowHeight / 2);
    xPos += columns[4].width;

    // Priority
    if (task.priority) {
      ctx.fillStyle = styles.priorityColors[task.priority] || '#CCCCCC';
      ctx.fillRect(xPos + 5, yPos + 10, columns[5].width - 10, 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(task.priority, xPos + 10, yPos + styles.rowHeight / 2);
    }
    xPos += columns[5].width;

    // Created
    ctx.fillStyle = styles.textColor;
    ctx.fillText(createdAt, xPos + 5, yPos + styles.rowHeight / 2);
  });

  // Draw grid
  ctx.strokeStyle = styles.borderColor;
  ctx.lineWidth = 1;
  xPos = styles.padding;
  columns.forEach(col => {
    xPos += col.width;
    ctx.beginPath();
    ctx.moveTo(xPos, 0);
    ctx.lineTo(xPos, tableHeight);
    ctx.stroke();
  });

  for (let i = 0; i <= tasks.length; i++) {
    const yPos = styles.headerHeight + (i * styles.rowHeight);
    ctx.beginPath();
    ctx.moveTo(0, yPos);
    ctx.lineTo(tableWidth, yPos);
    ctx.stroke();
  }

  const reportsDir = path.join(__dirname, '../../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `task_report_${timestamp}.png`;
  const filePath = path.join(reportsDir, fileName);

  // Save PNG with compression
  const buffer = canvas.toBuffer('image/png', { compressionLevel: 6 });
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

}

module.exports = ReportGenerator;