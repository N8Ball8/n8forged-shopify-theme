(() => {
  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  };

  document.querySelectorAll('[data-n8f-share]').forEach((share) => {
    const isAuction = Boolean(document.querySelector('n8forged-auction'));
    const productSection = share.closest('.shopify-section');
    const productTitle = productSection?.querySelector('.product-details h1');

    if (!isAuction && productTitle) {
      const productShares = productSection.querySelectorAll('[data-n8f-share]');
      if (productShares[0] !== share) {
        share.remove();
        return;
      }
      productTitle.closest('.text-block')?.insertAdjacentElement('afterend', share);
    }

    if (isAuction) {
      const url = `${window.location.origin}/pages/contact?view=art-auction`;
      const title = 'Bid on Joy in Our Chains: Support our Costa Rica mission';
      const encodedUrl = encodeURIComponent(url);
      const encodedTitle = encodeURIComponent(title);
      const previewImage = document.querySelector('meta[property="og:image"]')?.content || '';

      share.dataset.shareUrl = url;
      share.dataset.shareTitle = title;

      const facebook = share.querySelector('a[href*="facebook.com/sharer"]');
      const x = share.querySelector('a[href*="twitter.com/intent"]');
      const pinterest = share.querySelector('a[href*="pinterest.com/pin"]');
      const email = share.querySelector('a[href^="mailto:"]');
      if (facebook) facebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
      if (x) x.href = `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`;
      if (pinterest) pinterest.href = `https://pinterest.com/pin/create/button/?url=${encodedUrl}${previewImage ? `&media=${encodeURIComponent(previewImage)}` : ''}&description=${encodedTitle}`;
      if (email) email.href = `mailto:?subject=${encodedTitle}&body=${encodedUrl}`;
    }
    if (navigator.share) share.classList.add('has-native-share');
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-n8f-share] a, [data-share-copy], [data-native-share]');
    if (!button) return;
    const share = button.closest('[data-n8f-share]');
    if (!share) return;
    const url = share.dataset.shareUrl || window.location.href;
    const title = share.dataset.shareTitle || document.title;
    const status = share.querySelector('[data-share-status]');
    const platform = button.hasAttribute('data-native-share')
      ? 'native'
      : button.dataset.shareCopy || button.title?.toLowerCase() || 'unknown';

    window.N8ForgedTracking?.publish('share_click', {
      platform,
      content_type: document.querySelector('n8forged-auction') ? 'auction' : 'tshirt',
      shared_url: url,
    });

    if (button.matches('a')) return;

    try {
      if (button.hasAttribute('data-native-share') && navigator.share) {
        await navigator.share({ title, url });
        if (status) status.textContent = 'Share options opened.';
        return;
      }
      await copyText(url);
      if (status) {
        status.textContent = button.dataset.shareCopy === 'instagram'
          ? 'Link copied. Paste it into your Instagram story or bio.'
          : 'Link copied to your clipboard.';
      }
    } catch (_) {
      if (status) status.textContent = 'Unable to share automatically. Copy the address from your browser.';
    }
  });
})();
