// src/database/db.js
const mysql = require('mysql2/promise');
const config = require('../../config');
const logger = require('../utils/logger');

let pool;

// Initialize database connection pool
async function initializeDatabase() {
  try {
    pool = mysql.createPool({
      ...config.databaseConfig,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    
    // Test the connection
    const connection = await pool.getConnection();
    connection.release();
    logger.info('Database connection pool initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize database connection:', error);
    throw error;
  }
}

// Get database connection from pool
async function getConnection() {
  if (!pool) {
    await initializeDatabase();
  }
  return pool.getConnection();
}

// Execute SQL query with params
async function query(sql, params = []) {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    logger.error(`Query error: ${sql}`, error);
    throw error;
  }
}

// Transaction helper
async function transaction(callback) {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  initializeDatabase,
  getConnection,
  query,
  transaction
};