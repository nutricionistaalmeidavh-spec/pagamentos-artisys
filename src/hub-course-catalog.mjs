// IDs canônicos do HubEstudos: uma trilha = um produto comercial.
// Modelos administrativos sem preço. Não entram na tabela de ofertas,
// catálogo público nem checkout até o operador informar um preço válido.
import {CATALOG_DRAFTS} from './catalog-drafts.mjs';

export const HUB_COURSE_TEMPLATES=Object.freeze([
 {id:'trilha-pentest-ethical-hacking',productId:'hubestudos-course-trilha-pentest-ethical-hacking',name:'Pentest e Ethical Hacking',lessons:30},
 {id:'trilha-seguranca-ofensiva-defensiva',productId:'hubestudos-course-trilha-seguranca-ofensiva-defensiva',name:'Segurança Ofensiva e Defensiva',lessons:50},
 {id:'trilha-engenharia-reversa-malware',productId:'hubestudos-course-trilha-engenharia-reversa-malware',name:'Engenharia Reversa e Análise de Malware',lessons:60},
 {id:'trilha-pesquisa-vulnerabilidades',productId:'hubestudos-course-trilha-pesquisa-vulnerabilidades',name:'Pesquisa e Exploração de Vulnerabilidades',lessons:20},
 {id:'trilha-aplicacoes-cloud-ia',productId:'hubestudos-course-trilha-aplicacoes-cloud-ia',name:'Segurança de Aplicações, Infraestrutura, Nuvem e IA',lessons:58},
 // Três trilhas guiadas com IA; o estado editorial vem do catálogo canônico do Hub.
 {id:'desenvolvimento-com-ia',productId:'hubestudos-course-desenvolvimento-com-ia',name:'Desenvolvimento de Sistemas com IA',description:'Projeto Meu Gestor · 32 aulas guiadas',lessons:32,trackKind:'ia',status:'published'},
 {id:'automacao-canal-dark',productId:'hubestudos-course-automacao-canal-dark',name:'Automação de Canal com IA',description:'Automação de conteúdo · 32 aulas guiadas',lessons:32,trackKind:'ia',status:'published'},
 {id:'engenharia-reversa-com-ia',productId:'hubestudos-course-engenharia-reversa-com-ia',name:'Engenharia Reversa com IA',description:'Trilha de IA em preparação editorial · 32 aulas',lessons:32,trackKind:'ia',status:'draft'}
].map(x=>Object.freeze({...x,description:x.description||'Trilha HubEstudos · '+x.lessons+' aulas',trackKind:x.trackKind||'principal',status:x.status||'published',saleType:'one_time',deliveryMode:'webhook',artifactName:null,active:false,priceCents:null,category:'cursos'})));

export const isUnpublishedHubCourse=productId=>HUB_COURSE_TEMPLATES.some(x=>x.productId===productId&&x.status!=='published');

const SYSTEM_OFFER_IDS=new Set(['obra-na-mao','pdv-artisys-restaurantes','pdv-nexus','artisys-sistema-financeiro']);
const DEVKIT_OFFER_IDS=new Set(CATALOG_DRAFTS.map(x=>x.id).filter(x=>!SYSTEM_OFFER_IDS.has(x)));

export function offerCategory(offer){
 const id=String(offer?.id||''),product=String(offer?.product_id||offer?.productId||'');
 if(product.startsWith('hubestudos-course-')||product==='hubestudos-subscription'||HUB_COURSE_TEMPLATES.some(x=>x.id===id))return 'cursos';
 if(SYSTEM_OFFER_IDS.has(id)||SYSTEM_OFFER_IDS.has(product))return 'sistemas';
 if(DEVKIT_OFFER_IDS.has(id)||DEVKIT_OFFER_IDS.has(product))return 'devkits';
 return 'outros';
}

export function courseTemplatesPending(offers){
 const registered=new Set(offers.map(x=>x.id));
 // Nunca altera ofertas reais existentes, inclusive legadas ou publicadas.
 return HUB_COURSE_TEMPLATES.filter(x=>!registered.has(x.id));
}
