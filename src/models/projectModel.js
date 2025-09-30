// src/models/projectModel.js
const { query } = require("../database/db");
const logger = require("../utils/logger");

class ProjectModel {
  // Create a new project
  static async createProject(name, description, managerId, startDate = null, endDate = null) {
    try {
      const result = await query(
        `INSERT INTO projects (name, description, manager_id, start_date, end_date, status) 
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [name, description, managerId, startDate, endDate]
      );

      return {
        id: result.insertId,
        name,
        description,
        managerId,
        startDate,
        endDate,
        status: 'active'
      };
    } catch (error) {
      logger.error("Error creating project:", error);
      throw error;
    }
  }

  // Get all projects
  static async getAllProjects() {
    try {
      const projects = await query(
        `SELECT p.*, u.first_name as manager_name, u.username as manager_username
         FROM projects p
         LEFT JOIN users u ON p.manager_id = u.id
         ORDER BY p.created_at DESC`
      );
      return projects;
    } catch (error) {
      logger.error("Error getting all projects:", error);
      throw error;
    }
  }

  // Get projects by manager ID
  static async getProjectsByManagerId(managerId) {
    try {
      const projects = await query(
        `SELECT p.*, u.first_name as manager_name, u.username as manager_username
         FROM projects p
         LEFT JOIN users u ON p.manager_id = u.id
         WHERE p.manager_id = ?
         ORDER BY p.created_at DESC`,
        [managerId]
      );
      return projects;
    } catch (error) {
      logger.error("Error getting projects by manager ID:", error);
      throw error;
    }
  }

  // Get project by ID
  static async getProjectById(projectId) {
    try {
      const projects = await query(
        `SELECT p.*, u.first_name as manager_name, u.username as manager_username
         FROM projects p
         LEFT JOIN users u ON p.manager_id = u.id
         WHERE p.id = ?
         LIMIT 1`,
        [projectId]
      );
      return projects.length > 0 ? projects[0] : null;
    } catch (error) {
      logger.error("Error getting project by ID:", error);
      throw error;
    }
  }

  // Get project by name
  static async getProjectByName(name) {
    try {
      const projects = await query(
        `SELECT p.*, u.first_name as manager_name, u.username as manager_username
         FROM projects p
         LEFT JOIN users u ON p.manager_id = u.id
         WHERE p.name = ?
         LIMIT 1`,
        [name]
      );
      return projects.length > 0 ? projects[0] : null;
    } catch (error) {
      logger.error("Error getting project by name:", error);
      throw error;
    }
  }

  // Update project
  static async updateProject(projectId, updates) {
    try {
      const fields = [];
      const values = [];

      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      });

      if (fields.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(projectId);
      const sql = `UPDATE projects SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
      
      await query(sql, values);
      return true;
    } catch (error) {
      logger.error("Error updating project:", error);
      throw error;
    }
  }

  // Delete project
  static async deleteProject(projectId) {
    try {
      await query("DELETE FROM projects WHERE id = ?", [projectId]);
      return true;
    } catch (error) {
      logger.error("Error deleting project:", error);
      throw error;
    }
  }

  // Get tasks for a project
  static async getProjectTasks(projectId) {
    try {
      const tasks = await query(
        `SELECT t.*, u.first_name as employee_name, u.username as employee_username
         FROM tasks t
         LEFT JOIN users u ON t.employee_id = u.id
         WHERE t.project_id = ?
         ORDER BY t.created_at DESC`,
        [projectId]
      );
      return tasks;
    } catch (error) {
      logger.error("Error getting project tasks:", error);
      throw error;
    }
  }

  // Get active projects
  static async getActiveProjects() {
    try {
      const projects = await query(
        `SELECT p.*, u.first_name as manager_name, u.username as manager_username
         FROM projects p
         LEFT JOIN users u ON p.manager_id = u.id
         WHERE p.status = 'active'
         ORDER BY p.created_at DESC`
      );
      return projects;
    } catch (error) {
      logger.error("Error getting active projects:", error);
      throw error;
    }
  }
}

module.exports = ProjectModel;

