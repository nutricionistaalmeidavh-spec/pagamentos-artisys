# Go-live · Pagamento ArtiSys

## Estado seguro
- A hospedagem canônica é Cloudflare Workers + D1 + R2, com o Worker **pagamentos-artisys-central**.
- Nunca colocar tokens, API keys, secrets, Pix ou IDs privados no repositório ou na URL do navegador.
- O merge do painel **não ativa** cobrança; `PAYMENTS_ENABLED` permanece ausente/`false` até a autorização da operação.
- Não alterar `wrangler.jsonc` nem substituir Worker/D1/R2/OAuth para configurar pagamentos.

## Diagnóstico de leitura
1. Acesse `/admin`, entre com `ADMIN_TOKEN`, abra **Mais → Diagnóstico da integração Asaas → Verificar agora**.
2. O serviço usa `GET /v3/wallets/` para autenticar a chave, e `GET /v3/webhooks?offset=0&limit=100` para verificar URL, ativo, fila e eventos. Consultas são **somente leitura**, não criam cobranças.
3. Para produção: `ASAAS_API_BASE_URL=https://api.asaas.com/v3`, `ASAAS_API_KEY` como Secret exclusivo, `ASAAS_WEBHOOK_TOKEN` como Secret, `PUBLIC_BASE_URL` com o domínio HTTPS atual.
4. Webhook esperado: `https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/v1/webhooks/asaas`.
5. Eventos de checkout: `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e `CHECKOUT_EXPIRED`.
6. Se GET /webhooks retornar 403, verifique as permissões de consulta da chave no Asaas (não substitua nem exponha segredos no chat).
7. O diagnóstico **não prova** que o token de webhook no Asaas é o mesmo do Worker: o Asaas não fornece o valor do segredo em consultas posteriores. Compare os dois manualmente sem compartilhá-los.
8. O diagnóstico **não confirma** recebimento de webhook, transação financeira, licença entregue nem aprovação final da operação.


## Preparação automatizada da entrega (sem liberar vendas)
- Fonte imutável dos 8 instaladores: `src/system-releases.mjs`; fonte dos 63 Dev Kits e 8 pacotes: `src/devkit-releases.mjs`.
- A sincronização original comprovou 8 instaladores e 71 ZIPs no **R2 privado** com SHA-256; não copiar novamente nem colocar binários no repositório de pagamentos.
- O Worker prepara automaticamente, em execução agendada, as **quatro ofertas de sistemas ainda em rascunho**: `delivery_mode=download` com um arquivo padrão canônico. Não altera preço, ativo, pedidos antigos ou ofertas já publicadas. Também há um botão explícito na aba **Ofertas**.
- `GET /v1/admin/offer-readiness` (exige `ADMIN_TOKEN`) verifica todas as variantes, integridade do R2 e licenciamento do kit. O painel mostra a razão de bloqueio em cada oferta.
- Os kits ficam com licença **pendente** até conferência **individual** de autoria, licença do código, dependências, NOTICEs, documentação e obrigações de terceiros. O administrador pode registrar essa conferência com duas declarações e confirmação textual; `review-devkit-license` apenas audita a revisão, sem publicar.
- O ZIP `mapas-e-dados-geoespaciais-agro-v0.1.0.zip` foi gerado **antes** da atualização de documentação/licenciamento e permanece **bloqueado** até ser substituído por release e proveniência atualizados.
- O catálogo público apresenta plataformas para os quatro sistemas; o pedido salva imutavelmente a escolha e entrega apenas o arquivo correspondente. Para ZIPs individuais, não há escolha de plataforma.
- Downloads exigem pagamento **confirmado**, entrega concluída e manifesto R2 validado. O navegador faz download em fluxo nativo por POST autenticado, evitando carregar instaladores de mais de 100 MB como Blob JS.
- O comprador recebe um código de acesso gerado no pedido, que pode copiar e usar com o ID em outro navegador. Perda de ambos exige conferência de identidade e reemissão administrativa; a reemissão invalida o código anterior.
- O status de reembolso bloqueia imediatamente novos downloads. Nenhuma ação baseada exclusivamente em redirecionamento do gateway autoriza pagamento.

## Regras de publicação e dependências
- **Nunca** definir `PAYMENTS_ENABLED=true` automaticamente. O backend bloqueia publicação **e ambas as formas de checkout** enquanto a chave estiver `false`/ausente.
- Um sistema só pode ser publicado com **todas as suas variantes** íntegras e verificadas no R2. Um kit exige, adicionalmente, homologação expressa de direitos/licenças. A validação é no **backend**, independentemente dos botões da interface.
- Para a operação básica é suficiente **Pix manual com confirmação administrativa**, usando `MANUAL_PIX_KEY`; não é necessária uma integração paga. Asaas é **alternativa opcional**, que exige secrets e homologação financeira própria.
- Nem o upload R2 nem a conferência documental publicam ofertas. Quando o responsável decidir ativar vendas, primeiro confirme o fluxo financeiro e as variáveis do Cloudflare; depois publique uma oferta por vez, revendo preço e formato de entrega.
- Testes automáticos simulam pedido, checkout Pix manual, confirmação administrativa, autorização e bloqueio do download, reemissão de credencial e seleção de plataforma **sem movimentar dinheiro real**.
- O teste automatizado **não substitui** um pagamento controlado real nem atesta a configuração privada do Asaas. Essa etapa requer autorização do titular.

## Antes de liberar vendas
- [ ] API autenticada no ambiente de produção, sem 401/403.
- [ ] Webhook correspondente à URL oficial, ativo, fila não interrompida e eventos completos.
- [ ] Mesmo token privado nos dois serviços, verificado pelo operador.
- [ ] Conferência de pagamento real controlado autorizada pelo operador: criação do checkout, pagamento, log de entrega do Asaas, evento persistido e processado, conciliação com GET /payments e resultado canônico no D1.
- [ ] Testar entrega manual, conector HMAC ou download R2 escolhido para cada sistema vendido; pagamento confirmado e entrega concluída são estados distintos.
- [ ] Confirmar preço, condições, suporte/entrega e catálogo do produto específico.
- [ ] Rotacionar `ADMIN_TOKEN` divulgado em conversa antes de disponibilizar operação a colaboradores.
- [ ] Configurar monitoramento de falhas do Worker, backups D1 e procedimento de recuperação.
- [ ] Somente então definir `PAYMENTS_ENABLED=true` no painel Cloudflare, em **Configurações → Variáveis e segredos**. Não configurar isso no GitHub.
- [ ] Publicar primeira oferta e vincular a URL `/comprar?oferta=ID` no site ArtiSys após testar tudo.

## Garantias do código atual e limites
- O endpoint administrativo `GET /v1/admin/asaas/diagnostic` exige `ADMIN_TOKEN`; não modifica gateway, ofertas, pedidos ou secrets.
- Assinaturas mensais/anuais e integração automática de licença precisam de homologação específica do produto, além da configuração geral do gateway.
- Falha de API, timeout ou webhook sem evento **não** deve gerar confirmação otimista de pagamento ou entrega.
- A criação de cobranças é irreversivelmente financeira: não executar testes de produção com dinheiro sem autorização explícita do titular da operação.

Referências: https://docs.asaas.com/reference/retrieve-walletid e https://docs.asaas.com/reference/list-webhooks.
