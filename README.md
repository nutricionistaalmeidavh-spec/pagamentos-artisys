# Pagamento ArtiSys

Central financeira independente para venda dos sistemas ArtiSys. **Hospedagem canônica: Cloudflare Workers + D1 + R2**, com deploy automático pelo GitHub. A versão Node.js/SQLite permanece somente como opção self-hosted isolada.

## Conectar ao Cloudflare

1. Acompanhar a `main` do repositório (as mudanças passam por PR com testes antes do merge).
2. No Cloudflare: Workers & Pages → Create application → Import a repository → GitHub → nutricionistaalmeidavh-spec/pagamentos-artisys.
3. Nome do Worker: **pagamento-artisys-central** (igual ao wrangler.jsonc). Branch de produção: **main**. Diretório raiz: /.
4. Build command: **npm run check**. Deploy command: **npx wrangler deploy**.
5. Confirmar que o Worker dispõe dos bindings D1 **PAGAMENTO_ARTISYS_DB** e R2 **PAGAMENTO_ARTISYS_ARQUIVOS**. O D1 será identificado como **pagamento-artisys-central-db**. O R2 usa provisionamento automático beta, com nome gerado pelo Wrangler a partir do Worker; caso não esteja disponível, veja docs/CLOUDFLARE.md para adicionar os recursos e identificadores reais.
6. Configurar em Worker → Settings → Variables & Secrets: ADMIN_TOKEN (segredo aleatório de no mínimo 32 caracteres), PUBLIC_BASE_URL (HTTPS definitivo) e PUBLIC_ORIGINS (domínio do site).
7. Quando estiver pronto para conectar Asaas, configurar ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN e ASAAS_API_BASE_URL exclusivos. Habilitar o checkout somente ao adicionar PAYMENTS_ENABLED=true ao runtime.
8. Opcionalmente vincular pagamentos.artisys.dev pelo painel Domains & Routes; até lá usar a URL workers.dev gerada na implantação.

O Worker cria D1 apenas com CREATE TABLE/INDEX IF NOT EXISTS; checkout Asaas permanece **desativado** enquanto PAYMENTS_ENABLED não for true. Sem D1 responde 503 em vez de simular disponibilidade. O cron pertence somente ao Worker **pagamento-artisys-central**, com agendamento a cada cinco minutos; não cria um cron global com nome compartilhado.

## Rotas

- /admin — painel administrativo.
- /comprar?oferta=ID — checkout público.
- /pedido?id=ID — status protegido do pedido.
- /v1/catalog — ofertas publicadas.
- /v1/orders — pedidos e checkout.
- /v1/webhooks/asaas — receptor autenticado de webhooks.
- /healthz — integridade e binding D1.

Arquivos digitais em R2: releases/NOME_DO_ARQUIVO, servidos com token do comprador. Conectores HTTPS HMAC para sistemas desktop e SaaS. Cron de reconciliação a cada 5 minutos.

## Testes e segurança

- **npm run check**: testes da API e do Worker.
- **npm run test:worker**: smoke Worker+D1+assets local sem chave Asaas real.
- GitHub Actions roda apenas por acionamento manual ou abertura/reabertura/ready de PR, não a cada commit.
- Cloudflare Workers Builds fará deploy de cada commit na main após a vinculação GitHub.

O motor Asaas pode ser homologado uma vez; novos produtos necessitam somente testar preço e conector. O primeiro deploy em conta nova requer verificação controlada de segredos, webhook, DNS, backups, rate limiting e primeiros pagamentos. Nenhum segredo ou instalação de produto existente é alterado.

[Configuração Cloudflare](docs/CLOUDFLARE.md) · [Contrato de API](docs/openapi.yaml) · [Integrações de produtos](docs/INTEGRACAO.md)
