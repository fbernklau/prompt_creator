const { config } = require('../config');

function splitGroups(value = '') {
  return value
    .split(/[;,| ]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function firstHeader(req, names) {
  for (const name of names) {
    const value = req.header(name);
    if (value) return value;
  }
  return '';
}

function isInRequiredGroup(groups, groupName) {
  if (!groupName) return true;
  const required = groupName.toLowerCase();
  return groups.some((g) => g.toLowerCase() === required);
}

function authMiddleware(req, res, next) {
  const userHeader = firstHeader(req, [
    'x-authentik-username',
    'x-authentik-email',
    'x-forwarded-user',
    'x-auth-request-user',
    'x-forwarded-email',
  ]);
  const groupsHeader = firstHeader(req, [
    'x-authentik-groups',
    'x-forwarded-groups',
    'x-auth-request-groups',
    'x-authentik-entitlements',
  ]);
  const groups = splitGroups(groupsHeader);

  if (config.authRequired && !userHeader) {
    return res.status(401).json({ error: 'Authentication required via Traefik/OIDC forward auth.' });
  }

  if (config.authRequired && !isInRequiredGroup(groups, config.requiredGroup)) {
    return res.status(403).json({ error: `User is not in required group: ${config.requiredGroup}` });
  }

  req.userId = userHeader || 'local-dev';
  req.userGroups = groups;
  next();
}

module.exports = { authMiddleware };
