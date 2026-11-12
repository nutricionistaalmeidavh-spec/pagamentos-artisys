# ArtiSys Commerce Core — fases P2 a P5

Módulo **independente** da Central de Pagamentos em produção. Não modifica o checkout Asaas, pedidos antigos, D1, Worker, secrets, nem o licenciamento nativo dos aplicativos existentes.

## Arquitetura e custo

- **Core obrigatório: R$ 0**, Node.js 22.16+/24, SQLite nativo, HTML/CSS/JS, Docker opcional e self-hosted.
- **Shopify é canal opcional pago**, nunca dependência de ativação ou do painel do cliente.
- E-mail, CRM, Mercado Livre e conectores nativos são explicitamente opt-in; sem configuração a fila permanece em waiting_configuration.
- Dados canônicos: pedidos por (channel,seller,external_id); direitos de uso por (order_id,sku,seat); eventos externos por (channel,event_id); entrega externa por (kind,ref).
- Banco único de controle: nenhuma escrita em D1/SQLite de PDV, Obra, NutriDesk ou CRM existentes.
- Chaves internas: 16 caracteres criptograficamente aleatórios, hash SHA-256 para consulta e segredo protegido em AES-256-GCM no banco. Não substituir chaves nativas de produtos até a API de ativação reconhecer a emissão.

## Iniciar com custo zero

No diretório commerce, use o Node.js 24 ou o Docker Compose.

1. Copie .env.example para .env **fora do versionamento**.
2. Gere LICENSE_MASTER_KEY com openssl rand -base64 32.
3. Gere COMMERCE_ADMIN_TOKEN com pelo menos 32 caracteres aleatórios (por exemplo, openssl rand -hex 32).
4. Defina PUBLIC_BASE_URL para a URL real do portal; em produção deve ser HTTPS.
5. Execute via shell com as variáveis carregadas: node src/server.mjs. Ou docker compose up --build -d.
6. Acesse /healthz e /portal. O serviço liga em 127.0.0.1:8789 por padrão, e o Compose expõe a mesma porta **apenas no loopback** do host.
7. **Nenhuma compra será processada até conectar uma origem autenticada com secrets e webhooks oficiais**.

Não há npm install obrigatório para o core. TESTES: dentro de commerce, npm run check. Não copiar arquivos de produção para testes.

## P2 — autoridade e idempotência

A emissão acontece somente após comprovante financeiro assinado da origem. Eventos pending não geram direitos de uso; cancelados revogam direitos, e eventos paid atrasados não ressuscitam licenças canceladas. Replays de event_id ou reenvio de ordem com novos event_ids não duplicam a licença. O catálogo é allowlist: SKUs não conhecidos ficam sem provisionamento.

Cada autorização fica com activationStatus=awaiting_connector até a API do produto responder {"accepted":true,"activationCode":"CODIGO-NATIVO"}. Se o app aceitar explicitamente o código ArtiSys Core, o conector pode declarar acceptsCoreCode=true na configuração privada; não habilite para sistemas legados sem auditoria. Erros não criam falsos estados ativados.

Ordens canceladas geram product.revoke para o conector; estornos em refunds/create entram em payment.refund_review para revisão humana, pois reembolso parcial não equivale sempre a revogação completa. Não há estorno monetário automático.

## P3 — Shopify (não habilitado automaticamente)

Crie/configure uma integração própria no Shopify Dev Dashboard e obtenha o Client Secret da aplicação autorizada. Configure em ambiente privado:

- SHOPIFY_STORE_DOMAIN=85pits-mq.myshopify.com
- SHOPIFY_CLIENT_SECRET como segredo da aplicação Shopify emissora do webhook
- Endpoint HTTPS: POST /v1/webhooks/shopify
- Tópicos: orders/paid, orders/cancelled, refunds/create
- Permissões de pedidos e assinatura conforme a aplicação Shopify e seu escopo.

A API usa o corpo bruto e X-Shopify-Hmac-Sha256, compara em tempo constante, confere x-shopify-shop-domain e deduplica x-shopify-webhook-id. Sem secret, retorna 503 e não processa. Não ativar antes do QA real com pedido pago e cancelado controlados.

Produtos já criados na Shopify estão em rascunho; não são ativados nem publicados por este módulo. Preços e SKU precisam ser revistos antes da publicação. O webhook só cria direito de uso quando um pedido realmente pago incluir SKU presente no commerce/catalog.json.

## Configuração oficial de webhooks da Shopify

Os webhooks **não podem ser criados pelo token da integração ChatGPT**, porque pertenceriam a outro aplicativo e a assinatura HMAC não corresponderia à instalação ArtiSys. A integração deve pertencer a um aplicativo próprio criado no **Shopify Dev Dashboard**, instalado na loja com escopos `read_orders` (e campos protegidos de clientes quando habilitados). Para essa loja, utilize app próprio e o client credentials grant de loja da mesma organização. Mantenha credenciais privadas.

1. Aponte `PUBLIC_BASE_URL` para o HTTPS público que chega ao Commerce Core, com TLS e proxy protegendo `/v1/internal/*` e `/v1/admin/*`.
2. Configure `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` no ambiente privado do Commerce Core. O secret utilizado para HMAC é o do **mesmo app** que emite os webhooks.
3. Execute em ambiente seguro `node scripts/shopify-webhooks.mjs` com essas variáveis, **somente após** o servidor público e o aplicativo instalado existirem. O script consulta webhooks existentes, evita registros duplicados e recusa trocar um endpoint já registrado sem revisão.
4. Confirme no painel do app da Shopify os tópicos orders/paid, orders/cancelled e refunds/create, e faça os testes de entrega com payload assinado.
5. Não publique os sete produtos em rascunho até a homologação de ponta a ponta.

O script usa GraphQL Admin API versão 2026-10 e o OAuth client credentials grant (token temporário), sem serviços pagos novos e sem armazenar token no Git. Referências: https://shopify.dev/docs/apps/build/webhooks/subscribe e https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant.

## P4 — área do comprador

- GET /portal: área web mobile-first com login por link temporário.
- POST /v1/portal/request-access: responde genericamente, sem enumerar e-mails.
- POST /v1/admin/portal-link: gera link de acesso temporário **apenas para administrador autenticado** para entrega manual gratuita.
- GET /portal/claim?token=...: consome token de uso único (15 minutos); estabelece sessão HttpOnly, SameSite=Lax e Secure em HTTPS, válida por 7 dias.
- GET /v1/portal/licenses: exibe somente os direitos do comprador autenticado; não libera código de ativação nativo antes do retorno do conector original.
- POST /v1/portal/logout: encerra sessão.

A criação de licença paga gera entrega portal.email na outbox se PUBLIC_BASE_URL estiver configurado. Para e-mail automático defina MAIL_CONNECTOR_JSON apontando para um relay HTTPS próprio que aceite POST assinado e responda {"accepted":true}. Sem relay, usar a rota administrativa de link manual; nenhuma dependência paga.

O portal mostra downloads **somente** de releases estáveis previamente verificados no catálogo, quando o comprador está autorizado. Releases em homologação e aplicativos sem link confirmado não ganham download inventado.

## P5 — adaptadores e CRM

### Mercado Livre

POST /v1/ingest/mercadolivre exige X-ArtiSys-Timestamp e X-ArtiSys-Signature (sha256=HMAC-SHA256(secret, timestamp + "." + rawBody)), com janela de 5 minutos e secreto exclusivo MERCADOLIVRE_BRIDGE_SECRET. O Worker do Mercado Livre **deve** verificar o pagamento via API autenticada antes de enviar:

    {"source":"mercadolivre","seller":"SELLER_ID","eventId":"ml-paid-123","externalOrderId":"ORDER_ID","event":"paid","paymentConfirmed":true,"email":"cliente@exemplo.com","lines":[{"sku":"ARTISYS-PDV-NEXUS","quantity":1}]}

Use MERCADOLIVRE_SELLER_ID para restringir o vendedor esperado. Dados fictícios somente em QA. Se e-mail for ausente, o pedido fica para revisão, sem licença gerada. Não expor token OAuth ao Commerce Core.

### Pagamentos ArtiSys

POST /v1/ingest/artisys-payments aceita o mesmo contrato, alterando source para artisys-payments e usando PAYMENTS_BRIDGE_SECRET separado. O produtor deve confirmar liquidação na Central de Pagamentos; comprovante do usuário ou order pending não é fonte de pagamento.

### Ligação com a Central existente de Pagamentos ArtiSys

A Central de Pagamentos já emite callbacks assinados no formato artisys.license.activate/ artisys.license.revoke. Para ela, utilize POST /v1/ingest/artisys-payments/connector, com PAYMENTS_BRIDGE_SECRET correspondente ao secret individual do PRODUCT_CONNECTORS_JSON configurado na central, e PAYMENTS_PRODUCT_SKUS_JSON mapeando productId para os SKUs do Commerce Core. A rota só responde {"accepted":true} depois de o adaptador do software original ter confirmado a licença nativa. Enquanto isso, retorna HTTP 409 para manter o fulfillment pendente na Central (não altera pagamentos confirmados). Não sobrescreva segredos nem conectores existentes sem validação explícita.

### WppProspector CRM

O Commerce Core gera evento crm.sale por pedido pago com email, channel, orderId e SKUs e crm.sale_revoked por cancelamento. O endereço/secret são exclusivamente CRM_CONNECTOR_JSON. A implementação receptora no WppProspector deve preservar leads.phone canônico: nunca inferir um telefone, criar um lead, vincular conversa ou enviar WhatsApp a partir de apenas um e-mail de checkout. Armazenar vendas externas separadamente, com deduplicação por canal e número do pedido, e vincular por identidade verificada somente com consentimento.

### Contrato de saída (CRM, e-mail e aplicativos)

Via POST HTTPS (ou http://127.0.0.1 para self-hosted local) com:

- content-type: application/json
- x-artisys-timestamp: milissegundos desde epoch
- x-artisys-delivery-id: ID estável do job
- x-artisys-signature: sha256=HMAC-SHA256(secret, timestamp + "." + JSON enviado)

Payload:

    {"event":"product.grant","deliveryId":"UUID","payload":{"sku":"ARTISYS-PDV-NEXUS","licenseId":"UUID","orderId":"ID", "...":"..."}}

O receptor valida signature e replay e só responde {"accepted":true,"activationCode":"CODIGO_NATIVO"} após persistência durável. O evento crm.sale usa o mesmo envelope. Configure PRODUCT_CONNECTORS_JSON para mapear SKUs a URL e segredo de cada sistema, nunca para apontar um app diretamente a outro banco. Um conector sem destino fica pendente sem efeitos colaterais.

### Administração

- GET /v1/admin/jobs: somente metadados, nunca as chaves ou o payload cifrado.
- POST /v1/admin/dispatch: tenta enviar jobs de forma controlada, exige Bearer COMMERCE_ADMIN_TOKEN. Retry preserva IDs estáveis; erros não marcam a entrega como concluída.
- Rate limiting, firewall e autenticação do proxy são obrigatórios para exposição pública. Faça backup consistente do SQLite, guarde o MASTER_KEY e teste restauração.

## QA e condição de lançamento

Executar npm run check, validar o PR e homologar em ambiente separado: pedido pendente, pago, replay, cancelado, estorno parcial, mudança de SKU, e-mail ausente, falha de conexão, ativação nativa, acesso e revogação. Também validar política LGPD, logs sem dados sensíveis, HTTPS, backup, domínio, relay de e-mail e permissão da Shopify.

**Não é um deploy de produção.** A branch/PR não altera secrets nem variáveis da instalação atual. Não fazer merge automático na main enquanto faltarem integrações nativas e testes reais assinados.

## Ponte P2: licenciador nativo do PDV e Oficina

O endpoint interno `POST /v1/internal/pdv-bridge` oferece compatibilidade com a Central comercial existente, que emite **códigos de 6 dígitos com 48 horas**. Ele é independente do código interno de 16 caracteres do Commerce Core. Sem credenciais ele retorna HTTP 503 e não emite licença.

O conector verifica o HMAC recebido com `PDV_BRIDGE_SECRET`; inicia sessão na Central existente usando o `PDV_NATIVE_ADMIN_TOKEN` somente no backend; consulta se já existe licença ativa para aquele e-mail/produto; impede substituí-la; e cria um vínculo local criptografado por `licenseId` antes de liberar o código nativo ao comprador. No cancelamento altera apenas a licença nativa comprovadamente criada por esse vínculo. Caso o POST remoto tenha resultado incerto, trava com `native_manual_reconciliation_required` e **não reemite** automaticamente.

Para ativar, configure segredo privado e URL HTTPS em `PDV_BRIDGE_SECRET`, `PDV_NATIVE_ADMIN_TOKEN`, `PDV_NATIVE_BASE_URL`. Aponte ambos SKUs `ARTISYS-PDV-DESKTOP` e `ARTISYS-OFICINA-DESKTOP` em `PRODUCT_CONNECTORS_JSON` para `http://127.0.0.1:8789/v1/internal/pdv-bridge` com o mesmo segredo HMAC. Essa URL é loopback do processo, não endpoint de exposição pública; proteja no proxy reverso e não publique o caminho interno na internet. **Não sobrescreva credenciais existentes**.

Os demais produtos, incluindo NutriDesk, Obra, Nexus e Financeiro, preservam seus próprios licenciadores; não há ativação automática falsa. Eles exigem adaptadores específicos antes da venda.
