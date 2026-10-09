const HOSTS = new Set(['api.asaas.com', 'api-sandbox.asaas.com']);
const CHECKOUT_HOSTS = new Set(['asaas.com', 'sandbox.asaas.com']);

export function gatewayConfig(env) {
  if (!env.ASAAS_API_KEY) throw new Error('asaas_not_configured');
  const base = new URL(env.ASAAS_API_BASE_URL || 'https://api-sandbox.asaas.com/v3');
  if (base.protocol !== 'https:' || !HOSTS.has(base.hostname) || base.pathname !== '/v3' || base.search || base.hash || base.port) throw new Error('asaas_invalid_host');
  return base.href.replace(/\/$/, '');
}
export async function asaasRequest(env, fetchImpl, path, init = {}) {
  const base = gatewayConfig(env);
  const response = await fetchImpl(base + path, {
    ...init, headers: {
      accept: 'application/json', 'content-type': 'application/json',
      access_token: env.ASAAS_API_KEY, ...init.headers
    },
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('asaas_http_' + response.status);
  return body;
}
export function validCheckoutUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && CHECKOUT_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/checkoutSession/') && !parsed.username && !parsed.password;
  } catch { return false; }
}
export async function createCheckout(env, fetchImpl, order, offer) {
  const base = gatewayConfig(env);
  const recurring = order.sale_type !== 'one_time';
  const body = {
    externalReference: order.id,
    billingTypes: recurring ? ['CREDIT_CARD'] : ['PIX', 'CREDIT_CARD'],
    chargeTypes: recurring ? ['RECURRENT'] : ['DETACHED'],
    minutesToExpire: 60,
    callback: {
      successUrl: env.PUBLIC_BASE_URL + '/pedido?id=' + encodeURIComponent(order.id),
      cancelUrl: env.PUBLIC_BASE_URL + '/pedido?id=' + encodeURIComponent(order.id),
      expiredUrl: env.PUBLIC_BASE_URL + '/pedido?id=' + encodeURIComponent(order.id)
    },
    items: [{ name: offer.name, description: offer.description || offer.name, quantity: 1, value: order.amount_cents / 100 }]
  };
  if (recurring) {
    const due = new Date(Date.now() + 86400000).toISOString().slice(0,10) + ' 12:00:00';
    body.subscription = { cycle: order.sale_type === 'yearly' ? 'YEARLY' : 'MONTHLY', nextDueDate: due };
  }
  const data = await asaasRequest(env, fetchImpl, '/checkouts', { method: 'POST', body: JSON.stringify(body) });
  const id = String(data.id || '');
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw new Error('asaas_checkout_id_invalid');
  const fallback = base.includes('sandbox') ? 'https://sandbox.asaas.com/checkoutSession/show/' + encodeURIComponent(id) : 'https://asaas.com/checkoutSession/show?id=' + encodeURIComponent(id);
  const link = String(data.link || fallback);
  if (!validCheckoutUrl(link)) throw new Error('asaas_checkout_url_invalid');
  return { id, link };
}
export function checkoutAmountCents(checkout) {
  if (!Array.isArray(checkout?.items) || !checkout.items.length) return null;
  let cents = 0;
  for (const item of checkout.items) {
    const qty = Number(item.quantity), val = Number(item.value);
    if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(val) || val <= 0) return null;
    cents += Math.round(val * 100) * qty;
  }
  return cents;
}
