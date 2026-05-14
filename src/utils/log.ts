import { colors } from "./colors";

/**
 * Semantic console output. Each level owns a colour so the CLI reads at a
 * glance: cyan = in progress, green = done, yellow = caution, red = failure,
 * gray = low-signal detail.
 */
export const log = {
  /** A headline action is starting. */
  info: (msg: string, ...rest: unknown[]) =>
    console.log(colors.cyan(msg), ...rest),
  /** An action finished successfully. */
  success: (msg: string, ...rest: unknown[]) =>
    console.log(colors.green(msg), ...rest),
  /** Something the user should notice but isn't a failure. */
  warn: (msg: string, ...rest: unknown[]) =>
    console.warn(colors.yellow(msg), ...rest),
  /** An operation failed. */
  error: (msg: string, ...rest: unknown[]) =>
    console.error(colors.brightRed(msg), ...rest),
  /** Low-signal progress detail — sub-steps of a headline action. */
  step: (msg: string, ...rest: unknown[]) =>
    console.log(colors.gray(msg), ...rest),
  /** Emphasised heading. */
  heading: (msg: string, ...rest: unknown[]) =>
    console.log(colors.bold(colors.cyan(msg)), ...rest),
  /** Uncoloured passthrough — for content the user reads literally. */
  plain: (msg: string, ...rest: unknown[]) => console.log(msg, ...rest),
};

/** Prints a centred-ish banner block in the given colour. */
export const banner = (
  lines: string[],
  paint: (text: string) => string = colors.cyan,
): void => {
  const rule = paint("═".repeat(60));
  console.log("\n" + rule);
  for (const line of lines) console.log(paint(line));
  console.log(rule + "\n");
};
