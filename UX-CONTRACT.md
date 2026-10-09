# Pagamento ArtiSys · Contrato de UX administrativo

## Escopo
Aplicação web responsiva `/admin` que usa os endpoints existentes em `src/cloudflare-worker.mjs`, sem fontes paralelas, sem redefinir status financeiros e sem alterar o checkout `/comprar`.

## Navegação
Início (`screen=inicio`), Pedidos (`pedidos`), Ofertas (`ofertas`), Mais (`mais`). No celular, tabs inferiores; no desktop, superiores. A aba é refletida na URL. Navegação de retorno deve reabrir a área solicitada; filtros de pedido permanecem na sessão atual.

## Fonte de dados
- Início: GET /v1/admin/summary, /v1/admin/fulfillments e /healthz.
- Pedidos: GET /v1/admin/orders; o endpoint retorna **no máximo 200** e a busca filtra apenas o conjunto recebido. Não exibir a pesquisa como global.
- Ofertas: GET /v1/admin/offers, /coupons, /summary e GET /healthz.
- Mais: /v1/admin/events, /fulfillments, /summary e GET /healthz.
- Sem dados falsos ou pré-preenchimento financeiro.

## Estado e semântica
- `gatewayConfigured=true` significa chave presente, não autenticação com o Asaas verificada.
- `paymentsEnabled=false` indica checkout Asaas bloqueado. Novas ofertas iniciam em rascunho; publicar exige confirmação separada e readiness mínimo.
- `order.status` é financeiro e `order.fulfillmentStatus` indica entrega. Pedido pago e não entregue exige pendência visível.
- D1/Asaas determinam o pagamento; JS nunca pode marcar status como pago por conta própria.

## Ações, erro e recuperação
- Criar oferta: etapa produto/valor → entrega → revisão → POST /v1/admin/offers com `active:false`. Em falha, preservar escolhas e exibir erro; em sucesso, reconsultar servidor.
- Editar oferta: preservar `active` existente ao salvar; publicação/retração explícita exige confirmação, reconsulta de catálogo e impede reenvio durante request.
- Confirmar Pix manual: diálogo adverte que somente crédito bancário verificado permite confirmar. POST /orders/:id/confirm-manual somente após ação explícita; erro não muda UI.
- Confirmar entrega manual: POST /orders/:id/deliver-manual somente após confirmação; pagamento e entrega continuam estados distintos.
- Conciliação: POST /orders/:id/reconcile; sucesso não é sinônimo de pagamento encontrado. Reconsultar status real.
- Reprocessar fila: POST /events/:id/replay ou /fulfillments/:id/replay; confirmação não indica sucesso da entrega, só pedido aceito para processamento.
- O servidor controla autorização. A interface não apresenta campos de secrets.
- Ações pendentes desabilitam reenvio; login expirado volta ao acesso; modal tem Escape, foco inicial e trap de Tab; após fechar restaura foco.
- Toda lista contempla carregamento, vazio, falha com retry e resultado persistido do servidor.

## Verificação
`npm run check` (contratos e backend); `npm run test:worker` (D1 e assets); GitHub Actions só sob PR/manual. Verificar em navegador real a 375px e desktop com token de teste, cadastro de rascunho, nenhuma cobrança, rolagem horizontal ausente, foco de diálogo e recuperação de erro.
