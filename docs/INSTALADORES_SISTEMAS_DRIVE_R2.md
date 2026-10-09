# Entregas dos quatro sistemas ArtiSys — Google Drive → R2

## Fontes verificadas em 09/10/2026 (Drive + GitHub Actions)

| Oferta (já em rascunho) | Plataforma | Instalador no Drive | Tamanho (bytes) | Estado |
|---|---|---|---:|---|
| Obra na Mão | Windows | [Obra 2.1.0 — artefato do GitHub Actions](https://github.com/nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL/actions/runs/37495882884/artifacts/11427268634) | 125774266 | **Versão 2.1.0 validada** no build de `main`, aguardando R2 |
| PDV ArtiSys — restaurantes | Windows 10/11 | [Instalador Windows](https://drive.google.com/file/d/1hAu1EhTGtSf3npdxsjl0X_RpdeSGHlSV/view) | 98109306 | Candidato |
| PDV ArtiSys — restaurantes | macOS Intel | [Instalador Intel](https://drive.google.com/file/d/1CqxfNSHU8PTIL3XzYzwa5LcOZn5NwTdc/view) | 122669575 | Candidato |
| PDV ArtiSys — restaurantes | macOS Apple Silicon | [Instalador Apple Silicon](https://drive.google.com/file/d/1Lj2OY464T5vU5Xf5EOhUSkP0wOF3kjBz/view) | 117168141 | Candidato |
| PDV Nexus | Windows 10/11 | [Instalador Windows 10](https://drive.google.com/file/d/1EXfLkUH7Jun6oMBkfljTQnUqtDAYOMAT/view) | 94403609 | Candidato |
| PDV Nexus | Windows 8 | [Instalador Windows 8](https://drive.google.com/file/d/1MI5V-OfCM4u9EL4m5ei3k_omRJ4xEKNw/view) | 65376681 | Candidato |
| PDV Nexus | Windows 7 | [Instalador Windows 7](https://drive.google.com/file/d/1fxyWAOGPvpJ9zNaSBIxTVHNpbYlMSOkm/view) | 69007120 | Candidato |
| ArtiSys Sistema Financeiro | Windows | [Instalador v0.1.0](https://drive.google.com/file/d/12rwqtuaiM4vHRcByNhHNU5lvEE2mLDer/view) | 118366655 | Candidato; validar QA da build |

## Segurança
- NÃO cadastrar esses arquivos como públicos, nem liberar links diretos do Drive aos compradores.
- IDs de catálogo vinculados a suas ofertas pré-existentes. Nenhum Dev Kit foi modificado.
- Os arquivos **não são transferidos automaticamente** do Drive pela implantação GitHub: não existe conectividade de escrita do conector Drive para a conta Cloudflare nesta conversa.
- No painel (Mais → Instaladores dos sistemas), somente usuário com `ADMIN_TOKEN` consegue ver fontes e enviar arquivos ao R2. O Worker aceita cada arquivo em partes de 8 MiB para não depender de limites de 100 MB por requisição.
- O upload exige o tamanho exato informado pelo Drive; o Worker confere com R2 HEAD depois de concluir. Não valida SHA-256 nessa etapa.
- Versionamento de Obra é baseado em build validado do GitHub Actions; não se confunde a versão do código, release antiga ou instalador antigo no Drive. O upload de Obra exige 125774266 bytes exatos.
- As ofertas continuam inativas, com entrega manual, até a aprovação explícita de versão e implementação da entrega múltipla autenticada por compra.

## Próximos passos operacionais
1. Obra na Mão: baixar o artefato do GitHub Actions, extrair `Obra-na-Mao-Desktop-Setup-2.1.0.exe` (não enviar o ZIP do Actions) e usar o painel para transferi-lo ao R2. SHA-256 local verificado: `6f8a310f7d4ea6cc48fa1c6fbfa5448b78a4a4e97e484da071611785889af6a2`. A release pública `2.0.0` é anterior ao build `2.1.0` aprovado.
2. Confirmar a build corrente do Financeiro e a compatibilidade do PDV Nexus.
3. No painel, abrir a seção de instaladores; para Obra, extrair o executável do artefato do GitHub Actions; para os demais, baixar os arquivos no Drive e selecionar o executável/DMG para envio ao R2.
4. Conferir os oito `stored: true` com tamanho validado no R2. O instalador Obra 1.0.19 não é usado.
5. Implementar/testar seleção por plataforma e liberação por pedido pago, sem links públicos, antes de alterar `delivery_mode`.
6. Testar download autenticado com pagamento controlado, liberar compras somente após aprovação.

## Contrato administrativo (privado)
- `GET /v1/admin/system-releases` – retorna estado de cada arquivo no R2 e origem Drive.
- `POST /v1/admin/system-releases/{variant}/start` – inicia multipart (somente candidatos).
- `PUT /v1/admin/system-releases/{variant}/part/{n}?uploadId=...` – recebe uma parte de 8 MiB.
- `POST /v1/admin/system-releases/{variant}/complete` – conclui com eTags e verifica tamanho.
- `POST /v1/admin/system-releases/{variant}/abort` – cancela multipart interrompido.

Nenhuma rota pública nova é criada e nenhum link privado é distribuído ao comprador nesta etapa.
