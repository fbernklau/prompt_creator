const DEFAULT_PERMISSIONS = [
  { key: '*', description: 'Full access (all permissions).' },
  { key: 'app.access', description: 'Access to base application routes.' },
  { key: 'providers.manage_own', description: 'Create/update/delete own providers.' },
  { key: 'prompts.generate', description: 'Generate provider output from templates.' },
  { key: 'history.manage_own', description: 'Read/write own prompt history.' },
  { key: 'library.manage_own', description: 'Manage own prompt library entries.' },
  { key: 'library.view_public', description: 'View public library entries.' },
  { key: 'library.rate', description: 'Rate visible library entries.' },
  { key: 'settings.manage_own', description: 'Manage own user settings.' },
  { key: 'templates.review', description: 'Review and approve/reject community templates.' },
  { key: 'templates.official_manage', description: 'Create/manage official templates.' },
  { key: 'tags.moderate', description: 'Moderate official/community tags.' },
  { key: 'admin.access', description: 'Access admin interface.' },
  { key: 'rbac.manage', description: 'Manage roles, permissions and group-role bindings.' },
];

const DEFAULT_ROLES = [
  {
    key: 'teachers',
    name: 'Teachers',
    description: 'Default application users.',
    system: true,
    permissions: [
      'app.access',
      'providers.manage_own',
      'prompts.generate',
      'history.manage_own',
      'library.manage_own',
      'library.view_public',
      'library.rate',
      'settings.manage_own',
    ],
  },
  {
    key: 'template_reviewers',
    name: 'Template Reviewers',
    description: 'Review and moderation for community templates.',
    system: true,
    permissions: [
      'app.access',
      'templates.review',
      'tags.moderate',
      'admin.access',
    ],
  },
  {
    key: 'template_curators',
    name: 'Template Curators',
    description: 'Official template and taxonomy management.',
    system: true,
    permissions: [
      'app.access',
      'templates.review',
      'templates.official_manage',
      'tags.moderate',
      'admin.access',
    ],
  },
  {
    key: 'platform_admins',
    name: 'Platform Admins',
    description: 'Full platform and RBAC administration.',
    system: true,
    permissions: ['*'],
  },
];

const DEFAULT_GROUP_ROLE_BINDINGS = [
  { groupName: 'teachers', roleKey: 'teachers' },
  { groupName: 'template_reviewers', roleKey: 'template_reviewers' },
  { groupName: 'template_curators', roleKey: 'template_curators' },
  { groupName: 'platform_admins', roleKey: 'platform_admins' },
];

module.exports = {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_GROUP_ROLE_BINDINGS,
};
