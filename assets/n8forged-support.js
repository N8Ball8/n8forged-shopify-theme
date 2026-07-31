(() => {
  const revealOnlyIfNeeded = (element) => {
    const margin = 24;
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    if (rect.height > viewportHeight - margin * 2 || rect.top < margin) {
      window.scrollBy({ top: rect.top - margin, behavior: 'smooth' });
      return;
    }

    if (rect.bottom > viewportHeight - margin) {
      window.scrollBy({ top: rect.bottom - viewportHeight + margin, behavior: 'smooth' });
    }
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-prayer-toggle]');
    if (!trigger) return;

    const prayerPanel = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!prayerPanel) return;

    const willOpen = prayerPanel.hidden;
    prayerPanel.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));

    const arrow = trigger.querySelector('[data-prayer-arrow]');
    if (arrow) arrow.classList.toggle('is-open', willOpen);

    if (willOpen) {
      window.N8ForgedTracking?.publish('prayer_needs_open', { placement: 'homepage_support' });
      requestAnimationFrame(() => {
        revealOnlyIfNeeded(prayerPanel);
      });
    }
  });
})();
