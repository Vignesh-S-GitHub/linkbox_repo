import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
export default tseslint.config({ignores:["dist",".wrangler"]},{extends:[js.configs.recommended,...tseslint.configs.recommended],files:["**/*.ts"],languageOptions:{globals:{...globals.worker,...globals.node}},rules:{"@typescript-eslint/no-explicit-any":"error"}});
