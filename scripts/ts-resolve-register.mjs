/** Registers `ts-resolve.mjs` for the test run. See that file for why. */
import { register } from "node:module";
register("./ts-resolve.mjs", import.meta.url);
