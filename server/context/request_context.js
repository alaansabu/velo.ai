/**
 * RequestContext
 *
 * A lightweight, request-scoped container that flows through
 * Handler → Middleware → Service → Repository.
 *
 * Attach it to `req.ctx` in an early middleware so every layer
 * can read / write shared data without coupling to Express.
 */
class RequestContext {
  /**
   * @param {Object} opts
   * @param {string} [opts.requestId]  - Unique ID for tracing / logging.
   * @param {string} [opts.sessionId]  - Voice-agent session identifier.
   * @param {Object} [opts.meta]       - Any extra metadata (user info, etc.).
   */
  constructor({ requestId = null, sessionId = null, meta = {} } = {}) {
    this.requestId = requestId || RequestContext.generateId();
    this.sessionId = sessionId;
    this.meta = meta;
    this.createdAt = new Date();
  }

  /** Simple unique-id generator (replace with uuid if needed) */
  static generateId() {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Attach a session id after it's been created */
  setSessionId(id) {
    this.sessionId = id;
  }

  /** Merge additional metadata */
  addMeta(key, value) {
    this.meta[key] = value;
  }

  /** Serialise for logging */
  toJSON() {
    return {
      requestId: this.requestId,
      sessionId: this.sessionId,
      meta: this.meta,
      createdAt: this.createdAt,
    };
  }
}

module.exports = RequestContext;
