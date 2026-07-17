function normalizeOptionName(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildPrintifyMediaColorMap(printifyProduct, shopifyProduct, imagePositions = null) {
  const options = printifyProduct.options || [];
  const colorOptionIndex = options.findIndex((option) => {
    const name = normalizeOptionName(option.name);
    const type = normalizeOptionName(option.type);
    return (
      name === 'color' ||
      name === 'colour' ||
      name === 'colors' ||
      name === 'colours' ||
      type === 'color' ||
      type === 'colour'
    );
  });

  if (colorOptionIndex < 0) {
    throw new Error('Printify product has no color option.');
  }

  const colorValues = new Map(
    (options[colorOptionIndex].values || []).map((value) => [String(value.id), String(value.title).trim()])
  );
  const variantColors = new Map();

  for (const variant of printifyProduct.variants || []) {
    const colorId = variant.options?.[colorOptionIndex];
    const color = colorValues.get(String(colorId));
    if (color) variantColors.set(String(variant.id), color);
  }

  const printifyImages = printifyProduct.images || [];
  const shopifyImages = shopifyProduct.images || [];
  if (printifyImages.length !== shopifyImages.length) {
    throw new Error(
      `Image count mismatch: Printify has ${printifyImages.length}; Shopify has ${shopifyImages.length}.`
    );
  }

  const colors = {};
  const shared = [];

  printifyImages.forEach((image, index) => {
    const position = imagePositions?.[index] ?? index + 1;
    const imageColors = [
      ...new Set((image.variant_ids || []).map((id) => variantColors.get(String(id))).filter(Boolean)),
    ];

    if (!imageColors.length) {
      shared.push(position);
      return;
    }

    for (const color of imageColors) {
      colors[color] ||= [];
      colors[color].push(position);
    }
  });

  return {
    version: 1,
    printifyProductId: String(printifyProduct.id),
    imageCount: printifyImages.length,
    colors,
    shared,
  };
}
