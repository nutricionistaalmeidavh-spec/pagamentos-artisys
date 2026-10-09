# Pagamento ArtiSys — contrato operacional

## Independência

Banco e painel são exclusivos deste serviço; não reutilize a API key ou o webhook do Obra na Mão. Use Node.js nativo, SQLite e, opcionalmente, Docker. Sem assinatura de software ou serviço cloud obrigatórios.

## Painel e ofertas

Acesse /admin com ADMIN_TOKEN de no mínimo 32 caracteres. Cadastre um produto, uma oferta, preço em BRL, tipo de venda (one_time, monthly, yearly) e modo de entrega (manual, download, webhook). Produtos não publicados não aparecem em GET /v1/catalog.

O valor do pedido é calculado no servidor a partir da oferta ativa. Cupons são validados e aplicados ao criar o pedido. Nunca aceite valores vindos do navegador.

Para conectar o site ArtiSys, direcione o botão do produto à URL https://SEU-DOMINIO-PAGAMENTOS/comprar?oferta=ID_DA_OFERTA. Alternativamente, integre as rotas JSON documentadas em openapi.yaml.

## Checkout

POST /v1/orders cria pedido, exige Idempotency-Key com 16 a 120 caracteres e retorna orderAccessToken. Trate esse token como segredo. POST /v1/orders/ID/checkout aceita provider=asaas ou provider=manual_pix, autenticado pelo Bearer do pedido. GET /v1/orders/ID exige o mesmo Bearer.

Asaas é opt-in. Use ASAAS_API_KEY, ASAAS_API_BASE_URL (somente hosts oficiais), ASAAS_WEBHOOK_TOKEN e PUBLIC_BASE_URL https. O checkout é hospedado no Asaas. O gateway pode ser homologado centralmente, sem repetir o sandbox para cada novo produto. A primeira ativação da nova infraestrutura ainda requer conferência controlada do ambiente, webhook, domínio TLS e pagamento.

Para Pix sem Asaas, defina MANUAL_PIX_KEY no ambiente privado. O painel de administração exige conferência do recebimento no banco da empresa antes de confirmar o pedido; comprovantes enviados não equivalem a confirmação financeira.

## Webhook

Configure no painel Asaas, com token **distinto da API key**:
- Endpoint: https://SEU-DOMINIO-PAGAMENTOS/v1/webhooks/asaas
- Header autenticado de entrega: asaas-access-token
- Eventos: CHECKOUT_CREATED, CHECKOUT_PAID, CHECKOUT_CANCELED, CHECKOUT_EXPIRED.
- Se utilizar assinaturas e estornos, habilite também os eventos específicos após validar o tratamento correspondente.

O handler valida token, insere o ID único do evento em SQLite e responde HTTP 200 após persistir. Em seguida a fila local processa. CHECKOUT_PAID requer ID de checkout associado à ordem, valores coerentes e pagamento confirmado por GET /v3/payments filtrado pelo checkoutSession. Na ausência de cobrança paga, nada é liberado. A conciliação administrativa usa a mesma verificação, mesmo se a sessão do checkout não estiver mais consultável. Falhas ficam registradas e podem ser reprocessadas pelo painel.

Eventos recebidos sem correspondência de pedido não criam pedidos nem ativam licenças. O processamento e a entrega são idempotentes por identificadores duráveis.

## Conector para sistemas

No ambiente privado, configure CONNECTOR_ALLOWED_ORIGINS com lista de origens HTTPS permitidas, separadas por vírgula. Configure PRODUCT_CONNECTORS_JSON em JSON, indexado pelo productId canônico. Cada item possui url HTTPS e secret individual, por exemplo:

  {"pdv-artisys":{"url":"https://produto.exemplo.com/api/internal/ativar","secret":"chave-privada-do-conector"}}

Payload POST JSON: event, orderId, productId, email, customerName, amountCents, currency, saleType, idempotencyKey. Headers:
- x-artisys-timestamp: timestamp de milissegundos
- x-artisys-delivery-id: ID único da entrega
- x-artisys-signature: sha256=HMAC-SHA256(secret, timestamp + "." + JSON_CANÔNICO_ENVIADO)

O sistema receptor deve comparar assinatura de forma segura, validar janela de tempo de cinco minutos, persistir idempotencyKey e só responder JSON {"accepted":true} após o processamento durável. Se ainda não existir conector, a entrega fica em waiting_configuration, sem licença liberada.

Para delivery_mode=download, registre artifactName no painel e armazene o arquivo fisicamente em RELEASES_DIR. A API só libera GET /v1/orders/ID/download mediante token do pedido e status pago/entregue. Não publique RELEASES_DIR como diretório web.

## Autenticação e proteção

ADMIN_TOKEN deve ser restrito a administradores. Restringir /admin por VPN, autenticação no proxy ou firewall é recomendado. O comprador recebe um token exclusivo do pedido. Ele autoriza somente a consulta daquele pedido; não permite consultar outros pedidos do mesmo e-mail sem autenticação adicional. Não o exponha em URLs ou logs públicos.

PUBLIC_ORIGINS configura CORS para o domínio do site. CORS não substitui antifraude ou rate limiting de API. Use reverse proxy com TLS, limite de requisições e registros redigidos. Evite que conexão de produto aponte para endereço fora de CONNECTOR_ALLOWED_ORIGINS.

SQLite pressupõe execução com instância única: não exponha o mesmo arquivo simultaneamente a várias réplicas. Agende backups consistentes, teste restauração e monitore espaço em disco. Documente tratamento de dados pessoais e retenção conforme LGPD.

## Limitações intencionais

Os conectores reais de ArtiSys ainda precisam ser configurados individualmente. Não há reembolso financeiro automático no gateway nem motor completo de upgrade/downgrade/cancelamento por parte do cliente. Para assinaturas, o checkout recorrente e eventos básicos estão disponíveis, mas todo o ciclo de gestão requer homologação. Não considerar o motor novo automaticamente aprovado para produção: sua ativação exige verificação controlada de credenciais, endpoint, webhook, gateway e monitoramento. Depois, produtos adicionais usam somente o gate de conector e preço, sem repetição do sandbox.

## Referência de produção reutilizada

Padrão técnico estudado em ConsulroriaAmamenta-o/worker/cloudflare-billing-runtime.js: usar o webhook como gatilho e a API autenticada como fonte de confirmação; não reutilizar segredos, banco ou recursos da Gestão Amamentação.

Novos produtos: validar somente preço e conector idempotente de entrega. Mudanças no motor financeiro, payload, autenticação ou gateway exigem nova homologação da parte alterada.

### Gate de um novo produto (sem novo sandbox de cobrança)

1. Cadastrar oferta com preço canônico, identificador estável e modalidade.
2. Configurar endpoint e segredo HMAC do produto no servidor, sem copiar credenciais Asaas.
3. Validar assinatura do evento, idempotência e estado de entrega com mocks/testes de integração.
4. Simular evento verificado para assegurar que pagamento sem confirmação NÃO ativa licença.
5. Validar ativação, eventual renovação e revogação do próprio produto, separadamente.
6. Habilitar a oferta no site. Não modificar os demais aplicativos.

A validação do gateway é responsabilidade do Pagamento ArtiSys e ocorre apenas quando o motor ou seu ambiente financeiro muda. Não se faz uma cobrança real a cada novo produto.
