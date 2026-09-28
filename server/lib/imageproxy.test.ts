import ImageProxy from '@server/lib/imageproxy';
import axios, { type AxiosResponse } from 'axios';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';

type Transform = (buffer: Buffer) => Promise<{
  buffer: Buffer;
  extension: string;
}>;

const optimize: Transform = async (buffer) => ({
  buffer: await sharp(buffer)
    .resize(600, 900, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer(),
  extension: 'webp',
});

describe('image proxy transform', () => {
  let original: Buffer;
  let previousAdapter: typeof axios.defaults.adapter;
  const cached: [ImageProxy, string][] = [];

  const freshProxy = async (transform: Transform, path: string) => {
    const proxy = new ImageProxy('imageproxy-test', 'https://images.test', {
      transform,
    });
    await proxy.clearCachedImage(path);
    cached.push([proxy, path]);
    return proxy;
  };

  before(async () => {
    original = await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 3,
        background: '#808080',
      },
    })
      .jpeg()
      .toBuffer();
  });

  beforeEach(() => {
    previousAdapter = axios.defaults.adapter;
    axios.defaults.adapter = (config) =>
      Promise.resolve({
        data: original,
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': 'max-age=3600',
        },
        config,
        request: {},
      } as AxiosResponse);
  });

  afterEach(() => {
    axios.defaults.adapter = previousAdapter;
  });

  after(async () => {
    for (const [proxy, path] of cached) {
      await proxy.clearCachedImage(path);
    }
  });

  it('serves the optimized image on the first request', async () => {
    const proxy = await freshProxy(optimize, '/first.jpg');

    const image = await proxy.getImage('/first.jpg');

    assert.equal(image.meta.cacheMiss, true);
    assert.equal(image.meta.extension, 'webp');
    const { format, width, height } = await sharp(image.imageBuffer).metadata();
    assert.deepEqual(
      { format, width, height },
      { format: 'webp', width: 600, height: 900 }
    );
  });

  it('serves the same optimized image from the cache afterwards', async () => {
    const proxy = await freshProxy(optimize, '/repeat.jpg');

    const first = await proxy.getImage('/repeat.jpg');
    const second = await proxy.getImage('/repeat.jpg');

    assert.equal(second.meta.cacheMiss, false);
    assert.equal(second.meta.extension, 'webp');
    assert.deepEqual(second.imageBuffer, first.imageBuffer);
  });

  it('falls back to the original when optimizing fails', async () => {
    const proxy = await freshProxy(async () => {
      throw new Error('unsupported image');
    }, '/broken.jpg');

    const image = await proxy.getImage('/broken.jpg');

    assert.deepEqual(image.imageBuffer, original);
  });
});
