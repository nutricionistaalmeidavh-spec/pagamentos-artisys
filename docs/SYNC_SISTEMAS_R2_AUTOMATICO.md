# Sincronização automática — somente GitHub → Cloudflare R2 privado

A sincronização após merge na main é feita por **ArtiSys · Sincronizar instaladores no R2**, usando um manifesto de oito instaladores de quatro sistemas. Os 63 Dev Kits são independentes e **não são alterados**.

## Fonte de cada sistema

- Obra na Mão: artefato GitHub Actions do instalador Windows **2.1.0**, do repositório `OBRANAMAOCOMERCIAL`.
- PDV ArtiSys: GitHub Release **2.0.7** para Windows; artefatos GitHub Actions **2.0.1** para macOS Intel e Apple Silicon, do repositório `PDV-ARTISYS`.
- PDV Nexus (não Classic): GitHub Release **2.0.1**, com instaladores Windows 10/11, 8 (32 bits) e 7, do repositório `PDVNexus`.
- ArtiSys Sistema Financeiro: artefato GitHub Actions **0.1.0**, reconstruído no repositório `sistemafinanceiro`.

Versões distintas por plataforma são intencionais e devem ser exibidas como tais. Os hashes e tamanhos constam em `src/system-releases.mjs`. Release público não é sinônimo de autorização de pagamento: a entrega continuará privada até o checkout e o download protegido estarem homologados.

## Configuração restante (não é necessária nenhuma credencial do Google Drive)

O vínculo de deploy GitHub → Cloudflare **não transfere tokens de escrita R2 para GitHub Actions**. No repositório `pagamentos-artisys` → Settings → Secrets and variables → Actions:

1. Secret **`ARTISYS_R2_CONFIG_JSON`** — JSON com o `account_id`, o **nome real do bucket já existente**, `access_key_id` e `secret_access_key` S3 R2. Conceder apenas acesso ao bucket privado de releases, sem usar tokens de Asaas ou OAuth do painel.
2. Secret **`ARTISYS_SOURCE_GITHUB_TOKEN`** — fine-grained GitHub PAT com **Actions: Read** nos repositórios `OBRANAMAOCOMERCIAL`, `PDV-ARTISYS` e `sistemafinanceiro`. As releases públicas não precisam desse PAT.
3. Repository variable **`ARTISYS_RELEASE_SYNC_ENABLED=true`** — apenas depois de cadastrar os dois secrets, para permitir o upload em `main`. Não controla `PAYMENTS_ENABLED`.

**Não configurar `ARTISYS_GDRIVE_OAUTH_JSON`**. Nenhuma leitura do Drive faz parte do pipeline.

Quando os acessos forem autorizados: Actions → **ArtiSys · Sincronizar instaladores no R2** → **Run workflow**. Próximas alterações de manifesto na main executam o workflow automaticamente. Antes disso a etapa de validação passa e o upload permanece `skipped`.

## Como funciona

1. Exporta e valida o manifesto de oito binários, com repositório de origem permitido por ID do produto.
2. Faz HEAD no R2 privado e pula objeto já íntegro (tamanho e metadata SHA-256).
3. Para o que faltar, baixa da **GitHub Release** correspondente ou do **artefato GitHub Actions** correspondente.
4. No caso de artefato ZIP de Actions, extrai somente o `.exe`/`.dmg` esperado; nunca confunde o ZIP com o arquivo distribuído.
5. Calcula SHA-256 nos bytes do instalador extraído e compara com o valor do manifesto; falha fechado em qualquer divergência.
6. Faz upload multipart via cliente S3-compatible do R2 e depois confirma HEAD e metadata SHA-256.
7. O painel mostra **R2 · SHA conferido** somente para arquivos verificados.

Arquivos maiores que 100 MB não são commitados no repositório. O manifesto está versionado, os binários permanecem nos releases/artifacts de origem e no bucket privado. Artefatos Actions expiram; execute a importação antes da retenção acabar ou regenere a build validada e atualize o manifesto.

## Limites

- O pipeline não cria nova conta, token, bucket, Worker, domínio, OAuth ou ligação Cloudflare.
- Não habilita vendas, não altera `PAYMENTS_ENABLED`, `active`, `delivery_mode` ou dados D1.
- Upload não é entrega ao comprador: exige implementação e homologação do download protegido com token de pedido pago.
- A automação não substitui instaladores em conflito silenciosamente, nem aceita releases de repositórios divergentes.
