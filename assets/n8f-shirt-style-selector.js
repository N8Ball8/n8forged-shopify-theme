import { Component } from '@theme/component';

class N8FShirtStyleSelector extends Component {
  async connectedCallback() {
    super.connectedCallback();

    const familyTag = this.dataset.familyTag;
    const currentHandle = this.dataset.currentHandle;
    const options = this.querySelector('[data-n8f-style-options]');
    if (!familyTag || !currentHandle || !options) return;

    try {
      const response = await fetch(`/collections/all/${encodeURIComponent(familyTag)}?section_id=n8f-family-products`);
      if (!response.ok) return;

      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      const familyOptions = html.querySelector('[data-n8f-family-options]');
      if (!familyOptions) return;

      familyOptions.querySelectorAll('[data-product-handle]').forEach((link) => {
        const isCurrent = link.getAttribute('data-product-handle') === currentHandle;
        link.classList.toggle('n8f-shirt-style-selector__option--selected', isCurrent);
        if (isCurrent) link.setAttribute('aria-current', 'true');
      });

      options.replaceChildren(...familyOptions.children);
    } catch (error) {
      console.warn('[n8f-shirt-style-selector] Unable to load related shirt styles:', error);
    }
  }
}

if (!customElements.get('n8f-shirt-style-selector')) {
  customElements.define('n8f-shirt-style-selector', N8FShirtStyleSelector);
}
