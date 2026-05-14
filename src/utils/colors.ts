const wrap =
  (code: string) =>
  (text: string): string =>
    `\x1b[${code}m${text}\x1b[0m`;

export const colors = {
  red: wrap("31"),
  brightRed: wrap("91"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  gray: wrap("90"),
  dim: wrap("2"),
  bold: wrap("1"),
  orange: (text: string) => `\x1b[1m\x1b[38;5;208m${text}\x1b[0m`,
  reset: "\x1b[0m",
};
