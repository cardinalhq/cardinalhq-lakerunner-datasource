const grafanaConfig = require("@grafana/eslint-config/flat");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".config/**",
      "src/static/**",
    ],
  },
  ...grafanaConfig.filter(Boolean),
  {
    rules: {
      "react/prop-types": "off",
      // These rules catch patterns that need larger refactors
      "react-hooks/set-state-in-effect": "off", // setState-in-useEffect needs key-based reset or lifting state
      "react-hooks/immutability": "off", // Ref updates for stale closure avoidance
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "warn",
    },
  },
  {
    files: ["tests/**/*"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];
