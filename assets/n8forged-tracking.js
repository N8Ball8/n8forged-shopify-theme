(() => {
  const PREFIX = 'n8forged:';

  const clean = (value) => String(value ?? '').trim().slice(0, 100);

  const publish = (eventName, eventData = {}) => {
    if (!window.Shopify?.analytics?.publish) return false;

    const data = {
      page_path: window.location.pathname,
      page_title: document.title,
      ...eventData,
    };

    Object.keys(data).forEach((key) => {
      if (typeof data[key] === 'string') data[key] = clean(data[key]);
    });

    return window.Shopify.analytics.publish(`${PREFIX}${eventName}`, data);
  };

  window.N8ForgedTracking = { publish };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-n8f-track-event]');
    if (!trigger) return;

    publish(trigger.dataset.n8fTrackEvent, {
      link_url: trigger.href || '',
      link_text: trigger.dataset.n8fTrackLabel || trigger.textContent,
      person: trigger.dataset.n8fTrackPerson || '',
      placement: trigger.dataset.n8fTrackPlacement || '',
    });
  });
})();
