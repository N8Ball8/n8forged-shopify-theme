(() => {
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
        prayerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  });
})();
