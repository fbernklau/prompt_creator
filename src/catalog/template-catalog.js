const { defaultTemplateCatalog } = require('./default-template-catalog');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTemplateCatalog() {
  return clone(defaultTemplateCatalog);
}

module.exports = { getTemplateCatalog };
