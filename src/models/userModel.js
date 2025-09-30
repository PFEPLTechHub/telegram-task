// src/models/userModel.js
const { query } = require("../database/db");
const logger = require("../utils/logger");

const ROLES = Object.freeze({
  ADMIN: 0,
  MANAGER: 1,
  EMPLOYEE: 2,
});

const USER_FIELDS = "id, telegram_id, username, first_name, last_name, role, manager_id";

class UserModel {
  /**
   * Validate role before inserting or updating
   */
  static validateRole(role) {
    if (!Object.values(ROLES).includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
  }

  /**
   * Create a new user or update an existing one
   * @param {Object} telegramUser - Telegram user object
   * @param {number} role - User role
   * @param {number|null} managerId - ID of the manager who invited this user (for employees)
   */
 static async createOrUpdateUser(telegramUser, role = ROLES.EMPLOYEE, managerId = null) {
  console.log('Incoming role:', role, 'Type:', typeof role);

  try {
    role = parseInt(role, 10); // <-- Ensure role is a number
    this.validateRole(role);

    const {
      id,
      username = null,
      first_name = null,
      last_name = null,
    } = telegramUser;

    const existingUser = await query(
      `SELECT ${USER_FIELDS} FROM users WHERE telegram_id = ? LIMIT 1`,
      [id]
    );

    if (existingUser?.length > 0) {
      // Only update manager_id if provided and user is an employee
      const updateManagerId = managerId !== null && role === ROLES.EMPLOYEE;

      // Build SET clause and values array
      const fields = ['username = ?', 'first_name = ?', 'last_name = ?'];
      const values = [username, first_name, last_name];

      if (updateManagerId) {
        fields.push('manager_id = ?');
        values.push(managerId);
      }

      values.push(id); // For WHERE clause

      const sql = `
        UPDATE users
        SET ${fields.join(', ')}
        WHERE telegram_id = ?
      `;

      await query(sql, values);

      return {
        ...existingUser[0],
        username,
        first_name,
        last_name,
        manager_id: updateManagerId ? managerId : existingUser[0].manager_id,
      };
    } else {
      const result = await query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, role, manager_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, username, first_name, last_name, role, managerId]
      );

      return {
        id: result.insertId,
        telegram_id: id,
        username,
        first_name,
        last_name,
        role,
        manager_id: managerId,
      };
    }
  } catch (error) {
    logger.error("Error creating/updating user:", error);
    throw error;
  }
}

static async updateUserStatus(userId, status) {
  const sql = `UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?`;
  await query(sql, [status, userId]);
}


  /**
   * Find users by list of IDs
   */
  static async findUsersByIds(ids) {
    try {
      if (!ids || ids.length === 0) return [];

      const placeholders = ids.map(() => '?').join(', ');
      const queryStr = `SELECT id, first_name FROM users WHERE id IN (${placeholders})`;

      return await query(queryStr, ids);
    } catch (error) {
      logger.error("Error finding users by IDs:", error);
      throw error;
    }
  }
static async getManagerByEmployeeId(employeeId) {
    try {
      const sql = `
        SELECT m.* FROM users m
        INNER JOIN users e ON e.manager_id = m.id
        WHERE e.id = ? AND m.role = 1
      `;
      const rows = await query(sql, [employeeId]); // same query helper
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error("Error getting manager by employee ID:", error);
      return null;
    }
  }

  /**
   * Get user with their manager's information
   */
  static async getUserWithManagerInfo(userId) {
    try {
      const sql = `
        SELECT u.*, 
               m.id as manager_id, 
               m.telegram_id as manager_telegram_id,
               m.first_name as manager_first_name
        FROM users u
        LEFT JOIN users m ON u.manager_id = m.id
        WHERE u.id = ?
      `;
      const rows = await query(sql, [userId]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error("Error getting user with manager info:", error);
      return null;
    }
  }

  /**
   * Get user by Telegram ID
   */
  static async getUserByTelegramId(telegramId) {
    try {
      const users = await query(
        `SELECT * FROM users WHERE telegram_id = ? LIMIT 1`,
        [telegramId]
      );

      return users?.[0] || null;
    } catch (error) {
      logger.error("Error getting user by Telegram ID:", error);
      throw error;
    }
  }

  /**
   * Get user by internal ID
   */
  static async findById(id) {
    try {
      const users = await query(
        `SELECT ${USER_FIELDS} FROM users WHERE id = ? LIMIT 1`,
        [id]
      );

      return users?.[0] || null;
    } catch (error) {
      logger.error("Error getting user by ID:", error);
      throw error;
    }
  }
  
  static async getUserById(userId) {
    try {
      const users = await query(
        "SELECT * FROM users WHERE id = ? LIMIT 1",
        [userId]
      );
      
      return users.length > 0 ? users[0] : null;
    } catch (error) {
      logger.error(`Error getting user by ID: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get user by name (first name or username)
   */
  static async getUserByName(name) {
    try {
      const users = await query(
        `SELECT ${USER_FIELDS} FROM users WHERE first_name = ? OR username = ? LIMIT 1`,
        [name, name]
      );

      return users?.[0] || null;
    } catch (error) {
      logger.error("Error getting user by name:", error);
      throw error;
    }
  }
  
  /**
   * Get all managers
   */
  static async getAllManagers() {
    try {
      const role = ROLES.MANAGER;
      this.validateRole(role);
  
      return await query(
        `SELECT ${USER_FIELDS} FROM users WHERE role = ? ORDER BY first_name`,
        [role]
      );
    } catch (error) {
      logger.error("Error getting users with role manager:", error);
      throw error;
    }
  }
  
  /**
   * Get users by role
   */
  static async getUsersByRole(role) {
    try {
      this.validateRole(role);

      return await query(
        `SELECT ${USER_FIELDS} FROM users WHERE role = ? ORDER BY first_name`,
        [role]
      );
    } catch (error) {
      logger.error(`Error getting users with role ${role}:`, error);
      throw error;
    }
  }

  /**
   * Get users by multiple roles
   * @param {Array<number>} roles - Array of role values (e.g., [1, 2] for Managers and Employees)
   * @returns {Promise<Array<Object>>} - Array of user objects
   */
  static async getUsersByRoles(roles) {
    try {
      if (!roles || roles.length === 0) return [];
      
      // Ensure all roles are valid numbers
      roles.forEach(role => {
        if (typeof role !== 'number' || !Object.values(ROLES).includes(role)) {
            throw new Error(`Invalid role in array: ${role}`);
        }
      });

      const placeholders = roles.map(() => '?').join(', ');
      const sql = `
        SELECT ${USER_FIELDS}
        FROM users
        WHERE role IN (${placeholders})
        ORDER BY role, first_name
      `;

      const users = await query(sql, roles);
      return users;

    } catch (error) {
      logger.error("Error getting users by roles:", error);
      throw error;
    }
  }

  /**
   * Get all employees
   */
  static async getAllEmployees() {
    return this.getUsersByRole(ROLES.EMPLOYEE);
  }
  
  /**
   * Get all employees for a specific manager
   */
  static async getEmployeesByManagerId(managerId) {
  try {
    return await query(
      `SELECT ${USER_FIELDS} FROM users 
       WHERE manager_id = ? 
       ORDER BY first_name`,
      [managerId]
    );
  } catch (error) {
    logger.error(`Error getting employees for manager ${managerId}:`, error);
    throw error;
  }
}


  /**
   * Set user role by Telegram ID
   */
  static async setUserRole(telegramId, role) {
    try {
      this.validateRole(role);

      await query("UPDATE users SET role = ? WHERE telegram_id = ?", [
        role,
        telegramId,
      ]);

      return true;
    } catch (error) {
      logger.error("Error setting user role:", error);
      throw error;
    }
  }

  /**
   * Check if user has one of the given roles
   * @param {number} telegramId 
   * @param {number[]} roles 
   * @returns {Promise<boolean>}
   */
  static async hasRole(telegramId, roles) {
    try {
      const placeholders = roles.map(() => '?').join(', ');
      const users = await query(
        `SELECT id FROM users WHERE telegram_id = ? AND role IN (${placeholders}) LIMIT 1`,
        [telegramId, ...roles]
      );
      
      return users?.length > 0;
    } catch (error) {
      logger.error("Error checking user role:", error);
      return false;
    }
  }

  /**
   * Delete a user from the database by ID
   * @param {number} userId - The ID of the user to delete
   * @returns {Promise<boolean>} - True if deleted successfully, false otherwise
   */
  static async deleteUser(userId) {
  try {
    // Check if user exists first
    const user = await query(
      "SELECT * FROM users WHERE id = ?",
      [userId]
    );
    
    if (!user || user.length === 0) {
      logger.error(`Attempted to delete non-existent user ID: ${userId}`);
      return false;
    }

    logger.info(`Starting deletion process for user ID ${userId} (${user[0].first_name || 'Unknown'})`);

    // Step 1: Delete all related records from pending_approvals in one query
    // This handles all possible foreign key references
    const pendingApprovalsResult = await query(`
      DELETE FROM pending_approvals 
      WHERE user_id = ? 
         OR inviter_id = ? 
         OR approver_id = ? 
         OR approved_by = ?
    `, [userId, userId, userId, userId]);

    logger.info(`Cleaned up ${pendingApprovalsResult.affectedRows} pending_approvals records for user ID ${userId}`);

    // Step 2: Add cleanup for other tables if needed
    // Example for tasks table (uncomment if you have it):
    /*
    const tasksResult = await query(`
      DELETE FROM tasks 
      WHERE assigned_to = ? OR created_by = ? OR approved_by = ?
    `, [userId, userId, userId]);
    logger.info(`Cleaned up ${tasksResult.affectedRows} tasks records for user ID ${userId}`);
    */

    // Step 3: Finally delete the user from the users table
    const result = await query(
      "DELETE FROM users WHERE id = ?",
      [userId]
    );
    
    if (result.affectedRows > 0) {
      logger.info(`User ID ${userId} deleted successfully along with all related records`);
      return true;
    } else {
      logger.error(`Failed to delete user ID: ${userId}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error deleting user ID ${userId}:`, error);
    return false;
  }
}

  static async getAllUsers() {
    try {
      // Query to get all users
      const users = await query(
        `SELECT id, telegram_id, first_name, last_name, username, role, manager_id
         FROM users 
         ORDER BY first_name ASC`
      );
      
      return users;
    } catch (error) {
      logger.error("Error getting all users:", error);
      throw error;
    }
  }

  static async isTeamLead(telegramId) {
    // Note: You may want to define a TEAM_LEAD role if needed
    return this.hasRole(telegramId, [ROLES.MANAGER, ROLES.ADMIN]);
  }

  static async isManager(telegramId) {
    return this.hasRole(telegramId, [ROLES.MANAGER, ROLES.ADMIN]);
  }

  static async isAdmin(telegramId) {
    return this.hasRole(telegramId, [ROLES.ADMIN]);
  }

  /**
   * Return list of roles for UI display
   */
  static getRoles() {
    return Object.values(ROLES);
  }
  
  /**
   * Return role name by numeric value
   */
  static getRoleName(roleValue) {
    const roleNames = {
      [ROLES.ADMIN]: "admin",
      [ROLES.MANAGER]: "manager", 
      [ROLES.EMPLOYEE]: "employee"
    };
    
    return roleNames[roleValue] || "unknown";
  }

  /**
   * Update a user's manager
   */
  static async updateUserManager(userId, managerId) {
    try {
      await query(
        "UPDATE users SET manager_id = ? WHERE id = ?",
        [managerId, userId]
      );
      
      return true;
    } catch (error) {
      logger.error(`Error updating manager for user ${userId}:`, error);
      throw error;
    }
  }
}

module.exports = UserModel;
module.exports.ROLES = ROLES;