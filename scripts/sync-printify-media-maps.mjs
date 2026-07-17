import process from 'node:process';
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
  const data = await requestJson(`https://${shopifyStore}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopifyToken,
    },
    body: JSON.stringify({
      query,
      variables: {
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
    }),
  });

  const errors = data.errors || data.data?.metafieldsSet?.userErrors || [];
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

  const shopifyProduct = await requestJson(`${storefrontOrigin}/products/${handle}.js`);
  try {
    const mediaMap = buildPrintifyMediaColorMap(printifyProduct, shopifyProduct);
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
