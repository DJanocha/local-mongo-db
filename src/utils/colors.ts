export const colors = {
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  brightRed: (text: string) => `\x1b[91m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  orange: (text: string) => `\x1b[1m\x1b[38;5;208m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  reset: "\x1b[0m",
};
