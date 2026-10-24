# Consulta de cobrança do PDV Total

Endpoint aditivo e somente leitura: `POST /v1/integrations/pdv/billing-status`, disponível no Worker e no Node self-hosted.

Usa exclusivamente o segredo já configurado para o conector `pdv-total-saas`. A assinatura HMAC-SHA256 cobre `timestamp + '.' + caminho + '.' + corpo JSON bruto`; timestamp válido por cinco minutos. O corpo recebe `tenantId` e até 50 pares `orderId`/`userId`. Cada pedido é conferido contra produto e vínculo original da compra, mesmo após o vencimento do ticket histórico.

A resposta contém apenas identificador, status de pagamento, estado do checkout e estado de entrega. Não expõe e-mail, token de acesso, binding nem credenciais de Asaas. Pedidos ausentes ou de outro vínculo retornam o mesmo status indisponível. A operação não chama Asaas, não concilia, não cria jobs e não concede licenças.

Publicar esta alteração antes da interface correspondente do PDV. Não exige alterações de schema ou secrets. Reverter o commit remove apenas a consulta; o PDV deve apresentar status indisponível, mantendo trial e entregas financeiras existentes.

Validação: `npm run check` (114 testes aprovados), incluindo assinatura inválida, timestamp vencido, assinatura de outra finalidade, limites, isolamento, Worker/D1 e HTTP self-hosted. Novo envio real e consulta administrativa do pedido de homologação continuam sendo verificações de produção separadas.
