/**
 * validateSession middleware
 *
 * Ensures `req.body.sessionId` is present and resolves to an existing session
 * in the repository. Attaches the session to `req.ctx.session` for downstream use.
 */
const sessionRepository = require("../repositories/session_repository");

function validateSession(req, res, next) {
  const { sessionId } = req.body || {};

  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: "sessionId is required",
    });
  }

  const session = sessionRepository.findById(sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "Session not found",
    });
  }

  // Attach to context so service/handler don't need to look it up again
  req.ctx.setSessionId(sessionId);
  req.ctx.session = session;

  next();
}

module.exports = validateSession;
