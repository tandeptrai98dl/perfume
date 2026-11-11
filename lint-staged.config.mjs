/** @type {import('lint-staged').Configuration} */
const config = {
  '*.{ts,tsx,mjs,js}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{json,css,yml,yaml}': ['prettier --write'],
};

export default config;
