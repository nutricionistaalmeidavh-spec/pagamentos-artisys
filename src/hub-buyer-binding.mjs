// Extensão opt-in: o Hub valida criptograficamente o ticket e o usuário.
// O gateway o transporta intacto, sem aceitar privilégio, preço ou e-mail dele.
export const isHubProduct=product=>typeof product==='string'&&
  (product==='hubestudos-subscription'||/^hubestudos-course-[a-z0-9-]{2,80}$/.test(product));
export const checkoutBinding=(productId,binding)=>isHubProduct(productId)?{buyerBinding:binding}:undefined;
export function bindingForOffer(productId,deliveryMode,value){
 if(!isHubProduct(productId))return null;
 if(deliveryMode!=='webhook'||typeof value!=='string'||!(/^[A-Za-z0-9_-]{40,1200}\.[a-f0-9]{64}$/.test(value)))
  throw Error(value?'buyer_binding_invalid':'buyer_binding_required');
 return value;
}
