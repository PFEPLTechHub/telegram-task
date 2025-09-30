// src/models/noteModel.js
const { query } = require("../database/db");
const logger = require("../utils/logger");

class NoteModel {
  // Create a new note
  static async createNote(title, description, managerId, isPinned = false) {
    try {
      const result = await query(
        `INSERT INTO notes (title, description, manager_id, is_pinned, created_at, updated_at) 
         VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [title, description, managerId, isPinned]
      );

      return {
        id: result.insertId,
        title,
        description,
        managerId,
        isPinned,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } catch (error) {
      logger.error("Error creating note:", error);
      throw error;
    }
  }

  // Get all notes for a specific manager
  static async getNotesByManagerId(managerId) {
    try {
      const notes = await query(
        `SELECT id, title, description, is_pinned, created_at, updated_at 
         FROM notes 
         WHERE manager_id = ? 
         ORDER BY is_pinned DESC, updated_at DESC`,
        [managerId]
      );

      return notes;
    } catch (error) {
      logger.error("Error getting notes by manager ID:", error);
      throw error;
    }
  }

  // Get a specific note by ID
  static async getNoteById(noteId, managerId) {
    try {
      const notes = await query(
        `SELECT id, title, description, is_pinned, created_at, updated_at 
         FROM notes 
         WHERE id = ? AND manager_id = ?`,
        [noteId, managerId]
      );

      return notes.length > 0 ? notes[0] : null;
    } catch (error) {
      logger.error("Error getting note by ID:", error);
      throw error;
    }
  }

  // Update a note
  static async updateNote(noteId, managerId, updates) {
    try {
      const allowedFields = ['title', 'description', 'is_pinned'];
      const sets = [];
      const params = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          sets.push(`${key} = ?`);
          params.push(value);
        }
      }

      if (sets.length === 0) {
        throw new Error('No valid fields to update');
      }

      sets.push('updated_at = NOW()');
      params.push(noteId, managerId);

      const result = await query(
        `UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND manager_id = ?`,
        params
      );

      return result.affectedRows > 0;
    } catch (error) {
      logger.error("Error updating note:", error);
      throw error;
    }
  }

  // Delete a note
  static async deleteNote(noteId, managerId) {
    try {
      const result = await query(
        `DELETE FROM notes WHERE id = ? AND manager_id = ?`,
        [noteId, managerId]
      );

      return result.affectedRows > 0;
    } catch (error) {
      logger.error("Error deleting note:", error);
      throw error;
    }
  }

  // Toggle pin status of a note
  static async togglePin(noteId, managerId) {
    try {
      const result = await query(
        `UPDATE notes 
         SET is_pinned = NOT is_pinned, updated_at = NOW() 
         WHERE id = ? AND manager_id = ?`,
        [noteId, managerId]
      );

      return result.affectedRows > 0;
    } catch (error) {
      logger.error("Error toggling pin status:", error);
      throw error;
    }
  }
}

module.exports = NoteModel;
