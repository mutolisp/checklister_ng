export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.(m|c)?(j|t)s(on)?$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      // fall through — it may be a real extensionless JS module
    }
  }
  return next(specifier, context);
}
