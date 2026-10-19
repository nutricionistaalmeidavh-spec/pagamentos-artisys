// Billing links are opt-in and opaque to the payment service.
// The receiving product verifies the signed binding and tenant ownership.
export const isHubProduct=product=>typeof product==='string'&&
  (product==='hubestudos-subscription'||/^hubestudos-course-[a-z0-9-]{2,80}$/.test(product));
export const isPdvSaasProduct=product=>product==='pdv-total-saas';
export const needsBuyerBinding=product=>isHubProduct(product)||isPdvSaasProduct(product);
export const checkoutBinding=(productId,binding)=>needsBuyerBinding(productId)?{buyerBinding:binding}:undefined;
export function bindingForOffer(productId,deliveryMode,value){
 if(!needsBuyerBinding(productId))return null;
 if(deliveryMode!=='webhook'||typeof value!=='string'||
   !(/^[A-Za-z0-9_-]{40,1200}\.[a-f0-9]{64}$/.test(value)))
  throw Error(value?'buyer_binding_invalid':'buyer_binding_required');
 return value;
}
