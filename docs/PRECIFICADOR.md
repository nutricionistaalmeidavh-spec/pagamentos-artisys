# Precificador comercial da ArtiSys — Workers oficial

Ferramenta interna para precificar serviços durante reuniões de BI, automação e sistemas.

## Endereços reais

**Central de Pagamentos já configurada no repositório:**

`https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev`

O nome está em `wrangler.jsonc` e no README. O estado do site ao vivo deve ser confirmado após publicação.

**Nova rota no mesmo Worker (após merge e deploy):**

`https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/precificar`

**Worker independente de precificação (ainda não publicado):**

`https://precificador-artisys-central.nutricionistaalmeidavh.workers.dev`

Este novo nome não é um subdomínio de `pagamentos-artisys-central`: ambos são serviços irmãos na conta `nutricionistaalmeidavh.workers.dev`. Não são necessários domínios `artisys.dev`, DNS próprio, serviço pago ou mudança nos domínios da Central.

## Publicação

1. Revise o PR com testes e faça merge na `main`. Se o Worker central já estiver vinculado a Builds, o deploy automático da `main` atualiza **somente** o `pagamentos-artisys-central`, liberando `/precificar` na origem atual.
2. Para ter endereço próprio, crie no Cloudflare Workers & Pages uma **segunda aplicação Worker** a partir do **mesmo repo GitHub**, com nome `precificador-artisys-central` e configuração `wrangler.precificador.jsonc`. A alternativa via CLI autenticada é `npx wrangler deploy --config wrangler.precificador.jsonc`.
3. Esta configuração usa o binding `PRECIFICADOR_ASSETS` e o **Service Binding** `PAGAMENTOS_CENTRAL` para o Worker `pagamentos-artisys-central`. Verifique no Dashboard a existência e vínculo. O novo Worker não tem D1, R2, Asaas, cron ou secrets de cobrança.
4. Confirme o acesso ao painel e faça login com o token administrativo existente. Login é validado pela Central via Service Binding; o Worker secundário não retorna os dados financeiros do endpoint.
5. Não publique o endereço do Worker secundário como ativo até concluir o deploy e conferir o login.
6. Se não desejar segundo Worker, use apenas `/precificar` na origem atual. É a versão com menor manutenção e sem recurso adicional.

**Alternativa self-hosted (R$ 0 em licenças):** executar `npm start` em Node.js com SQLite local e `ADMIN_TOKEN` de 32+ caracteres; servir `/precificar` pelo mesmo servidor e, se for necessário HTTPS público, configurar reverse proxy próprio. Sem serviço externo de IA nem fontes de terceiros.

## Fluxo comercial

1. Escolha um preset: BI obras, BI industrial, BI planilhas, automação ou software.
2. Registre cliente, contato, escopo, horas estimadas de cada etapa e prazo em dias úteis.
3. Informe **custo interno da hora**, despesas, percentual de contingência, alíquota estimada de tributos e margem de lucro desejada.
4. Registre qualidade de dados, fontes, frequência de atualização e perfis de acesso. **Aplicar reserva sugerida** é opcional: o diagnóstico não altera automaticamente seu orçamento.
5. Confira custo, ponto de equilíbrio, lucro, margem real, preço após desconto, investimento e retorno ilustrativo do cliente.
6. Copie a proposta para o cliente sem informar custos internos ou exporte a estimativa JSON para arquivo privado.

## Fórmula comercial

- Custo direto = soma(horas por etapa) × custo interno/hora + despesas adicionais.
- Reserva de risco = custo direto × risco %.
- Custo total = custo direto + reserva.
- Preço-alvo = custo total / [1 - (tributos% + margem desejada%) / 100].
- Arredondar preço para cima em múltiplos de R$ 50, em seguida aplicar eventual desconto.
- Ponto de equilíbrio = custo total / (1 - tributos% / 100).
- Lucro estimado = preço final - tributos estimados - custo total.
- Margem efetiva = lucro estimado / preço final.

**Limites:** Os percentuais são premissas do prestador, não regras tributárias. Valide a alíquota com o contador; informe custos de equipe e impostos corretamente. Retorno por economia de horas não é garantia de ROI. Proposta é estimativa não vinculante, sujeita à validação de dados e escopo.

## Privacidade

- O front-end é estático, mas entrar no painel requer token `ADMIN_TOKEN` existente, validado por `/v1/admin/summary`. Em host secundário a validação é delegada por binding.
- Orçamentos, nomes e informações do cliente ficam **somente no localStorage do navegador** (sem criptografia, sincronização ou persistência em D1). Não devem ser usados em dispositivo compartilhado.
- Uma sessão autorizada está em `sessionStorage` por origem. No Worker secundário é necessário autenticar novamente, pois as origens são diferentes.
- `Exportar JSON` inclui custos internos: use apenas como backup privado. `Copiar proposta` e `Imprimir/PDF` excluem a margem interna e o custo/hora.
- Nenhum formulário do precificador cria oferta, pedido, checkout, cobrança ou webhook.

## Testes

`npm run check` executa testes unitários de fórmulas e rotas Node/Worker, inclusive isolamento do Worker secundário. `npm run test:worker` valida o Worker da Central em ambiente local.
