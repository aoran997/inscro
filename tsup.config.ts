import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    pretext: "src/pretext.ts",
    react: "src/react/index.tsx",
    vue: "src/vue/index.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react/jsx-runtime", "vue"],
  noExternal: ["@chenglou/pretext"]
});
