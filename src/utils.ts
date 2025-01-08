// tokenize functions splits a string of CLI flags by whitespace, additionally handling
export function tokenize (input: string): string[] {
  // Regular expression to find quoted strings or sequences of non-whitespace characters
  const regex = /"([^"]*)"|\S+/g

  const tokens: string[] = []
  let match: RegExpExecArray | null

  // Use the exec method to find all matches in the input string
  while ((match = regex.exec(input)) !== null) {
    // match[1] will hold the matched content inside quotes if it exists,
    // otherwise use match[0] which covers the non-quoted matches
    if (match[1] !== undefined) {
      tokens.push(match[1]) // Pushes the inside of the quotes to the array
    } else {
      tokens.push(match[0]) // Pushes the non-quoted match to the array
    }
  }

  return tokens
}
