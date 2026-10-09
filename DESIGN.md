---
version: alpha
colors:
  ink: "#152B40"
  navy: "#142E46"
  action: "#2466A0"
  canvas: "#F5F7FB"
  surface: "#FFFFFF"
  success: "#16734D"
  warning: "#9D621D"
  danger: "#AC3448"
typography:
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
  numbers:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
rounded:
  panel: "17px"
  input: "10px"
  button: "11px"
spacing:
  base: "4px"
components:
  Panel:
    background: "#FFFFFF"
    borderRadius: "17px"
  PrimaryButton:
    background: "#142E46"
    borderRadius: "11px"
  Navigation:
    background: "#FFFFFF"
    active: "#E9F2FA"
---
# Pagamento ArtiSys · Design system

## Overview
Central operacional financeira para o administrador de múltiplos produtos ArtiSys. Prioridade em **situação → decisão → ação → confirmação**, não em enfeites de dashboard. A estética preserva o azul escuro do produto; sem rebrand, sem gradientes ornamentais ou cores de bancos concorrentes. O protótipo aprovado é a referência de composição, não de dados.

## Colors
As variáveis canônicas executáveis estão em `public/admin.css` (`--navy`, `--ink`, `--blue`, `--muted`, `--line`, `--green`, `--amber`, `--red`). As cores semânticas não informam pagamento até o backend confirmar o estado. Superfícies claras reforçam legibilidade de dados.

## Typography
Fonte nativa do sistema (iOS/macOS e fallback Segoe UI) mantém legibilidade, especialmente quantias e longos identificadores de pedido. Valores financeiros em números tabulares quando aplicável, sem truncamento.

## Layout
Mobile-first: até 799px navegação inferior com `safe-area-inset-bottom` e áreas de toque de 44px ou mais; a partir de 800px navegação superior discreta. Cards no mobile; duas colunas para listas no desktop. Nenhuma tabela fixa de 670px. `public/style.css` pertence ao checkout público e não deve ser alterado pelas decisões visuais do painel.

## Elevation & Depth
Superfícies brancas com borda suave e sombra mínima. O único bloco escuro destacado é o aviso de operação/pendência no início.

## Shapes
Raios de 10–17px para controles e cartões, sem excessos. Modal vira folha inferior no iPhone e diálogo central no desktop.

## Components
Nav: Início, Pedidos, Ofertas e Mais; filtros como botões com `aria-pressed`; pedido/entrega em chips semânticos separados; formulários com labels visíveis; confirmação financeira em modal com foco retido; avisos persistentes para pendências.

## Do's and Don'ts
- **Faça**: destaque a ação necessária antes de métricas, mostre pagamento e entrega separadamente, mantenha os rascunhos de ofertas.
- **Não faça**: alegar que uma API key presente é API autenticada, publicar produto sem entrega configurada, confirmar Pix por comprovante ou tratar webhook enviado como liberação de licença.
- Não transportar tokens nem mocks de demo para cliente. Segredos continuam apenas no runtime.
