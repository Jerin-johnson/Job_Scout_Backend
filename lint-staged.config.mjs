export default {
  "*.{js,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*.{ts,tsx}": ["prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"],
};
