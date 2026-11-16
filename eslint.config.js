import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import { transformSync } from 'esbuild';
import * as espree from 'espree';

// Lightweight ESM ESTree bridge using installed esbuild + espree so ESLint 10 lints
// .ts / .tsx files without hitting @typescript-eslint/parser's TS 7.0 rejection error.
const tsEsbuildParser = {
  meta: {
    name: 'esbuild-espree-ts-parser',
    version: '1.0.0',
  },
  parseForESLint(code, options = {}) {
    const filePath = String(options.filePath || 'file.tsx');
    const loader = filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? 'tsx' : 'ts';
    const { code: rawTransformed } = transformSync(code, {
      loader,
      jsx: 'preserve',
      target: 'esnext',
    });
    // TypeScript enums lower to `var EnumName = /* @__PURE__ */ (...)` in esbuild; keep real `var` caught by no-var
    const transformed = rawTransformed.replace(
      /\bvar ([A-Za-z_$][A-Za-z0-9_$]* = \/\* @__PURE__ \*\/)/g,
      'const $1',
    );
    const ast = espree.parse(transformed, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
      loc: true,
      range: true,
      comment: true,
      tokens: true,
    });
    return {
      ast,
      scopeManager: null,
      visitorKeys: null,
    };
  },
};

// Marks JSX component references (<Component />) as used for ESLint's core no-unused-vars rule
const localJsxPlugin = {
  rules: {
    'jsx-uses-vars': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          JSXOpeningElement(node) {
            let root = node.name;
            while (root && root.type === 'JSXMemberExpression') {
              root = root.object;
            }
            if (root && root.type === 'JSXIdentifier' && /^[A-Z_$]/.test(root.name)) {
              context.sourceCode.markVariableAsUsed(root.name, node);
            }
          },
        };
      },
    },
  },
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  AudioContext: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  MessageEvent: 'readonly',
  PopStateEvent: 'readonly',
  HTMLElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLModElement: 'readonly',
  HTMLIFrameElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLButtonElement: 'readonly',
  SVGSVGElement: 'readonly',
  Node: 'readonly',
  Element: 'readonly',
  File: 'readonly',
  Blob: 'readonly',
  Image: 'readonly',
  XMLSerializer: 'readonly',
  btoa: 'readonly',
  atob: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  Intl: 'readonly',
  globalThis: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  globalThis: 'readonly',
};

const coreCodeRules = {
  'local-jsx/jsx-uses-vars': 'error',
  'no-undef': 'error',
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-debugger': 'error',
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-unsafe-finally': 'error',
  'valid-typeof': 'error',
  eqeqeq: ['warn', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'warn',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'android/**', '.aistudio/**'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { 'local-jsx': localJsxPlugin },
    languageOptions: {
      parser: tsEsbuildParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: coreCodeRules,
  },
  {
    files: ['server.ts', 'vite.config.ts'],
    plugins: { 'local-jsx': localJsxPlugin },
    languageOptions: {
      parser: tsEsbuildParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: coreCodeRules,
  },
];
