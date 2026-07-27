import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonymousKey = Deno.env.get('SUPABASE_ANON_KEY')!
const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
const auctionCronSecret = Deno.env.get('AUCTION_CRON_SECRET') || ''
const admin = createClient(supabaseUrl, serviceRoleKey)

const allowedOrigins = new Set([
  'https://n8forged.com',
  'https://www.n8forged.com',
  'https://n8forged.myshopify.com',
  'http://127.0.0.1:9292',
])

const blockedNicknameWords = [
  'asshole',
  'bastard',
  'bitch',
  'cunt',
  'dick',
  'fuck',
  'motherfucker',
  'nigger',
  'pussy',
  'shit',
  'slut',
  'whore',
]

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://n8forged.com',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(req) })
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function normalizeNickname(text: string) {
  return text
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[2]/g, 'z')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[6]/g, 'g')
    .replace(/[7+]/g, 't')
    .replace(/[8]/g, 'b')
    .replace(/[9]/g, 'g')
    .replace(/\(/g, 'c')
    .replace(/\)/g, '')
    .replace(/\[/g, 'c')
    .replace(/\]/g, '')
    .replace(/\{/g, 'c')
    .replace(/\}/g, '')
    .replace(/</g, 'c')
    .replace(/>/g, '')
    .replace(/\\/g, '')
    .replace(/\//g, '')
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/-/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
}

function containsBlockedNicknameWord(nickname: string) {
  const normalized = normalizeNickname(nickname)
  return blockedNicknameWords.some((word) => normalized.includes(word))
}

function nicknameIsSafe(nickname: string) {
  return !containsBlockedNicknameWord(nickname)
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function routeName(req: Request) {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const functionIndex = parts.lastIndexOf('auction-api')
  return parts.slice(functionIndex + 1).join('/')
}

async function authenticatedUser(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  return error ? null : data.user
}

async function ensureBidderProfile(user: any) {
  const metadata = user.user_metadata || {}
  const { data: existingProfile, error: existingError } = await admin
    .from('bidder_profiles')
    .select('id, nickname, blocked_at')
    .eq('id', user.id)
    .maybeSingle()
  if (existingError) throw existingError
  if (existingProfile?.blocked_at) throw new Error('BIDDER_BLOCKED')

  if (!existingProfile) {
    const { error: profileError } = await admin.from('bidder_profiles').insert({
      id: user.id,
      full_name: cleanText(metadata.full_name, 100),
      nickname: cleanText(metadata.nickname, 32),
      email: cleanText(user.email, 254).toLowerCase(),
      phone: cleanText(metadata.phone, 40),
      age_terms_version: cleanText(metadata.age_terms_version, 80),
      email_consent_version: cleanText(metadata.email_consent_version, 80),
    })
    if (profileError) throw profileError
  }

  const { data: profile, error: readError } = await admin
    .from('bidder_profiles')
    .select('nickname')
    .eq('id', user.id)
    .single()
  if (readError) throw readError
  return profile
}

async function findAuthUserByEmail(email: string) {
  let page = 1
  const perPage = 100
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const match = data.users.find((user) => user.email?.toLowerCase() === email)
    if (match) return match
    if (data.users.length < perPage) return null
    page += 1
  }
  return null
}

async function sendAuctionLoginLink(userId: string, email: string) {
  if (!resendApiKey) throw new Error('RESEND_NOT_CONFIGURED')
  const loginUrl = await createAuctionLoginUrl(userId)

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'N8Forged Mission Art Auction <auction@n8forged.com>',
      to: [email],
      bcc: ['N8Darby@gmail.com'],
      subject: 'Confirm your N8Forged auction sign-in',
      html: `<h2>Confirm your N8Forged auction sign-in</h2><p>Click the button below to return to the auction signed in and ready to bid.</p><p><a href="${loginUrl}" style="display:inline-block;padding:14px 22px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Confirm and return to the auction</a></p><p>This secure link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`EMAIL_SEND_FAILED: ${errorText}`)
  }
}

async function createAuctionLoginUrl(userId: string, expiresAtOverride?: string) {
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = expiresAtOverride || new Date(Date.now() + 1000 * 60 * 30).toISOString()

  const { error: tokenError } = await admin.from('auction_login_tokens').insert({
    token_hash: tokenHash,
    user_id: userId,
    expires_at: expiresAt,
  })
  if (tokenError) throw tokenError

  return `https://n8forged.com/pages/contact?view=art-auction#auction_login=${encodeURIComponent(token)}`
}

async function sendAuctionEmail(email: string, subject: string, html: string) {
  if (!resendApiKey) throw new Error('RESEND_NOT_CONFIGURED')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'N8Forged Mission Art Auction <auction@n8forged.com>',
      to: [email],
      bcc: ['N8Darby@gmail.com'],
      subject,
      html,
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`EMAIL_SEND_FAILED: ${errorText}`)
  }
}

function auctionReminderWindow(endsAt: string) {
  const minutesRemaining = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 60000)
  if (minutesRemaining <= 0) return null
  if (minutesRemaining <= 30) return { key: 'final-30-minutes', label: 'about 30 minutes' }
  if (minutesRemaining <= 180) return { key: 'final-3-hours', label: 'about 3 hours' }
  if (minutesRemaining <= 600) return { key: 'final-10-hours', label: 'about 10 hours' }
  if (minutesRemaining <= 1440) return { key: 'final-24-hours', label: 'less than 24 hours' }
  return null
}

async function processAuctionReminder(slug: string) {
  const { data: auction, error: auctionError } = await admin
    .from('auctions')
    .select('id, slug, current_price, reserve_met, effective_ends_at, status, winning_bidder_id')
    .eq('slug', slug)
    .single()
  if (auctionError) throw auctionError
  if (new Date(auction.effective_ends_at).getTime() <= Date.now()) {
    return await processAuctionFinalization(slug)
  }
  if (auction.status !== 'open') return { message: 'The auction is not open.', sent: 0, skipped: true }

  const reminder = auctionReminderWindow(auction.effective_ends_at)
  if (!reminder) return { message: 'There is no ending-soon reminder window right now.', sent: 0, skipped: true }

  const { data: existingSend } = await admin
    .from('auction_reminder_sends')
    .select('reminder_key')
    .eq('auction_id', auction.id)
    .eq('reminder_key', reminder.key)
    .maybeSingle()
  if (existingSend) {
    return { message: `The ${reminder.label} reminder was already sent.`, sent: 0, reminder: reminder.key, skipped: true }
  }

  const { data: bidders, error: biddersError } = await admin
    .from('bidder_profiles')
    .select('id, email, nickname, blocked_at, optional_reminders')
    .is('blocked_at', null)
    .eq('optional_reminders', true)
  if (biddersError) throw biddersError

  const { data: maximumBids, error: maximumBidsError } = await admin
    .from('maximum_bids')
    .select('bidder_id, amount')
    .eq('auction_id', auction.id)
  if (maximumBidsError) throw maximumBidsError
  const maximumByBidder = new Map((maximumBids || []).map((maximum) => [maximum.bidder_id, Number(maximum.amount)]))

  const endingTime = new Date(auction.effective_ends_at).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  const subject = `Joy in Our Chains auction ends in ${reminder.label}`
  const reminderExpiresAt = new Date(
    Math.min(
      Date.now() + 1000 * 60 * 60 * 12,
      new Date(auction.effective_ends_at).getTime() + 1000 * 60 * 30
    )
  ).toISOString()

  let sent = 0
  for (const bidder of bidders || []) {
    const auctionUrl = await createAuctionLoginUrl(bidder.id, reminderExpiresAt)
    const currentBid = Number(auction.current_price)
    const bidderMaximum = maximumByBidder.get(bidder.id) || 0
    const isWinning = auction.winning_bidder_id === bidder.id
    const amountToLead = Math.max(10, currentBid + 10 - bidderMaximum)
    const bidderMessage = isWinning
      ? 'You’re currently winning. If you want a little extra protection from a late bid, you can raise your private Maximum Bid.'
      : bidderMaximum > 0
        ? `You’re only ${amountToLead.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} away from taking the lead because your current Maximum Bid is ${bidderMaximum.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}.`
        : 'You’re registered and ready to bid. If this piece feels like something you’d enjoy owning, this is a good moment to jump in.'
    const reserveMessage = auction.reserve_met
      ? 'The reserve has been met, so the highest bidder is currently in position to win.'
      : 'The reserve has not been met yet, so the auction is still working toward a final sale price.'
    await sendAuctionEmail(
      bidder.email,
      subject,
      `<h2>The N8Forged Mission Art Auction is almost over</h2>
      <p>Hi ${cleanText(bidder.nickname, 32)},</p>
      <p><strong>Joy in Our Chains</strong> is scheduled to close ${endingTime}. There is ${reminder.label} remaining.</p>
      <p>The current bid is <strong>$${currentBid.toLocaleString('en-US')}</strong>. ${reserveMessage}</p>
      <p>${bidderMessage}</p>
      <div style="margin:18px 0;padding:16px;border-radius:12px;background:#eef4ff;border:1px solid #bfdbfe;">
        <p style="margin:0;font-size:16px;line-height:1.5;"><strong>Quick reminder:</strong> 100% of the auction funds go toward this mission trip, and the winning bidder gets one-of-a-kind original art as well. What a deal.</p>
      </div>
      <p><a href="${auctionUrl}" style="display:inline-block;padding:14px 22px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Return to the auction</a></p>
      <p>If a bid is placed in the final five minutes, bidding extends by five minutes.</p>`
    )
    sent += 1
  }

  const { error: recordError } = await admin.from('auction_reminder_sends').insert({
    auction_id: auction.id,
    reminder_key: reminder.key,
    recipient_count: sent,
  })
  if (recordError) throw recordError

  return { message: `Sent the ${reminder.label} reminder to ${sent} bidder${sent === 1 ? '' : 's'}.`, sent, reminder: reminder.key }
}

async function processAuctionFinalization(slug: string) {
  const { data: auction, error: auctionError } = await admin
    .from('auctions')
    .select('id, slug, status, current_price, reserve_met, effective_ends_at, winning_bidder_id')
    .eq('slug', slug)
    .single()
  if (auctionError) throw auctionError

  if (new Date(auction.effective_ends_at).getTime() > Date.now()) {
    return { message: 'The auction has not ended yet.', sent: 0, skipped: true }
  }

  if (auction.status === 'cancelled') {
    return { message: 'The auction was cancelled.', sent: 0, skipped: true }
  }

  const { data: existingSend } = await admin
    .from('auction_finalization_sends')
    .select('auction_id')
    .eq('auction_id', auction.id)
    .maybeSingle()
  if (existingSend) {
    return { message: 'The auction was already finalized.', sent: 0, skipped: true }
  }

  const finalStatus = auction.status === 'closed' ? 'closed' : 'closed'
  const { error: closeError } = await admin
    .from('auctions')
    .update({ status: finalStatus, updated_at: new Date().toISOString() })
    .eq('id', auction.id)
  if (closeError) throw closeError

  if (!auction.reserve_met || !auction.winning_bidder_id) {
    const { error: recordNoWinnerError } = await admin.from('auction_finalization_sends').insert({
      auction_id: auction.id,
      winner_bidder_id: auction.winning_bidder_id,
      recipient: null,
      final_price: Number(auction.current_price || 0),
    })
    if (recordNoWinnerError && recordNoWinnerError.code !== '23505') throw recordNoWinnerError
    return { message: 'The auction closed without a winner email because reserve was not met or no winner exists.', sent: 0, skipped: true }
  }

  const { data: winner, error: winnerError } = await admin
    .from('bidder_profiles')
    .select('id, email, nickname, full_name')
    .eq('id', auction.winning_bidder_id)
    .single()
  if (winnerError) throw winnerError

  const { error: recordError } = await admin.from('auction_finalization_sends').insert({
    auction_id: auction.id,
    winner_bidder_id: winner.id,
    recipient: winner.email,
    final_price: Number(auction.current_price || 0),
  })
  if (recordError) {
    if (recordError.code === '23505') return { message: 'The auction was already finalized.', sent: 0, skipped: true }
    throw recordError
  }

  const finalPrice = Number(auction.current_price || 0)
  const auctionUrl = await createAuctionLoginUrl(winner.id, new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString())
  await sendAuctionEmail(
    winner.email,
    'You won Joy in Our Chains',
    `<h2>Congratulations, you won Joy in Our Chains</h2>
    <p>Hi ${cleanText(winner.nickname, 32)},</p>
    <p>You are the winning bidder for <strong>Joy in Our Chains</strong>.</p>
    <p>Your winning bid is <strong>$${finalPrice.toLocaleString('en-US')}</strong>.</p>
    <div style="margin:18px 0;padding:16px;border-radius:12px;background:#eef4ff;border:1px solid #bfdbfe;">
      <p style="margin:0;font-size:16px;line-height:1.5;"><strong>Next step:</strong> Please reply to this email within 48 hours and tell us whether you want local pickup in Little Rock, Arkansas or insured shipping.</p>
    </div>
    <p>If you choose shipping, include your full shipping address. Shipping, packing, insurance, taxes, duties, and customs charges are paid separately from the winning bid.</p>
    <p>Nathan will follow up with the Shopify payment link and final pickup or shipping details.</p>
    <p><a href="${auctionUrl}" style="display:inline-block;padding:14px 22px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">View the final auction result</a></p>
    <p>Thank you for supporting the Costa Rica mission trip. 100% of the auction funds go toward the trip, and you get one-of-a-kind original art as well. What a deal.</p>`
  )

  return { message: `Winner email sent to ${winner.email}.`, sent: 1, winner: winner.nickname }
}

function authenticatedClient(req: Request) {
  return createClient(supabaseUrl, anonymousKey, {
    global: { headers: { Authorization: req.headers.get('authorization') || '' } },
  })
}

export default {
  async fetch(req: Request) {
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(req) })
      }

      const route = routeName(req)

      try {
        if (route === 'auth/request-code' && req.method === 'POST') {
          const input = await req.json()
          const email = cleanText(input.email, 254).toLowerCase()
          const fullName = cleanText(input.full_name, 100)
          const nickname = cleanText(input.nickname, 32)
          const phone = cleanText(input.phone, 40)

          if (!email.includes('@') || fullName.length < 2 || phone.length < 7) {
            return json(req, { error: 'Enter a valid name, email, and phone number.' }, 400)
          }
          if (nickname.length < 2 || !nicknameIsSafe(nickname)) {
            return json(req, { error: 'Choose a different Auction Nickname.' }, 400)
          }
          if (input.age_and_terms !== 'on' || input.email_consent !== 'on') {
            return json(req, { error: 'Both registration agreements are required.' }, 400)
          }

          const { data: blocked } = await admin
            .from('bidder_profiles')
            .select('blocked_at')
            .ilike('email', email)
            .maybeSingle()

          if (blocked?.blocked_at) {
            return json(req, { error: 'This bidder is not eligible to register.' }, 403)
          }

          const { data: nicknameOwner } = await admin
            .from('bidder_profiles')
            .select('email')
            .ilike('nickname', nickname)
            .maybeSingle()

          if (nicknameOwner && nicknameOwner.email.toLowerCase() !== email) {
            return json(req, { error: 'That Auction Nickname is already taken.' }, 409)
          }

          let authUser = await findAuthUserByEmail(email)
          if (!authUser) {
            const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
              email,
              email_confirm: true,
              user_metadata: {
                full_name: fullName,
                nickname,
                phone,
                age_terms_version: 'auction-terms-2026-07-20',
                email_consent_version: 'auction-email-consent-2026-07-20',
              },
            })
            if (createError) throw createError
            authUser = createdUser.user
          }

          const { error: profileError } = await admin.from('bidder_profiles').upsert({
            id: authUser.id,
            full_name: fullName,
            nickname,
            email,
            phone,
            age_terms_version: 'auction-terms-2026-07-20',
            email_consent_version: 'auction-email-consent-2026-07-20',
          })
          if (profileError) throw profileError

          await sendAuctionLoginLink(authUser.id, email)
          return json(req, { ok: true })
        }

        if (route === 'auth/request-link' && req.method === 'POST') {
          const input = await req.json()
          const email = cleanText(input.email, 254).toLowerCase()
          if (!email.includes('@')) return json(req, { error: 'Enter a valid email address.' }, 400)

          const { data: profile, error: profileError } = await admin
            .from('bidder_profiles')
            .select('blocked_at')
            .ilike('email', email)
            .maybeSingle()
          if (profileError) throw profileError
          if (!profile) return json(req, { error: 'No bidder account was found for that email. Choose New bidder to register.' }, 404)
          if (profile.blocked_at) return json(req, { error: 'This bidder is not eligible to sign in.' }, 403)

          const authUser = await findAuthUserByEmail(email)
          if (!authUser) return json(req, { error: 'No bidder account was found for that email. Choose New bidder to register.' }, 404)
          await sendAuctionLoginLink(authUser.id, email)
          return json(req, { ok: true })
        }

        if (route === 'auth/verify-auction-link' && req.method === 'POST') {
          const input = await req.json()
          const token = cleanText(input.token, 512)
          if (!token) return json(req, { error: 'This sign-in link is incomplete.' }, 400)

          const tokenHash = await sha256Hex(token)
          const { data: loginToken, error: tokenError } = await admin
            .from('auction_login_tokens')
            .select('token_hash, user_id, expires_at, used_at')
            .eq('token_hash', tokenHash)
            .maybeSingle()
          if (tokenError) throw tokenError
          if (!loginToken || loginToken.used_at || new Date(loginToken.expires_at).getTime() < Date.now()) {
            return json(req, { error: 'That sign-in link has already been used or expired. Choose Existing Bidder and enter your email to get a fresh link.' }, 401)
          }

          const { data: profile, error: profileError } = await admin
            .from('bidder_profiles')
            .select('email, nickname, blocked_at')
            .eq('id', loginToken.user_id)
            .single()
          if (profileError) throw profileError
          if (profile.blocked_at) return json(req, { error: 'This bidder is not eligible to bid.' }, 403)

          const temporaryPassword = randomToken(48)
          const { error: updateError } = await admin.auth.admin.updateUserById(loginToken.user_id, {
            password: temporaryPassword,
          })
          if (updateError) throw updateError

          const auth = createClient(supabaseUrl, anonymousKey)
          const { data: sessionData, error: signInError } = await auth.auth.signInWithPassword({
            email: profile.email,
            password: temporaryPassword,
          })
          if (signInError || !sessionData.session) {
            return json(req, { error: 'This sign-in link could not create a session. Please request a new link.' }, 401)
          }

          await admin
            .from('auction_login_tokens')
            .update({ used_at: new Date().toISOString() })
            .eq('token_hash', tokenHash)

          return json(req, {
            access_token: sessionData.session.access_token,
            refresh_token: sessionData.session.refresh_token,
            expires_at: sessionData.session.expires_at,
            profile: { nickname: profile.nickname },
          })
        }

        if (route === 'auth/verify-code' && req.method === 'POST') {
          const input = await req.json()
          const email = cleanText(input.email, 254).toLowerCase()
          const token = cleanText(input.code, 8)

          const { data, error } = await admin.auth.verifyOtp({
            email,
            token,
            type: 'email',
          })
          if (error || !data.user || !data.session) {
            return json(req, { error: 'The code is invalid or expired.' }, 401)
          }

          let profile
          try {
            profile = await ensureBidderProfile(data.user)
          } catch (profileError) {
            if (String(profileError).includes('BIDDER_BLOCKED')) {
              return json(req, { error: 'This bidder is not eligible to bid.' }, 403)
            }
            throw profileError
          }

          return json(req, {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
            profile,
          })
        }

        if (route === 'auth/complete-link' && req.method === 'POST') {
          const user = await authenticatedUser(req)
          if (!user) return json(req, { error: 'This sign-in link is invalid or expired.' }, 401)
          try {
            const profile = await ensureBidderProfile(user)
            return json(req, { profile })
          } catch (profileError) {
            if (String(profileError).includes('BIDDER_BLOCKED')) {
              return json(req, { error: 'This bidder is not eligible to bid.' }, 403)
            }
            throw profileError
          }
        }

        if (route === 'auth/verify-link' && req.method === 'POST') {
          const input = await req.json()
          const tokenHash = cleanText(input.token_hash, 512)
          if (!tokenHash) return json(req, { error: 'This sign-in link is incomplete.' }, 400)

          const auth = createClient(supabaseUrl, anonymousKey)
          const { data, error } = await auth.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'email',
          })
          if (error || !data.user || !data.session) {
            return json(req, { error: 'This sign-in link is invalid or has expired. Please request a new link.' }, 401)
          }

          try {
            const profile = await ensureBidderProfile(data.user)
            return json(req, {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
              expires_at: data.session.expires_at,
              profile,
            })
          } catch (profileError) {
            if (String(profileError).includes('BIDDER_BLOCKED')) {
              return json(req, { error: 'This bidder is not eligible to bid.' }, 403)
            }
            throw profileError
          }
        }

        if (route === 'auth/update-nickname' && req.method === 'POST') {
          const user = await authenticatedUser(req)
          if (!user) return json(req, { error: 'Sign in before changing your nickname.' }, 401)

          const input = await req.json()
          const nickname = cleanText(input.nickname, 32)
          if (nickname.length < 2 || !nicknameIsSafe(nickname)) {
            return json(req, { error: 'Choose a different Auction Nickname.' }, 400)
          }

          const { data: profile, error: profileError } = await admin
            .from('bidder_profiles')
            .select('id, blocked_at')
            .eq('id', user.id)
            .single()
          if (profileError) throw profileError
          if (profile.blocked_at) return json(req, { error: 'This bidder is not eligible to change their nickname.' }, 403)

          const { data: nicknameOwner, error: nicknameOwnerError } = await admin
            .from('bidder_profiles')
            .select('id')
            .ilike('nickname', nickname)
            .maybeSingle()
          if (nicknameOwnerError) throw nicknameOwnerError
          if (nicknameOwner && nicknameOwner.id !== user.id) {
            return json(req, { error: 'That Auction Nickname is already taken.' }, 409)
          }

          const { data: updatedProfile, error: updateError } = await admin
            .from('bidder_profiles')
            .update({ nickname })
            .eq('id', user.id)
            .select('nickname')
            .single()
          if (updateError) throw updateError

          return json(req, { profile: updatedProfile })
        }

        if (route === 'auction-state' && req.method === 'GET') {
          const slug = cleanText(new URL(req.url).searchParams.get('auction_id'), 80)
          const { data: auction, error } = await admin
            .from('auctions')
            .select('id, slug, status, current_price, reserve_met, effective_ends_at, winning_bidder_id')
            .eq('slug', slug)
            .single()
          if (error) throw error

          const { data: events, error: eventsError } = await admin
            .from('bid_events')
            .select('id, bidder_id, public_amount, kind, created_at')
            .eq('auction_id', auction.id)
            .eq('is_valid', true)
            .in('kind', ['manual', 'automatic'])
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
          if (eventsError) throw eventsError

          const bidderIds = [...new Set((events || []).map((event) => event.bidder_id).filter(Boolean))]
          const { data: profiles } = bidderIds.length
            ? await admin.from('bidder_profiles').select('id, nickname').in('id', bidderIds)
            : { data: [] }
          const nicknames = new Map((profiles || []).map((profile) => [profile.id, profile.nickname]))

          const viewerId = (await authenticatedUser(req))?.id || null
          const viewerProfile = viewerId
            ? await admin.from('bidder_profiles').select('nickname').eq('id', viewerId).maybeSingle()
            : null
          const viewerAdmin = viewerId
            ? await admin.from('auction_admins').select('user_id').eq('user_id', viewerId).maybeSingle()
            : null
          const viewerMaximum = viewerId
            ? await admin
                .from('maximum_bids')
                .select('amount')
                .eq('auction_id', auction.id)
                .eq('bidder_id', viewerId)
                .maybeSingle()
            : null
          const activeSince = new Date(Date.now() - 120000).toISOString()
          const { count: activeBidderCount } = await admin
            .from('auction_presence')
            .select('user_id', { count: 'exact', head: true })
            .eq('auction_id', auction.id)
            .gte('last_seen_at', activeSince)

          return json(req, {
            currentPrice: auction.current_price,
            reserveMet: auction.reserve_met,
            status: auction.status,
            extensionEndsAt: auction.effective_ends_at,
            bids: (events || []).map((event) => ({
              id: event.id,
              nickname: nicknames.get(event.bidder_id) || 'Anonymous',
              amount: event.public_amount,
              kind: event.kind,
              createdAt: event.created_at,
            })),
            viewer: viewerId && viewerProfile?.data
              ? {
                  nickname: viewerProfile.data.nickname,
                  isLeading: auction.winning_bidder_id === viewerId,
                  isAdmin: Boolean(viewerAdmin?.data),
                  maximumBid: viewerMaximum?.data?.amount ?? null,
                }
              : null,
            activeBidderCount: activeBidderCount || 0,
          })
        }

        if (route === 'presence/heartbeat' && req.method === 'POST') {
          const user = await authenticatedUser(req)
          if (!user) return json(req, { error: 'Sign in required.' }, 401)
          const input = await req.json()
          const slug = cleanText(input.auction_id, 80)
          const { data: auction, error: auctionError } = await admin
            .from('auctions')
            .select('id')
            .eq('slug', slug)
            .single()
          if (auctionError) throw auctionError

          const { error: heartbeatError } = await admin.from('auction_presence').upsert({
            auction_id: auction.id,
            user_id: user.id,
            last_seen_at: new Date().toISOString(),
          })
          if (heartbeatError) throw heartbeatError

          const activeSince = new Date(Date.now() - 120000).toISOString()
          const { count } = await admin
            .from('auction_presence')
            .select('user_id', { count: 'exact', head: true })
            .eq('auction_id', auction.id)
            .gte('last_seen_at', activeSince)
          return json(req, { activeBidderCount: count || 0 })
        }

        if (route === 'admin/reset-test' && req.method === 'POST') {
          const user = await authenticatedUser(req)
          if (!user) return json(req, { error: 'Administrator sign-in required.' }, 401)

          const { data: adminRecord } = await admin
            .from('auction_admins')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle()
          if (!adminRecord) return json(req, { error: 'Administrator access required.' }, 403)

          const input = await req.json()
          const slug = cleanText(input.auction_id, 80)
          const durationHours = Number(input.duration_hours || 24)
          const { data: resetAuction } = await admin
            .from('auctions')
            .select('id')
            .eq('slug', slug)
            .maybeSingle()

          if (input.clear_registrations) {
            const { data: protectedAdmins } = await admin.from('auction_admins').select('user_id')
            const protectedIds = new Set((protectedAdmins || []).map((record) => record.user_id))
            const { data: profiles } = await admin.from('bidder_profiles').select('id')
            for (const profile of profiles || []) {
              if (!protectedIds.has(profile.id)) {
                const { error: deleteError } = await admin.auth.admin.deleteUser(profile.id)
                if (deleteError) throw deleteError
              }
            }
          }
          if (resetAuction?.id) {
            await admin.from('auction_finalization_sends').delete().eq('auction_id', resetAuction.id)
          }
          const { data, error } = await authenticatedClient(req).rpc('reset_test_auction', {
            p_auction_slug: slug,
            p_duration_hours: durationHours,
          })
          if (error) return json(req, { error: error.message }, 400)
          return json(req, {
            message: 'The test auction was reset and scheduled to close at 8 PM Central.',
            auction: {
              currentPrice: data.current_price,
              reserveMet: data.reserve_met,
              extensionEndsAt: data.effective_ends_at,
              status: data.status,
            },
          })
        }

        if (route === 'cron/send-reminders' && req.method === 'POST') {
          if (!auctionCronSecret || req.headers.get('x-auction-cron-secret') !== auctionCronSecret) {
            return json(req, { error: 'Unauthorized reminder job.' }, 401)
          }
          const input = await req.json().catch(() => ({}))
          const slug = cleanText(input.auction_id || 'mission-art-2026', 80)
          return json(req, await processAuctionReminder(slug))
        }

        if (route === 'finalize-auction' && req.method === 'POST') {
          const input = await req.json().catch(() => ({}))
          const slug = cleanText(input.auction_id || 'mission-art-2026', 80)
          return json(req, await processAuctionFinalization(slug))
        }

        if (route === 'place-bid' && req.method === 'POST') {
          const user = await authenticatedUser(req)
          if (!user) {
            return json(req, { error: 'Sign in before placing a bid.' }, 401)
          }
          const input = await req.json()
          const amount = Number(input.amount)
          const kind = input.kind === 'quick' ? 'quick' : 'maximum'
          const slug = cleanText(input.auction_id, 80)

          const { data: previousAuction, error: previousAuctionError } = await admin
            .from('auctions')
            .select('id, current_price, winning_bidder_id')
            .eq('slug', slug)
            .single()
          if (previousAuctionError) throw previousAuctionError

          const previousLeaderId = previousAuction.winning_bidder_id
          const previousLeader = previousLeaderId
            ? await admin
                .from('bidder_profiles')
                .select('id, email, nickname, optional_reminders, blocked_at')
                .eq('id', previousLeaderId)
                .maybeSingle()
            : null
          const previousLeaderMaximum = previousLeaderId
            ? await admin
                .from('maximum_bids')
                .select('amount')
                .eq('auction_id', previousAuction.id)
                .eq('bidder_id', previousLeaderId)
                .maybeSingle()
            : null
          const previousLeaderPresence = previousLeaderId
            ? await admin
                .from('auction_presence')
                .select('last_seen_at')
                .eq('auction_id', previousAuction.id)
                .eq('user_id', previousLeaderId)
                .maybeSingle()
            : null
          const previousOutbidEmail = previousLeaderId
            ? await admin
                .from('auction_outbid_email_sends')
                .select('last_sent_at')
                .eq('auction_id', previousAuction.id)
                .eq('bidder_id', previousLeaderId)
                .maybeSingle()
            : null

          const { data, error } = await authenticatedClient(req).rpc('place_bid', {
            p_auction_slug: slug,
            p_amount: amount,
            p_kind: kind,
          })
          if (error) return json(req, { error: error.message }, 400)

          const isLeading = Boolean(data.viewer_is_leading)
          const newLeaderId = cleanText(data.winning_bidder_id, 80)
          const outbidProfile = previousLeader?.data
          if (
            outbidProfile &&
            outbidProfile.id !== user.id &&
            outbidProfile.id !== newLeaderId &&
            !outbidProfile.blocked_at &&
            outbidProfile.optional_reminders
          ) {
            try {
              const currentBid = Number(data.current_price)
              const previousMax = Number(previousLeaderMaximum?.data?.amount || 0)
              const amountToLead = Math.max(10, currentBid + 10 - previousMax)
              const activeCutoff = Date.now() - 1000 * 60 * 2
              const lastSeenAt = previousLeaderPresence?.data?.last_seen_at
              const outbidBidderIsActive = lastSeenAt ? new Date(lastSeenAt).getTime() >= activeCutoff : false
              const minutesRemaining = Math.ceil((new Date(data.effective_ends_at).getTime() - Date.now()) / 60000)
              const lastSentAt = previousOutbidEmail?.data?.last_sent_at
              const cooldownPassed = !lastSentAt || new Date(lastSentAt).getTime() <= Date.now() - 1000 * 60 * 10
              const shouldSendOutbidEmail = !outbidBidderIsActive && (minutesRemaining <= 30 || cooldownPassed)

              if (shouldSendOutbidEmail) {
                const auctionUrl = await createAuctionLoginUrl(outbidProfile.id)
                await sendAuctionEmail(
                  outbidProfile.email,
                  'You’ve been outbid on Joy in Our Chains',
                  `<h2>You’ve been outbid</h2>
                  <p>Hi ${cleanText(outbidProfile.nickname, 32)},</p>
                  <p>Another bidder has taken the lead on <strong>Joy in Our Chains</strong>.</p>
                  <p>The current bid is <strong>$${currentBid.toLocaleString('en-US')}</strong>.</p>
                  <p>You’re only ${amountToLead.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} away from taking the lead because your current Maximum Bid is ${previousMax.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}.</p>
                  <div style="margin:18px 0;padding:16px;border-radius:12px;background:#eef4ff;border:1px solid #bfdbfe;">
                    <p style="margin:0;font-size:16px;line-height:1.5;"><strong>Quick reminder:</strong> 100% of the auction funds go toward this mission trip, and the winning bidder gets one-of-a-kind original art as well. What a deal.</p>
                  </div>
                  <p><a href="${auctionUrl}" style="display:inline-block;padding:14px 22px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Return to the auction</a></p>
                  <p>If a bid is placed in the final five minutes, bidding extends by five minutes.</p>`
                )
                await admin.from('auction_outbid_email_sends').upsert({
                  auction_id: previousAuction.id,
                  bidder_id: outbidProfile.id,
                  last_sent_at: new Date().toISOString(),
                })
              }
            } catch (emailError) {
              console.error('OUTBID_EMAIL_FAILED', emailError)
            }
          }

          return json(req, {
            message: isLeading
              ? 'Your bid was placed successfully. You’re currently winning.'
              : `Another bidder reached that maximum first. Enter at least $${Number(data.current_price) + 10} to take the lead.`,
            auction: {
              currentPrice: data.current_price,
              reserveMet: data.reserve_met,
              extensionEndsAt: data.effective_ends_at,
              status: 'open',
              viewer: {
                nickname: (await ensureBidderProfile(user)).nickname,
                isLeading,
                maximumBid: amount,
              },
            },
          })
        }

        return json(req, { error: 'Not found' }, 404)
      } catch (error) {
        console.error(error)
        return json(req, { error: 'The auction service is temporarily unavailable.' }, 500)
      }
  },
}
