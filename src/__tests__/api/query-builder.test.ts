import { QueryBuilder } from '../../api/query/query-builder.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

const builder = () => new QueryBuilder({ type: 'basic', token: 'dGVzdA==' });

describe('QueryBuilder.where - TP doubled-quote escaping', () => {
  it('accepts a value containing a single apostrophe escaped by doubling', () => {
    const qb = builder();
    // Name eq 'O''Brien' — TP syntax for apostrophe in value
    expect(() => qb.where("Name eq 'O''Brien'")).not.toThrow();
  });

  it('preserves doubled single quotes in the built where clause', () => {
    const qb = builder();
    qb.where("Name eq 'O''Brien'");
    const params = qb.buildParams();
    expect(params.get('where')).toBe("Name eq 'O''Brien'");
  });

  it('does not split on " and " inside a value with a doubled quote', () => {
    const qb = builder();
    // Value contains " and " — should not be split
    expect(() => qb.where("Name eq 'Smith''s and Jones'")).not.toThrow();
    const params = qb.buildParams();
    expect(params.get('where')).toBe("Name eq 'Smith''s and Jones'");
  });

  it('still splits on " and " between two valid conditions', () => {
    const qb = builder();
    qb.where("Name eq 'Alice' and Id eq '1'");
    const params = qb.buildParams();
    // Both conditions joined back with and
    expect(params.get('where')).toContain(' and ');
  });

  it('rejects an unmatched single quote (injection attempt)', () => {
    const qb = builder();
    expect(() => qb.where("Name eq 'bad")).toThrow(McpError);
  });
});
