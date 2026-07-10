# Contexto Operacional

Data: 2026-04-13

## Templates

- Os templates base do projeto ficam em `core/templates`.
- Template de produção: `core/templates/template_plano_fogo_producao_realizado.xls`
- Template de pré-corte: `core/templates/template_plano_fogo_precorte_realizado.xls`
- Os templates redundantes nas pastas de input foram removidos para evitar divergência.

## Pré-corte realizado

### Fontes usadas

- `data/inputs/precorte_realizado/previsto.csv`
- `data/inputs/precorte_realizado/realizado.csv`
- `data/inputs/precorte_realizado/PC.xlsx`
- `data/inputs/precorte_realizado/PP.pdf`
- `data/inputs/precorte_realizado/Consumo.png`
- `data/inputs/precorte_realizado/HISTO-*.txt`

### Regras já confirmadas

- `Banco / Área` deve ser definido pela cota dominante.
- Exemplo: maioria dos furos em cota 280 => `280-270`.
- Interpretação: `cota-cota_pé`.
- No pré-corte atual, a regra foi aplicada a partir da moda de `Z` no `ID`.

- O encartuchado deve vir da imagem `Consumo.png`.
- No caso atual, o OCR encontrou candidatos `[100, 750]` e o valor correto aplicado foi `750 kg`.
- No pré-corte, esta e uma regra permanente do software: as cargas dos furos reais devem sempre ser redistribuidas para coincidir exatamente com o total detectado na imagem de consumo.
- A redistribuição deve considerar apenas os furos realmente detonados do pré-corte.
- No caso atual, isso significa usar os 53 furos com `r_length` preenchido no `realizado.csv`, e não os 183 furos do arquivo.
- Se houver diferenca de arredondamento na distribuicao por furo, o residuo final deve ser aplicado no ultimo furo para fechar exatamente com o total da imagem.
- Regra consolidada no script atual: quando o plano e pré-corte, a redistribuicao de cargas deve ser proporcional à profundidade realizada e fechar no total alvo de `400 kg`.
- Organizacao de execução: usar `data/inputs/PC` e `data/outputs/PC` para pré-corte, `data/inputs/PP` e `data/outputs/PP` para produção.

- `Material 1` deve vir do plano de perfuração ou da liberação, se existir na pasta.
- No caso atual, o texto detectado foi `Minério/ Estéril`.
- Hoje o campo foi colocado em `AA31` e está aparecendo como `Minério/ Estéril`.

- `Material 2` está separado no código, mas a fonte atual não trouxe um segundo valor confiável.

### Estado atual do pré-corte

- `ID.csv` do pré-corte está sendo gerado com:
  - somente os furos realmente detonados do pré-corte;
  - `Length` realizado;
  - `InputedCharge` redistribuído para fechar exatamente com o total da imagem de consumo;
  - `X_Toe/Y_Toe/Z_Toe` recalculados geometricamente.

- O plano é gerado em:
  - `data/outputs/precorte_realizado/Plano de Fogo - PRÉ-CORTE-190426/`

### Pendências conhecidas

- A regra final de `M10` ainda não está fechada.
- A regra final de `AA39/AA40/E18` ainda não está fechada.
- As abas técnicas do template de pré-corte ainda possuem placeholders herdados do modelo e precisam de refinamento adicional.

## Diretriz para outros agentes

- Não recriar templates nas pastas de input.
- Usar sempre `core/templates` como fonte padrão dos modelos.
- Antes de alterar o pré-corte, verificar as regras registradas aqui.
- Quando descobrir uma nova regra de negócio, atualizar este arquivo.
