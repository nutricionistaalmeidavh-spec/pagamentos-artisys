# Instaladores canônicos dos quatro sistemas: GitHub → R2

Esta documentação substitui a relação antiga de arquivos do Drive. A fonte oficial de cada variante é o GitHub de seu produto, e a cópia de distribuição é armazenada no R2 privado.

| Oferta | Plataforma | Versão | Fonte |
|---|---|---:|---|
| Obra na Mão | Windows | 2.1.0 | GitHub Actions `OBRANAMAOCOMERCIAL` |
| PDV ArtiSys | Windows 10/11 | 2.0.7 | [GitHub Release](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS/releases/tag/v2.0.7) |
| PDV ArtiSys | macOS Intel | 2.0.1 | [GitHub Actions](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS/actions/runs/37938230759) |
| PDV ArtiSys | macOS Apple Silicon | 2.0.1 | [GitHub Actions](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS/actions/runs/37938230759) |
| PDV Nexus | Windows 10/11 | 2.0.1 | [GitHub Release](https://github.com/nutricionistaalmeidavh-spec/PDVNexus/releases/tag/pdv-v2.0.1) |
| PDV Nexus | Windows 8 (32 bits) | 2.0.1 | [GitHub Release](https://github.com/nutricionistaalmeidavh-spec/PDVNexus/releases/tag/pdv-v2.0.1) |
| PDV Nexus | Windows 7 | 2.0.1 | [GitHub Release](https://github.com/nutricionistaalmeidavh-spec/PDVNexus/releases/tag/pdv-v2.0.1) |
| ArtiSys Financeiro | Windows | 0.1.0 | GitHub Actions `sistemafinanceiro` — novo workflow de distribuição |

- Os nomes finais, tamanhos, URLs exatas e SHA-256 estão em `src/system-releases.mjs`.
- Arquivos presentes no Drive foram usados apenas para comparação histórica; não são dependência do pipeline.
- O instalador do Obra 1.0.19 não faz parte do catálogo atual.
- Os DMGs são artefatos de QA aprovados do macOS, **não** uma release comercial assinada/notarizada. A homologação comercial pode demandar assinatura da Apple.
- A existência de arquivo no R2 não ativa automaticamente a entrega nem a venda.

Veja `docs/SYNC_SISTEMAS_R2_AUTOMATICO.md` para o procedimento completo de sincronização.
