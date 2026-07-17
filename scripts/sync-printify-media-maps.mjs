import process from 'node:process';
import { createHash } from 'node:crypto';
import { buildPrintifyMediaColorMap } from './lib/media-color-map.mjs';

const PRINTIFY_API = 'https://api.printify.com/v1';
const SHOPIFY_API_VERSION = '2026-04';
const printifyToken = process.env.PRINTIFY_API_TOKEN;
const configuredShopId = process.env.PRINTIFY_SHOP_ID;
const shopifyClientId = process.env.SHOPIFY_CLIENT_ID;
const shopifyClientSecret = process.env.SHOPIFY_CLIENT_SECRET;
const shopifyStore = process.env.SHOPIFY_STORE_DOMAIN || 'n8forged.myshopify.com';
const storefrontOrigin = (process.env.SHOPIFY_STOREFRONT_ORIGIN || 'https://n8forged.com').replace(/\/$/, '');

if (!printifyToken) throw new Error('PRINTIFY_API_TOKEN is required.');
if (!shopifyClientId) throw new Error('SHOPIFY_CLIENT_ID is required.');
if (!shopifyClientSecret) throw new Error('SHOPIFY_CLIENT_SECRET is required.');

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} for ${url}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function requestBuffer(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = new Error(`${response.status} for ${url}`);
      if (response.status < 500 && response.status !== 429) throw lastError;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw lastError;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function digestImages(images, getUrl) {
  return mapWithConcurrency(images, 6, async (image) => {
    const buffer = await requestBuffer(getUrl(image));
    return createHash('sha256').update(buffer).digest('hex');
  });
}

async function matchShopifyImagePositions(printifyImages, shopifyImages) {
  const [printifyDigests, shopifyDigests] = await Promise.all([
    digestImages(printifyImages, (image) => image.src),
    digestImages(shopifyImages, (image) => image.url),
  ]);
  const positionsByDigest = new Map();

  shopifyDigests.forEach((digest, index) => {
    const positions = positionsByDigest.get(digest) || [];
    positions.push(index + 1);
    positionsByDigest.set(digest, positions);
  });

  const positions = printifyDigests.map((digest) => positionsByDigest.get(digest)?.shift() || null);
  const unmatched = positions.filter((position) => position === null).length;
  if (unmatched) {
    throw new Error(`${unmatched} of ${positions.length} Printify images could not be matched to Shopify by identity.`);
  }
  return positions;
}

async function printify(path) {
  return requestJson(`${PRINTIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${printifyToken}`, 'Content-Type': 'application/json' },
  });
}

async function getShopId() {
  if (configuredShopId) return configuredShopId;
  const shops = await printify('/shops.json');
  const connected = shops.filter((shop) => shop.sales_channel?.toLowerCase().includes('shopify'));
  if (connected.length !== 1) {
    throw new Error(`Set PRINTIFY_SHOP_ID; found ${connected.length} connected Shopify shops.`);
  }
  return String(connected[0].id);
}

async function getProducts(shopId) {
  const products = [];
  for (let page = 1; ; page += 1) {
    const response = await printify(`/shops/${shopId}/products.json?limit=50&page=${page}`);
    products.push(...response.data);
    if (page >= response.last_page) return products;
  }
}

async function getShopifyAccessToken() {
  const response = await requestJson(`https://${shopifyStore}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: shopifyClientId,
      client_secret: shopifyClientSecret,
    }),
  });

  if (!response.access_token) throw new Error('Shopify did not return an access token.');
  return response.access_token;
}

async function shopifyGraphql(query, variables, shopifyToken) {
  const response = await requestJson(`https://${shopifyStore}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopifyToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.errors?.length) throw new Error(`Shopify GraphQL error: ${JSON.stringify(response.errors)}`);
  return response.data;
}

async function getShopifyProduct(handle, shopifyToken) {
  const data = await shopifyGraphql(
    `
      query ProductForMediaMap($identifier: ProductIdentifierInput!) {
        product: productByIdentifier(identifier: $identifier) {
          id
          media(first: 250) {
            nodes {
              id
              ... on MediaImage {
                image { url }
              }
            }
          }
        }
      }
    `,
    { identifier: { handle } },
    shopifyToken
  );

  if (!data.product) throw new Error(`Shopify product not found for handle ${handle}.`);

  return {
    id: data.product.id.split('/').pop(),
    images: data.product.media.nodes
      .filter((media) => media.image?.url)
      .map((media) => ({ id: media.id, url: media.image.url })),
  };
}

function getShopifyHandle(product) {
  const handle = product.external?.handle;
  if (!handle) return null;
  const match = new URL(handle, storefrontOrigin).pathname.match(/\/products\/([^/?#]+)/);
  return match?.[1] || null;
}

async function setMediaMap(productId, value, shopifyToken) {
  const query = `
    mutation SetMediaColorMap($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message code }
      }
    }
  `;
  const data = await shopifyGraphql(
    query,
    {
      metafields: [
        {
          ownerId: `gid://shopify/Product/${productId}`,
          namespace: 'n8f',
          key: 'media_color_map',
          type: 'json',
          value: JSON.stringify(value),
        },
      ],
    },
    shopifyToken
  );

  const errors = data.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(`Shopify metafield error: ${JSON.stringify(errors)}`);
}

const shopId = await getShopId();
const shopifyToken = await getShopifyAccessToken();
const summaries = await getProducts(shopId);
const results = [];

for (const summary of summaries) {
  if (!summary.visible) continue;

  const printifyProduct = await printify(`/shops/${shopId}/products/${summary.id}.json`);
  const handle = getShopifyHandle(printifyProduct);
  if (!handle) continue;

  try {
    const shopifyProduct = await getShopifyProduct(handle, shopifyToken);
    const imagePositions = await matchShopifyImagePositions(printifyProduct.images || [], shopifyProduct.images);
    const mediaMap = buildPrintifyMediaColorMap(printifyProduct, shopifyProduct, imagePositions);
    await setMediaMap(shopifyProduct.id, { ...mediaMap, syncedAt: new Date().toISOString() }, shopifyToken);
    results.push({ handle, status: 'synced', colors: Object.keys(mediaMap.colors).length });
  } catch (error) {
    results.push({ handle, status: 'skipped', reason: error.message });
  }
}

console.table(results);
const skipped = results.filter((result) => result.status === 'skipped');
if (skipped.length) {
  throw new Error(`${skipped.length} product media map(s) were not synchronized.`);
}
