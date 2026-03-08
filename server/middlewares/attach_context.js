/**
 * attachContext middleware
 *
 * Creates a fresh RequestContext for every incoming request
 * and attaches it at `req.ctx` so all downstream layers can use it.
 */
const RequestContext = require("../context/request_context");

function attachContext(req, _res, next) {
  req.ctx = new RequestContext({
    meta: {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    },
  });
  next();
}

module.exports = attachContext;
