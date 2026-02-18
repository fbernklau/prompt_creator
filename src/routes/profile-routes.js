const { Router } = require('express');
const { config } = require('../config');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { accessMiddleware, requirePermission } = require('../middleware/rbac');

async function getWelcomeFlowEnabled() {
  try {
    const result = await pool.query(
      `SELECT setting_value_json
       FROM app_runtime_settings
       WHERE setting_key = 'system_keys'
       LIMIT 1`
    );
    if (!result.rowCount) return true;
    return result.rows[0]?.setting_value_json?.welcomeFlowEnabled !== false;
  } catch (_error) {
    return true;
  }
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host') || '';
  if (!host) return '';
  return `${proto}://${host}`;
}

function buildFallbackLogoutUrl(req, originOverride = '') {
  const origin = originOverride || requestOrigin(req);
  if (!origin) return '/outpost.goauthentik.io/sign_out';
  return `${origin}/outpost.goauthentik.io/sign_out?rd=${encodeURIComponent(`${origin}/`)}`;
}

function resolveLogoutUrl(rawUrl = '', req = null) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return req ? buildFallbackLogoutUrl(req) : '/outpost.goauthentik.io/sign_out';
  const lower = raw.toLowerCase();
  // Backchannel endpoints are not interactive logout targets in browser UI.
  if (lower.includes('backchannel-logout')) {
    try {
      const parsed = new URL(raw);
      if (req) return buildFallbackLogoutUrl(req, parsed.origin);
      return `${parsed.origin}/outpost.goauthentik.io/sign_out`;
    } catch (_error) {
      return req ? buildFallbackLogoutUrl(req) : '/outpost.goauthentik.io/sign_out';
    }
  }
  return raw;
}

function createProfileRouter() {
  const router = Router();

  router.get('/me', authMiddleware, accessMiddleware, requirePermission('app.access'), async (req, res, next) => {
    try {
      const welcomeFlowEnabled = await getWelcomeFlowEnabled();
      res.json({
        userId: req.userId,
        groups: req.userGroups,
        roles: req.access?.roles || [],
        permissions: req.access?.permissions || [],
        logoutUrl: resolveLogoutUrl(config.authLogoutUrl || '', req),
        welcomeFlowEnabled,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/logout', authMiddleware, accessMiddleware, requirePermission('app.access'), async (req, res) => {
    const target = resolveLogoutUrl(config.authLogoutUrl || '', req);
    res.redirect(302, target);
  });

  return router;
}

module.exports = { createProfileRouter };
