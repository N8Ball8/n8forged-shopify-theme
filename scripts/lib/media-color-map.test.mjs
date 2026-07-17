import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrintifyMediaColorMap } from './media-color-map.mjs';

test('maps uneven image groups from variant ownership without using image order arithmetic', () => {
  const printifyProduct = {
    id: 'hoodie',
    options: [
      { name: 'Size', values: [{ id: 1, title: 'S' }] },
      {
        name: 'Color',
        values: [
          { id: 10, title: 'Light Blue' },
          { id: 11, title: 'Royal' },
          { id: 12, title: 'Red' },
        ],
      },
    ],
    variants: [
      { id: 100, options: [1, 10] },
      { id: 101, options: [1, 11] },
      { id: 102, options: [1, 12] },
    ],
    images: [
      { variant_ids: [100] },
      { variant_ids: [101] },
      { variant_ids: [102] },
      { variant_ids: [100] },
      { variant_ids: [100] },
      { variant_ids: [101] },
      { variant_ids: [102] },
    ],
  };
  const shopifyProduct = { images: Array.from({ length: 7 }) };

  const result = buildPrintifyMediaColorMap(printifyProduct, shopifyProduct);

  assert.deepEqual(result.colors, {
    'Light Blue': [1, 4, 5],
    Royal: [2, 6],
    Red: [3, 7],
  });
});

test('refuses to write a stale map while Shopify and Printify image counts differ', () => {
  const printifyProduct = {
    options: [{ name: 'Color', values: [{ id: 1, title: 'Black' }] }],
    variants: [{ id: 1, options: [1] }],
    images: [{ variant_ids: [1] }],
  };

  assert.throws(
    () => buildPrintifyMediaColorMap(printifyProduct, { images: [] }),
    /Image count mismatch/
  );
});

test('recognizes Printify color options by type when the display name is provider-specific', () => {
  const printifyProduct = {
    id: 'provider-specific-option',
    options: [{ name: 'Shade', type: 'color', values: [{ id: 7, title: 'Navy' }] }],
    variants: [{ id: 70, options: [7] }],
    images: [{ variant_ids: [70] }],
  };

  const result = buildPrintifyMediaColorMap(printifyProduct, { images: [{}] });

  assert.deepEqual(result.colors, { Navy: [1] });
});

test('uses verified Shopify positions instead of assuming Printify and Shopify image order match', () => {
  const printifyProduct = {
    id: 'reordered-images',
    options: [{ name: 'Color', type: 'color', values: [{ id: 1, title: 'Red' }, { id: 2, title: 'Royal' }] }],
    variants: [{ id: 10, options: [1] }, { id: 20, options: [2] }],
    images: [{ variant_ids: [10] }, { variant_ids: [20] }],
  };

  const result = buildPrintifyMediaColorMap(printifyProduct, { images: [{}, {}] }, [2, 1]);

  assert.deepEqual(result.colors, { Red: [2], Royal: [1] });
});
