import { createCorsOriginDelegate, parseCorsOrigins } from './cors.utils';

describe('cors.utils', () => {
  it('normalizes bare public hostnames to https origins', () => {
    expect(parseCorsOrigins('dash.noderax.net')).toEqual({
      allowAnyOrigin: false,
      origins: ['https://dash.noderax.net'],
    });
  });

  it('normalizes localhost hostnames to http origins', () => {
    expect(parseCorsOrigins('localhost:3001')).toEqual({
      allowAnyOrigin: false,
      origins: ['http://localhost:3001'],
    });
  });

  it('accepts browser origins against bare configured hostnames', () => {
    const delegate = createCorsOriginDelegate('dash.noderax.net');
    const callback = jest.fn();

    delegate('https://dash.noderax.net', callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });
});
