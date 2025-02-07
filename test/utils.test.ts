import { tokenize } from '../src/utils'

describe('utils.tokenize', () => {
  it('should handle normal unquoted words', () => {
    const result = tokenize('--flag1 flag1value --anotherFlag')
    expect(result).toEqual(['--flag1', 'flag1value', '--anotherFlag'])
  })

  it('should handle single quoted group', () => {
    const result = tokenize('--flag1 "multi value"')
    expect(result).toEqual(['--flag1', '"multi value"'])
  })

  it('should handle multiple quoted groups', () => {
    const result = tokenize('--flag1 "multi value" --anotherFlag "another multi value" --flag333')
    expect(result).toEqual(['--flag1', '"multi value"', '--anotherFlag', '"another multi value"', '--flag333'])
  })

  it('should handle empty quotes', () => {
    const result = tokenize('--flag1 "" --flag2')
    expect(result).toEqual(['--flag1', '""', '--flag2'])
  })

  it('should correctly tokenize empty input', () => {
    const result = tokenize('')
    expect(result).toEqual([])
  })

  it('should handle comma separated and quoted values', () => {
    const result = tokenize('--sources .github/scripts/kubernetes-namespace.sh --scriptArguments "setup,kube_name--space-cucumber,some--context--123"')
    expect(result).toEqual(['--sources', '.github/scripts/kubernetes-namespace.sh', '--scriptArguments', '"setup,kube_name--space-cucumber,some--context--123"'])
  })
})
