# Instalação dos quatro sistemas — GitHub → Worker → R2 (OIDC sem segredos)

## Estado e fluxo

Todos os repositórios de origem estão públicos: `OBRANAMAOCOMERCIAL`, `PDV-ARTISYS`, `PDVNexus` e `sistemafinanceiro`.

`merge na main do pagamentos-artisys` → `.github/workflows/sync-system-releases-r2.yml` → validação de 8 instaladores / 4 produtos → runner baixa os arquivos via **GitHub Releases** e **GitHub Actions artifacts públicos** → confere nome, tamanho e SHA-256 → GitHub Actions solicita **token OIDC temporário e assinado** ao GitHub → Cloudflare Worker autentica a assinatura na JWKS oficial do GitHub, audience, repo, branch e workflow específico → grava os arquivos em partes de 8 MiB no R2 privado já vinculado pelo binding `PAGAMENTO_ARTISYS_ARQUIVOS`.

Não são necessários `ARTISYS_R2_CONFIG_JSON`, `ARTISYS_SOURCE_GITHUB_TOKEN`, `ARTISYS_GDRIVE_OAUTH_JSON`, PAT nem a variável de habilitação. Não criar tokens permanentes só para fazer a transferência.

## Segurança

- GitHub Actions recebe `permissions: id-token: write` apenas no job de sincronização.
- O Worker aceita esse JWT **somente** para `/v1/admin/system-releases` e seus endpoints de multipart. Todas as demais rotas de admin continuam exigindo `ADMIN_TOKEN`.
- O verificador exige issuer exato, audience `artisys-release-sync-r2`, assinatura RSA/SHA-256 validada contra JWKS do GitHub, `repo:nutricionistaalmeidavh-spec/pagamentos-artisys:ref:refs/heads/main`, `workflow_ref` fixo e prazo de validade curto.
- O multipart inclui SHA-256 do manifesto em metadados R2 apenas quando a rota é autenticada pelo OIDC; o cliente calcula SHA-256 dos bytes reais antes da transmissão.
- O backend confere o tamanho do objeto no R2 e o checksum declarado nos metadados ao concluir. Objetos existentes com tamanho/hash conflitantes não são sobrescritos silenciosamente.
- Nenhum ZIP de artifact é entregue ao cliente: o runner extrai só o `.exe` ou `.dmg` esperado.
- O upload não publica ofertas, não cria cobranças e não concede download a pedidos. `PAYMENTS_ENABLED`, `active`, `delivery_mode`, Asaas, D1, OAuth e os 63 Dev Kits permanecem inalterados.
- As builds macOS ainda requerem avaliação de assinatura/notarização antes da distribuição comercial para Mac.

## Origem das versões

| Sistema | Origem |
|---|---|
| Obra na Mão | GitHub Actions Windows v2.1.0 |
| PDV ArtiSys | Release Windows v2.0.7; Actions macOS Intel/Apple Silicon v2.0.1 |
| PDV Nexus (normal) | Release v2.0.1 Windows 10/11, 8 (32-bit) e 7 |
| Sistema Financeiro | Actions Windows v0.1.0 da main |

Todos os hashes e URLs são versionados em `src/system-releases.mjs`.

## Manutenção

O job `upload` sincroniza automaticamente quando o manifesto ou o workflow são atualizados em `main`, e também pode ser acionado manualmente pela opção **Run workflow** do GitHub.

Se a publicação da versão nova do Worker ainda não tiver terminado, o job aguarda a rota OIDC ficar acessível. Artifacts do GitHub Actions expiram; os arquivos já copiados e verificados no R2 deixam de depender da retenção do Actions.

Se um arquivo divergir ou o R2 estiver indisponível, a execução falha e informa a variante — nunca ativa a oferta para compensar o erro.

**O R2 é a distribuição privada definitiva.** Para começar a vender, ainda é necessário homologar a liberação de download autenticada por pedido pago.
