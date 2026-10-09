# Pagamento ArtiSys

Sistema financeiro independente para vender softwares e serviços ArtiSys diretamente no site, sem conectar pagamentos ao Obra na Mão, MercadoLivre ou Central de Licenças.

**Status:** implementação inicial P0-P4 em homologação; não usar dinheiro real até concluir o gate de sandbox e segurança operacional.

## Entregas

| Fase | Funcionalidades implementadas |
| --- | --- |
| P0 | Node.js + SQLite, catálogo e preços canônicos, cupons, pedidos, tokens, painel |
| P1 | Adaptador Checkout Asaas opcional, Pix manual alternativo, compra avulsa e estrutura recorrente |
| P2 | Webhook autenticado, persistência antes do HTTP 200, deduplicação, fila de tentativas, replay e reconciliação |
| P3 | Entrega manual, download local protegido e conectores de produto HMAC por origem permitida |
| P4 | Dashboard, ofertas, pedidos, cupons, eventos, entregas, tela de checkout, área de pedido e contrato OpenAPI |

## Execução local (núcleo R$0)

Requer Node.js 22.16 ou superior. A API usa somente bibliotecas nativas do Node.js e SQLite embutido; Node 22 pode imprimir um aviso experimental do SQLite.

1. Copie .env.example para .env.
2. Gere um ADMIN_TOKEN aleatório de ao menos 32 caracteres (Node crypto.randomBytes).
3. Configure o ADMIN_TOKEN apenas no arquivo de ambiente privado.
4. Execute: node --env-file=.env src/main.mjs
5. Abra http://127.0.0.1:3080/admin.
6. Cadastre oferta e habilite sua publicação.

Docker: docker compose up --build -d. O container fica exposto somente na interface local 127.0.0.1:3080. Publique atrás de proxy TLS open source (ex.: Caddy) para receber webhooks externos.

## Testes

- npm test — suite integrada com simulação local da API Asaas.
- npm run check — valida a sintaxe do backend e roda a suite.
- CI GitHub Actions — somente em Pull Request para main ou acionamento manual; não dispara a cada commit.

## Documentos

- docs/INTEGRACAO.md — API, modelo de segurança, operação e integração dos sistemas.
- docs/openapi.yaml — contrato OpenAPI 3.1.
- API oficial Asaas: https://docs.asaas.com/reference/criar-novo-checkout
- Webhook oficial Asaas: https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook

## Notas de implantação

O Asaas não é requisito para rodar o núcleo e tem tarifas próprias quando habilitado. Nenhum segredo real é commitado.

O painel de pedidos usa SQLite como fonte canônica. Cada produto mantém sua própria autoridade de licença e somente recebe um evento por conector HMAC. Sem conector, o pedido pago permanece aguardando configuração/entrega e não finge que uma licença foi ativada.

**Limites desta entrega:** conectar produtos reais, testar compra ponta a ponta no sandbox Asaas, monitoramento, backups, limitação de tráfego e TLS de produção exigem configuração de ambiente. Estorno financeiro via API do Asaas, troca de plano, emissão fiscal e cancelamento self-service de assinaturas não são automatizados nesta versão.

A venda só deve ser habilitada no site após execução e aprovação dos testes completos em ambiente homologado.
