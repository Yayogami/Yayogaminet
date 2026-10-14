/** Artwork is presentation data. Rules and room messages never reference file paths. */
export async function loadAssets(manifestUrl = new URL('../public/assets.json', import.meta.url)) {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Artwork manifest could not load (${response.status}).`);
  const manifest = await response.json();
  if (manifest.version !== 1 || !manifest.assets) throw new Error('Unsupported artwork manifest.');
  const entries = Object.entries(manifest.assets).map(([id, config]) => {
    if (typeof config.src !== 'string') throw new Error(`Missing source for artwork: ${id}`);
    const url = new URL(config.src, manifestUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported artwork URL: ${id}`);
    for (const field of ['slice', 'borderWidth']) {
      if (config[field] && (!Array.isArray(config[field]) || config[field].length !== 4 || !config[field].every(n => Number.isFinite(n) && n >= 0))) {
        throw new Error(`Artwork ${id}: ${field} must have four nonnegative numbers.`);
      }
    }
    return [id, { ...config, url: url.href }];
  });
  const assets = Object.fromEntries(entries);
  return {
    get(id) {
      if (!assets[id]) throw new Error(`Unknown artwork key: ${id}`);
      return assets[id];
    },
    apply(element, id) {
      const asset = this.get(id);
      if (element instanceof HTMLImageElement) {
        element.src = asset.url;
        element.style.objectFit = asset.fit || 'contain';
        element.style.objectPosition = asset.position || 'center';
      } else if (asset.slice) {
        element.style.borderImageSource = `url(${JSON.stringify(asset.url)})`;
        element.style.borderImageSlice = `${asset.slice.join(' ')} fill`;
        element.style.borderImageWidth = (asset.borderWidth || [20, 20, 20, 20]).map(n => `${n}px`).join(' ');
      } else {
        element.style.backgroundImage = `url(${JSON.stringify(asset.url)})`;
        element.style.backgroundSize = asset.fit || 'cover';
        element.style.backgroundPosition = asset.position || 'center';
      }
    },
  };
}
