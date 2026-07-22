class N8ForgedAuction extends HTMLElement {
  connectedCallback() {
    this.apiUrl = this.dataset.apiUrl?.replace(/\/$/, '') || '';
    this.publishableKey = this.dataset.publishableKey || '';
    this.auctionId = this.dataset.auctionId || 'mission-art-2026';
    this.endsAt = new Date(this.dataset.endsAt);
    this.state = {
      currentPrice: 0,
      reserveMet: false,
      status: 'open',
      extensionEndsAt: null,
      bids: [],
      viewer: null,
      activeBidderCount: 0,
    };
    this.sessionKey = `n8f-auction-session:${this.auctionId}`;
    this.legacyTokenKey = `n8f-auction-token:${this.auctionId}`;
    this.session = this.readStoredSession();
    this.accessToken = this.session?.access_token || window.localStorage.getItem(this.legacyTokenKey) || '';

    this.clock = this.querySelector('[data-auction-countdown]');
    this.deadline = this.querySelector('[data-auction-deadline]');
    this.feedback = this.querySelector('[data-auction-feedback]');
    this.bindEvents();
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 1000);
    this.completeEmailLinkHandler = () => this.completeEmailLink().then(async () => {
      await this.loadState();
      await this.heartbeat();
    });
    this.completeEmailLinkHandler();
    window.addEventListener('hashchange', this.completeEmailLinkHandler);
    this.refreshTimer = window.setInterval(() => this.loadState(), 12000);
    this.presenceTimer = window.setInterval(() => this.heartbeat(), 30000);
    this.celebratedAuctionEnd = false;
    this.endRefreshRequested = false;
  }

  async completeEmailLink() {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const auctionLoginToken = hash.get('auction_login') || query.get('auction_login');
    if (auctionLoginToken) {
      try {
        this.setFeedback('Completing secure sign-in link…');
        const response = await fetch(`${this.apiUrl}/auth/verify-auction-link`, {
          method: 'POST',
          headers: this.headers(true),
          body: JSON.stringify({ token: auctionLoginToken, auction_id: this.auctionId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The sign-in link could not be completed.');
        this.storeSession(result);
        query.delete('auction_login');
        const cleanQuery = query.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
        this.setFeedback(`Welcome, ${result.profile.nickname}. You’re signed in and ready to bid.`);
      } catch (error) {
        query.delete('auction_login');
        const cleanQuery = query.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
        if (this.accessToken) {
          this.setFeedback('You’re already signed in and ready to bid.');
        } else {
          this.setFeedback(error.message, true);
        }
      }
      return;
    }

    const tokenHash = hash.get('token_hash') || query.get('token_hash');
    if (tokenHash) {
      try {
        this.setFeedback('Completing secure sign-in link…');
        const response = await fetch(`${this.apiUrl}/auth/verify-link`, {
          method: 'POST',
          headers: this.headers(true),
          body: JSON.stringify({ token_hash: tokenHash, auction_id: this.auctionId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The sign-in link could not be completed.');
        this.storeSession(result);
        query.delete('token_hash');
        query.delete('type');
        const cleanQuery = query.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
        this.setFeedback(`Welcome, ${result.profile.nickname}. You’re signed in and ready to bid.`);
      } catch (error) {
        query.delete('token_hash');
        query.delete('type');
        const cleanQuery = query.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
        if (this.accessToken) {
          this.setFeedback('You’re already signed in and ready to bid.');
        } else {
          this.setFeedback(error.message, true);
        }
      }
      return;
    }

    const token = hash.get('access_token');
    if (!token && (query.get('error') || query.get('error_description'))) {
      this.setFeedback(query.get('error_description') || query.get('error') || 'The sign-in link could not be completed.', true);
      return;
    }
    if (!token) return;

    this.storeSession({ access_token: token, refresh_token: hash.get('refresh_token'), expires_at: Number(hash.get('expires_at') || 0) || null });
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);

    try {
      const response = await fetch(`${this.apiUrl}/auth/complete-link`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ auction_id: this.auctionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The sign-in link could not be completed.');
      this.setFeedback(`Welcome, ${result.profile.nickname}. You’re signed in and ready to bid.`);
    } catch (error) {
      this.clearSession();
      this.setFeedback(error.message, true);
    }
  }

  disconnectedCallback() {
    window.clearInterval(this.timer);
    window.clearInterval(this.refreshTimer);
    window.clearInterval(this.presenceTimer);
    window.removeEventListener('hashchange', this.completeEmailLinkHandler);
  }

  readStoredSession() {
    try {
      return JSON.parse(window.localStorage.getItem(this.sessionKey) || 'null');
    } catch (_) {
      return null;
    }
  }

  storeSession(session) {
    if (!session?.access_token) return;
    this.session = {
      access_token: session.access_token,
      refresh_token: session.refresh_token || this.session?.refresh_token || null,
      expires_at: session.expires_at || this.session?.expires_at || null,
    };
    this.accessToken = this.session.access_token;
    window.localStorage.setItem(this.sessionKey, JSON.stringify(this.session));
    window.localStorage.setItem(this.legacyTokenKey, this.accessToken);
  }

  clearSession() {
    this.session = null;
    this.accessToken = '';
    window.localStorage.removeItem(this.sessionKey);
    window.localStorage.removeItem(this.legacyTokenKey);
  }

  supabaseAuthUrl() {
    return this.apiUrl.replace(/\/functions\/v1\/auction-api$/, '');
  }

  async ensureFreshSession() {
    if (!this.session?.refresh_token || !this.publishableKey) return;
    const expiresAtMs = Number(this.session.expires_at || 0) * 1000;
    if (expiresAtMs && expiresAtMs - Date.now() > 120000) return;

    const response = await fetch(`${this.supabaseAuthUrl()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: this.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: this.session.refresh_token }),
    });
    const result = await response.json();
    if (!response.ok) {
      this.clearSession();
      return;
    }
    this.storeSession(result);
  }

  bindEvents() {
    this.querySelector('[data-quick-bid]')?.addEventListener('click', () => {
      this.confirmBid(this.state.currentPrice + 10, 'quick');
    });

    this.querySelector('[data-max-bid-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const rawValue = new FormData(event.currentTarget).get('maximum_bid');
      const value = Number(rawValue);
      if (!String(rawValue || '').trim()) {
        this.setFeedback('Enter a Maximum Bid before submitting.', true);
        return;
      }
      if (!Number.isFinite(value) || value < 10) {
        this.setFeedback('Your Maximum Bid must be at least $10.', true);
        return;
      }
      if (value % 10 !== 0) {
        const lower = Math.floor(value / 10) * 10;
        const upper = Math.ceil(value / 10) * 10;
        this.setFeedback(`Bids must be in $10 increments. Enter ${this.money(lower)} or ${this.money(upper)} instead of ${this.money(value)}.`, true);
        return;
      }
      this.confirmBid(value, 'maximum');
    });
    this.querySelector('#AuctionMaximumBid')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || event.shiftKey) return;
      const submitButton = this.querySelector('[data-max-bid-submit]');
      if (!submitButton || submitButton.disabled) return;
      event.preventDefault();
      submitButton.focus({ preventScroll: true });
    });

    this.querySelector('[data-view-all-bids]')?.addEventListener('click', () => {
      this.renderBids(true);
    });

    const authDialog = this.querySelector('[data-auction-auth]');
    this.querySelector('[data-open-registration]')?.addEventListener('click', () => this.openAuthDialog());
    this.querySelector('[data-auth-close]')?.addEventListener('click', () => authDialog?.close());
    this.querySelector('[data-auth-done]')?.addEventListener('click', () => authDialog?.close());
    authDialog?.addEventListener('close', () => this.unlockPageScroll());
    this.querySelector('[data-registration-form]')?.addEventListener('submit', (event) => this.requestCode(event));
    this.querySelector('[data-returning-form]')?.addEventListener('submit', (event) => this.requestReturningLink(event));
    this.querySelector('[data-auction-logout]')?.addEventListener('click', () => this.logout());
    this.querySelector('[data-nickname-form]')?.addEventListener('submit', (event) => this.updateNickname(event));
    this.querySelector('[data-nickname-close]')?.addEventListener('click', () => this.querySelector('[data-nickname-dialog]')?.close());
    this.querySelector('[data-nickname-dialog]')?.addEventListener('close', () => this.unlockPageScroll());
    this.addEventListener('click', (event) => {
      if (event.target.closest('[data-change-nickname]')) this.openNicknameDialog();
    });
    this.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => this.selectAuthTab(tab.dataset.authTab)));

    this.querySelectorAll('[data-bid-confirm-cancel]').forEach((button) => button.addEventListener('click', () => this.resolveBidConfirmation(false)));
    this.querySelector('[data-bid-confirm-submit]')?.addEventListener('click', () => this.resolveBidConfirmation(true));

    this.querySelectorAll('[data-auction-image]').forEach((image) => {
      image.addEventListener('click', () => this.openLightbox(image));
    });

    this.querySelectorAll('[data-hotspot]').forEach((hotspot, index) => {
      hotspot.addEventListener('mousedown', (event) => event.preventDefault());
      hotspot.addEventListener('click', () => this.revealArtDetail(hotspot, index));
    });

    this.querySelector('[data-discovery-zoom]')?.addEventListener('click', () => {
      const image = this.querySelector('[data-discovery-image]');
      if (image) this.openLightbox(image);
    });

    this.querySelector('[data-lightbox-close]')?.addEventListener('click', () => {
      this.querySelector('[data-auction-lightbox]')?.close();
    });
    this.querySelector('[data-lightbox-previous]')?.addEventListener('click', () => this.stepLightbox(-1));
    this.querySelector('[data-lightbox-next]')?.addEventListener('click', () => this.stepLightbox(1));
    this.querySelector('[data-auction-lightbox]')?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') this.stepLightbox(-1);
      if (event.key === 'ArrowRight') this.stepLightbox(1);
    });
    this.querySelector('[data-reset-test-auction]')?.addEventListener('click', () => this.resetTestAuction());
  }

  async loadState() {
    if (!this.apiUrl) {
      this.setFeedback('Preview mode — connect the auction service before launch.');
      this.render();
      return;
    }

    try {
      await this.ensureFreshSession();
      const response = await fetch(`${this.apiUrl}/auction-state?auction_id=${encodeURIComponent(this.auctionId)}`, {
        headers: this.headers(),
      });
      if (!response.ok) throw new Error('Auction state is unavailable.');
      this.state = { ...this.state, ...(await response.json()) };
      if (
        this.feedback?.classList.contains('is-error') &&
        /auction (service|state) is (temporarily )?unavailable/i.test(this.feedback.textContent || '')
      ) {
        this.setFeedback('');
      }
      this.render();
    } catch (error) {
      this.setFeedback(error.message, true);
    }
  }

  async confirmBid(amount, kind) {
    await this.ensureFreshSession();
    if (!this.accessToken || !this.state.viewer) {
      this.openSignInForBid();
      return;
    }

    if (!Number.isFinite(amount) || amount < 10 || amount % 10 !== 0) {
      this.setFeedback('Enter a whole-dollar amount in $10 increments.', true);
      return;
    }

    const accepted = await this.askBidConfirmation(amount, kind);
    if (!accepted) return;

    if (!this.apiUrl) {
      this.setFeedback('Bidding is disabled in preview mode.', true);
      return;
    }

    this.toggleBidControls(true);
    try {
      const response = await fetch(`${this.apiUrl}/place-bid`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          auction_id: this.auctionId,
          amount,
          kind,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The bid could not be placed.');
      this.state = { ...this.state, ...result.auction };
      await this.loadState();
      this.setFeedback(result.message || 'Your bid was placed successfully.');
      this.render();
    } catch (error) {
      this.setFeedback(error.message, true);
    } finally {
      this.toggleBidControls(false);
    }
  }

  openSignInForBid() {
    const dialog = this.querySelector('[data-auction-auth]');
    this.setFeedback('Verify your email before placing a bid.', true);
    this.setAuthFeedback('Sign in through the secure link in your email to place your bid.', true);
    if (dialog && !dialog.open) {
      this.lockPageScroll();
      dialog.showModal();
    }
    window.setTimeout(() => dialog?.querySelector('input')?.focus(), 50);
  }

  openAuthDialog() {
    const dialog = this.querySelector('[data-auction-auth]');
    const register = this.querySelector('[data-auth-register]');
    const verify = this.querySelector('[data-auth-verify]');
    if (register) register.hidden = false;
    if (verify) verify.hidden = true;
    this.selectAuthTab('returning');
    this.setAuthFeedback('');
    if (dialog && !dialog.open) {
      this.lockPageScroll();
      dialog.showModal();
    }
  }

  lockPageScroll() {
    if (document.body.dataset.n8fAuctionScrollY) return;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.dataset.n8fAuctionScrollY = String(scrollY);
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  unlockPageScroll() {
    const scrollY = Number(document.body.dataset.n8fAuctionScrollY || 0);
    if (!document.body.dataset.n8fAuctionScrollY) return;
    delete document.body.dataset.n8fAuctionScrollY;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, scrollY);
  }

  async requestCode(event) {
    event.preventDefault();
    if (!this.apiUrl) {
      this.setAuthFeedback('Registration is disabled in preview mode.', true);
      return;
    }
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    this.setAuthFeedback('Sending your secure sign-in link…');
    try {
      const response = await fetch(`${this.apiUrl}/auth/request-code`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ ...data, auction_id: this.auctionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The sign-in link could not be sent.');
      this.querySelector('[data-auth-email]').textContent = data.email;
      this.querySelector('[data-auth-register]').hidden = true;
      this.querySelector('[data-auth-verify]').hidden = false;
      this.setAuthFeedback('Open the email and click “Confirm and return to the auction.”');
    } catch (error) {
      this.setAuthFeedback(error.message, true);
    }
  }

  async requestReturningLink(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await this.sendSignInLink('auth/request-link', data);
  }

  async sendSignInLink(route, data) {
    if (!this.apiUrl) return this.setAuthFeedback('Sign-in is disabled in preview mode.', true);
    this.setAuthFeedback('Sending your secure sign-in link…');
    try {
      const response = await fetch(`${this.apiUrl}/${route}`, {
        method: 'POST', headers: this.headers(true), body: JSON.stringify({ ...data, auction_id: this.auctionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The sign-in link could not be sent.');
      this.querySelector('[data-auth-email]').textContent = data.email;
      this.querySelector('[data-auth-register]').hidden = true;
      this.querySelector('[data-auth-verify]').hidden = false;
      this.setAuthFeedback('Open the email and click “Confirm and return to the auction.”');
    } catch (error) { this.setAuthFeedback(error.message, true); }
  }

  selectAuthTab(name) {
    this.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.authTab === name));
    const returning = this.querySelector('[data-returning-form]');
    const newcomer = this.querySelector('[data-new-bidder]');
    if (returning) returning.hidden = name !== 'returning';
    if (newcomer) newcomer.hidden = name !== 'new';
    this.setAuthFeedback('');
  }

  logout() {
    this.clearSession();
    this.state.viewer = null;
    this.state.activeBidderCount = 0;
    this.render();
    this.setFeedback('You’re logged out. Another bidder can now sign in on this device.');
    this.loadState();
  }

  openNicknameDialog() {
    if (!this.state.viewer) return;
    const dialog = this.querySelector('[data-nickname-dialog]');
    const current = this.querySelector('[data-current-nickname]');
    const input = this.querySelector('[data-nickname-form] [name="nickname"]');
    if (current) current.value = this.state.viewer.nickname || '';
    if (input) input.value = this.state.viewer.nickname || '';
    this.setNicknameFeedback('');
    if (dialog && !dialog.open) {
      this.lockPageScroll();
      dialog.showModal();
    }
    window.setTimeout(() => input?.focus(), 50);
  }

  async updateNickname(event) {
    event.preventDefault();
    const input = event.currentTarget.querySelector('[name="nickname"]');
    const nickname = String(input?.value || '').trim();
    if (!nickname) {
      this.setNicknameFeedback('Enter a new Auction Nickname.', true);
      return;
    }
    if (!this.apiUrl || !this.accessToken) {
      this.setNicknameFeedback('Sign in before changing your nickname.', true);
      return;
    }

    this.setNicknameFeedback('Saving nickname...');
    try {
      await this.ensureFreshSession();
      const response = await fetch(`${this.apiUrl}/auth/update-nickname`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ auction_id: this.auctionId, nickname }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The nickname could not be updated.');
      this.state.viewer = { ...this.state.viewer, nickname: result.profile.nickname };
      this.setNicknameFeedback('Nickname updated.');
      this.setFeedback(`Signed in as ${result.profile.nickname}.`);
      await this.loadState();
      window.setTimeout(() => this.querySelector('[data-nickname-dialog]')?.close(), 400);
    } catch (error) {
      this.setNicknameFeedback(error.message, true);
    }
  }

  async heartbeat() {
    if (!this.accessToken || !this.state.viewer || !this.apiUrl || document.hidden) return;
    try {
      await this.ensureFreshSession();
      if (!this.accessToken) return;
      const response = await fetch(`${this.apiUrl}/presence/heartbeat`, {
        method: 'POST', headers: this.headers(true), body: JSON.stringify({ auction_id: this.auctionId }),
      });
      if (!response.ok) return;
      const result = await response.json();
      this.state.activeBidderCount = result.activeBidderCount || 0;
      this.renderPresence();
    } catch (_) { /* Presence is helpful, but never blocks bidding. */ }
  }

  askBidConfirmation(amount, kind) {
    const dialog = this.querySelector('[data-bid-confirm]');
    const copy = this.querySelector('[data-bid-confirm-copy]');
    const quickNote = this.querySelector('[data-bid-confirm-quick]');
    const maximumNote = this.querySelector('[data-bid-confirm-maximum]');
    if (!dialog || !copy) return Promise.resolve(false);
    copy.textContent = kind === 'maximum'
      ? `Set your private Maximum Bid to ${this.money(amount)}?`
      : `Place the next bid of ${this.money(amount)}?`;
    if (quickNote) quickNote.hidden = kind === 'maximum';
    if (maximumNote) maximumNote.hidden = kind !== 'maximum';
    if (!dialog.open) dialog.showModal();
    return new Promise((resolve) => { this.bidConfirmationResolver = resolve; });
  }

  resolveBidConfirmation(accepted) {
    this.querySelector('[data-bid-confirm]')?.close();
    this.bidConfirmationResolver?.(accepted);
    this.bidConfirmationResolver = null;
  }

  tick() {
    if (!this.clock) return;
    const effectiveEnd = this.state.extensionEndsAt ? new Date(this.state.extensionEndsAt) : this.endsAt;
    if (this.deadline && !Number.isNaN(effectiveEnd.getTime())) {
      const formattedEnd = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(effectiveEnd);
      this.deadline.textContent = `Scheduled to close ${formattedEnd}. A bid in the final five minutes extends bidding by five minutes.`;
    }
    const remaining = Math.max(0, effectiveEnd.getTime() - Date.now());
    const units = {
      days: Math.floor(remaining / 86400000),
      hours: Math.floor((remaining / 3600000) % 24),
      minutes: Math.floor((remaining / 60000) % 60),
      seconds: Math.floor((remaining / 1000) % 60),
    };

    Object.entries(units).forEach(([unit, value]) => {
      const target = this.clock.querySelector(`[data-${unit}]`);
      if (target) target.textContent = String(value).padStart(2, '0');
    });

    if (remaining === 0 && !this.endRefreshRequested) {
      this.endRefreshRequested = true;
      this.loadState();
    }
    if (remaining === 0) this.render();
  }

  render() {
    const ended = this.isAuctionEnded();
    this.classList.toggle('is-ended', ended);

    const price = this.querySelector('[data-current-price]');
    if (price) price.textContent = this.money(this.state.currentPrice);

    const reserve = this.querySelector('[data-reserve-status]');
    if (reserve) {
      reserve.dataset.met = String(Boolean(this.state.reserveMet));
      reserve.textContent = this.state.reserveMet ? '● Reserve met' : '○ Reserve not met';
    }

    const identity = this.querySelector('[data-bidder-identity]');
    if (identity) {
      const viewer = this.state.viewer;
      const hasBid = viewer?.maximumBid != null;
      const status = !viewer ? 'signed-out' : viewer.isLeading ? 'winning' : hasBid ? 'outbid' : 'ready';
      const winner = this.winningBid();
      identity.dataset.status = ended ? 'ended' : status;
      if (ended) {
        const winnerName = winner?.nickname || 'the winning bidder';
        identity.innerHTML = `
          <div class="n8f-auction__winner-card">
            <span>Final Result</span>
            <strong>Winner: ${this.escape(winnerName)}</strong>
            <em>Winning bid: ${this.money(this.state.currentPrice)}</em>
          </div>
        `;
        this.celebrateAuctionEnd();
      } else if (!viewer) {
        identity.innerHTML = `
          <div class="n8f-auction__login-state"><strong>Not signed in</strong></div>
          <div class="n8f-auction__bidder-status">Sign in to bid. Your Auction Nickname is the only identity shown publicly.</div>
        `;
      } else if (status === 'winning') {
        identity.innerHTML = `
          <div class="n8f-auction__login-state">Signed in as <button type="button" class="n8f-auction__nickname-button" data-change-nickname>${this.escape(viewer.nickname)}</button></div>
          <div class="n8f-auction__bidder-status"><strong>✓ You’re winning!</strong></div>
        `;
      } else if (status === 'outbid') {
        identity.innerHTML = `
          <div class="n8f-auction__login-state">Signed in as <button type="button" class="n8f-auction__nickname-button" data-change-nickname>${this.escape(viewer.nickname)}</button></div>
          <div class="n8f-auction__bidder-status"><strong>! You’ve been outbid.</strong><span>Bid again to take the lead.</span></div>
        `;
      } else {
        identity.innerHTML = `
          <div class="n8f-auction__login-state">Signed in as <button type="button" class="n8f-auction__nickname-button" data-change-nickname>${this.escape(viewer.nickname)}</button></div>
          <div class="n8f-auction__bidder-status"><strong>Ready to bid</strong></div>
        `;
      }
    }

    const signedIn = Boolean(this.state.viewer);
    const openAuth = this.querySelector('[data-open-registration]');
    const logout = this.querySelector('[data-auction-logout]');
    if (openAuth) openAuth.hidden = signedIn;
    if (logout) logout.hidden = !signedIn;

    const currentMax = this.querySelector('[data-current-max]');
    const currentMaxAmount = this.querySelector('[data-current-max-amount]');
    const maximum = this.state.viewer?.maximumBid;
    if (currentMax) currentMax.hidden = maximum == null;
    if (currentMaxAmount && maximum != null) currentMaxAmount.textContent = this.money(maximum);
    const maxLabel = this.querySelector('[data-max-bid-label]');
    if (maxLabel) maxLabel.textContent = maximum == null ? 'Maximum Bid (USD)' : 'Change your Maximum Bid (USD)';

    this.renderPresence();

    const adminPanel = this.querySelector('[data-admin-panel]');
    if (adminPanel) adminPanel.hidden = !this.state.viewer?.isAdmin;

    this.renderBids(false);
    this.toggleBidControls(ended || this.state.status !== 'open');
  }

  isAuctionEnded() {
    const effectiveEnd = this.state.extensionEndsAt ? new Date(this.state.extensionEndsAt) : this.endsAt;
    return this.state.status !== 'open' || (!Number.isNaN(effectiveEnd.getTime()) && Date.now() >= effectiveEnd.getTime());
  }

  winningBid() {
    const currentPrice = Number(this.state.currentPrice || 0);
    return [...this.state.bids]
      .filter((bid) => Number(bid.amount) === currentPrice)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || Number(b.id || 0) - Number(a.id || 0))[0] || null;
  }

  celebrateAuctionEnd() {
    if (this.celebratedAuctionEnd) return;
    this.celebratedAuctionEnd = true;
    const burst = document.createElement('div');
    burst.className = 'n8f-auction__celebration';
    burst.setAttribute('aria-hidden', 'true');
    burst.innerHTML = Array.from({ length: 28 }, (_, index) => {
      const delay = (index % 7) * 0.05;
      const drift = ((index % 5) - 2) * 24;
      return `<span style="--i:${index}; --delay:${delay}s; --drift:${drift}px;"></span>`;
    }).join('');
    document.body.appendChild(burst);
    window.setTimeout(() => burst.remove(), 2200);
  }

  renderPresence() {
    const presence = this.querySelector('[data-active-bidders]');
    if (!presence) return;
    const count = Number(this.state.activeBidderCount || 0);
    presence.hidden = count < 2;
    presence.textContent = count >= 2 ? `● ${count} signed-in bidders active now` : '';
  }

  renderBids(showAll) {
    const list = this.querySelector('[data-bid-list]');
    if (!list) return;
    const sortedBids = [...this.state.bids].sort((a, b) => {
      const dateDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return dateDelta || Number(b.id || 0) - Number(a.id || 0);
    });
    const bids = showAll ? sortedBids : sortedBids.slice(0, 20);
    if (!bids.length) {
      list.innerHTML = '<p class="n8f-auction__helper">No bids yet. Be the first to support the mission.</p>';
      return;
    }

    list.innerHTML = bids
      .map((bid) => {
        const date = new Date(bid.createdAt);
        return `<article class="n8f-auction__bid">
          <strong>${this.escape(bid.nickname)}</strong>
          <strong>${this.money(bid.amount)}</strong>
          <time datetime="${date.toISOString()}" title="${date.toLocaleString()}">${this.relativeTime(date)} · ${date.toLocaleString()}</time>
          <span></span>
        </article>`;
      })
      .join('');

    const viewAll = this.querySelector('[data-view-all-bids]');
    if (viewAll) viewAll.hidden = showAll || this.state.bids.length <= 20;
  }

  revealArtDetail(hotspot, index) {
    const explorer = hotspot.closest('[data-art-discovery]');
    if (!explorer) return;
    const scrollParent = this.findScrollParent(hotspot);
    const preservedScrollTop = scrollParent?.scrollTop;
    const preservedScrollLeft = scrollParent?.scrollLeft;
    const restoreScroll = () => {
      if (!scrollParent) return;
      scrollParent.scrollTop = preservedScrollTop;
      scrollParent.scrollLeft = preservedScrollLeft;
    };

    explorer.querySelectorAll('[data-hotspot]').forEach((item) => {
      const selected = item === hotspot;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });

    const image = explorer.querySelector('[data-discovery-image]');
    const title = explorer.querySelector('[data-discovery-title]');
    const copy = explorer.querySelector('[data-discovery-copy]');
    const number = explorer.querySelector('[data-discovery-number]');
    const detail = explorer.querySelector('.n8f-auction__discovery-detail');

    if (image) {
      image.addEventListener('load', restoreScroll, { once: true });
      image.src = hotspot.dataset.detailImage;
    }
    if (title) title.textContent = hotspot.dataset.detailTitle;
    if (copy) copy.textContent = hotspot.dataset.detailCopy;
    if (number) number.textContent = String(index + 1).padStart(2, '0');
    restoreScroll();

    detail?.classList.remove('is-revealing');
    window.requestAnimationFrame(() => {
      detail?.classList.add('is-revealing');
      restoreScroll();
    });
    window.setTimeout(restoreScroll, 120);
    window.setTimeout(restoreScroll, 320);
  }

  findScrollParent(element) {
    let parent = element.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
      parent = parent.parentElement;
    }
    return document.scrollingElement;
  }

  openLightbox(image) {
    const dialog = this.querySelector('[data-auction-lightbox]');
    if (!dialog) return;

    if (image.hasAttribute('data-auction-gallery')) {
      this.lightboxItems = [...this.querySelectorAll('[data-gallery-source]')].map((item, index) => ({
        src: item.dataset.gallerySource,
        alt: index === 0
          ? 'Joy in Our Chains by Andrea Darby, full artwork'
          : `Joy in Our Chains by Andrea Darby, gallery image ${index + 1}`,
      }));
    } else {
      this.lightboxItems = [{ src: image.currentSrc || image.src, alt: image.alt }];
    }

    this.lightboxIndex = 0;
    this.renderLightbox();
    if (!dialog.open) dialog.showModal();
  }

  stepLightbox(direction) {
    if (!this.lightboxItems?.length || this.lightboxItems.length < 2) return;
    this.lightboxIndex = (this.lightboxIndex + direction + this.lightboxItems.length) % this.lightboxItems.length;
    this.renderLightbox();
  }

  renderLightbox() {
    const dialog = this.querySelector('[data-auction-lightbox]');
    const target = dialog?.querySelector('img');
    const counter = dialog?.querySelector('[data-lightbox-count]');
    const controls = dialog?.querySelectorAll('[data-lightbox-previous], [data-lightbox-next]');
    const item = this.lightboxItems?.[this.lightboxIndex];
    if (!dialog || !target || !item) return;

    target.src = item.src;
    target.alt = item.alt;
    const isGallery = this.lightboxItems.length > 1;
    controls?.forEach((control) => { control.hidden = !isGallery; });
    if (counter) {
      counter.hidden = !isGallery;
      counter.textContent = `${this.lightboxIndex + 1} / ${this.lightboxItems.length}`;
    }
  }

  async resetTestAuction() {
    const accepted = window.confirm(
      'Reset all family test data and immediately start a fresh 24-hour test? This cannot be undone.'
    );
    if (!accepted) return;

    const button = this.querySelector('[data-reset-test-auction]');
    const feedback = this.querySelector('[data-admin-feedback]');
    if (button) button.disabled = true;
    if (feedback) feedback.textContent = 'Resetting the test auction…';

    try {
      const response = await fetch(`${this.apiUrl}/admin/reset-test`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          auction_id: this.auctionId,
          duration_hours: 24,
          clear_registrations: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The test could not be reset.');
      this.state = { ...this.state, ...result.auction };
      if (feedback) feedback.textContent = result.message;
      this.render();
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  }

  toggleBidControls(disabled) {
    this.querySelectorAll('[data-bid-control]').forEach((control) => {
      control.disabled = disabled;
    });
  }

  setFeedback(message, error = false) {
    if (!this.feedback) return;
    this.feedback.textContent = message;
    this.feedback.classList.toggle('is-error', error);
  }

  setAuthFeedback(message, error = false) {
    const target = this.querySelector('[data-auth-feedback]');
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('is-error', error);
  }

  setNicknameFeedback(message, error = false) {
    const target = this.querySelector('[data-nickname-feedback]');
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('is-error', error);
  }

  headers(json = false) {
    const headers = { Accept: 'application/json' };
    if (json) headers['Content-Type'] = 'application/json';
    if (this.publishableKey) headers.apikey = this.publishableKey;
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    return headers;
  }

  money(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
  }

  relativeTime(date) {
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
    if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
    if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
    return formatter.format(Math.round(seconds / 86400), 'day');
  }

  escape(value) {
    const node = document.createElement('span');
    node.textContent = value || '';
    return node.innerHTML;
  }
}

if (!customElements.get('n8forged-auction')) {
  customElements.define('n8forged-auction', N8ForgedAuction);
}
