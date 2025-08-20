export type Logger = {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

export function createLogger(verbose?: boolean): Logger {
  if (!verbose) {
    return {
      info: () => {},
      warn: (...a) => console.warn("[warn]", ...a),
      error: (...a) => console.error("[error]", ...a),
    };
  }
  return {
    info: (...a) => console.error("[info]", ...a),
    warn: (...a) => console.warn("[warn]", ...a),
    error: (...a) => console.error("[error]", ...a),
  };
}
