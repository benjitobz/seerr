import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AxiosAdapter, AxiosInstance } from 'axios';
import axios, { AxiosError } from 'axios';

import Hardcover, {
  pickSeriesBooks,
  retryOnRateLimit,
} from '@server/api/hardcover';

function statusSequence(statuses: number[], retryAfter = '0.01') {
  let calls = 0;
  const adapter: AxiosAdapter = async (config) => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls++;
    const response = {
      data: { ok: status === 200 },
      status,
      statusText: String(status),
      headers: { 'retry-after': retryAfter },
      config,
    };

    if (status !== 200) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        response
      );
    }

    return response;
  };

  return { adapter, calls: () => calls };
}

describe('Hardcover rate limiting', () => {
  it('retries a request that Hardcover rate limited', async () => {
    const sequence = statusSequence([429, 200]);
    const instance = axios.create({ adapter: sequence.adapter });
    retryOnRateLimit(instance);

    const response = await instance.post('/', {});

    assert.strictEqual(response.status, 200);
    assert.strictEqual(sequence.calls(), 2);
  });

  it('gives up after two retries', async () => {
    const sequence = statusSequence([429]);
    const instance = axios.create({ adapter: sequence.adapter });
    retryOnRateLimit(instance);

    await assert.rejects(() => instance.post('/', {}), /status code 429/);
    assert.strictEqual(sequence.calls(), 3);
  });

  it('does not retry other errors', async () => {
    const sequence = statusSequence([500]);
    const instance = axios.create({ adapter: sequence.adapter });
    retryOnRateLimit(instance);

    await assert.rejects(() => instance.post('/', {}), /status code 500/);
    assert.strictEqual(sequence.calls(), 1);
  });

  it('shares one rate-limited client between instances', () => {
    const first = (new Hardcover() as unknown as { axios: AxiosInstance })
      .axios;
    const second = (new Hardcover() as unknown as { axios: AxiosInstance })
      .axios;

    assert.strictEqual(first, second);
  });
});

describe('pickSeriesBooks', () => {
  const row = (position: number, id: number, title: string, users: number) =>
    ({ position, book: { id, title, users_count: users } }) as never;

  it('keeps the most-read book at each position', () => {
    const picked = pickSeriesBooks([
      row(1, 431448, 'Slow Horses', 1018),
      row(1, 3006894, 'Sløve hester', 1),
      row(2, 510379, 'Dead Lions', 440),
      row(2, 706291, 'Dode leeuwen', 10),
    ]);

    assert.deepEqual(
      picked.map((entry) => entry.book.id),
      [431448, 510379]
    );
  });

  it('drops sets and keeps editions at fractional positions', () => {
    const picked = pickSeriesBooks([
      row(1, 1, 'The Slough House Thrillers Books 1-3', 5000),
      row(1, 2, 'Slow Horses', 1018),
      row(2.5, 3, 'The List', 137),
    ]);

    assert.deepEqual(
      picked.map((entry) => entry.book.id),
      [2, 3]
    );
  });
});
