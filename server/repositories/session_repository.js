/**
 * SessionRepository
 *
 * Data-access layer for voice-agent sessions.
 * Currently backed by an in-memory Map — swap this for Redis / Postgres / Mongo
 * later without touching the Service or Handler layers.
 */
class SessionRepository {
  constructor() {
    /** @type {Map<string, Object>} */
    this.sessions = new Map();
  }

  /**
   * Persist a session.
   * @param {string} sessionId
   * @param {Object} sessionData - The agent handle returned by the service.
   */
  save(sessionId, sessionData) {
    this.sessions.set(sessionId, {
      ...sessionData,
      createdAt: new Date(),
    });
  }

  /**
   * Retrieve a session by ID.
   * @param {string} sessionId
   * @returns {Object|null}
   */
  findById(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Remove a session after it's been closed.
   * @param {string} sessionId
   * @returns {boolean} true if the session existed.
   */
  delete(sessionId) {
    return this.sessions.delete(sessionId);
  }

  /**
   * List all active session IDs.
   * @returns {string[]}
   */
  listAll() {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check whether a session exists.
   * @param {string} sessionId
   * @returns {boolean}
   */
  exists(sessionId) {
    return this.sessions.has(sessionId);
  }

  /**
   * Return the total number of active sessions.
   * @returns {number}
   */
  count() {
    return this.sessions.size;
  }
}

// Export a singleton so the same store is shared across the app.
module.exports = new SessionRepository();
