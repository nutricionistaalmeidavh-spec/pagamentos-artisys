# Precificador comercial da ArtiSys

Ferramenta interna para precificação de projetos de BI, automação e sistemas. **Roda somente na Central de Pagamentos existente, sem Worker adicional.**

## Endereço e publicação

- **Worker único:** `pagamentos-artisys-central`.
- **Repositório:** `nutricionistaalmeidavh-spec/pagamentos-artisys`.
- **Configuração Cloudflare:** `wrangler.jsonc`.
- **Precificador:** https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/precificar
- **Admin da Central:** https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/admin

O precificador é servido como HTML, CSS e JavaScript no mesmo Worker que já atende ao checkout e à API administrativa. A entrada `/precificar` utiliza os assets existentes; não adiciona banco, R2, segundo Worker, DNS, domínio `artisys.dev`, rota de checkout ou provedor de pagamento.

A publicação acompanha **o deploy automático da `main` já conectado ao `pagamentos-artisys-central`**. O status real do deploy deve ser conferido no Cloudflare se o link não abrir. Não configurar outra aplicação, não criar outro subdomínio e não executar deploy separado.

**Alternativa self-hosted:** `npm start` com Node.js/SQLite e `ADMIN_TOKEN` de 32 caracteres ou mais. O mesmo caminho `/precificar` funciona localmente. Não há dependência obrigatória de serviço pago.

## Fluxo comercial

1. Selecione tipo de serviço (BI de obras, BI industrial, BI de planilhas, automação ou sistema).
2. Informe cliente, contato, projeto, escopo, estimativa de horas por etapa e prazo.
3. Ajuste o custo **interno** por hora, despesas extras, risco, alíquota tributária estimada, margem-alvo e desconto.
4. Avalie quatro aspectos do diagnóstico (fontes, qualidade dos dados, atualização e permissões); o botão de contingência é opcional e explícito.
5. Confira custo, preço sugerido, ponto de equilíbrio, impostos, lucro e margem efetiva.
6. Copie a proposta para apresentar ao cliente sem divulgar custos internos, imprima em PDF ou salve/exporte uma cópia privada.

## Cálculo

- **Custo direto:** soma(horas estimadas por atividade) × custo interno/hora + despesas.
- **Reserva de risco:** custo direto × percentual de contingência.
- **Custo total:** custo direto + reserva.
- **Preço-alvo:** custo total / [1 − (tributos% + margem-alvo%) / 100].
- **Preço sugerido:** arredondamento do preço-alvo para cima em múltiplos de R$ 50.
- **Preço final:** preço sugerido × (1 − desconto%).
- **Ponto de equilíbrio:** custo total / (1 − tributos% / 100).
- **Lucro previsto:** preço final − tributos estimados − custo total.
- **Margem efetiva:** lucro previsto / preço final.

Margem é diferente de markup. Tributos e horas são premissas e exigem confirmação; a estimativa não substitui avaliação contábil nem a validação de escopo com o cliente. Valor mensal de suporte é opcional e não está incluído no projeto automaticamente.

## Segurança e privacidade

- O acesso administrativo é validado pelo endpoint existente `/v1/admin/summary`, usando `ADMIN_TOKEN`.
- As estimativas e os nomes dos clientes são mantidos somente no `localStorage` do navegador; **não são criptografados nem sincronizados**. Use em equipamento privado e confiável.
- O token fica no `sessionStorage` da mesma origem da Central; não é enviado para o cliente na proposta.
- A exportação JSON contém custo e margem internos e deve ser guardada de forma privada. `Copiar proposta` e `Imprimir/PDF` não revelam esses detalhes.
- A ferramenta não cria cobrança, pedido ou oferta e não mexe nos webhooks do Asaas.

## Testes

`npm run check` valida o código e as regras de preço; `npm run test:worker` testa as rotas Worker; `npm run test:ui` valida desktop/mobile no navegador. Um teste de regressão impede voltar a adicionar segundo Worker ao código do precificador.
