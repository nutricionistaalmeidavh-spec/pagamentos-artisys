# Precificador comercial da ArtiSys

Ferramenta interna para diagnósticos durante reuniões de BI, automações e sistemas sob medida.

## Acesso e publicação

- Na Central de Pagamentos: `/precificar` (rota adicionada tanto ao Worker quanto ao servidor Node).
- Subdomínio planejado: `https://precificar.pagamentos.artisys.dev/` (ainda **não** vinculado; não anunciar como disponível antes de verificar DNS e acesso).
- **Cloudflare:** após o merge na branch principal e o deploy concluído, abra Workers & Pages → `pagamentos-artisys-central` → Settings → Domains & Routes → Add Custom Domain → `precificar.pagamentos.artisys.dev`. Só fazer isso caso a zona DNS `artisys.dev` esteja sob a mesma conta e haja controle do domínio. A configuração não deve retirar ou mudar `pagamentos.artisys.dev`.
- O Worker detecta apenas o hostname exato `precificar.pagamentos.artisys.dev`: a raiz deste host abre o precificador. A raiz de outros hosts permanece o checkout.
- **Self-hosted:** `npm start`, definir `ADMIN_TOKEN` forte de 32+ caracteres e colocar um proxy reverso HTTPS na frente do Node, apontando o subdomínio para o servidor. Não exige Cloudflare; usa SQLite local existente e arquivos HTML/JS/CSS incluídos.
- O precificador usa o endpoint `/v1/admin/summary` exclusivamente para autenticar a sessão; o mesmo token do painel de pagamentos fica em `sessionStorage`, nunca em URL ou na proposta.

## Fluxo na reunião

1. Selecionar o tipo de serviço: BI obras, BI industrial, BI planilhas, automação ou sistema.
2. Registrar cliente, contato e escopo, horas estimadas de cada etapa e prazo.
3. Informar **custo interno** da hora, despesas, contingência, alíquota estimada e margem-alvo.
4. Opcionalmente avaliar fontes, qualidade de dados, atualização e permissões; clicar em **Aplicar reserva sugerida** se fizer sentido. O diagnóstico não muda os preços sozinho.
5. Checar preço sugerido, equilíbrio financeiro, impostos previstos, lucro e margem efetiva; ajustar o desconto se necessário.
6. Copiar proposta sem divulgar custos internos; salvar ou exportar a estimativa e apresentar investimento na reunião.

## Fórmula

- Custo direto = horas previstas × custo interno/h + despesas externas.
- Reserva de risco = custo direto × risco %.
- Custo total = custo direto + reserva.
- Preço alvo = custo total / [1 - (tributos % + margem alvo %) / 100].
- Arredondamento comercial: para cima, em múltiplos de R$ 50.
- Preço final = preço arredondado × (1 - desconto %).
- Ponto de equilíbrio = custo total / (1 - tributos %).
- Lucro estimado = preço final - tributos estimados - custo total.
- Margem efetiva = lucro estimado / preço final.

**Atenção:** margem não é markup. O campo de tributos é apenas uma estimativa e requer orientação contábil. Custos recorrentes/infraestrutura, se houver, devem ser negociados separadamente. O suporte mensal não entra na conta da implantação e não é ativado automaticamente.

## Privacidade e segurança

- UI estática pública, mas o **uso requer token administrativo** validado na API existente.
- Orçamentos e nomes de clientes são gravados **somente no armazenamento local do navegador (localStorage)**. Não há nova tabela D1, API, pagamento, pedido, oferta, webhook ou transmissão de orçamento.
- O armazenamento local **não é criptografado**, não sincroniza dispositivos nem subdomínios. Use apenas dispositivo confiável; para migrar, exporte uma cópia e apague-a do equipamento quando não for mais necessária.
- A exportação JSON inclui custos e margem internos: é apenas para controle interno. A proposta copiada/versão para imprimir exclui esses detalhes.
- Não inclua dados pessoais desnecessários, contratos privados ou segredos nas observações.
- Nunca passe `ADMIN_TOKEN` por link, query string ou compartilhamento de tela.
- Em execução pública, evite armazenar token em sessões compartilhadas e proteja o acesso ao dispositivo.

## Custo e dependências

A implementação usa JavaScript nativo, Node.js e os componentes já presentes no repositório, sem SDK pago, API de IA, fontes externas nem licença. A execução local é open source e self-hosted; a opção Cloudflare segue a infraestrutura existente da Central de Pagamentos, sujeita aos limites do plano contratado.

## Testes

```bash
npm run check
npm run test:worker
```

Os testes cobrem cálculo de margem, desconto, risco, ponto de equilíbrio, payback, proposta textual, rota Worker e execução Node. Nenhum teste cria cobrança real.
