# Sincronização automática dos 4 sistemas para R2 — GitHub Actions

## Fluxo

`merge em main` → GitHub Actions **ArtiSys · Sincronizar instaladores no R2** → valida manifesto versionado em `src/system-releases.mjs` → baixa 8 instaladores de fonte autorizada (Google Drive ou artefato GitHub Actions) → valida tamanho e SHA-256 → upload multipart diretamente ao R2 privado → valida **HEAD (tamanho + SHA-256 em metadados)** → painel exibe **R2 · SHA conferido**.

**Não colocar executáveis no GitHub.** São 8 arquivos somando aproximadamente 810 MB; alguns passam do limite de 100 MB por objeto do GitHub. O manifesto é o contrato de arquivos, não a carga binária. O repositório também não ganha acesso automático aos segredos do Cloudflare só porque o Worker faz deploy pelo GitHub.

## Configuração única necessária no GitHub

Repositório: `nutricionistaalmeidavh-spec/pagamentos-artisys` → **Settings → Secrets and variables → Actions**.

Criar **3 segredos** (NÃO enviar conteúdo pelo chat, commit, issue ou PR):

| Secret | Conteúdo | Escopo de acesso |
|---|---|---|
| `ARTISYS_R2_CONFIG_JSON` | JSON contendo `account_id`, `bucket`, `access_key_id`, `secret_access_key` | Credencial S3-compatible do Cloudflare R2 limitada ao bucket privado `PAGAMENTO_ARTISYS_ARQUIVOS` |
| `ARTISYS_GDRIVE_OAUTH_JSON` | JSON contendo `client_id`, `client_secret`, `refresh_token` | OAuth `drive.readonly` com acesso aos sete instaladores no Google Drive |
| `ARTISYS_SOURCE_GITHUB_TOKEN` | Fine-grained PAT no repositório `OBRANAMAOCOMERCIAL` com **Actions: Read** | Só para baixar o artefato aprovado do Obra na Mão 2.1.0 |

Exemplo **esquemático**, sem valores reais, do JSON R2:

```json
{"account_id":"CONTA_CLOUDFLARE","bucket":"BUCKET_EXISTENTE","access_key_id":"CHAVE_R2","secret_access_key":"SEGREDO_R2"}
```

Exemplo **esquemático** do JSON Google Drive:

```json
{"client_id":"CLIENT_ID_OAUTH","client_secret":"CLIENT_SECRET_OAUTH","refresh_token":"REFRESH_TOKEN_READONLY"}
```

Usar nome **real** do bucket Cloudflare, que não está fixado em `wrangler.jsonc` (binding R2 gerado no provisionamento original). Nenhum bucket, token, Worker, OAuth do checkout ou aplicação será recriado.

**Após cadastrar os três secrets**, em **Variables → Repository variables**, criar `ARTISYS_RELEASE_SYNC_ENABLED=true`. Esta flag autoriza **somente upload de binários**, não ativa cobranças nem publica ofertas.

Se os secrets/flag forem adicionados **depois** do merge, entrar em **Actions → ArtiSys · Sincronizar instaladores no R2 → Run workflow** uma única vez. Próximas alterações do manifesto em `main` sincronizam automaticamente.

## Garantias e limites

- A automação só roda o upload na `main` quando `ARTISYS_RELEASE_SYNC_ENABLED=true`. O job de validação roda sem credenciais.
- O upload consulta `HEAD` do R2. Se já existir o arquivo com **mesmo tamanho e hash nos metadados**, pula. Se houver objeto diferente na mesma chave, aborta — **não sobrescreve**.
- As oito entradas passam por SHA-256 dos bytes realmente baixados. Só são aceitos 7 IDs do Google Drive e o artefato do GitHub Actions do Obra 2.1.0, com origem/endereço autorizados.
- A chave R2 é fixa e privada em `releases/...`. O job não faz `wrangler deploy`, não atualiza D1, nem altera `PAYMENTS_ENABLED`, `active` ou `delivery_mode`.
- Sem ativar o recebimento automático pelo comprador. **Upload para R2 não significa entrega concluída:** só posteriormente implementar e homologar links protegidos por pedido pago, por plataforma, com validação de Asaas.
- Executáveis só podem ser redistribuídos depois da verificação de licença do software e eventuais componentes de terceiros. O pipeline valida **integridade**, não licenciamento/assinatura do sistema operacional.
- O artefato do GitHub Actions pode expirar (retention 90 dias). Após sincronização, reexecução usa objetos já verificados no R2 e dispensa novo download; ao mudar versão, apontar o manifesto a um artefato ainda disponível.
- Arquivo carregado manualmente na UI sem metadado SHA-256 é marcado como *R2 · SHA pendente*. A rotina automática interromperá ao encontrar chave existente sem SHA válido em vez de ocultar possível divergência.

## Arquivos versionados

- `src/system-releases.mjs`: manifest fonte de verdade com versões, keys e SHA-256
- `scripts/export-release-manifest.mjs`: exportação validada para formato neutro
- `scripts/sync_system_releases.py`: download autorizado, verificação e multipart R2
- `.github/workflows/sync-system-releases-r2.yml`: agendamento automático após merge
- `test/test_release_sync.py`: testes sem chamadas externas

O sistema atual possui as ofertas em rascunho; os 63 Dev Kits não fazem parte deste workflow.
