import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const PRINTIFY_API = 'https://api.printify.com/v1';
const token = process.env.PRINTIFY_API_TOKEN;
const configuredShopId = process.env.PRINTIFY_SHOP_ID;
const storefrontOrigin = (process.env.SHOPIFY_STOREFRONT_ORIGIN || 'https://n8forged.com').replace(/\/$/, '');
const reportPath = process.env.AUDIT_REPORT_PATH || '.audit/printify-shopify-audit.json';

if (!token) {
  throw new Error('PRINTIFY_API_TOKEN is required. Store it as a GitHub Actions secret.');
}

async function printify(path, options = {}) {
  const response = await fetch(`${PRINTIFY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Printify ${response.status} for ${path}: ${await response.text()}`);
  }

  return response.status === 204 ? null : response.json();
}

async function getShopId() {
  if (configuredShopId) return configuredShopId;

  const shops = await printify('/shops.json');
  const connected = shops.filter((shop) => shop.sales_channel?.toLowerCase().includes('shopify'));

  if (connected.length !== 1) {
    throw new Error(
      `Unable to choose one Shopify shop automatically. Set PRINTIFY_SHOP_ID. Found ${connected.length} Shopify shops.`
    );
  }

  return String(connected[0].id);
}

async function getProducts(shopId) {
  const products = [];
  let page = 1;

  while (true) {
    const response = await printify(`/shops/${shopId}/products.json?limit=50&page=${page}`);
    products.push(...response.data);
    if (page >= response.last_page) break;
    page += 1;
  }

  return products;
}

function getShopifyHandle(product) {
  const handle = product.external?.handle;
  if (!handle) return null;

  try {
    const url = new URL(handle, storefrontOrigin);
    const match = url.pathname.match(/\/products\/([^/?#]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function makeSkuMap(variants) {
  const map = new Map();
  for (const variant of variants) {
    if (variant.sku) map.set(variant.sku, variant);
  }
  return map;
}

function auditProduct(printifyProduct, shopifyProduct, handle) {
  const findings = [];
  const printifyVariants = printifyProduct.variants.filter((variant) => variant.is_enabled);
  const printifyBySku = makeSkuMap(printifyVariants);
  const shopifyBySku = makeSkuMap(shopifyProduct.variants);

  for (const variant of printifyVariants) {
    if (!variant.sku) {
      findings.push({ severity: 'error', type: 'missing_printify_sku', variant: variant.title });
      continue;
    }

    const shopifyVariant = shopifyBySku.get(variant.sku);
    if (!shopifyVariant) {
      findings.push({ severity: 'error', type: 'missing_shopify_variant', sku: variant.sku, variant: variant.title });
      continue;
    }

    if (Boolean(variant.is_available) !== Boolean(shopifyVariant.available)) {
      findings.push({
        severity: 'error',
        type: 'availability_mismatch',
        sku: variant.sku,
        variant: variant.title,
        printify: Boolean(variant.is_available),
        shopify: Boolean(shopifyVariant.available),
      });
    }

    if (Number(variant.price) !== Number(shopifyVariant.price)) {
      findings.push({
        severity: 'warning',
        type: 'price_mismatch',
        sku: variant.sku,
        variant: variant.title,
        printify: Number(variant.price),
        shopify: Number(shopifyVariant.price),
      });
    }

    if (!shopifyVariant.featured_image) {
      findings.push({ severity: 'warning', type: 'missing_featured_image', sku: variant.sku, variant: variant.title });
    }
  }

  for (const variant of shopifyProduct.variants) {
    if (variant.sku && !printifyBySku.has(variant.sku)) {
      findings.push({ severity: 'warning', type: 'shopify_only_variant', sku: variant.sku, variant: variant.title });
    }
  }

  const n8fTags = shopifyProduct.tags.filter((tag) => tag.toLowerCase().startsWith('n8f-'));
  if (!n8fTags.some((tag) => tag.toLowerCase().startsWith('n8f-family-'))) {
    findings.push({ severity: 'warning', type: 'missing_n8f_family_tag' });
  }
  if (!n8fTags.some((tag) => tag.toLowerCase().startsWith('n8f-style-'))) {
    findings.push({ severity: 'warning', type: 'missing_n8f_style_tag' });
  }

  const printifyImageCount = printifyProduct.images?.length || 0;
  const shopifyImageCount = shopifyProduct.images?.length || 0;
  if (printifyImageCount !== shopifyImageCount) {
    findings.push({
      severity: 'warning',
      type: 'image_count_mismatch',
      printify: printifyImageCount,
      shopify: shopifyImageCount,
    });
  }

  return {
    printifyId: printifyProduct.id,
    shopifyId: shopifyProduct.id,
    handle,
    title: shopifyProduct.title,
    variants: { printifyEnabled: printifyVariants.length, shopify: shopifyProduct.variants.length },
    images: { printify: printifyImageCount, shopify: shopifyImageCount },
    n8fTags,
    findings,
  };
}

function markdownSummary(report) {
  const lines = [
    '# Printify and Shopify Audit',
    '',
    `- Checked: ${report.checkedAt}`,
    `- Products audited: ${report.summary.productsAudited}`,
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Skipped products: ${report.summary.productsSkipped}`,
    '',
  ];

  for (const product of report.products) {
    const status = product.findings.length ? 'Needs review' : 'Matched';
    lines.push(`## ${product.title}`, '', `Status: **${status}**`, '');
    for (const finding of product.findings) {
      const details = Object.entries(finding)
        .filter(([key]) => !['severity', 'type'].includes(key))
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(', ');
      lines.push(`- ${finding.severity.toUpperCase()}: \`${finding.type}\`${details ? ` (${details})` : ''}`);
    }
    if (!product.findings.length) lines.push('- No discrepancies found.');
    lines.push('');
  }

  if (report.skipped.length) {
    lines.push('## Skipped', '');
    for (const skipped of report.skipped) lines.push(`- ${skipped.title}: ${skipped.reason}`);
  }

  return lines.join('\n');
}

const shopId = await getShopId();
const printifyProducts = await getProducts(shopId);
const products = [];
const skipped = [];

for (const productSummary of printifyProducts) {
  if (!productSummary.visible) continue;

  // The product list can omit details used by this audit, so compare against
  // the full product record instead of trusting the abbreviated response.
  const printifyProduct = await printify(`/shops/${shopId}/products/${productSummary.id}.json`);
  const handle = getShopifyHandle(printifyProduct);
  if (!handle) {
    skipped.push({ id: printifyProduct.id, title: printifyProduct.title, reason: 'No Shopify product handle' });
    continue;
  }

  const response = await fetch(`${storefrontOrigin}/products/${handle}.js`);
  if (!response.ok) {
    skipped.push({ id: printifyProduct.id, title: printifyProduct.title, reason: `Shopify returned ${response.status}` });
    continue;
  }

  products.push(auditProduct(printifyProduct, await response.json(), handle));
}

const findings = products.flatMap((product) => product.findings);
const report = {
  mode: 'audit-only',
  checkedAt: new Date().toISOString(),
  shopId,
  storefrontOrigin,
  summary: {
    productsAudited: products.length,
    productsSkipped: skipped.length,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
  },
  products,
  skipped,
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const summary = markdownSummary(report);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

if (report.summary.errors > 0 || report.summary.warnings > 0 || report.summary.productsSkipped > 0) {
  process.exitCode = 1;
}
