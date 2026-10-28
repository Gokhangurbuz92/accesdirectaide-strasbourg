import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GrandEstConnector } from '../../api/lib/ingestion/GrandEstConnector.js';

describe('Scraper Resilience (FR-013)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('immediately throws RESOURCE_NOT_FOUND on 404 without retrying', async () => {
    const connector = new GrandEstConnector();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    try {
      await connector.fetch('http://test.com/404');
    } catch (err) {
      expect(err.code).toBe('RESOURCE_NOT_FOUND');
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 TRANSIENT error', async () => {
    const connector = new GrandEstConnector();
    
    // Mock setTimeout to fire immediately to speed up test
    vi.spyOn(global, 'setTimeout').mockImplementation((cb) => {
        if (typeof cb === 'function') cb();
        return 1;
    });

    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' };
      }
      return { ok: true, text: async () => '<html>success</html>' };
    });

    const html = await connector.fetch('http://test.com/429');
    expect(html).toBe('<html>success</html>');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on 500 TRANSIENT error', async () => {
    const connector = new GrandEstConnector();
    
    vi.spyOn(global, 'setTimeout').mockImplementation((cb) => {
        if (typeof cb === 'function') cb();
        return 1;
    });

    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) {
        return { ok: false, status: 500, statusText: 'Internal Server Error' };
      }
      return { ok: true, text: async () => '<html>success</html>' };
    });

    const html = await connector.fetch('http://test.com/500');
    expect(html).toBe('<html>success</html>');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
