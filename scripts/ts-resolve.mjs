/**
 * Lets `node --experimental-strip-types` follow extensionless imports.
 *
 * App code imports `./grading` (the bundler resolves it); Node's ESM resolver
 * wants `./grading.ts`. This hook appends the extension, so the content
 * scripts and the tests run the app's modules unchanged.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:[cm]?[jt]sx?|json)$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      return await nextResolve(`${specifier}/index.ts`, context);
    }
  }
  return nextResolve(specifier, context);
}
