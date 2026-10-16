import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { builtinModules } from "node:module";
import { BOUNDARIES, PLUGIN_ONLY_SPECIFIER } from "./scripts/boundaries.mjs";
import { NATIVE_NOTICE, NO_NATIVE_TITLE, PARSE_YAML_USES, VISION_FIELD_READS, VISION_ON_USES } from "./scripts/lintRules.mjs";

// Keep the directory rules and add the restrictions for shared helpers.
const restrictedGlobals = new Map();
for (const config of obsidianmd.configs.recommended) {
  const rule = config.rules?.["no-restricted-globals"];
  if (Array.isArray(rule)) for (const entry of rule.slice(1)) {
    restrictedGlobals.set(typeof entry === "string" ? entry : entry.name, entry);
  }
}
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "localStorage", "indexedDB"]) {
  restrictedGlobals.set(name, { name, message: "Shared helpers must receive data from their caller." });
}
const nodeNames = builtinModules.map(name => name.replace(/^node:/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// Obsidian's community directory scores the plugin with `recommended`, so every
// finding of those rules is a public scorecard row. Additions below only make
// the local gate stricter, never looser.
//
// The overrides are limited to script files. `recommended` also lints
// `package.json` (without the TypeScript plugin), and an unscoped
// `@typescript-eslint/*` rule there is a fatal ESLint error, which is what
// Obsidian's whole-repository scan runs into.
const SCRIPT_FILES = ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"];

// The files the selectors of scripts/lintRules.mjs make an exception for.
const NOTE_YAML_PARSER = "src/app/services/noteYaml.ts";
const ATLAS_NOTICE = "src/app/ui/notice.ts";

// The two files that may ask `visionOn`: no source without vision on, whatever a policy says,
// and the selection's check of every token.
const VISION_ON_ASKERS = ["src/app/vision/sight.ts", "src/app/vision/selectSight.ts"];

export default defineConfig([
  // The player client and the relay are not Obsidian plugin code: scripts/eslint.player.config.mjs and
  // scripts/eslint.relay.config.mjs lint them (npm run lint:player, npm run lint:relay).
  globalIgnores(["atlas-website/", "token-ui-examples/", "party/", "logs/", "benchmarks/", "release/", "dist/", "node_modules/", "test-vault/", "networking-test-vault/", "tests/", "scripts/", "docs/", "vite/", "player/", "relay/", "**/*.test.*", "*.js", "*.cjs", "*.mjs", "*.mts", "*.config.ts"]),
  ...obsidianmd.configs.recommended,
  {
    files: SCRIPT_FILES,
    rules: {
      // "Atlas" is the product name. `ignoreWords` rather than `brands`,
      // because `brands` replaces the rule's built-in list (Obsidian, GitHub, …).
      "obsidianmd/ui/sentence-case": ["warn", { ignoreWords: ["Atlas", "Fantasy", "Statblocks"] }],
      // Stricter than the scorecard: type errors are fixed, not silenced.
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-ignore": true,
        "ts-nocheck": true,
        "ts-expect-error": true,
      }],
      "no-restricted-syntax": ["error", ...NATIVE_NOTICE, ...NO_NATIVE_TITLE, ...PARSE_YAML_USES],
    },
  },
  // Which tokens give sight and which a picture always shows is decided in one place,
  // `vision/tokenSightPolicy.ts`. A later block replaces the rule's options for the files it
  // matches, so both blocks repeat the `title` selectors.
  {
    files: ["src/app/vision/**/*.{ts,tsx}", "src/app/pixi/lighting/**/*.{ts,tsx}"],
    ignores: ["src/app/vision/tokenSightPolicy.ts", ...VISION_ON_ASKERS, "**/__tests__/**"],
    rules: {
      "no-restricted-syntax": ["error", ...NATIVE_NOTICE, ...NO_NATIVE_TITLE, ...PARSE_YAML_USES, ...VISION_FIELD_READS, ...VISION_ON_USES],
    },
  },
  {
    files: VISION_ON_ASKERS,
    rules: {
      "no-restricted-syntax": ["error", ...NATIVE_NOTICE, ...NO_NATIVE_TITLE, ...PARSE_YAML_USES, ...VISION_FIELD_READS],
    },
  },
  {
    files: [NOTE_YAML_PARSER],
    rules: {
      "no-restricted-syntax": ["error", ...NATIVE_NOTICE, ...NO_NATIVE_TITLE],
    },
  },
  {
    files: [ATLAS_NOTICE],
    rules: {
      "no-restricted-syntax": ["error", ...NO_NATIVE_TITLE, ...PARSE_YAML_USES],
    },
  },
  // Statblocks: only the drag-and-drop wrapper may import dnd-kit, and the pure
  // core (model, format, expressions, values, the patcher, the FS layout
  // converter) imports neither Obsidian nor React. The core rule is used
  // because the obsidianmd preset owns the TypeScript variant, and overriding
  // it would drop its options.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/statblocks/editor/dnd/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@dnd-kit/*"], message: "Only statblocks/editor/dnd/ imports dnd-kit." }],
      }],
    },
  },
  {
    files: [
      "src/app/statblocks/{model,format,expressions,values}/**/*.{ts,tsx}",
      "src/app/statblocks/notes/{frontmatterPatch,frontmatterBounds,frontmatterModel,yamlSplice,yamlDocument,yamlValueText,listIdentity,patchTypes}.ts",
      "src/app/statblocks/fs/{fsLayoutToTemplate,fsBlocks,fsBlockParts,fsLeafBlocks,fsCallbackPatterns,fsCallbackSyntax,fsCallbackLexer,fsImportState,fsScripts,fsLayoutTypes,fsTrackReplacement}.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "obsidian", message: "The statblock core is pure: no Obsidian." },
          { name: "react", message: "The statblock core is pure: no React." },
          { name: "react-dom", message: "The statblock core is pure: no React." },
        ],
        patterns: [{ group: ["@dnd-kit/*"], message: "Only statblocks/editor/dnd/ imports dnd-kit." }],
      }],
    },
  },
  {
    files: SCRIPT_FILES,
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    linterOptions: {
      // Findings are fixed at their root. An accepted exception is recorded in
      // eslint.suppressions.json, where a review sees it, never in a comment.
      // The file is not at ESLint's default location on purpose: Obsidian's
      // directory review runs ESLint with its own rule set, and a suppression
      // that set does not use makes ESLint exit 2, which the review reports
      // as a fatal error. Only npm run lint passes --suppressions-location.
      noInlineConfig: true,
    },
  },
  {
    files: BOUNDARIES.shared.include,
    ignores: BOUNDARIES.shared.exclude,
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: `^(obsidian|electron)(/|$)|^(@codemirror|@lezer)/|^node:|^(?:${nodeNames.join("|")})(/|$)|^(src/|@/)|${PLUGIN_ONLY_SPECIFIER.source}`,
          message: "Shared helpers must not import plugin services or host APIs.",
        }],
      }],
      "no-restricted-globals": ["error", {
        globals: [...restrictedGlobals.values()],
        checkGlobalObject: true,
      }],
    },
  },
]);
