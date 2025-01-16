// tokenize functions splits a string of CLI flags by whitespace, additionally handling double-quoted
// and space separated string values
export function tokenize (input: string): string[] {
  // This regular expression looks for:
  // 1. Sequences inside double quotes which may contain spaces (captured including the quotes)
  // 2. Or sequences of non-space characters
  const argRegex = /"[^"]*"|\S+/g

  const matches = input.match(argRegex)
  return matches ? matches.map(arg => {
    // Preserve the double quotes around arguments that contain spaces
    if (arg.startsWith('"') && arg.endsWith('"')) {
      return arg
    }
    return arg
  }) : []
}
