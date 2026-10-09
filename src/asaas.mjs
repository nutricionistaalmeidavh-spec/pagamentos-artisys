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
    const due = new Date(Date.now()).toISOString().slice(0,10) + ' 12:00:00';
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

const PAID = new Set(['RECEIVED','CONFIRMED','RECEIVED_IN_CASH']);
function paymentCents(value){const v=Number(value);return Number.isFinite(v)&&v>0?Math.round(v*100):null;}
// Proveniência financeira derivada da API autenticada, nunca apenas do webhook.
export async function verifyCheckoutPayment(env,fetchImpl,order){
  if(order.payment_provider!=='asaas'||!order.checkout_id)throw new Error('checkout_unlinked');
  const data=await asaasRequest(env,fetchImpl,'/payments?checkoutSession='+encodeURIComponent(order.checkout_id)+'&limit=100');
  if(!Array.isArray(data.data)||data.hasMore===true)throw new Error('payments_lookup_incomplete');
  const paid=data.data.filter(p=>PAID.has(String(p?.status||'').toUpperCase()));
  if(paid.length===0)return null;
  if(paid.length!==1)throw new Error('ambiguous_paid_checkout');
  const p=paid[0];
  if(!p.id||(p.checkoutSession&&String(p.checkoutSession)!==order.checkout_id)||(p.externalReference&&String(p.externalReference)!==order.id))
    throw new Error('payment_not_linked');
  if(paymentCents(p.value)!==order.amount_cents)throw new Error('payment_amount_mismatch');
  return {paymentId:String(p.id),subscriptionId:p.subscription?String(p.subscription):null,status:String(p.status).toUpperCase()};
}
export async function verifyPaymentEvent(env,fetchImpl,order,paymentId,expectedStatuses){
  if(!/^[A-Za-z0-9_-]{3,128}$/.test(String(paymentId||'')))throw new Error('invalid_payment_id');
  const p=await asaasRequest(env,fetchImpl,'/payments/'+encodeURIComponent(paymentId));
  if(String(p.id||'')!==paymentId||!expectedStatuses.includes(String(p.status||'').toUpperCase()))
    throw new Error('payment_status_not_verified');
  if(paymentCents(p.value)!==order.amount_cents)throw new Error('payment_amount_mismatch');
  if(p.externalReference&&String(p.externalReference)!==order.id)throw new Error('payment_reference_mismatch');
  if(String(p.checkoutSession||'')!==order.checkout_id && (!order.subscription_id||String(p.subscription||'')!==order.subscription_id))
    throw new Error('payment_link_mismatch');
  return p;
}
