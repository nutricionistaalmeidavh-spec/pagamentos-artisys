# Deploy automático Cloudflare — Pagamento ArtiSys

## Importar o GitHub

Cloudflare Dashboard → Workers & Pages → Create application → Import a repository. Conecte a conta GitHub, selecione nutricionistaalmeidavh-spec/pagamentos-artisys e configure:

- **Worker:** pagamento-artisys-central, mesmo nome do wrangler.jsonc.
- **Production branch:** main.
- **Root directory:** / ou vazio.
- **Build command:** npm run check.
- **Deploy command:** npx wrangler deploy.

Workers Builds instalará as dependências e publicará o Worker quando houver novo commit na main. Não configurar workflow GitHub Actions concorrente para deploy.

## D1 e R2

wrangler.jsonc define os bindings **PAGAMENTO_ARTISYS_DB** (D1) e **PAGAMENTO_ARTISYS_ARQUIVOS** (R2), sem IDs de recursos, para provisionamento automático beta do Wrangler no primeiro deploy via GitHub. O D1 tem nome **pagamento-artisys-central-db**; o nome do bucket R2 será gerado pelo provisionamento automático com prefixo do Worker **pagamento-artisys-central**, para evitar reutilizar o bucket de outro aplicativo. **Confirme que os recursos foram provisionados no Dashboard**. Se a conta não tiver o beta, configure manualmente: crie D1 com nome **pagamento-artisys-central-db** e um bucket R2 exclusivo com prefixo **pagamento-artisys-central**, copie os valores reais `database_id` e `bucket_name` para as entradas respectivas em wrangler.jsonc, faça commit e aguarde o deploy. Nunca reutilize D1 de outro produto ou invente IDs.

O binding dos arquivos está em **PAGAMENTO_ARTISYS_ARQUIVOS** e o dos assets do painel em **PAGAMENTO_ARTISYS_ASSETS**. O agendamento `*/5 * * * *` pertence exclusivamente a esse Worker, sem colisão com os crons dos demais sistemas.

O schema é criado com IF NOT EXISTS na inicialização; a versão Node/SQLite local não compartilha dados com D1.

## Secrets no Dashboard

| Nome | Valor / uso |
| --- | --- |
| ADMIN_TOKEN | Secret aleatório de 32+ caracteres, autenticação do painel |
| PUBLIC_BASE_URL | URL HTTPS real do Worker; destino do retorno |
| PUBLIC_ORIGINS | Lista de origens autorizadas, separadas por vírgula; por exemplo https://artisys.dev |
| ASAAS_API_KEY | Chave API específica do Pagamento ArtiSys |
| ASAAS_WEBHOOK_TOKEN | Token do webhook de 32+ caracteres, diferente da chave API |
| ASAAS_API_BASE_URL | https://api.asaas.com/v3 para produção, https://api-sandbox.asaas.com/v3 para sandbox |
| PAYMENTS_ENABLED | Literal true somente quando a cobrança estiver habilitada |
| PRODUCT_CONNECTORS_JSON | JSON secreto dos destinos HMAC por productId |
| CONNECTOR_ALLOWED_ORIGINS | Origens HTTPS permitidas para integração |
| MANUAL_PIX_KEY | Opcional, Pix com confirmação humana |

O Worker não define PAYMENTS_ENABLED no repositório. Portanto, cobranças Asaas ficam desabilitadas até você definir essa variável como true. Não copie os secrets da Gestão de Amamentação.

## Ativar e verificar

1. Após o deploy, abra a URL workers.dev fornecida pelo Cloudflare. O deploy publica código, painel, rotas e cron. Se os bindings D1/R2 forem provisionados automaticamente, os recursos também estarão conectados. Não publica ofertas, secrets ou domínio próprio de forma automática.
2. GET /healthz deve retornar ok true, storage cloudflare-d1 e paymentsEnabled false.
3. /admin deve abrir, exigindo ADMIN_TOKEN para carregar os dados.
4. Conecte opcionalmente pagamentos.artisys.dev em Settings → Domains & Routes, se sua zona DNS estiver na Cloudflare.
5. Configure no Asaas um webhook HTTPS para https://SEU_DOMINIO/v1/webhooks/asaas, com o mesmo token salvo em ASAAS_WEBHOOK_TOKEN.
6. Confira o registro do evento, reconciliação e pagamento autorizado em ambiente controlado.
7. Depois da homologação da **infraestrutura central**, ative PAYMENTS_ENABLED=true e publique a oferta do produto.
8. Próximos aplicativos não precisam de sandbox de pagamentos repetido; devem testar somente contratos de preço e de entrega.

## Operação

- Cron programado: a cada cinco minutos. Recupera pagamentos pendentes, eventos e entregas.
- Binários no R2 com prefixo releases/. O endpoint de download exige pagamento/entrega confirmados e token do pedido.
- O serviço usa D1 como fonte canônica; não copie arquivo SQLite local para produção sem migração própria.
- Antes de vender publicamente, aplique WAF/rate limiting, políticas LGPD, alertas, retenção de dados, backup e teste de restauração.

Fontes Cloudflare:
https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/
https://developers.cloudflare.com/workers/wrangler/configuration/
https://developers.cloudflare.com/workers/static-assets/binding/
